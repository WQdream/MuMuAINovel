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
    PolishAnalyzeRequest,
    PolishAnalyzeResponse,
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
from app.services.polish_output import (
    PolishOutputError,
    extract_analysis_only,
    extract_polish_output,
)
from app.services.skill_loader import get_skill_detail
from app.logger import get_logger
from app.api.settings import get_user_ai_service, require_login

router = APIRouter(prefix="/polish", tags=["AI去味"])
logger = get_logger(__name__)

DESLOP_SKILL_KEY = "SKILL_STORY_DESLOP"

# 复改轮数上限：上游 skill 规定「全文扫描最多三轮」，这里是首轮改写 + 两轮复改
MAX_REFINE_ROUNDS = 3

# 单次改写至少留足原文 + 思考预算；上限沿用章节生成的 20000，
# 防止本地模型因上下文窗口较小而直接拒绝请求。思考型模型会先消耗大量
# reasoning token，4096 往往还没写到正文结尾就被截断。
MIN_DESLOP_MAX_TOKENS = 12000
MAX_DESLOP_MAX_TOKENS = 20000


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
    """默认（未自定义模板时）的任务指令

    story-deslop 的 Phase 5 原本会附报告；Web 工作台要的是可直接写回的正文，
    所以这里明确覆盖交付格式，避免报告被当成正文保存。
    """
    if refine:
        task = (
            "上一版改写后，确定性检查仍发现下列必须修掉的问题。"
            "只针对这些问题做最小改动，保住剧情、人称、专有名词与字数，"
            "不要重写没被点到的句子。\n\n"
        )
    else:
        task = "请按工作流对下面这段正文做去AI味改稿，按最小改动处理。\n\n"
    output_contract = (
        "【输出要求（最高优先级）】\n"
        "严格按下面两个标签输出，不得增加其他标签或前言：\n"
        "<正文>\n"
        "改写后的完整正文，从第一句到最后一句，覆盖原稿全部段落与情节点，"
        "不得省略、缩写或以“……”代替。\n"
        "</正文>\n"
        "<分析>\n"
        "用简短中文列出你实际判断的问题和改法，按表达、用笔、故事三层组织；"
        "这是给作者看的依据，不要重复正文。\n"
        "</分析>\n"
        "必须先写完 </正文>，再写分析，防止分析占用正文的输出预算。\n\n"
    )
    return (
        task
        + output_contract
        + f"【待改写正文】\n{original_text}\n"
        + _findings_block(findings_text)
        + "\n再次强调：你的整条回答就是改后正文本身，不能附带报告。"
    )


def _build_analysis_prompt(original_text: str, findings_text: str) -> str:
    """只诊断、不改写；报告单独返回给分析标签，绝不进入正文"""
    return (
        "【本次任务：只分析，不改写】\n"
        "请按 story-deslop 的三层扫描方法诊断下面这段正文，指出真实存在的问题、"
        "所在位置和可执行的修改方向。不要改写原文，不要输出任何“改后正文”，"
        "也不要把诊断写成小说片段。\n\n"
        "【输出要求（最高优先级）】\n"
        "只输出一个 <分析>…</分析> 区块，不要输出 <正文> 或其他标签。\n"
        "分析按「表达层 / 用笔层 / 故事层」组织；每层先给结论，再列具体证据。\n"
        "如果脚本命中与你的判断冲突，以原文语境为准，并说明为什么。\n\n"
        f"【待分析正文】\n{original_text}\n"
        + _findings_block(findings_text)
    )


def _deslop_max_tokens(original_text: str) -> int:
    """给正文与思考型模型的 reasoning 留足预算，避免后半章被截断"""
    return max(
        MIN_DESLOP_MAX_TOKENS,
        min(len(original_text) * 3 + 4096, MAX_DESLOP_MAX_TOKENS),
    )


def _analysis_max_tokens(original_text: str) -> int:
    """分析通常比全文改写短，但仍给思考型模型留足 reasoning 预算"""
    return max(4096, min(len(original_text) * 2 + 2048, 12000))


def _extract_polish_result(response, original_text: str):
    finish_reason = response.get("finish_reason") if isinstance(response, dict) else None
    return extract_polish_output(
        _extract_content(response),
        original_text=original_text,
        finish_reason=finish_reason,
    )


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
    retry_note: str = "",
) -> tuple[Optional[str], str]:
    custom, system_prompt = mode
    if custom:
        prompt = _render_custom_template(custom, original_text) + _findings_block(findings_text)
        return None, retry_note + prompt
    return system_prompt, retry_note + _build_user_prompt(original_text, findings_text, refine=refine)


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
    target_text = original_text
    findings_text = format_findings_for_prompt(before)
    after = before
    rounds = 0
    punctuation_fixed = 0
    output_notes: list[str] = []
    analysis = ""
    analysis_by_round: list[dict] = []
    refine_round = False
    retry_note = ""

    for attempt in range(MAX_REFINE_ROUNDS):
        system_prompt, prompt = _compose_prompts(
            mode,
            target_text,
            findings_text,
            refine=refine_round,
            retry_note=retry_note,
        )

        response = await ai_service.generate_text(
            prompt=prompt,
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=_deslop_max_tokens(original_text),
            system_prompt=system_prompt or None,
            auto_mcp=False,
        )
        try:
            extraction = _extract_polish_result(response, original_text)
        except PolishOutputError as exc:
            detail = str(exc)
            if exc.code == "truncated":
                detail += "。请调高该模型的输出上限，或关闭“思考”后重试"
            if rounds > 0:
                # 复改输出不合格时，上一版已是完整正文；保留它并如实标记
                # 剩余命中，比丢弃结果或写回残缺稿更安全。
                logger.warning(f"AI去味复改输出不合格，保留上一版完整正文：{detail}")
                break
            # 模型首次常把 Skill 的“检查报告 + 正文”整体输出，剥离后仍缺尾时
            # 允许再要一次纯正文，不能把残缺稿交给“写回本章”。
            if attempt + 1 < MAX_REFINE_ROUNDS:
                logger.warning(f"AI去味输出不合格，重试纯正文交付：{detail}")
                mode = (
                    None,
                    "你是网文去AI味编辑。只改表达，不改剧情、人设与因果。"
                    "严格输出 <正文>完整正文</正文><分析>简短分析</分析>，"
                    "不得省略正文或附带其他说明。",
                )
                retry_note = (
                    "上一次回答没有给出可直接保存的完整正文："
                    f"{detail}。请重新改写，先完整输出 <正文>，再输出 <分析>；"
                    "务必覆盖全部段落和结尾。\n\n"
                )
                continue
            raise HTTPException(status_code=502, detail=detail) from exc
        output_notes = extraction.notes
        rewritten = extraction.body
        if extraction.analysis:
            analysis_by_round.append({"round": rounds + 1, "content": extraction.analysis})
            analysis = "\n\n".join(
                (
                    item["content"]
                    if index == 0 and len(analysis_by_round) == 1
                    else f"### 第 {item['round']} 轮\n\n{item['content']}"
                )
                for index, item in enumerate(analysis_by_round)
            )
        rounds += 1
        retry_note = ""

        # 脚本不可用时不做复改，避免拿不到依据还反复烧 token
        after = await check_text(rewritten)
        current = rewritten
        if not after.available or after.blocking == 0:
            break
        if not refine_until_clean:
            break
        findings_text = format_findings_for_prompt(after)
        target_text = current
        refine_round = True
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
        output_notes=output_notes,
        analysis=analysis,
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


@router.post("/analyze", response_model=PolishAnalyzeResponse, summary="只分析AI味（不改写）")
async def polish_analyze(
    request: PolishAnalyzeRequest,
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    """让模型按 story-deslop 做三层诊断，但只返回分析，不触碰原文

    与 /polish 的区别是这里没有“写回正文”的交付契约：模型即使误写了正文，
    也只从 </正文> 之后或 <分析> 标签中取报告，前端不会提供写回按钮。
    """
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="text 不能为空")

    report = await check_text(request.text)
    findings_text = format_findings_for_prompt(report)
    system_prompt = _deslop_system_prompt()
    if not system_prompt:
        system_prompt = (
            "你是网文去AI味编辑。你只做诊断，不改写正文；"
            "按表达、用笔、故事三层指出问题与修改方向。"
        )
    system_prompt += (
        "\n\n【本次交付边界】只输出 <分析>…</分析>，不要输出正文、"
        "不要输出改稿、不要声称已经修改。"
    )

    try:
        response = await user_ai_service.generate_text(
            prompt=_build_analysis_prompt(request.text, findings_text),
            provider=request.provider,
            model=request.model,
            temperature=request.temperature,
            max_tokens=_analysis_max_tokens(request.text),
            system_prompt=system_prompt,
            auto_mcp=False,
        )
        analysis = extract_analysis_only(_extract_content(response))
    except PolishOutputError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"AI去味分析失败: {exc}")
        raise HTTPException(status_code=500, detail=f"AI去味分析失败: {exc}") from exc

    return PolishAnalyzeResponse(
        analysis=analysis,
        score=report.score,
        blocking=report.blocking,
        advisory=report.advisory,
        findings=report.findings[:80],
        checker_available=report.available,
        check_error=report.error,
    )


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
