"""项目连续性状态、章节事务和创作质量门禁。"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.logger import get_logger
from app.models.chapter import Chapter
from app.models.character import Character
from app.models.foreshadow import Foreshadow
from app.models.memory import PlotAnalysis
from app.models.outline import Outline
from app.models.project import Project
from app.models.story_tracking import ChapterTrackingTransaction, StoryTrackingState
from app.schemas.tracking import (
    ChapterPlanningContract,
    ChapterQualityReport,
    ChapterQualityStatus,
    QualityFinding,
    TrackingContextCard,
)
from app.services.deslop_check_service import check_text, scripts_available
from app.services.chapter_length_guard import chapter_length_limits

logger = get_logger(__name__)

TRACKING_SCHEMA_VERSION = 1
TRACKING_CARD_MAX_BYTES = 12 * 1024
ACTIVE_CHARACTER_LIMIT = 20
ACTIVE_FORESHADOW_LIMIT = 8
RECENT_CHAPTER_LIMIT = 3
PROJECT_LEASE_MINUTES = 30


def body_sha256(content: str) -> str:
    return hashlib.sha256((content or "").encode("utf-8")).hexdigest()


def visible_char_count(content: str) -> int:
    return len(re.sub(r"\s+", "", content or ""))


def empty_state(project_id: str) -> Dict[str, Any]:
    return {
        "schema_version": TRACKING_SCHEMA_VERSION,
        "project_id": project_id,
        "context": {
            "position": {},
            "long_term_constraints": [],
            "active_character_names": [],
            "continuity_risks": [],
            "recent_chapters": [],
            "next_chapter_commitments": [],
        },
        "characters": {},
        "foreshadows": {},
        "timeline": {},
        "chapter_metrics": {},
        "chapter_records": {},
        "quality_overrides": {},
    }


def empty_transaction(
    *,
    chapter: Chapter,
    mode: str = "append",
    source: str = "legacy_backfill",
) -> Dict[str, Any]:
    """构造不依赖 AI 的最小事务，用于历史回填和删除后的审计重建。"""
    summary = _chapter_note(chapter)
    return {
        "schema_version": TRACKING_SCHEMA_VERSION,
        "mode": mode,
        "chapter": chapter.chapter_number,
        "chapter_title": chapter.title,
        "source": source,
        "delta": {
            "result": summary,
            "character_changes": [],
            "foreshadow_changes": [],
            "timeline_events": [],
            "constraints": [],
            "next_chapter_commitments": [],
        },
        "character_snapshots": {},
        "context": {
            "position": {
                "chapter": chapter.chapter_number,
                "chapter_title": chapter.title,
                "volume": "",
                "story_time": "",
                "scene": "",
            },
            "long_term_constraints": [],
            "active_character_names": [],
            "continuity_risks": [
                "该章由本地历史数据回填，需作者复核角色状态、时间线和伏笔。"
            ],
            "recent_chapters": [
                {
                    "chapter": chapter.chapter_number,
                    "title": chapter.title,
                    "summary": summary,
                }
            ],
            "next_chapter_commitments": [],
        },
    }


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _chapter_note(chapter: Chapter) -> str:
    summary = (chapter.summary or "").strip()
    if summary:
        return summary[:500]
    normalized = " ".join((chapter.content or "").split())
    return normalized[:500]


def _character_snapshot(name: str, chapter_number: int) -> Dict[str, Any]:
    return {
        "identity": "",
        "location": "",
        "goal": "",
        "state": "",
        "abilities_resources": [],
        "relationships": [],
        "knowledge": [],
        "open_threads": [],
        "confidence": "low",
        "updated_chapter": chapter_number,
    }


async def _load_chapters(db: AsyncSession, project_id: str) -> List[Chapter]:
    result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.chapter_number)
    )
    return list(result.scalars().all())


async def rebuild_authority_from_committed_transactions(
    db: AsyncSession,
    project_id: str,
    *,
    through_chapter: Optional[int] = None,
) -> StoryTrackingState:
    """从仍匹配当前正文的已提交事务重放权威状态。

    每个章节只采用最新一条匹配当前正文哈希的 committed 事务，避免旧修订
    重复贡献时间线或伏笔。被删除、手改后尚未重分析的章节不会被重放。
    """
    state_row = await ensure_project_state(db, project_id)
    chapters = await _load_chapters(db, project_id)
    chapters_by_id = {chapter.id: chapter for chapter in chapters}

    query = (
        select(ChapterTrackingTransaction, Chapter)
        .join(Chapter, Chapter.id == ChapterTrackingTransaction.chapter_id)
        .where(ChapterTrackingTransaction.project_id == project_id)
        .where(ChapterTrackingTransaction.status == "committed")
    )
    if through_chapter is not None:
        query = query.where(Chapter.chapter_number <= through_chapter)
    rows = (
        await db.execute(
            query.order_by(
                Chapter.chapter_number,
                ChapterTrackingTransaction.result_state_revision,
                ChapterTrackingTransaction.created_at,
            )
        )
    ).all()

    latest_by_chapter: Dict[int, tuple[ChapterTrackingTransaction, Chapter]] = {}
    for transaction_row, transaction_chapter in rows:
        chapter = chapters_by_id.get(transaction_chapter.id)
        if not chapter or (chapter.content or "") == "":
            continue
        if body_sha256(chapter.content or "") != transaction_row.body_sha256:
            continue
        current = latest_by_chapter.get(chapter.chapter_number)
        current_order = (
            int(current[0].result_state_revision or current[0].revision or 0)
            if current
            else -1
        )
        candidate_order = int(
            transaction_row.result_state_revision or transaction_row.revision or 0
        )
        if candidate_order >= current_order:
            latest_by_chapter[chapter.chapter_number] = (transaction_row, chapter)

    rebuilt = empty_state(project_id)
    last_committed = 0
    committed_chapter_ids: set[str] = set()
    for chapter_number in sorted(latest_by_chapter):
        transaction_row, chapter = latest_by_chapter[chapter_number]
        rebuilt = _merge_transaction(
            rebuilt,
            _as_dict(transaction_row.transaction_json),
            chapter,
        )
        last_committed = max(last_committed, chapter_number)
        committed_chapter_ids.add(chapter.id)

    previous_overrides = _as_dict(
        _as_dict(state_row.state_json).get("quality_overrides")
    )
    rebuilt["quality_overrides"] = previous_overrides
    rebuilt.setdefault("context", {})["continuity_risks"] = _as_list(
        _as_dict(rebuilt.get("context")).get("continuity_risks")
    )

    state_row.state_json = rebuilt
    state_row.state_revision = max(1, (state_row.state_revision or 0) + 1)
    state_row.last_committed_chapter = last_committed
    state_row.imported_through_chapter = min(
        state_row.imported_through_chapter or 0,
        last_committed,
    )
    state_row.state_status = "current"

    for chapter in chapters:
        if chapter.id in committed_chapter_ids:
            chapter.quality_status = "ready"
            chapter.tracking_status = "current"
            chapter.tracking_revision = next(
                (
                    int(row.result_state_revision or row.revision or 0)
                    for row, item in [latest_by_chapter[chapter.chapter_number]]
                    if item.id == chapter.id
                ),
                chapter.tracking_revision or 0,
            )
            chapter.tracking_body_sha256 = body_sha256(chapter.content or "")
            chapter.status = "completed"
        elif (chapter.content or "").strip():
            chapter.quality_status = "stale"
            chapter.tracking_status = "stale"
            chapter.status = "draft"

    return state_row


async def rebuild_after_chapter_deletion(
    db: AsyncSession,
    project_id: str,
    *,
    deleted_chapter_number: int,
) -> StoryTrackingState:
    """删除章节后重建到前一章，并将后续正文章节级联标记为陈旧。"""
    state_row = await rebuild_authority_from_committed_transactions(
        db,
        project_id,
        through_chapter=max(0, deleted_chapter_number - 1),
    )
    later_chapters = (
        await db.execute(
            select(Chapter)
            .where(Chapter.project_id == project_id)
            .where(Chapter.chapter_number > deleted_chapter_number)
            .order_by(Chapter.chapter_number)
        )
    ).scalars().all()
    for chapter in later_chapters:
        if (chapter.content or "").strip():
            chapter.quality_status = "stale"
            chapter.tracking_status = "stale"
            chapter.status = "draft"
    state_row.state_status = "needs_review" if later_chapters else "current"
    state_row.imported_through_chapter = min(
        state_row.imported_through_chapter or 0,
        state_row.last_committed_chapter or 0,
    )
    await db.commit()
    await db.refresh(state_row)
    return state_row


async def ensure_project_state(
    db: AsyncSession,
    project_id: str,
    *,
    force_backfill: bool = False,
) -> StoryTrackingState:
    """返回项目状态；不存在时执行一次不调用 AI 的本地回填。"""
    result = await db.execute(
        select(StoryTrackingState).where(StoryTrackingState.project_id == project_id)
    )
    state_row = result.scalar_one_or_none()
    if state_row and not force_backfill:
        return state_row

    project = (
        await db.execute(select(Project).where(Project.id == project_id))
    ).scalar_one_or_none()
    if not project:
        raise ValueError("项目不存在")

    chapters = await _load_chapters(db, project_id)
    characters = list(
        (
            await db.execute(
                select(Character)
                .where(Character.project_id == project_id)
                .order_by(Character.created_at)
            )
        ).scalars().all()
    )
    foreshadows = list(
        (
            await db.execute(
                select(Foreshadow)
                .where(Foreshadow.project_id == project_id)
                .order_by(Foreshadow.updated_at.desc())
            )
        ).scalars().all()
    )
    chapter_ids = [chapter.id for chapter in chapters]
    analyses: Dict[str, PlotAnalysis] = {}
    if chapter_ids:
        result = await db.execute(
            select(PlotAnalysis).where(PlotAnalysis.chapter_id.in_(chapter_ids))
        )
        analyses = {item.chapter_id: item for item in result.scalars().all()}

    state = empty_state(project_id)
    content_chapters = [chapter for chapter in chapters if (chapter.content or "").strip()]
    last_content_chapter = content_chapters[-1].chapter_number if content_chapters else 0

    active_names: List[str] = []
    for chapter in reversed(content_chapters):
        try:
            raw_plan = _as_dict(json.loads(chapter.expansion_plan or "{}"))
        except (TypeError, json.JSONDecodeError):
            raw_plan = {}
        for name in _as_list(raw_plan.get("character_focus") or raw_plan.get("active_characters")):
            normalized = str(name.get("name") if isinstance(name, dict) else name).strip()
            if normalized and normalized not in active_names:
                active_names.append(normalized)
        analysis = analyses.get(chapter.id)
        for item in _as_list(getattr(analysis, "character_states", None)):
            if isinstance(item, dict):
                normalized = str(item.get("character_name") or "").strip()
                if normalized and normalized not in active_names:
                    active_names.append(normalized)
        if len(active_names) >= ACTIVE_CHARACTER_LIMIT:
            break

    if not active_names:
        active_names = [
            character.name
            for character in characters
            if not character.is_organization
        ][:ACTIVE_CHARACTER_LIMIT]

    for character in characters[:ACTIVE_CHARACTER_LIMIT]:
        snapshot = _character_snapshot(character.name, last_content_chapter)
        snapshot.update(
            {
                "identity": "；".join(
                    value for value in (character.role_type, character.background[:200] if character.background else "") if value
                ),
                "state": character.current_state or character.status or "",
                "relationships": [character.relationships] if character.relationships else [],
                "updated_chapter": character.state_updated_chapter or last_content_chapter,
            }
        )
        state["characters"][character.name] = snapshot

    for foreshadow in foreshadows[:50]:
        state["foreshadows"][foreshadow.id] = {
            "id": foreshadow.id,
            "title": foreshadow.title,
            "summary": foreshadow.content,
            "status": foreshadow.status,
            "planted_chapter": foreshadow.plant_chapter_number,
            "planned_resolution_chapter": foreshadow.target_resolve_chapter_number,
            "importance": foreshadow.importance,
            "urgency": foreshadow.urgency,
            "confidence": "low",
        }

    for index, chapter in enumerate(content_chapters):
        analysis = analyses.get(chapter.id)
        plot_points = _as_list(getattr(analysis, "plot_points", None))
        state["chapter_metrics"][str(chapter.chapter_number)] = {
            "title": chapter.title,
            "word_count": visible_char_count(chapter.content or ""),
            "body_sha256": body_sha256(chapter.content or ""),
            "backfilled": True,
        }
        state["chapter_records"][str(chapter.chapter_number)] = {
            "result": _chapter_note(chapter),
            "timeline_event_ids": [],
        }
        for point_index, point in enumerate(plot_points[:8]):
            content = (
                str(point.get("content") or "").strip()
                if isinstance(point, dict)
                else str(point).strip()
            )
            if not content:
                continue
            event_id = f"E{chapter.chapter_number:04d}_{point_index + 1}"
            state["timeline"][event_id] = {
                "id": event_id,
                "story_time": "",
                "objective_fact": content,
                "reader_knowledge": content,
                "character_knowledge": {},
                "reveal_status": "已揭示",
                "reveal_chapter": chapter.chapter_number,
                "characters": active_names[:10],
                "confidence": "low",
            }
            state["chapter_records"][str(chapter.chapter_number)]["timeline_event_ids"].append(event_id)

    recent = content_chapters[-RECENT_CHAPTER_LIMIT:]
    state["context"].update(
        {
            "position": {
                "chapter": last_content_chapter,
                "chapter_title": content_chapters[-1].title if content_chapters else "",
                "volume": "",
                "story_time": "",
                "scene": "",
            },
            "active_character_names": active_names[:ACTIVE_CHARACTER_LIMIT],
            "continuity_risks": [
                "该状态由本地历史数据聚合生成，低置信角色关系与时间线需要作者复核"
            ] if content_chapters else [],
            "recent_chapters": [
                {
                    "chapter": chapter.chapter_number,
                    "title": chapter.title,
                    "summary": _chapter_note(chapter),
                }
                for chapter in recent
            ],
        }
    )

    committed_by_chapter: Dict[str, ChapterTrackingTransaction] = {}
    if chapters:
        committed_rows = list(
            (
                await db.execute(
                    select(ChapterTrackingTransaction)
                    .where(ChapterTrackingTransaction.project_id == project_id)
                    .where(ChapterTrackingTransaction.status == "committed")
                    .order_by(
                        ChapterTrackingTransaction.chapter_id,
                        ChapterTrackingTransaction.committed_at.desc(),
                        ChapterTrackingTransaction.created_at.desc(),
                    )
                )
            ).scalars().all()
        )
        for transaction_row in committed_rows:
            committed_by_chapter.setdefault(transaction_row.chapter_id, transaction_row)

    base_revision = max(
        [state_row.state_revision if state_row else 0]
        + [
            transaction_row.result_state_revision or 0
            for transaction_row in committed_by_chapter.values()
        ]
    )
    backfill_revision = base_revision
    for chapter in content_chapters:
        existing_transaction = committed_by_chapter.get(chapter.id)
        if existing_transaction:
            backfill_revision = max(
                backfill_revision,
                existing_transaction.result_state_revision or 0,
            )
            chapter.tracking_revision = existing_transaction.result_state_revision
            continue
        backfill_revision += 1
        transaction_row = ChapterTrackingTransaction(
            project_id=project_id,
            chapter_id=chapter.id,
            mode="import",
            revision=backfill_revision,
            expected_state_revision=max(0, backfill_revision - 1),
            result_state_revision=backfill_revision,
            body_sha256=body_sha256(chapter.content or ""),
            status="committed",
            transaction_json=empty_transaction(
                chapter=chapter,
                mode="import",
                source="legacy_backfill",
            ),
            quality_report=ChapterQualityReport(
                status=ChapterQualityStatus.ready,
                findings=[
                    QualityFinding(
                        severity="advisory",
                        code="tracking.legacy_backfill",
                        message="本地历史数据回填，未重新调用 AI 分析",
                    )
                ],
                word_count=visible_char_count(chapter.content or ""),
                target_word_count=3000,
                available_actions=["resync_tracking"],
            ).model_dump(),
            audit_json={"source": "legacy_backfill"},
            committed_at=datetime.now(),
        )
        db.add(transaction_row)
        chapter.tracking_revision = backfill_revision

    if state_row:
        state_row.schema_version = TRACKING_SCHEMA_VERSION
        state_row.state_revision = max(state_row.state_revision or 0, backfill_revision)
        state_row.last_committed_chapter = last_content_chapter
        state_row.imported_through_chapter = last_content_chapter
        state_row.state_status = "needs_review"
        state_row.state_json = state
    else:
        state_row = StoryTrackingState(
            project_id=project_id,
            schema_version=TRACKING_SCHEMA_VERSION,
            state_revision=backfill_revision,
            last_committed_chapter=last_content_chapter,
            imported_through_chapter=last_content_chapter,
            state_status="needs_review",
            state_json=state,
        )
        db.add(state_row)

    for chapter in chapters:
        if (chapter.content or "").strip():
            chapter.tracking_status = "current"
            chapter.tracking_body_sha256 = body_sha256(chapter.content)
            if chapter.quality_status in (None, "", "draft"):
                chapter.quality_status = "ready"
        else:
            chapter.tracking_status = "uninitialized"
            chapter.quality_status = "draft"

    await db.commit()
    await db.refresh(state_row)
    logger.info(
        "已回填项目追踪状态: project=%s chapter=%s revision=%s",
        project_id,
        state_row.last_committed_chapter,
        state_row.state_revision,
    )
    return state_row


def resolve_plan_contract(
    chapter: Chapter,
    outline: Optional[Outline],
) -> ChapterPlanningContract:
    raw: Dict[str, Any] = {}
    for source in (chapter.expansion_plan, outline.structure if outline else None):
        if not source:
            continue
        try:
            parsed = json.loads(source) if isinstance(source, str) else source
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(parsed, dict):
            raw.update(parsed)
    return ChapterPlanningContract.from_legacy(
        raw,
        fallback_summary=(chapter.summary or outline.content if outline else chapter.summary or ""),
    )


def validate_plan_contract(contract: ChapterPlanningContract) -> List[QualityFinding]:
    findings: List[QualityFinding] = []
    for field_name in (
        "core_event",
        "target_word_count",
        "word_count_basis",
        "unit_position",
        "opening_hook",
        "payoff",
        "forbidden_early_release",
    ):
        value = getattr(contract, field_name)
        if value in (None, "", []):
            findings.append(
                QualityFinding(
                    severity="advisory",
                    code=f"outline.{field_name}.missing",
                    message=f"细纲字段 {field_name} 未填写，已按未知处理",
                )
            )
    return findings


def render_plan_contract(contract: ChapterPlanningContract) -> str:
    """把版本化细纲契约渲染成不可裁剪的写作指令。"""
    required_events = "；".join(contract.required_events) or "未指定"
    active_characters = "、".join(contract.active_characters) or "未指定"
    return "\n".join(
        [
            "## 本章细纲契约",
            f"- 核心事件：{contract.core_event}",
            f"- 字数目标：{contract.target_word_count}（{contract.word_count_basis}）",
            f"- 单元位置：{contract.unit_position}",
            f"- 目标情绪：{contract.target_emotion}",
            f"- 主角目标与关键选择：{contract.protagonist_goal_and_key_choice}",
            f"- 章首钩子：{contract.opening_hook}",
            f"- 爽点/兑现：{contract.payoff}",
            f"- 禁止提前释放：{contract.forbidden_early_release}",
            f"- 必须事件：{required_events}",
            f"- 活跃角色：{active_characters}",
        ]
    )


def evaluate_plan_fulfillment(
    content: str,
    contract: ChapterPlanningContract,
) -> List[QualityFinding]:
    """做零 Token 的细纲履约提示，避免明显的漏事件和漏角色。"""
    findings: List[QualityFinding] = []
    normalized = re.sub(r"\s+", "", content or "")

    def has_overlap(value: str) -> bool:
        compact = re.sub(r"\s+", "", value)
        if not compact:
            return True
        if compact in normalized:
            return True
        fragments = {
            compact[index:index + 2]
            for index in range(max(0, len(compact) - 1))
            if compact[index:index + 2].strip()
        }
        return bool(fragments and any(fragment in normalized for fragment in fragments))

    for event in contract.required_events[:12]:
        if not has_overlap(str(event)):
            findings.append(
                QualityFinding(
                    severity="advisory",
                    code="outline.required_event.unconfirmed",
                    message=f"细纲事件未在正文中检测到足够语言线索：{str(event)[:120]}",
                )
            )
    missing_characters = [
        name for name in contract.active_characters[:20]
        if name and name not in normalized
    ]
    if missing_characters:
        findings.append(
            QualityFinding(
                severity="advisory",
                code="outline.active_character.unconfirmed",
                message=f"细纲活跃角色未在正文出现：{'、'.join(missing_characters[:8])}",
            )
        )
    return findings


def _render_card(state: Dict[str, Any]) -> TrackingContextCard:
    context = _as_dict(state.get("context"))
    characters = _as_dict(state.get("characters"))
    foreshadows = _as_dict(state.get("foreshadows"))
    active_names = [
        name for name in _as_list(context.get("active_character_names"))
        if str(name) in characters
    ][:ACTIVE_CHARACTER_LIMIT]
    if not active_names:
        active_names = list(characters)[:ACTIVE_CHARACTER_LIMIT]

    active_foreshadows = sorted(
        [
            value for value in foreshadows.values()
            if isinstance(value, dict) and value.get("status") not in ("resolved", "abandoned", "已回收", "已废弃")
        ],
        key=lambda item: (
            -int(item.get("urgency") or 0),
            -float(item.get("importance") or 0),
            int(item.get("planned_resolution_chapter") or 999999),
        ),
    )[:ACTIVE_FORESHADOW_LIMIT]
    recent = _as_list(context.get("recent_chapters"))[-RECENT_CHAPTER_LIMIT:]

    def render() -> str:
        lines = ["## 当前位置", json.dumps(context.get("position") or {}, ensure_ascii=False)]
        lines.append("## 长期约束")
        constraints = [str(item) for item in _as_list(context.get("long_term_constraints")) if str(item).strip()]
        lines.extend(f"- {item}" for item in constraints[:6]) if constraints else lines.append("- 暂无")
        lines.append("## 核心角色状态")
        if active_names:
            for name in active_names:
                item = _as_dict(characters.get(name))
                details = "；".join(
                    part for part in (
                        f"身份={item.get('identity')}" if item.get("identity") else "",
                        f"位置={item.get('location')}" if item.get("location") else "",
                        f"目标={item.get('goal')}" if item.get("goal") else "",
                        f"状态={item.get('state')}" if item.get("state") else "",
                        f"已知={','.join(str(x) for x in _as_list(item.get('knowledge')))}" if item.get("knowledge") else "",
                        f"未结={','.join(str(x) for x in _as_list(item.get('open_threads')))}" if item.get("open_threads") else "",
                    )
                    if part
                )
                lines.append(f"- {name}：{details[:500]}")
        else:
            lines.append("- 暂无")
        lines.append("## 活跃伏笔")
        if active_foreshadows:
            for item in active_foreshadows:
                lines.append(
                    f"- {item.get('title') or item.get('id')}：{str(item.get('summary') or '')[:300]}"
                    f"（状态={item.get('status') or '未知'}，计划回收={item.get('planned_resolution_chapter') or '未定'}）"
                )
        else:
            lines.append("- 暂无")
        lines.append("## 近三章速记")
        if recent:
            for item in recent:
                lines.append(
                    f"- 第{item.get('chapter')}章《{item.get('title') or ''}》：{str(item.get('summary') or '')[:500]}"
                )
        else:
            lines.append("- 暂无")
        lines.append("## 下一章承诺")
        commitments = [str(item) for item in _as_list(context.get("next_chapter_commitments")) if str(item).strip()]
        lines.extend(f"- {item}" for item in commitments[:8]) if commitments else lines.append("- 暂无")
        lines.append("## 连贯性风险")
        risks = [str(item) for item in _as_list(context.get("continuity_risks")) if str(item).strip()]
        lines.extend(f"- {item}" for item in risks[:8]) if risks else lines.append("- 暂无")
        return "\n".join(lines)

    rendered = render()
    # 先压缩长行，再减少次级字段；标题和七栏边界始终保留。
    if len(rendered.encode("utf-8")) > TRACKING_CARD_MAX_BYTES:
        rendered = "\n".join(line[:700] for line in rendered.splitlines())
    while len(rendered.encode("utf-8")) > TRACKING_CARD_MAX_BYTES:
        lines = rendered.splitlines()
        longest = max(range(len(lines)), key=lambda index: len(lines[index]))
        if len(lines[longest]) <= 80:
            break
        overflow = len(rendered.encode("utf-8")) - TRACKING_CARD_MAX_BYTES
        keep = max(80, len(lines[longest]) - overflow)
        lines[longest] = lines[longest][:keep] + "…"
        rendered = "\n".join(lines)

    return TrackingContextCard(
        position=_as_dict(context.get("position")),
        long_term_constraints=_as_list(context.get("long_term_constraints")),
        active_character_names=active_names,
        continuity_risks=_as_list(context.get("continuity_risks")),
        active_foreshadows=active_foreshadows,
        recent_chapters=recent,
        next_chapter_commitments=_as_list(context.get("next_chapter_commitments")),
        rendered=rendered,
        byte_size=len(rendered.encode("utf-8")),
    )


async def build_tracking_card(db: AsyncSession, project_id: str) -> TrackingContextCard:
    state_row = await ensure_project_state(db, project_id)
    return _render_card(_as_dict(state_row.state_json))


async def acquire_generation_lease(
    db: AsyncSession,
    project_id: str,
    owner: str,
) -> tuple[bool, str]:
    await ensure_project_state(db, project_id)
    now = datetime.now()
    result = await db.execute(
        update(StoryTrackingState)
        .where(StoryTrackingState.project_id == project_id)
        .where(
            or_(
                StoryTrackingState.lease_owner.is_(None),
                StoryTrackingState.lease_expires_at.is_(None),
                StoryTrackingState.lease_expires_at < now,
                StoryTrackingState.lease_owner == owner,
            )
        )
        .values(
            lease_owner=owner,
            lease_expires_at=now + timedelta(minutes=PROJECT_LEASE_MINUTES),
        )
    )
    await db.commit()
    if result.rowcount:
        return True, ""
    current = (
        await db.execute(
            select(StoryTrackingState.lease_owner, StoryTrackingState.lease_expires_at)
            .where(StoryTrackingState.project_id == project_id)
        )
    ).first()
    return False, f"项目正在被另一创作任务占用（{current.lease_owner if current else 'unknown'}）"


async def release_generation_lease(db: AsyncSession, project_id: str, owner: str) -> None:
    await db.execute(
        update(StoryTrackingState)
        .where(StoryTrackingState.project_id == project_id)
        .where(StoryTrackingState.lease_owner == owner)
        .values(lease_owner=None, lease_expires_at=None)
    )
    await db.commit()


async def evaluate_chapter_quality(
    chapter: Chapter,
    *,
    outline: Optional[Outline] = None,
    target_word_count: Optional[int] = None,
    override: Optional[Dict[str, Any]] = None,
) -> ChapterQualityReport:
    content = chapter.content or ""
    actual = visible_char_count(content)
    findings: List[QualityFinding] = []

    contract: Optional[ChapterPlanningContract] = None
    try:
        contract = resolve_plan_contract(chapter, outline)
        findings.extend(validate_plan_contract(contract))
        findings.extend(evaluate_plan_fulfillment(content, contract))
        target = int(target_word_count or contract.target_word_count or 3000)
    except ValueError as exc:
        target = int(target_word_count or 3000)
        findings.append(
            QualityFinding(
                severity="blocking",
                code="outline.intent.missing",
                message=f"细纲意图字段不完整：{exc}",
            )
        )

    if not content.strip():
        return ChapterQualityReport(
            status=ChapterQualityStatus.invalid,
            findings=findings + [
                QualityFinding(severity="blocking", code="chapter.empty", message="章节正文为空")
            ],
            word_count=actual,
            target_word_count=target,
            available_actions=["rewrite"],
        )

    lower, upper = chapter_length_limits(target)
    if actual < lower:
        findings.append(
            QualityFinding(
                severity="blocking",
                code="length.under",
                message=(
                    f"正文 {actual} 字，低于目标区间 {lower}-{upper}；"
                    "生成流程会自动扩写一次，仍不足时需作者确认"
                ),
            )
        )
    elif actual > upper:
        findings.append(
            QualityFinding(
                severity="blocking",
                code="length.over",
                message=f"正文 {actual} 字，高于目标区间 {lower}-{upper}；需一次性净删压缩",
            )
        )

    checker_available = scripts_available()
    checker_error = None
    if not checker_available:
        checker_error = "运行环境缺少 Node 或去 AI 味检测脚本"
        findings.append(
            QualityFinding(
                severity="blocking",
                code="checker.unavailable",
                message=checker_error,
            )
        )
    else:
        report = await check_text(content)
        checker_available = report.available
        checker_error = report.error
        for item in report.findings[:80]:
            findings.append(
                QualityFinding(
                    severity="blocking" if item.get("severity") == "blocking" else "advisory",
                    code=str(item.get("type") or item.get("rule") or "deslop"),
                    message=str(item.get("message") or "去 AI 味检查未通过"),
                    evidence=str(item.get("excerpt") or "")[:500] or None,
                )
            )

    override_applied = bool(override)
    blocking = [item for item in findings if item.severity == "blocking"]
    if override_applied:
        blocking = [
            item for item in blocking
            if not (
                override.get("kind") == "accept_current_length"
                and item.code.startswith("length.")
            )
            and not (
                override.get("kind") == "accept_unchecked"
                and item.code == "checker.unavailable"
            )
        ]

    # Missing checker tooling is an environment degradation, not a defect in
    # the chapter. Keep the finding for auditability but classify it through
    # the dedicated tool_unavailable branch.
    chapter_blocking = [
        item for item in blocking if item.code != "checker.unavailable"
    ]
    accepted_unchecked = (
        override_applied
        and override.get("kind") == "accept_unchecked"
    )
    if not checker_available and not chapter_blocking and not accepted_unchecked:
        status = ChapterQualityStatus.tool_unavailable
        actions = ["accept_unchecked", "rewrite"]
    elif chapter_blocking:
        status = (
            ChapterQualityStatus.needs_decision
            if all(item.code.startswith("length.") for item in chapter_blocking)
            else ChapterQualityStatus.blocked
        )
        actions = (
            ["accept_current_length", "rewrite"]
            if status == ChapterQualityStatus.needs_decision
            else ["rewrite"]
        )
    else:
        status = ChapterQualityStatus.ready
        actions = ["resync_tracking"]

    return ChapterQualityReport(
        status=status,
        findings=findings,
        word_count=actual,
        target_word_count=target,
        checker_available=checker_available,
        checker_error=checker_error,
        available_actions=actions,
        override=override,
    )


def _build_transaction(
    state: Dict[str, Any],
    chapter: Chapter,
    analysis: Dict[str, Any],
) -> Dict[str, Any]:
    context = _as_dict(state.get("context"))
    raw_plan: Dict[str, Any] = {}
    try:
        raw_plan = _as_dict(json.loads(chapter.expansion_plan or "{}"))
    except (TypeError, json.JSONDecodeError):
        pass

    character_changes: List[Dict[str, Any]] = []
    snapshots: Dict[str, Dict[str, Any]] = {}
    for item in _as_list(analysis.get("character_states"))[:20]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("character_name") or "").strip()
        if not name:
            continue
        change = str(item.get("state_after") or item.get("key_event") or "").strip()
        character_changes.append({"name": name, "change": change})
        existing = _as_dict(_as_dict(state.get("characters")).get(name))
        snapshot = {**_character_snapshot(name, chapter.chapter_number), **existing}
        snapshot.update(
            {
                "state": change or snapshot.get("state", ""),
                "goal": snapshot.get("goal") or str(raw_plan.get("narrative_goal") or ""),
                "updated_chapter": chapter.chapter_number,
                "confidence": "medium",
            }
        )
        snapshots[name] = snapshot

    timeline_events: List[Dict[str, Any]] = []
    for index, item in enumerate(_as_list(analysis.get("plot_points"))[:8]):
        content = (
            str(item.get("content") or "").strip()
            if isinstance(item, dict)
            else str(item).strip()
        )
        if not content:
            continue
        timeline_events.append(
            {
                "action": "upsert",
                "id": f"E{chapter.chapter_number:04d}_{index + 1}",
                "story_time": "",
                "objective_fact": content,
                "reader_knowledge": content,
                "character_knowledge": {},
                "reveal_status": "已揭示",
                "reveal_chapter": chapter.chapter_number,
                "characters": [
                    str(item.get("character_name"))
                    for item in _as_list(analysis.get("character_states"))
                    if isinstance(item, dict) and item.get("character_name")
                ][:10],
            }
        )

    foreshadow_changes: List[Dict[str, Any]] = []
    for item in _as_list(analysis.get("foreshadows"))[:8]:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content") or item.get("title") or "").strip()
        if not content:
            continue
        action_type = str(item.get("type") or "planted")
        foreshadow_changes.append(
            {
                "action": "upsert",
                "id": item.get("id") or f"F{chapter.chapter_number:04d}_{len(foreshadow_changes) + 1}",
                "title": content[:120],
                "summary": content,
                "status": "已回收" if action_type == "resolved" else "已埋",
                "planted_chapter": chapter.chapter_number,
                "planned_resolution_chapter": item.get("reference_chapter"),
                "importance": float(item.get("strength") or 5) / 10.0,
            }
        )

    active_names = [
        str(name).strip()
        for name in (
            _as_list(raw_plan.get("active_characters"))
            or _as_list(raw_plan.get("character_focus"))
            or [item.get("name") for item in character_changes]
        )
        if str(name).strip()
    ][:ACTIVE_CHARACTER_LIMIT]
    if not active_names:
        active_names = _as_list(context.get("active_character_names"))[:ACTIVE_CHARACTER_LIMIT]

    summary = (chapter.summary or "").strip()
    if not summary:
        summary = " ".join((chapter.content or "").split())[:300]

    recent = [
        item for item in _as_list(context.get("recent_chapters"))
        if _as_dict(item).get("chapter") != chapter.chapter_number
    ][-2:]
    recent.append(
        {
            "chapter": chapter.chapter_number,
            "title": chapter.title,
            "summary": summary[:500],
        }
    )

    commitments = [
        str(item).strip()
        for item in (
            _as_list(raw_plan.get("next_chapter_commitments"))
            or _as_list(raw_plan.get("commitments"))
        )
        if str(item).strip()
    ]
    risks = [
        str(item).strip()
        for item in _as_list(raw_plan.get("continuity_constraints"))
        if str(item).strip()
    ]

    return {
        "schema_version": TRACKING_SCHEMA_VERSION,
        "mode": "append",
        "chapter": chapter.chapter_number,
        "chapter_title": chapter.title,
        "delta": {
            "result": summary,
            "character_changes": character_changes,
            "foreshadow_changes": foreshadow_changes,
            "timeline_events": timeline_events,
            "constraints": risks,
            "next_chapter_commitments": commitments,
        },
        "character_snapshots": snapshots,
        "context": {
            "position": {
                **_as_dict(context.get("position")),
                "chapter": chapter.chapter_number,
                "chapter_title": chapter.title,
                "scene": str(raw_plan.get("scene") or raw_plan.get("location") or ""),
            },
            "long_term_constraints": _as_list(context.get("long_term_constraints"))[:6],
            "active_character_names": active_names,
            "continuity_risks": risks[:8],
            "recent_chapters": recent[-RECENT_CHAPTER_LIMIT:],
            "next_chapter_commitments": commitments[:8],
        },
    }


def _merge_transaction(state: Dict[str, Any], transaction: Dict[str, Any], chapter: Chapter) -> Dict[str, Any]:
    next_state = json.loads(json.dumps(state or {}, ensure_ascii=False))
    next_state.setdefault("characters", {}).update(_as_dict(transaction.get("character_snapshots")))
    for item in _as_list(_as_dict(transaction.get("delta")).get("foreshadow_changes")):
        if isinstance(item, dict) and item.get("id"):
            next_state.setdefault("foreshadows", {})[item["id"]] = item
    for item in _as_list(_as_dict(transaction.get("delta")).get("timeline_events")):
        if isinstance(item, dict) and item.get("id"):
            next_state.setdefault("timeline", {})[item["id"]] = item
    context = _as_dict(transaction.get("context"))
    next_state["context"] = context
    next_state.setdefault("chapter_metrics", {})[str(chapter.chapter_number)] = {
        "title": chapter.title,
        "word_count": visible_char_count(chapter.content or ""),
        "body_sha256": body_sha256(chapter.content or ""),
    }
    next_state.setdefault("chapter_records", {})[str(chapter.chapter_number)] = {
        "result": str(_as_dict(transaction.get("delta")).get("result") or ""),
        "timeline_event_ids": [
            item.get("id")
            for item in _as_list(_as_dict(transaction.get("delta")).get("timeline_events"))
            if isinstance(item, dict) and item.get("id")
        ],
    }
    return next_state


async def _rebuild_projections(
    db: AsyncSession,
    project_id: str,
    chapter: Chapter,
    transaction: Dict[str, Any],
) -> None:
    delta = _as_dict(transaction.get("delta"))
    snapshots = _as_dict(transaction.get("character_snapshots"))
    for change in _as_list(delta.get("character_changes")):
        if not isinstance(change, dict):
            continue
        name = str(change.get("name") or "").strip()
        if not name:
            continue
        character = (
            await db.execute(
                select(Character)
                .where(Character.project_id == project_id)
                .where(Character.name == name)
            )
        ).scalar_one_or_none()
        if not character:
            continue
        snapshot = _as_dict(snapshots.get(name))
        character.current_state = str(snapshot.get("state") or change.get("change") or "")[:2000] or character.current_state
        character.state_updated_chapter = chapter.chapter_number
        if snapshot.get("relationships"):
            character.relationships = json.dumps(snapshot["relationships"], ensure_ascii=False)

    for item in _as_list(delta.get("foreshadow_changes")):
        if not isinstance(item, dict):
            continue
        foreshadow = (
            await db.execute(
                select(Foreshadow)
                .where(Foreshadow.project_id == project_id)
                .where(Foreshadow.id == str(item.get("id") or ""))
            )
        ).scalar_one_or_none()
        if not foreshadow:
            foreshadow = (
                await db.execute(
                    select(Foreshadow)
                    .where(Foreshadow.project_id == project_id)
                    .where(Foreshadow.title == str(item.get("title") or "")[:200])
                    .limit(1)
                )
            ).scalar_one_or_none()
        if not foreshadow:
            foreshadow = Foreshadow(
                project_id=project_id,
                title=str(item.get("title") or item.get("summary") or "未命名伏笔")[:200],
                content=str(item.get("summary") or item.get("title") or ""),
                source_type="analysis",
            )
            db.add(foreshadow)
        status = str(item.get("status") or "")
        foreshadow.status = "resolved" if status in ("已回收", "resolved") else "planted"
        foreshadow.plant_chapter_number = int(item.get("planted_chapter") or chapter.chapter_number)
        foreshadow.actual_resolve_chapter_number = (
            chapter.chapter_number if foreshadow.status == "resolved" else foreshadow.actual_resolve_chapter_number
        )
        foreshadow.target_resolve_chapter_number = item.get("planned_resolution_chapter")
        foreshadow.importance = float(item.get("importance") or foreshadow.importance or 0.5)


async def stage_and_commit_analysis(
    db: AsyncSession,
    chapter: Chapter,
    analysis: Dict[str, Any],
    quality_report: ChapterQualityReport,
) -> tuple[ChapterQualityReport, Optional[ChapterTrackingTransaction]]:
    """将分析写为待提交事务；质量通过时立即原子提交。"""
    state_row = await ensure_project_state(db, chapter.project_id)
    digest = body_sha256(chapter.content or "")
    existing = (
        await db.execute(
            select(ChapterTrackingTransaction)
            .where(ChapterTrackingTransaction.project_id == chapter.project_id)
            .where(ChapterTrackingTransaction.chapter_id == chapter.id)
            .where(ChapterTrackingTransaction.body_sha256 == digest)
            .order_by(ChapterTrackingTransaction.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    previous_committed = (
        await db.execute(
            select(ChapterTrackingTransaction.id)
            .where(ChapterTrackingTransaction.chapter_id == chapter.id)
            .where(ChapterTrackingTransaction.status == "committed")
            .limit(1)
        )
    ).scalar_one_or_none()
    mode = "revision" if previous_committed else "append"
    transaction = _build_transaction(_as_dict(state_row.state_json), chapter, analysis)
    transaction["mode"] = mode
    if existing and existing.status == "committed":
        chapter.quality_status = "ready"
        chapter.tracking_status = "current"
        await db.commit()
        return quality_report, existing

    revision = max(
        state_row.state_revision + 1,
        int((existing.revision if existing else 0) or 0),
    )
    if existing:
        existing.quality_report = quality_report.model_dump()
        existing.transaction_json = transaction
        transaction_row = existing
    else:
        transaction_row = ChapterTrackingTransaction(
            project_id=chapter.project_id,
            chapter_id=chapter.id,
            mode=mode,
            revision=revision,
            expected_state_revision=state_row.state_revision,
            body_sha256=digest,
            status="pending",
            transaction_json=transaction,
            quality_report=quality_report.model_dump(),
            audit_json={},
        )
        db.add(transaction_row)

    chapter.quality_status = quality_report.status.value
    if quality_report.status == ChapterQualityStatus.ready:
        chapter.tracking_status = "pending"
    else:
        chapter.tracking_status = "stale"
        chapter.status = "draft"
    await db.commit()
    await db.refresh(transaction_row)

    if quality_report.status == ChapterQualityStatus.ready:
        committed = await commit_staged_transaction(db, transaction_row)
        return quality_report, committed
    return quality_report, transaction_row


async def commit_staged_transaction(
    db: AsyncSession,
    transaction_row: ChapterTrackingTransaction,
) -> ChapterTrackingTransaction:
    state_row = (
        await db.execute(
            select(StoryTrackingState)
            .where(StoryTrackingState.project_id == transaction_row.project_id)
        )
    ).scalar_one_or_none()
    if not state_row:
        raise ValueError("项目追踪状态不存在")
    if state_row.state_revision != transaction_row.expected_state_revision:
        transaction_row.status = "rejected"
        transaction_row.error_message = "tracking state changed since this transaction was prepared"
        await db.commit()
        raise ValueError(transaction_row.error_message)

    chapter = (
        await db.execute(select(Chapter).where(Chapter.id == transaction_row.chapter_id))
    ).scalar_one_or_none()
    if not chapter:
        raise ValueError("章节不存在")
    current_hash = body_sha256(chapter.content or "")
    if current_hash != transaction_row.body_sha256:
        transaction_row.status = "rejected"
        transaction_row.error_message = "chapter content changed after tracking transaction was prepared"
        await db.commit()
        raise ValueError(transaction_row.error_message)

    state = _as_dict(state_row.state_json)
    chapter_record = _as_dict(_as_dict(state.get("chapter_records")).get(str(chapter.chapter_number)))
    if transaction_row.mode == "revision":
        timeline = _as_dict(state.get("timeline"))
        for event_id in _as_list(chapter_record.get("timeline_event_ids")):
            timeline.pop(str(event_id), None)
        state["timeline"] = timeline
        foreshadows = _as_dict(state.get("foreshadows"))
        for foreshadow_id, item in list(foreshadows.items()):
            if int(_as_dict(item).get("planted_chapter") or 0) == chapter.chapter_number:
                foreshadows.pop(foreshadow_id, None)
        state["foreshadows"] = foreshadows
    next_state = _merge_transaction(state, _as_dict(transaction_row.transaction_json), chapter)
    next_revision = state_row.state_revision + 1
    state_row.state_json = next_state
    state_row.state_revision = next_revision
    state_row.last_committed_chapter = max(
        state_row.last_committed_chapter or 0,
        chapter.chapter_number,
    )
    later_uncommitted = (
        await db.execute(
            select(Chapter.id)
            .where(Chapter.project_id == chapter.project_id)
            .where(Chapter.chapter_number > chapter.chapter_number)
            .where(Chapter.content.is_not(None))
            .where(Chapter.content != "")
            .where(Chapter.tracking_status != "current")
            .limit(1)
        )
    ).scalar_one_or_none()
    state_row.state_status = "needs_review" if later_uncommitted else "current"
    transaction_row.result_state_revision = next_revision
    transaction_row.status = "committed"
    transaction_row.committed_at = datetime.now()
    chapter.status = "completed"
    chapter.quality_status = "ready"
    chapter.tracking_status = "current"
    chapter.tracking_revision = next_revision
    chapter.tracking_body_sha256 = transaction_row.body_sha256
    await _rebuild_projections(
        db,
        transaction_row.project_id,
        chapter,
        _as_dict(transaction_row.transaction_json),
    )
    await db.commit()
    await db.refresh(transaction_row)
    logger.info(
        "章节追踪事务已提交: project=%s chapter=%s revision=%s",
        transaction_row.project_id,
        chapter.chapter_number,
        next_revision,
    )
    return transaction_row


async def get_pending_transaction(
    db: AsyncSession,
    chapter_id: str,
) -> Optional[ChapterTrackingTransaction]:
    return (
        await db.execute(
            select(ChapterTrackingTransaction)
            .where(ChapterTrackingTransaction.chapter_id == chapter_id)
            .order_by(ChapterTrackingTransaction.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def mark_chapter_stale(
    db: AsyncSession,
    chapter: Chapter,
    *,
    cascade: bool = True,
    commit: bool = True,
) -> int:
    chapter.tracking_status = "stale"
    chapter.quality_status = "stale"
    chapter.status = "draft"
    affected = 0
    if cascade:
        result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == chapter.project_id)
            .where(Chapter.chapter_number > chapter.chapter_number)
        )
        for later in result.scalars().all():
            later.tracking_status = "stale"
            later.quality_status = "stale"
            later.status = "draft"
            affected += 1
    state_row = (
        await db.execute(
            select(StoryTrackingState).where(
                StoryTrackingState.project_id == chapter.project_id
            )
        )
    ).scalar_one_or_none()
    if state_row:
        state_row.state_status = "needs_review"
    if commit:
        await db.commit()
    return affected


async def list_stale_chapters(
    db: AsyncSession,
    project_id: str,
) -> List[Dict[str, Any]]:
    rows = (
        await db.execute(
            select(Chapter)
            .where(Chapter.project_id == project_id)
            .where(Chapter.tracking_status == "stale")
            .order_by(Chapter.chapter_number)
        )
    ).scalars().all()
    return [
        {
            "id": chapter.id,
            "chapter_number": chapter.chapter_number,
            "title": chapter.title,
            "quality_status": chapter.quality_status,
            "tracking_status": chapter.tracking_status,
        }
        for chapter in rows
    ]
