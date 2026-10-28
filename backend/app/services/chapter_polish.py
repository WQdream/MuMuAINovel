"""章节生成后的自动去味：把「AI 去味」工作台的流程挂到创作链路上。

章节生成（chapters.py）本身不做去味；这里负责在三条生成路径写回正文之前，
跑一次 story-deslop 改写，并把原文快照存进 generation_history，让「写回正文」
永远可以回滚。自动流程只跑一轮改写 + 确定性标点整理，不做复改：复改是为了把
脚本 blocking 清零，容易把刚写的章节改紧、改短，那件事交给人工按钮。
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.logger import get_logger

logger = get_logger(__name__)

# 自动去味的最小正文长度：太短的片段（例如只写了一段开头）不值得额外一次调用，
# 也更容易在改写中被改没。
MIN_AUTO_POLISH_CHARS = 120


class AutoPolishUnavailable(RuntimeError):
    """当前环境或配置无法执行自动去味，调用方据此保留原文并如实提示"""


def _content_from_response(response: Any) -> str:
    if isinstance(response, dict):
        return (response.get("content") or "").strip()
    return (response or "").strip()


async def auto_polish_text(
    *,
    text: str,
    ai_service: Any,
    model: Optional[str] = None,
    user_id: Optional[str] = None,
    db: Optional[AsyncSession] = None,
) -> dict:
    """对刚生成的正文跑一轮 story-deslop 改写，返回写回用的正文与分析

    Returns:
        {"polished": str, "analysis": str, "notes": list[str],
         "score_before": int, "score_after": int,
         "blocking_before": int, "blocking_after": int,
         "punctuation_fixed": int, "checker_available": bool}

    Raises:
        AutoPolishUnavailable: 正文太短、模型没有交付可用正文、或调用本身失败。
            调用方必须保留原稿，不能写入残缺内容。
    """
    from app.services.polish_output import (
        PolishOutputError,
        extract_polish_output,
    )

    original = (text or "").strip()
    if len(original) < MIN_AUTO_POLISH_CHARS:
        raise AutoPolishUnavailable(
            f"正文仅 {len(original)} 字，低于自动去味的最小长度 {MIN_AUTO_POLISH_CHARS} 字"
        )

    # 延迟导入：polish.py 里有依赖注入，循环引用会在这里显形
    from app.api.polish import (
        MAX_REFINE_ROUNDS,
        _compose_prompts,
        _deslop_max_tokens,
        _extract_content,
        _resolve_prompt_mode,
    )
    from app.services.deslop_check_service import (
        check_text,
        format_findings_for_prompt,
        normalize_punctuation,
    )

    before = await check_text(original)
    # 用户在提示词工坊自定义过 AI_DENOISING 时沿用他的模板，与工作台保持一致
    mode = await _resolve_prompt_mode(user_id, db)
    system_prompt, prompt = _compose_prompts(
        mode,
        original,
        format_findings_for_prompt(before),
        refine=False,
    )

    try:
        response = await ai_service.generate_text(
            prompt=prompt,
            model=model,
            temperature=0.7,
            max_tokens=_deslop_max_tokens(original),
            system_prompt=system_prompt or None,
            auto_mcp=False,
        )
    except Exception as exc:
        raise AutoPolishUnavailable(f"去味模型调用失败：{exc}") from exc

    try:
        extraction = extract_polish_output(
            _extract_content(response),
            original_text=original,
            finish_reason=(
                response.get("finish_reason") if isinstance(response, dict) else None
            ),
        )
    except PolishOutputError as exc:
        # 自动流程不重试：残缺稿写回章节的代价比跳过一次去味大得多
        raise AutoPolishUnavailable(f"模型没有交付完整正文：{exc}") from exc

    polished = extraction.body
    after = await check_text(polished)
    punctuation_fixed = 0
    # 与工作台一致：只在语义改写干净后再做确定性的标点整理，零 token
    if after.available and after.blocking == 0:
        norm = await normalize_punctuation(polished)
        if norm["available"] and norm["changed"]:
            polished = norm["normalized"]
            punctuation_fixed = norm["count"]
            after = await check_text(polished)

    return {
        "polished": polished,
        "analysis": extraction.analysis,
        "notes": list(extraction.notes),
        "score_before": before.score,
        "score_after": after.score,
        "blocking_before": before.blocking,
        "blocking_after": after.blocking,
        "punctuation_fixed": punctuation_fixed,
        "checker_available": after.available,
        "rounds": 1,
        "max_rounds": MAX_REFINE_ROUNDS,
    }


SNAPSHOT_MARKER = "[自动去味快照]"
ANALYSIS_MARKER = "[自动去味分析]"


def build_polish_snapshot_record(
    *,
    project_id: str,
    chapter_id: Optional[str],
    chapter_number: Optional[int],
    chapter_title: Optional[str],
    original_content: str,
    result: dict,
    model: Optional[str],
    label: str,
) -> Any:
    """把去味前的完整原文存进 generation_history，作为「写回正文」的回滚快照

    generated_content 存的是回滚需要的原文全文；prompt 以固定前缀开头，
    既能在「生成历史」里认出这是快照，也能被 latest_polish_snapshot 精确找回。
    """
    from app.models.generation_history import GenerationHistory

    summary = (
        f"{SNAPSHOT_MARKER} {label}｜第{chapter_number}章 {chapter_title or ''}｜"
        f"干净度 {result.get('score_before')}→{result.get('score_after')}｜"
        f"必须改 {result.get('blocking_before')}→{result.get('blocking_after')}"
    )
    return GenerationHistory(
        project_id=project_id,
        chapter_id=chapter_id,
        prompt=summary,
        generated_content=original_content,
        model=model or "default",
    )


async def auto_polish_chapter_content(
    *,
    text: str,
    ai_service: Any,
    model: Optional[str] = None,
    label: str = "生成后自动去味",
    user_id: Optional[str] = None,
    db: Optional[AsyncSession] = None,
) -> dict:
    """供章节生成调用的一层包装：统一异常语义，返回可读日志字段"""
    result = await auto_polish_text(
        text=text,
        ai_service=ai_service,
        model=model,
        user_id=user_id,
        db=db,
    )
    logger.info(
        f"✨ {label}: 干净度 {result['score_before']}→{result['score_after']}，"
        f"必须改 {result['blocking_before']}→{result['blocking_after']}"
        + (f"，整理标点 {result['punctuation_fixed']} 处" if result["punctuation_fixed"] else "")
    )
    return result


async def latest_polish_snapshot(
    db: AsyncSession,
    chapter_id: str,
) -> Optional[dict]:
    """取最近一次自动去味的原文快照，供「恢复自动去味前的原文」使用"""
    from sqlalchemy import select

    from app.models.generation_history import GenerationHistory

    result = await db.execute(
        select(GenerationHistory)
        .where(GenerationHistory.chapter_id == chapter_id)
        .where(GenerationHistory.prompt.like(f"{SNAPSHOT_MARKER}%"))
        .order_by(GenerationHistory.created_at.desc())
        .limit(1)
    )
    row = result.scalars().first()
    if not row or not (row.generated_content or "").strip():
        return None
    return {
        "id": row.id,
        "note": row.prompt,
        "content": row.generated_content,
        "created_at": row.created_at,
    }


async def polish_chapter_after_generation(
    *,
    db: AsyncSession,
    chapter: Any,
    project: Any,
    generated_content: str,
    ai_service: Any,
    model: Optional[str] = None,
    user_id: Optional[str] = None,
    label: str = "生成后自动去味",
) -> tuple[str, dict]:
    """把刚生成的正文过一遍去味，并写好回滚快照

    只负责改写与快照记录，不 commit：三条生成路径各自的提交时机与写锁不同，
    由调用方在同一事务里落库。失败时返回原稿，让调用方照常保存完整正文。

    Returns:
        (要写入章节的正文, 结果字典或 {"skipped": 原因})
    """
    try:
        result = await auto_polish_chapter_content(
            text=generated_content,
            ai_service=ai_service,
            model=model,
            label=label,
            user_id=user_id,
            db=db,
        )
    except AutoPolishUnavailable as exc:
        logger.warning(f"⚠️ {label}已跳过: {exc}")
        return generated_content, {"skipped": str(exc)}
    except Exception as exc:
        logger.error(f"❌ {label}异常，保留原稿: {exc}", exc_info=True)
        return generated_content, {"skipped": f"自动去味异常：{exc}"}

    db.add(
        build_polish_snapshot_record(
            project_id=chapter.project_id,
            chapter_id=chapter.id,
            chapter_number=chapter.chapter_number,
            chapter_title=chapter.title,
            original_content=generated_content,
            result=result,
            model=model,
            label=label,
        )
    )
    # 分析单独存一条，既不污染回滚用的原文快照，也能在生成历史里回看
    if result.get("analysis"):
        from app.models.generation_history import GenerationHistory

        db.add(
            GenerationHistory(
                project_id=chapter.project_id,
                chapter_id=chapter.id,
                prompt=(
                    f"{ANALYSIS_MARKER} {label}｜第{chapter.chapter_number}章 "
                    f"{chapter.title or ''}"
                ),
                generated_content=result["analysis"],
                model=model or "default",
            )
        )
    return result["polished"], result
