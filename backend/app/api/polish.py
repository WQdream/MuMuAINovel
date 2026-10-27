"""AI去味API - 核心特色功能

改写规则来自 story-deslop Skill（上游 oh-story-claudecode，已同步 v0.9.1），
改前/改后的「必须改 / 建议改」计数与收尾的标点整理，来自随 Skill 分发的确定性 Node 脚本。
流程对齐 skill 的 Phase 1–4：检测 → 改写 → 复扫 →（仍有 blocking 且允许时）复改 → 整理标点 → 复扫。
检测不可用（运行环境无 Node）时自动降级为纯模型改写，并如实标注未检测。
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.generation_history import GenerationHistory
from app.user_manager import User
from app.schemas.polish import (
    PolishBatchRequest,
    PolishCheckRequest,
    PolishRequest,
    PolishResponse,
)
from app.services.ai_service import AIService
from app.services.deslop_check_service import (
    check_text,
    format_findings_for_prompt,
    normalize_punctuation,
)
from app.services.prompt_service import PromptService
from app.services.skill_loader import get_skill_detail
from app.logger import get_logger
from app.api.settings import get_user_ai_service, require_login

router = APIRouter(prefix="/polish", tags=["AI去味"])
logger = get_logger(__name__)

DESLOP_SKILL_KEY = "SKILL_STORY_DESLOP"

# 复改轮数上限：上游 skill 规定「全文扫描最多三轮」，这里是首轮改写 + 两轮复改
MAX_REFINE_ROUNDS = 3


def _extract_content(response) -> str:
    """generate_text 返回 dict（含 content/tool_calls/usage），流式接口返回字符串"""
    if isinstance(response, dict):
        return (response.get("content") or "").strip()
    return (response or "").strip()


def _deslop_system_prompt() -> Optional[str]:
    """取 story-deslop 的完整工作流作为系统提示词（含 references 与 Web 宿主降级说明）"""
    try:
        detail = get_skill_detail(DESLOP_SKILL_KEY)
    except Exception as exc:  # skill 目录异常不应阻断去味
        logger.warning(f"加载去味 Skill 失败，改用内置提示词: {exc}")
        return None
    if not detail:
        logger.warning(f"未找到去味 Skill: {DESLOP_SKILL_KEY}")
        return None
    return detail["content"]


@router.post("", response_model=PolishResponse, summary="AI去味")
async def polish_text(
    request: PolishRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service)
):
    """AI去味：按 story-deslop 工作流改写，并用确定性脚本给出改前/改后计数"""
    try:
        user_id = getattr(http_request.state, 'user_id', None)
        result = await _polish_once(
            original_text=request.original_text,
            ai_service=user_ai_service,
            user_id=user_id,
            db=db,
            provider=request.provider,
            model=request.model,
            temperature=request.temperature,
            refine_until_clean=request.refine_until_clean,
            project_id=request.project_id,
        )
        return result
    except HTTPException:
        # 400 空文本 / 502 模型无返回等已定性的错误，不能被重写成 500 掩盖原因
        raise
    except Exception as e:
        logger.error(f"AI去味失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI去味失败: {str(e)}")


def _findings_block(findings_text: str) -> str:
    if not findings_text:
        return ""
    return f"\n【确定性检查命中（脚本定位线索，不是 AIGC 检测分数）】\n{findings_text}\n"


def _render_custom_template(template: str, original_text: str) -> str:
    """兼容历史契约：用户在提示词工坊自定义的 AI_DENOISING 是含 {original_text} 的 user prompt

    用 replace 而不是 str.format，避免模板里的其他 `{}` 触发 KeyError。
    """
    if "{original_text}" in template:
        return template.replace("{original_text}", original_text)
    return f"{template.rstrip()}\n\n【正文】\n{original_text}\n"


def _build_user_prompt(original_text: str, findings_text: str, *, refine: bool = False) -> str:
    """默认（未自定义模板时）的任务指令"""
    if refine:
        head = (
            "上一版改写后，确定性检查仍发现下列必须修掉的问题。"
            "只针对这些问题做最小改动，保住剧情、人称、专有名词与字数，"
            "不要重写没被点到的句子。\n\n"
        )
    else:
        head = "请按工作流对下面这段正文做去AI味改稿。先三层扫描，再按最小改动交付改后的完整正文。\n\n"
    return head + f"【正文】\n{original_text}\n" + _findings_block(findings_text)


async def _resolve_prompt_mode(
    user_id: Optional[str],
    db: Optional[AsyncSession],
) -> tuple[Optional[str], Optional[str]]:
    """决定提示词来源，只解析一次（供各轮复用，避免每轮重复查库和读 Skill）

    用户若自定义过 AI_DENOISING，完整尊重它（沿用历史：它独自构成任务提示词，不叠加 Skill 规则），
    否则用 story-deslop 工作流做 system prompt + 默认任务指令。

    返回 (custom_template 或 None, system_prompt)
    """
    custom: Optional[str] = None
    if user_id and db is not None:
        try:
            custom = await PromptService.get_template("AI_DENOISING", user_id, db)
        except Exception as exc:
            logger.warning(f"读取自定义去味模板失败，改用 story-deslop Skill: {exc}")
            custom = None

    if custom:
        return custom, None

    skill_prompt = _deslop_system_prompt()
    if not skill_prompt:
        # Skill 不可用时兜底，保证接口不因此 500
        skill_prompt = "你是网文去AI味编辑。只改表达，不改剧情、人设与因果，输出改写后的正文本身。"
    return None, skill_prompt


def _compose_prompts(
    mode: tuple[Optional[str], Optional[str]],
    original_text: str,
    findings_text: str,
    *,
    refine: bool,
) -> tuple[Optional[str], str]:
    custom, system_prompt = mode
    if custom:
        return None, _render_custom_template(custom, original_text) + _findings_block(findings_text)
    return system_prompt, _build_user_prompt(original_text, findings_text, refine=refine)


async def _polish_once(
    *,
    original_text: str,
    ai_service: AIService,
    user_id: Optional[str],
    db: AsyncSession,
    provider: Optional[str],
    model: Optional[str],
    temperature: Optional[float],
    refine_until_clean: bool,
    project_id: Optional[str] = None,
) -> PolishResponse:
    """改前检测 → 改写 → 复扫 → 必要时复改，返回带分数的结果"""
    if not original_text or not original_text.strip():
        raise HTTPException(status_code=400, detail="original_text 不能为空")

    before = await check_text(original_text)
    mode = await _resolve_prompt_mode(user_id, db)

    current = original_text
    findings_text = format_findings_for_prompt(before)
    after = before
    rounds = 0
    punctuation_fixed = 0

    for attempt in range(MAX_REFINE_ROUNDS):
        refine = attempt > 0
        system_prompt, prompt = _compose_prompts(mode, current, findings_text, refine=refine)

        response = await ai_service.generate_text(
            prompt=prompt,
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=max(len(original_text) * 3, 4096),
            system_prompt=system_prompt or None,
            auto_mcp=False,
        )
        rewritten = _extract_content(response)
        if not rewritten:
            raise HTTPException(status_code=502, detail="AI 未返回改写结果，请检查模型配置")
        rounds += 1

        # 脚本不可用时不做复改，避免拿不到依据还反复烧 token
        after = await check_text(rewritten)
        current = rewritten
        if not after.available or after.blocking == 0:
            break
        if not refine_until_clean:
            break
        findings_text = format_findings_for_prompt(after)
        logger.info(f"AI去味第 {rounds} 轮后仍有 {after.blocking} 处必须改，自动复改")

    # Phase 4：语义改完、复扫没有 blocking 之后，再跑确定性的标点整理（不花 token）
    if after.available and after.blocking == 0:
        norm = await normalize_punctuation(current)
        if norm["available"] and norm["changed"]:
            current = norm["normalized"]
            punctuation_fixed = norm["count"]
            after = await check_text(current)

    if project_id:
        try:
            history = GenerationHistory(
                project_id=project_id,
                prompt=f"原文: {original_text[:100]}...",
                generated_content=(
                    f"[AI去味 {rounds} 轮] "
                    f"干净度 {before.score}→{after.score}，"
                    f"必须改 {before.blocking}→{after.blocking}"
                    + (f"，整理标点 {punctuation_fixed} 处" if punctuation_fixed else "")
                    + f"\n\n{current[:2000]}"
                ),
                model=model or "default",
            )
            db.add(history)
            await db.commit()
        except Exception as exc:
            # 记历史失败不该让已经拿到的改写结果变成 500
            await db.rollback()
            logger.warning(f"写入去味生成历史失败（结果仍返回）: {exc}")

    return PolishResponse(
        original_text=original_text,
        polished_text=current,
        word_count_before=len(original_text),
        word_count_after=len(current),
        score_before=before.score,
        score_after=after.score,
        blocking_before=before.blocking,
        blocking_after=after.blocking,
        findings=after.findings,
        rounds=rounds,
        checker_available=after.available,
        check_error=after.error,
        punctuation_fixed=punctuation_fixed,
    )


@router.post("/normalize-punctuation", summary="仅整理标点（确定性，不调模型）")
async def polish_normalize_punctuation(
    request: PolishCheckRequest,
    user: User = Depends(require_login),
):
    """跑上游 normalize-punctuation：省略号/破折号/双连字符与 markdown 分隔线的机械整理

    零 token 消耗，适合「内容已经定稿，只想把 AI 式标点洗掉」。白名单机制沿用
    skill 的 .deslop-whitelist（Web 宿主没有书目录，故不加载）。
    """
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="text 不能为空")
    result = await normalize_punctuation(request.text)
    if not result["available"]:
        raise HTTPException(status_code=503, detail=result["error"] or "标点脚本不可用")
    return result


@router.post("/check", summary="仅检测AI味（不改写）")
async def polish_check(
    request: PolishCheckRequest,
    user: User = Depends(require_login),
):
    """跑确定性检查脚本返回问题清单与干净度，供「先看看有多少 AI 味」使用"""
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="text 不能为空")
    report = await check_text(request.text)
    return report.to_dict()


@router.post("/batch", summary="批量AI去味")
async def polish_batch(
    request: PolishBatchRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    """逐条走与单文本相同的「检测 → 改写 → 复扫」流程

    串行执行：单条内部已可能复改多轮，并发会瞬间打满模型限流。
    """
    if not request.texts:
        raise HTTPException(status_code=400, detail="texts 不能为空")

    user_id = getattr(http_request.state, 'user_id', None) if http_request else None

    try:
        results = []
        for idx, text in enumerate(request.texts):
            logger.info(f"批量去味 {idx + 1}/{len(request.texts)}")
            result = await _polish_once(
                original_text=text,
                ai_service=user_ai_service,
                user_id=user_id,
                db=db,
                provider=request.provider,
                model=request.model,
                temperature=request.temperature,
                refine_until_clean=request.refine_until_clean,
                project_id=request.project_id,
            )
            results.append(result)

        return {
            "total": len(results),
            # polished_texts 与前端 polishApi.polishBatch 的既有契约保持一致
            "polished_texts": [item.polished_text for item in results],
            "results": [item.model_dump() for item in results],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"批量AI去味失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"批量AI去味失败: {str(e)}")
