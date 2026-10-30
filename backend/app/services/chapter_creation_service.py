"""统一的章节创作输入、门禁修复与落库服务。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.logger import get_logger
from app.models.chapter import Chapter
from app.models.generation_history import GenerationHistory
from app.models.outline import Outline
from app.models.project import Project
from app.models.writing_style import WritingStyle
from app.schemas.tracking import ChapterPlanningContract, ChapterQualityReport
from app.services.chapter_context_service import (
    OneToManyContext,
    OneToManyContextBuilder,
    OneToOneContext,
    OneToOneContextBuilder,
)
from app.services.chapter_length_guard import (
    chapter_length_error,
    chapter_length_limits,
)
from app.services.deslop_check_service import normalize_punctuation
from app.services.foreshadow_service import foreshadow_service
from app.services.memory_service import memory_service
from app.services.prompt_service import PromptService, WritingStyleManager
from app.services.story_tracking_service import (
    ChapterQualityStatus,
    evaluate_chapter_quality,
    render_plan_contract,
    resolve_plan_contract,
    visible_char_count,
)
from app.services.writing_guards import build_creation_system_prompt, guard_for_generation
from app.utils.provider_policy import detect_policy_refusal, policy_refusal_error

logger = get_logger(__name__)

MAX_CREATION_INPUT_CHARS = 35_000
PUNCTUATION_MARKER = "【标点整理】"

ProgressCallback = Callable[[str, str], Awaitable[None]]


@dataclass
class CreationInput:
    context: OneToManyContext | OneToOneContext
    contract: ChapterPlanningContract
    prompt: str
    system_prompt: Optional[str]
    skill_injected: bool
    style_content: str
    input_chars: int
    trims: list[str] = field(default_factory=list)


@dataclass
class GeneratedChapterResult:
    content: str
    quality_report: ChapterQualityReport
    repaired: bool = False
    compressed: bool = False
    expanded: bool = False
    punctuation_fixed: int = 0


def _extract_ai_content(response: Any) -> str:
    if isinstance(response, dict):
        return str(response.get("content") or "").strip()
    return str(response or "").strip()


def _trim_to(value: Optional[str], keep: int) -> Optional[str]:
    if not value:
        return value
    if keep <= 0:
        return None
    if len(value) <= keep:
        return value
    return value[:keep].rstrip() + "\n[因 35K 输入预算截断]"


class ChapterCreationService:
    """所有生成入口共享的创作内核。"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _load_style(self, style_id: Optional[int], user_id: str) -> str:
        if not style_id:
            return ""
        style = (
            await self.db.execute(
                select(WritingStyle).where(WritingStyle.id == style_id)
            )
        ).scalar_one_or_none()
        if not style or (style.user_id is not None and style.user_id != user_id):
            return ""
        return style.prompt_content or ""

    def _format_prompt(
        self,
        *,
        template: str,
        context: OneToManyContext | OneToOneContext,
        chapter: Chapter,
        project: Project,
        target_word_count: int,
        narrative_perspective: str,
    ) -> str:
        common = {
            "project_title": project.title,
            "chapter_number": chapter.chapter_number,
            "chapter_title": chapter.title,
            "chapter_outline": context.chapter_outline,
            "target_word_count": target_word_count,
            "min_word_count": int(target_word_count * 0.9),
            "max_word_count": int(target_word_count * 1.1),
            "genre": project.genre or "未设定",
            "narrative_perspective": narrative_perspective,
            "characters_info": context.chapter_characters or "暂无角色信息",
            "chapter_careers": context.chapter_careers or "暂无职业信息",
            "foreshadow_reminders": context.foreshadow_reminders or "暂无需要关注的伏笔",
            "relevant_memories": context.relevant_memories or "暂无相关记忆",
        }
        if isinstance(context, OneToManyContext) and context.continuation_point:
            common.update(
                {
                    "continuation_point": context.continuation_point,
                    "previous_chapter_summary": context.previous_chapter_summary
                    or "（无上一章摘要，请根据锚点续写）",
                    "recent_chapters_context": context.recent_chapters_context or "",
                }
            )
        elif isinstance(context, OneToOneContext) and context.continuation_point:
            common.update(
                {
                    "previous_chapter_content": context.continuation_point,
                    "previous_chapter_summary": context.previous_chapter_summary
                    or "（无上一章摘要）",
                    "recent_chapters_context": context.recent_chapters_context
                    or "暂无最近章节摘要",
                }
            )
        return PromptService.format_prompt(template, **common)

    async def prepare(
        self,
        *,
        chapter: Chapter,
        project: Project,
        outline: Optional[Outline],
        user_id: str,
        style_id: Optional[int],
        target_word_count: int,
        narrative_perspective: Optional[str] = None,
        skill_key: Optional[str] = None,
    ) -> CreationInput:
        style_content = await self._load_style(style_id, user_id)
        if project.outline_mode == "one-to-one":
            context = await OneToOneContextBuilder(
                memory_service=memory_service,
                foreshadow_service=foreshadow_service,
            ).build(
                chapter=chapter,
                project=project,
                outline=outline,
                user_id=user_id,
                db=self.db,
                target_word_count=target_word_count,
            )
        else:
            context = await OneToManyContextBuilder(
                memory_service=memory_service,
                foreshadow_service=foreshadow_service,
            ).build(
                chapter=chapter,
                project=project,
                outline=outline,
                user_id=user_id,
                db=self.db,
                style_content=style_content,
                target_word_count=target_word_count,
                temp_narrative_perspective=narrative_perspective,
            )

        contract = resolve_plan_contract(chapter, outline)
        contract_text = render_plan_contract(contract)
        tracking_text = context.tracking_context or ""
        raw_outline = context.chapter_outline or ""
        outline_marker = "\n\n【本章细纲】\n"
        if outline_marker in raw_outline:
            _, raw_outline = raw_outline.split(outline_marker, 1)
            hard_marker = "\n\n【硬约束】"
            if hard_marker in raw_outline:
                raw_outline = raw_outline.split(hard_marker, 1)[0]

        def compose_outline(outline_text: str) -> str:
            parts = []
            if tracking_text:
                parts.append(f"【续写状态卡】\n{tracking_text}")
            parts.append(f"【本章细纲】\n{outline_text or '暂无细纲'}")
            if "## 本章细纲契约" not in outline_text:
                parts.append(contract_text)
            parts.append(
                "【硬约束】细纲契约和续写状态卡不可被摘要或改写。"
            )
            return "\n\n".join(parts)

        context.chapter_outline = compose_outline(raw_outline)

        perspective = (
            narrative_perspective
            or project.narrative_perspective
            or "第三人称"
        )
        has_previous = bool(context.continuation_point)
        if project.outline_mode == "one-to-one":
            template_key = (
                "CHAPTER_GENERATION_ONE_TO_ONE_NEXT"
                if has_previous
                else "CHAPTER_GENERATION_ONE_TO_ONE"
            )
        else:
            template_key = (
                "CHAPTER_GENERATION_ONE_TO_MANY_NEXT"
                if has_previous
                else "CHAPTER_GENERATION_ONE_TO_MANY"
            )
        template = await PromptService.get_template(template_key, user_id, self.db)
        prompt = self._format_prompt(
            template=template,
            context=context,
            chapter=chapter,
            project=project,
            target_word_count=target_word_count,
            narrative_perspective=perspective,
        )
        prompt = WritingStyleManager.apply_style_to_prompt(prompt, style_content)
        system_prompt, skill_injected = build_creation_system_prompt(
            skill_key, style_content
        )
        prompt += guard_for_generation(skill_injected)

        trims: list[str] = []
        trim_order = (
            "relevant_memories",
            "chapter_characters",
            "chapter_careers",
            "recent_chapters_context",
            "continuation_point",
        )
        for field_name in trim_order:
            total = len(prompt) + len(system_prompt or "")
            if total <= MAX_CREATION_INPUT_CHARS:
                break
            current = getattr(context, field_name, None)
            if not current:
                continue
            excess = total - MAX_CREATION_INPUT_CHARS
            keep = max(0, len(current) - excess - 64)
            setattr(context, field_name, _trim_to(current, keep))
            trims.append(field_name)
            prompt = WritingStyleManager.apply_style_to_prompt(
                self._format_prompt(
                    template=template,
                    context=context,
                    chapter=chapter,
                    project=project,
                    target_word_count=target_word_count,
                    narrative_perspective=perspective,
                ),
                style_content,
            )
            prompt += guard_for_generation(skill_injected)

        total = len(prompt) + len(system_prompt or "")
        if total > MAX_CREATION_INPUT_CHARS and raw_outline:
            excess = total - MAX_CREATION_INPUT_CHARS
            keep = max(0, len(raw_outline) - excess - 64)
            raw_outline = _trim_to(raw_outline, keep) or ""
            context.chapter_outline = compose_outline(raw_outline)
            trims.append("chapter_outline")
            prompt = WritingStyleManager.apply_style_to_prompt(
                self._format_prompt(
                    template=template,
                    context=context,
                    chapter=chapter,
                    project=project,
                    target_word_count=target_word_count,
                    narrative_perspective=perspective,
                ),
                style_content,
            )
            prompt += guard_for_generation(skill_injected)

        total = len(prompt) + len(system_prompt or "")
        if total > MAX_CREATION_INPUT_CHARS and system_prompt:
            overflow = total - MAX_CREATION_INPUT_CHARS
            keep = max(200, len(system_prompt) - overflow - 80)
            system_prompt = (
                system_prompt[:keep].rstrip()
                + "\n[系统创作指令因 35K 输入预算截断；细纲契约和状态卡仍完整保留]"
            )
            trims.append("system_prompt")
            total = len(prompt) + len(system_prompt)

        if total > MAX_CREATION_INPUT_CHARS:
            raise ValueError(
                "不可裁剪的细纲契约与续写状态卡超过 35K 输入预算，"
                "请先精简大纲或状态卡"
            )

        context.context_stats.update(
            {
                "input_chars": total,
                "input_budget": MAX_CREATION_INPUT_CHARS,
                "input_trims": trims,
            }
        )
        return CreationInput(
            context=context,
            contract=contract,
            prompt=prompt,
            system_prompt=system_prompt,
            skill_injected=skill_injected,
            style_content=style_content,
            input_chars=total,
            trims=trims,
        )

    @staticmethod
    def _repairable(report: ChapterQualityReport) -> bool:
        repairable_prefixes = ("deslop", "ai_pattern", "degeneration")
        return any(
            finding.severity == "blocking"
            and not finding.code.startswith(
                ("outline.", "checker.", "chapter.empty", "length.")
            )
            for finding in report.findings
        ) or any(
            finding.code.startswith(repairable_prefixes)
            and finding.severity == "blocking"
            for finding in report.findings
        )

    async def _compress_once(
        self,
        *,
        content: str,
        report: ChapterQualityReport,
        ai_service: Any,
        model: Optional[str],
    ) -> str:
        lower, upper = chapter_length_limits(report.target_word_count)
        prompt = (
            "请只删除冗余、重复、解释性总结和无功能修饰，把下面正文压缩到"
            f"{lower}-{upper} 个可见字符。不得新增剧情、对话、动作或设定，"
            "不得改变事件顺序、伏笔、人物动机和章节结尾。只输出完整正文。\n\n"
            f"【待压缩正文】\n{content}"
        )
        try:
            response = await ai_service.generate_text(
                prompt=prompt,
                model=model,
                temperature=0.2,
                max_tokens=max(2000, min(20000, upper * 2)),
                auto_mcp=False,
            )
        except Exception as exc:
            logger.warning("超长章节净删压缩失败，保留原文: %s", exc)
            return content
        candidate = _extract_ai_content(response)
        if detect_policy_refusal(candidate):
            return content
        candidate_count = visible_char_count(candidate)
        if (
            not candidate
            or candidate_count < lower
            or candidate_count > upper
            or candidate_count >= visible_char_count(content)
        ):
            logger.warning(
                "超长章节压缩结果不在安全区间，保留原文: candidate=%s range=%s-%s",
                candidate_count,
                lower,
                upper,
            )
            return content
        return candidate

    async def _expand_once(
        self,
        *,
        content: str,
        report: ChapterQualityReport,
        prepared: CreationInput,
        chapter: Chapter,
        ai_service: Any,
        model: Optional[str],
    ) -> str:
        target = int(report.target_word_count or prepared.contract.target_word_count)
        actual = visible_char_count(content)
        lower = int(target * 0.9)
        upper = int(target * 1.1)
        prompt = (
            "请扩写下面这一章的完整正文。当前正文明显短于目标，"
            f"当前 {actual} 字，目标约 {target} 字；扩写后必须至少达到 "
            f"{lower} 字，建议控制在 {lower}-{upper} 字。\n\n"
            "必须保留原稿中的全部既有剧情、人物、对话、伏笔、事件顺序和"
            "结尾落点。只通过补足有效场景、动作衔接、对话、人物心理与必要"
            "过渡来扩写；禁止复述已有句段、注水总结、堆砌形容、新增支线或"
            "关键设定，禁止改变人物动机和已发生事件。\n\n"
            f"【章节】第{chapter.chapter_number}章《{chapter.title}》\n"
            f"【细纲契约】\n{render_plan_contract(prepared.contract)}\n\n"
            "只输出扩写后的完整正文，不要解释，也不要只输出新增片段。\n\n"
            f"【待扩写正文】\n{content}"
        )
        try:
            response = await ai_service.generate_text(
                prompt=prompt,
                system_prompt=prepared.system_prompt,
                model=model,
                temperature=0.35,
                max_tokens=max(4000, min(20000, target * 3 + 2048)),
                auto_mcp=False,
            )
        except Exception as exc:
            logger.warning("短章节自动扩写失败，保留原文: %s", exc)
            return content
        candidate = _extract_ai_content(response)
        refusal = detect_policy_refusal(candidate)
        if refusal:
            logger.warning("短章节自动扩写被服务商拒绝: %s", policy_refusal_error(refusal))
            return content
        if not candidate or visible_char_count(candidate) <= actual:
            return content
        return candidate

    async def _repair_once(
        self,
        *,
        content: str,
        report: ChapterQualityReport,
        prepared: CreationInput,
        chapter: Chapter,
        ai_service: Any,
        model: Optional[str],
    ) -> str:
        target = int(prepared.contract.target_word_count)
        lower, upper = chapter_length_limits(target)
        findings = "\n".join(
            f"- [{item.severity}] {item.code}: {item.message}"
            + (f"；证据：{item.evidence}" if item.evidence else "")
            for item in report.findings
            if item.severity == "blocking"
        )
        prompt = (
            "带诊断重写本章一次。必须修复下列确定性检查问题，同时严格保留"
            "细纲契约、角色已知边界、伏笔状态和本章既有核心事件。不得提前释放"
            f"禁止信息。重写后的完整正文必须保持在 {lower}-{upper} 个可见字符，"
            "不得用总结代替场景。只输出完整正文，不解释。\n\n"
            f"【章节】第{chapter.chapter_number}章《{chapter.title}》\n"
            f"【细纲契约】\n{render_plan_contract(prepared.contract)}\n\n"
            f"【阻断问题】\n{findings}\n\n"
            f"【待修正文】\n{content}"
        )
        try:
            response = await ai_service.generate_text(
                prompt=prompt,
                system_prompt=prepared.system_prompt,
                model=model,
                temperature=0.4,
                max_tokens=max(
                    3000,
                    min(20000, int(prepared.contract.target_word_count * 3)),
                ),
                auto_mcp=False,
            )
        except Exception as exc:
            logger.warning("章节带诊断自动重生失败，保留首稿: %s", exc)
            return content
        candidate = _extract_ai_content(response)
        refusal = detect_policy_refusal(candidate)
        if refusal:
            logger.warning("章节自动重生被服务商拒绝: %s", policy_refusal_error(refusal))
            return content
        return candidate or content

    async def finalize_generated(
        self,
        *,
        chapter: Chapter,
        project: Project,
        outline: Optional[Outline],
        prepared: CreationInput,
        content: str,
        ai_service: Any,
        model: Optional[str],
        progress: Optional[ProgressCallback] = None,
    ) -> GeneratedChapterResult:
        original_chapter_content = chapter.content
        try:
            normalized = await normalize_punctuation(content)
            current = normalized.get("normalized") or content
            punctuation_fixed = int(normalized.get("count") or 0)

            chapter.content = current
            report = await evaluate_chapter_quality(
                chapter,
                outline=outline,
                target_word_count=prepared.contract.target_word_count,
            )
            compressed = False
            expanded = False
            repaired = False
            if any(
                finding.code == "length.under" and finding.severity == "blocking"
                for finding in report.findings
            ):
                if progress:
                    await progress("repairing", "正文过短，正在自动扩写一次")
                expanded_content = await self._expand_once(
                    content=current,
                    report=report,
                    prepared=prepared,
                    chapter=chapter,
                    ai_service=ai_service,
                    model=model,
                )
                expanded = expanded_content != current
                current = expanded_content
                if expanded:
                    normalized = await normalize_punctuation(current)
                    current = normalized.get("normalized") or current
                    punctuation_fixed += int(normalized.get("count") or 0)
                chapter.content = current
                report = await evaluate_chapter_quality(
                    chapter,
                    outline=outline,
                    target_word_count=prepared.contract.target_word_count,
                )

            if any(
                finding.code == "length.over" and finding.severity == "blocking"
                for finding in report.findings
            ):
                if progress:
                    await progress("repairing", "正文超长，正在执行一次净删压缩")
                compressed_content = await self._compress_once(
                    content=current,
                    report=report,
                    ai_service=ai_service,
                    model=model,
                )
                compressed = compressed_content != current
                current = compressed_content
                chapter.content = current
                report = await evaluate_chapter_quality(
                    chapter,
                    outline=outline,
                    target_word_count=prepared.contract.target_word_count,
                )

            if self._repairable(report):
                if progress:
                    await progress("repairing", "质量门禁未通过，正在带诊断自动重生一次")
                repaired_content = await self._repair_once(
                    content=current,
                    report=report,
                    prepared=prepared,
                    chapter=chapter,
                    ai_service=ai_service,
                    model=model,
                )
                repaired = repaired_content != current
                current = repaired_content
                normalized = await normalize_punctuation(current)
                current = normalized.get("normalized") or current
                punctuation_fixed += int(normalized.get("count") or 0)
                chapter.content = current
                report = await evaluate_chapter_quality(
                    chapter,
                    outline=outline,
                    target_word_count=prepared.contract.target_word_count,
                )

            actual = visible_char_count(current)
            _, upper = chapter_length_limits(prepared.contract.target_word_count)
            if actual > upper:
                raise chapter_length_error(
                    actual=actual,
                    target_word_count=prepared.contract.target_word_count,
                )

            if progress:
                await progress("tracking", f"正文检查完成：{report.status.value}")
            return GeneratedChapterResult(
                content=current,
                quality_report=report,
                repaired=repaired,
                compressed=compressed,
                expanded=expanded,
                punctuation_fixed=punctuation_fixed,
            )
        finally:
            chapter.content = original_chapter_content

    async def save_generated(
        self,
        *,
        chapter: Chapter,
        project: Project,
        result: GeneratedChapterResult,
        label: str,
    ) -> int:
        actual = visible_char_count(result.content)
        target = result.quality_report.target_word_count
        _, upper = chapter_length_limits(target)
        if actual > upper:
            raise chapter_length_error(actual=actual, target_word_count=target)

        old_word_count = chapter.word_count or 0
        chapter.content = result.content
        chapter.word_count = actual
        chapter.status = "writing"
        chapter.quality_status = result.quality_report.status.value
        chapter.tracking_status = "pending"
        chapter.summary = " ".join(result.content.split())[:300]
        project.current_words = max(
            0,
            (project.current_words or 0) - old_word_count + chapter.word_count,
        )
        self.db.add(
            GenerationHistory(
                project_id=chapter.project_id,
                chapter_id=chapter.id,
                prompt=label,
                generated_content=result.content[:500],
                model="default",
            )
        )
        await self.db.commit()
        return chapter.word_count
