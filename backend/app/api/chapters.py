"""章节管理API"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy import delete, select, func, update
from sqlalchemy.orm import selectinload
import json
import asyncio
import httpx
import re
from typing import Any, Awaitable, Callable, Optional
from datetime import datetime, timedelta
import time
from asyncio import Queue, Lock

from app.database import get_db, get_engine
from app.api.common import verify_project_access
from app.services.chapter_context_service import (
    OneToManyContextBuilder,
    OneToOneContextBuilder
)
from app.models.chapter import Chapter
from app.models.project import Project
from app.models.outline import Outline
from app.models.character import Character
from app.models.career import Career, CharacterCareer
from app.models.relationship import CharacterRelationship, Organization, OrganizationMember
from app.models.generation_history import GenerationHistory
from app.models.writing_style import WritingStyle
from app.models.analysis_task import AnalysisTask
from app.models.memory import PlotAnalysis, StoryMemory
from app.models.batch_generation_task import BatchGenerationTask
from app.models.regeneration_task import RegenerationTask
from app.models.background_task import BackgroundTask
from app.models.story_tracking import ChapterTrackingTransaction, StoryTrackingState
from app.services.background_task_service import (
    TaskProgressTracker,
    background_task_service,
)
from app.schemas.chapter import (
    ChapterCreate,
    ChapterUpdate,
    ChapterResponse,
    ChapterListResponse,
    AnalysisTaskStatusResponse,
    BatchAnalysisStatusRequest,
    BatchAnalysisStatusResponse,
    BatchAnalyzeUnanalyzedRequest,
    BatchAnalyzeUnanalyzedResponse,
    ChapterGenerateRequest,
    BatchGenerateRequest,
    BatchGenerateResponse,
    BatchGenerateStatusResponse,
    ExpansionPlanUpdate,
    PartialRegenerateRequest
)
from app.schemas.regeneration import (
    ChapterRegenerateRequest,
    RegenerationTaskResponse,
    RegenerationTaskStatus
)
from app.services.ai_service import AIService
from app.services.prompt_service import prompt_service, PromptService, WritingStyleManager
from app.services.plot_analyzer import PlotAnalyzer
from app.services.analysis_monitor import analysis_monitor
from app.services.memory_service import memory_service
from app.services.foreshadow_service import foreshadow_service
from app.services.chapter_regenerator import ChapterRegenerator
from app.services.writing_guards import build_creation_system_prompt, guard_for_generation
from app.services.chapter_polish import (
    latest_polish_snapshot,
    polish_chapter_after_generation,
)
from app.services.chapter_creation_service import (
    MAX_CREATION_INPUT_CHARS,
    ChapterCreationService,
)
from app.services.chapter_length_guard import (
    ChapterLengthGuard,
    iter_guarded_chunks,
)
from app.services.story_tracking_service import (
    acquire_generation_lease,
    build_tracking_card,
    commit_staged_transaction,
    ensure_project_state,
    evaluate_chapter_quality,
    get_pending_transaction,
    list_stale_chapters,
    mark_chapter_stale,
    rebuild_after_chapter_deletion,
    rebuild_authority_from_committed_transactions,
    release_generation_lease,
    resolve_plan_contract,
    stage_and_commit_analysis,
    visible_char_count,
)
from app.logger import get_logger
from app.utils.provider_policy import detect_policy_refusal, policy_refusal_error
from app.api.settings import get_user_ai_service, get_user_ai_service_from_db_by_usage
from app.utils.sse_response import SSEResponse, create_sse_response
from app.schemas.tracking import (
    ChapterQualityDecisionRequest,
    ChapterQualityReport,
    ChapterQualityStatus,
    TrackingProjectResponse,
    TrackingResyncRequest,
    TrackingResyncResponse,
)

router = APIRouter(prefix="/chapters", tags=["章节管理"])
logger = get_logger(__name__)

# 全局数据库写入锁（每个用户一个锁，用于保护SQLite写入操作）
db_write_locks: dict[str, Lock] = {}
analysis_background_tasks: set[asyncio.Task] = set()
active_chapter_generations: set[str] = set()

# 后台任务以 background_tasks 表状态为准；未绑定任务的流式生成使用兜底租约。
CHAPTER_GENERATION_LEASE_SECONDS = 2 * 60 * 60
active_chapter_generation_started_at: dict[str, float] = {}
active_chapter_generation_task_ids: dict[str, str] = {}

ANALYSIS_TASK_TIMEOUT_SECONDS = 600
ANALYSIS_TASK_STALE_SECONDS = 720
TRACKING_RESYNC_TASK_TYPE = "tracking_resync"
TRACKING_RESYNC_MAX_ATTEMPTS = 2


def _schedule_analysis_background(coroutine) -> asyncio.Task:
    """持有后台任务引用，直到任务结束。"""
    task = asyncio.create_task(coroutine)
    analysis_background_tasks.add(task)
    task.add_done_callback(analysis_background_tasks.discard)
    return task


def _split_tracking_resync_scope(
    chapters: list[Chapter],
    start_chapter: int,
    end_chapter: int,
) -> tuple[list[Chapter], list[Chapter]]:
    """按章节号拆分本次分析范围和后续待重建范围，空正文不参与。"""
    selected: list[Chapter] = []
    downstream: list[Chapter] = []
    for chapter in sorted(chapters, key=lambda item: item.chapter_number):
        if not (chapter.content or "").strip():
            continue
        if chapter.chapter_number < start_chapter:
            continue
        if chapter.chapter_number <= end_chapter:
            selected.append(chapter)
        else:
            downstream.append(chapter)
    return selected, downstream


def _tracking_resync_result(
    *,
    start_chapter: int,
    end_chapter: int,
    total_chapters: int,
    processed_chapters: int,
    retried_chapters: list[int],
    failed_chapters: list[dict[str, Any]],
    downstream_stale_chapters: int,
    remaining_stale_chapters: list[dict[str, Any]],
    tracking_revision: int,
    state_status: str,
    cancelled: bool = False,
) -> dict[str, Any]:
    return {
        "version": 1,
        "start_chapter": start_chapter,
        "end_chapter": end_chapter,
        "total_chapters": total_chapters,
        "processed_chapters": processed_chapters,
        "retried_chapters": retried_chapters,
        "failed_chapters": failed_chapters,
        "downstream_stale_chapters": downstream_stale_chapters,
        "remaining_stale_chapters": remaining_stale_chapters,
        "tracking_revision": tracking_revision,
        "state_status": state_status,
        "cancelled": cancelled,
    }


async def _active_tracking_resync_task(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
) -> Optional[BackgroundTask]:
    result = await db.execute(
        select(BackgroundTask)
        .where(
            BackgroundTask.project_id == project_id,
            BackgroundTask.user_id == user_id,
            BackgroundTask.task_type == TRACKING_RESYNC_TASK_TYPE,
            BackgroundTask.status.in_(("pending", "running")),
        )
        .order_by(BackgroundTask.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _load_tracking_runtime_state(
    db: AsyncSession,
    project_id: str,
) -> tuple[int, str, list[dict[str, Any]]]:
    state = (
        await db.execute(
            select(StoryTrackingState).where(
                StoryTrackingState.project_id == project_id
            )
        )
    ).scalar_one_or_none()
    stale = await list_stale_chapters(db, project_id)
    return (
        state.state_revision if state else 0,
        state.state_status if state else "needs_review",
        stale,
    )


async def _write_cancelled_tracking_resync_result(
    *,
    task_id: str,
    user_id: str,
    task_result: dict[str, Any],
    message: str,
) -> None:
    """写入章间取消终态和摘要；绕过进度追踪器对 cancel_requested 的跳过。"""
    engine = await get_engine(user_id)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        await session.execute(
            update(BackgroundTask)
            .where(BackgroundTask.id == task_id)
            .values(
                status="cancelled",
                cancel_requested=True,
                task_result=task_result,
                status_message=message,
                progress_details={
                    "stage": "cancelled",
                    "message": message,
                },
                completed_at=datetime.now(),
                updated_at=datetime.now(),
            )
        )
        await session.commit()


async def _run_tracking_resync_task(
    task_id: str,
    user_id: str,
    start_chapter: int,
    end_chapter: int,
) -> None:
    """按范围逐章重建连续性追踪；单章技术失败自动重试一次。"""
    tracker = TaskProgressTracker(task_id, user_id, "连续性追踪")
    engine = await get_engine(user_id)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db_session:
        try:
            task = (
                await db_session.execute(
                    select(BackgroundTask).where(BackgroundTask.id == task_id)
                )
            ).scalar_one_or_none()
            if not task:
                return

            chapters = list(
                (
                    await db_session.execute(
                        select(Chapter)
                        .where(Chapter.project_id == task.project_id)
                        .order_by(Chapter.chapter_number)
                    )
                ).scalars().all()
            )
            selected, downstream = _split_tracking_resync_scope(
                chapters,
                start_chapter,
                end_chapter,
            )
            total_chapters = len(selected)
            if total_chapters == 0:
                await tracker.set_result(
                    _tracking_resync_result(
                        start_chapter=start_chapter,
                        end_chapter=end_chapter,
                        total_chapters=0,
                        processed_chapters=0,
                        retried_chapters=[],
                        failed_chapters=[],
                        downstream_stale_chapters=len(downstream),
                        remaining_stale_chapters=[],
                        tracking_revision=0,
                        state_status="needs_review",
                    )
                )
                await tracker.error("所选范围内没有可重分析的正文章节")
                return

            await tracker.start(
                f"准备重分析第{start_chapter}章至第{end_chapter}章，共 {total_chapters} 章"
            )
            await tracker.set_result(
                _tracking_resync_result(
                    start_chapter=start_chapter,
                    end_chapter=end_chapter,
                    total_chapters=total_chapters,
                    processed_chapters=0,
                    retried_chapters=[],
                    failed_chapters=[],
                    downstream_stale_chapters=len(downstream),
                    remaining_stale_chapters=[
                        {
                            "chapter_number": chapter.chapter_number,
                            "title": chapter.title,
                        }
                        for chapter in selected + downstream
                    ],
                    tracking_revision=0,
                    state_status="needs_review",
                )
            )

            processed_chapters = 0
            retried_chapters: list[int] = []
            failed_chapters: list[dict[str, Any]] = []

            for index, chapter in enumerate(selected):
                if await tracker.check_cancelled():
                    revision, state_status, stale = await _load_tracking_runtime_state(
                        db_session, task.project_id
                    )
                    result = _tracking_resync_result(
                        start_chapter=start_chapter,
                        end_chapter=end_chapter,
                        total_chapters=total_chapters,
                        processed_chapters=processed_chapters,
                        retried_chapters=retried_chapters,
                        failed_chapters=failed_chapters,
                        downstream_stale_chapters=len(downstream),
                        remaining_stale_chapters=stale,
                        tracking_revision=revision,
                        state_status=state_status,
                        cancelled=True,
                    )
                    await _write_cancelled_tracking_resync_result(
                        task_id=task_id,
                        user_id=user_id,
                        task_result=result,
                        message=f"重分析已取消，剩余 {len(stale)} 章仍待重建",
                    )
                    return

                success = False
                quality_pause_message: Optional[str] = None

                for attempt in range(1, TRACKING_RESYNC_MAX_ATTEMPTS + 1):
                    overall_progress = int(index / total_chapters * 100)
                    attempt_suffix = f"（第 {attempt}/2 次尝试）" if attempt > 1 else ""
                    await tracker.stage(
                        "tracking_resync",
                        (
                            f"正在重分析第{chapter.chapter_number}章"
                            f"（{index + 1}/{total_chapters}）{attempt_suffix}"
                        ),
                        overall_progress,
                        {
                            "chapter_id": chapter.id,
                            "chapter_number": chapter.chapter_number,
                            "chapter_title": chapter.title,
                            "completed": processed_chapters,
                            "total": total_chapters,
                            "attempt": attempt,
                        },
                    )

                    child_task = AnalysisTask(
                        chapter_id=chapter.id,
                        user_id=user_id,
                        project_id=task.project_id,
                        background_task_id=task_id,
                        status="pending",
                        progress=0,
                    )
                    db_session.add(child_task)
                    await db_session.commit()
                    await db_session.refresh(child_task)

                    async def report_chapter_progress(child_progress: int) -> None:
                        mapped = int(
                            (
                                index
                                + max(0, min(int(child_progress), 100)) / 100
                            )
                            / total_chapters
                            * 100
                        )
                        await tracker.stage(
                            "tracking_resync",
                            (
                                f"正在重分析第{chapter.chapter_number}章"
                                f"（{index + 1}/{total_chapters}）"
                            ),
                            min(mapped, 99),
                            {
                                "chapter_id": chapter.id,
                                "chapter_number": chapter.chapter_number,
                                "chapter_title": chapter.title,
                                "completed": processed_chapters,
                                "total": total_chapters,
                                "attempt": attempt,
                                "analysis_progress": child_progress,
                            },
                        )

                    analysis_ok = await analyze_chapter_background(
                        chapter_id=chapter.id,
                        user_id=user_id,
                        project_id=task.project_id,
                        task_id=child_task.id,
                        progress_callback=report_chapter_progress,
                    )
                    await db_session.refresh(chapter)

                    if (
                        analysis_ok
                        and chapter.quality_status == "ready"
                        and chapter.tracking_status == "current"
                    ):
                        success = True
                        break

                    if analysis_ok:
                        quality_pause_message = (
                            f"第{chapter.chapter_number}章分析完成，但质量门禁状态为"
                            f" {chapter.quality_status}，需要人工处理后才能继续"
                        )
                        break

                    if attempt < TRACKING_RESYNC_MAX_ATTEMPTS:
                        if await tracker.check_cancelled():
                            break
                        retried_chapters.append(chapter.chapter_number)
                        await tracker.retry(
                            retry_count=attempt,
                            max_retries=1,
                            reason=f"第{chapter.chapter_number}章分析失败",
                        )

                # 取消只在章节之间生效；若当前章已成功完成，摘要应计入这一章。
                if success:
                    processed_chapters += 1

                if await tracker.check_cancelled():
                    revision, state_status, stale = await _load_tracking_runtime_state(
                        db_session, task.project_id
                    )
                    result = _tracking_resync_result(
                        start_chapter=start_chapter,
                        end_chapter=end_chapter,
                        total_chapters=total_chapters,
                        processed_chapters=processed_chapters,
                        retried_chapters=retried_chapters,
                        failed_chapters=failed_chapters,
                        downstream_stale_chapters=len(downstream),
                        remaining_stale_chapters=stale,
                        tracking_revision=revision,
                        state_status=state_status,
                        cancelled=True,
                    )
                    await _write_cancelled_tracking_resync_result(
                        task_id=task_id,
                        user_id=user_id,
                        task_result=result,
                        message=f"重分析已取消，剩余 {len(stale)} 章仍待重建",
                    )
                    return

                if not success:
                    child_error = (
                        await db_session.execute(
                            select(AnalysisTask.error_message)
                            .where(AnalysisTask.chapter_id == chapter.id)
                            .where(AnalysisTask.background_task_id == task_id)
                            .order_by(AnalysisTask.created_at.desc())
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                    error_message = (
                        quality_pause_message
                        or child_error
                        or "章节分析未完成，且没有返回具体错误"
                    )
                    failed_chapters.append(
                        {
                            "chapter_number": chapter.chapter_number,
                            "title": chapter.title,
                            "error": error_message,
                        }
                    )
                    revision, state_status, stale = await _load_tracking_runtime_state(
                        db_session, task.project_id
                    )
                    await tracker.set_result(
                        _tracking_resync_result(
                            start_chapter=start_chapter,
                            end_chapter=end_chapter,
                            total_chapters=total_chapters,
                            processed_chapters=processed_chapters,
                            retried_chapters=retried_chapters,
                            failed_chapters=failed_chapters,
                            downstream_stale_chapters=len(downstream),
                            remaining_stale_chapters=stale,
                            tracking_revision=revision,
                            state_status=state_status,
                        )
                    )
                    await tracker.error(
                        f"第{chapter.chapter_number}章重分析失败，已停止：{error_message}"
                    )
                    return

                completed_progress = int(
                    processed_chapters / total_chapters * 100
                )
                await tracker.stage(
                    "tracking_resync",
                    (
                        f"已完成第{chapter.chapter_number}章"
                        f"（{processed_chapters}/{total_chapters}）"
                    ),
                    min(completed_progress, 99),
                    {
                        "completed": processed_chapters,
                        "total": total_chapters,
                        "chapter_number": chapter.chapter_number,
                    },
                )

            revision, state_status, stale = await _load_tracking_runtime_state(
                db_session, task.project_id
            )
            result = _tracking_resync_result(
                start_chapter=start_chapter,
                end_chapter=end_chapter,
                total_chapters=total_chapters,
                processed_chapters=processed_chapters,
                retried_chapters=retried_chapters,
                failed_chapters=[],
                downstream_stale_chapters=len(downstream),
                remaining_stale_chapters=stale,
                tracking_revision=revision,
                state_status=state_status,
            )
            await tracker.set_result(result)
            if stale:
                await tracker.complete(
                    f"范围重分析完成：已处理 {processed_chapters} 章，"
                    f"仍有 {len(stale)} 章待后续重建"
                )
            else:
                await tracker.complete(
                    f"连续性追踪已重建完成：共处理 {processed_chapters} 章，"
                    f"追踪版本 {revision}"
                )
        except Exception as exc:
            logger.error(f"❌ 连续性追踪重分析失败: {task_id}, {exc}", exc_info=True)
            await tracker.error(str(exc))


async def create_tracking_resync_task(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    start_chapter: int,
    end_chapter: int,
) -> dict[str, Any]:
    """创建项目级连续性追踪重分析任务。"""
    active_task = await _active_tracking_resync_task(
        db,
        project_id=project_id,
        user_id=user_id,
    )
    if active_task:
        raise HTTPException(
            status_code=409,
            detail="当前项目已有连续性追踪重分析任务正在运行，请等待完成或取消后再试",
        )

    chapters_result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.chapter_number)
    )
    chapters = list(chapters_result.scalars().all())
    selected, downstream = _split_tracking_resync_scope(
        chapters,
        start_chapter,
        end_chapter,
    )
    if not selected:
        raise HTTPException(status_code=400, detail="所选范围内没有可重分析的正文章节")

    running_analysis = (
        await db.execute(
            select(AnalysisTask.chapter_id)
            .where(
                AnalysisTask.chapter_id.in_([chapter.id for chapter in selected]),
                AnalysisTask.status.in_(("pending", "running")),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if running_analysis:
        raise HTTPException(
            status_code=409,
            detail="所选范围内已有章节正在分析，请等待完成后再试",
        )

    for chapter in selected + downstream:
        chapter.quality_status = "stale"
        chapter.tracking_status = "stale"
        chapter.status = "draft"

    state = (
        await db.execute(
            select(StoryTrackingState).where(
                StoryTrackingState.project_id == project_id
            )
        )
    ).scalar_one_or_none()
    if state:
        state.state_status = "needs_review"

    task = await background_task_service.create_task(
        user_id=user_id,
        project_id=project_id,
        task_type=TRACKING_RESYNC_TASK_TYPE,
        task_input={
            "start_chapter": start_chapter,
            "end_chapter": end_chapter,
            "selected_chapter_ids": [chapter.id for chapter in selected],
            "downstream_chapter_ids": [chapter.id for chapter in downstream],
        },
        db=db,
    )

    try:
        await background_task_service.spawn_background_task(
            task.id,
            user_id,
            _run_tracking_resync_task,
            start_chapter,
            end_chapter,
        )
    except Exception as exc:
        task.status = "failed"
        task.error_message = f"重分析任务调度失败: {exc}"
        task.status_message = "任务调度失败"
        task.completed_at = datetime.now()
        await db.commit()
        raise HTTPException(status_code=500, detail="重分析任务调度失败") from exc

    return {
        "task_id": task.id,
        "task_type": TRACKING_RESYNC_TASK_TYPE,
        "status": "pending",
        "start_chapter": start_chapter,
        "end_chapter": end_chapter,
        "selected_chapters": len(selected),
        "downstream_stale_chapters": len(downstream),
        "message": "连续性追踪重分析任务已创建",
    }


def _build_lightweight_chapter_summary(content: str, max_length: int = 300) -> str:
    """生成可立即用于下一章衔接的轻量摘要兜底。"""
    if not content:
        return ""
    normalized = " ".join(content.split())
    return normalized[:max_length]


async def get_db_write_lock(user_id: str) -> Lock:
    """获取或创建用户的数据库写入锁"""
    if user_id not in db_write_locks:
        db_write_locks[user_id] = Lock()
        logger.debug(f"🔒 为用户 {user_id} 创建数据库写入锁")
    return db_write_locks[user_id]


async def _has_active_chapter_generation_task(
    chapter_id: str,
    project_id: str,
    user_id: str,
    db: AsyncSession,
) -> bool:
    """检查数据库里是否仍有该章节的排队/运行任务。"""
    result = await db.execute(
        select(BackgroundTask).where(
            BackgroundTask.user_id == user_id,
            BackgroundTask.project_id == project_id,
            BackgroundTask.task_type == "chapter_generate",
            BackgroundTask.status.in_(("pending", "running")),
        )
    )
    return any(
        isinstance(task.task_input, dict)
        and task.task_input.get("chapter_id") == chapter_id
        for task in result.scalars().all()
    )


async def _claim_chapter_generation(
    chapter_id: str,
    project_id: str,
    user_id: str,
    db: AsyncSession,
) -> bool:
    now = time.monotonic()
    started_at = active_chapter_generation_started_at.get(chapter_id)
    if chapter_id in active_chapter_generations:
        task_id = active_chapter_generation_task_ids.get(chapter_id)
        if task_id:
            try:
                task_result = await db.execute(
                    select(BackgroundTask.status).where(
                        BackgroundTask.id == task_id,
                        BackgroundTask.user_id == user_id,
                    )
                )
                task_status = task_result.scalar_one_or_none()
                if task_status in ("pending", "running"):
                    return False
            except Exception as exc:
                logger.warning(f"检查章节生成任务状态失败，保留现有锁: {chapter_id} {exc}")
                return False

            logger.warning(f"清理已结束但未释放的章节生成锁: {chapter_id}")
            _release_chapter_generation(chapter_id)
        else:
            if await _has_active_chapter_generation_task(
                chapter_id, project_id, user_id, db
            ):
                return False
            if (
                started_at is not None
                and now - started_at < CHAPTER_GENERATION_LEASE_SECONDS
            ):
                return False
            logger.warning(f"清理遗留的章节生成锁: {chapter_id}")
            _release_chapter_generation(chapter_id)

    active_chapter_generations.add(chapter_id)
    active_chapter_generation_started_at[chapter_id] = now
    return True


def _bind_chapter_generation_task(chapter_id: str, task_id: str) -> None:
    active_chapter_generation_task_ids[chapter_id] = task_id


def _release_chapter_generation(chapter_id: str) -> None:
    active_chapter_generations.discard(chapter_id)
    active_chapter_generation_started_at.pop(chapter_id, None)
    active_chapter_generation_task_ids.pop(chapter_id, None)


async def _create_db_session(user_id: str) -> AsyncSession:
    engine = await get_engine(user_id)
    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    return session_factory()


def _minimum_complete_length(target_word_count: int) -> int:
    return min(500, max(120, int(target_word_count * 0.2)))


def _chapter_generation_error(full_content: str, target_word_count: int) -> Optional[str]:
    """区分「服务商内容审核拦截」「空输出」「提前结束」三种失败，避免误报成截断。"""
    refusal = detect_policy_refusal(full_content)
    if refusal:
        return policy_refusal_error(refusal)

    stripped = full_content.strip()
    if not stripped:
        return (
            "AI 未返回正文（可能把全部输出用于思考或被模型限流）。"
            "本次内容未保存，请重试或更换模型"
        )
    if len(stripped) < _minimum_complete_length(target_word_count):
        return (
            f"AI 生成提前结束，仅生成 {len(stripped)} 字，未保存到章节。请重试"
        )
    return None


async def _monitor_event(
    task_id: str,
    level: str,
    message: str,
    progress: Optional[int] = None,
) -> None:
    """把分析器的实时事件写入内存监控（异步签名以匹配回调类型）。"""
    analysis_monitor.emit(task_id, level, message, progress)


async def _set_analysis_task_terminal_state(
    user_id: str,
    task_id: str,
    status: str,
    error_message: Optional[str] = None,
) -> bool:
    """使用独立事务写入终态，避免分析会话失败后无法更新任务。"""
    engine = await get_engine(user_id)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    completed_at = datetime.now()

    for attempt in range(1, 4):
        async with session_factory() as terminal_db:
            try:
                result = await terminal_db.execute(
                    update(AnalysisTask)
                    .where(
                        AnalysisTask.id == task_id,
                        AnalysisTask.status.in_(["pending", "running"]),
                    )
                    .values(
                        status=status,
                        progress=100 if status == "completed" else 0,
                        error_message=error_message if status == "failed" else None,
                        completed_at=completed_at,
                    )
                )
                await terminal_db.commit()
                if result.rowcount == 0:
                    logger.info(f"分析任务已处于终态，无需重复更新: {task_id}")
                    return False
                return True
            except Exception as exc:
                await terminal_db.rollback()
                logger.error(f"更新分析任务终态失败({attempt}/3): {task_id}, {exc}")
                if attempt < 3:
                    await asyncio.sleep(0.1)

    return False


@router.post("", response_model=ChapterResponse, summary="创建章节")
async def create_chapter(
    chapter: ChapterCreate,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """创建新的章节"""
    # 验证用户权限和项目是否存在
    user_id = getattr(request.state, 'user_id', None)
    project = await verify_project_access(chapter.project_id, user_id, db)
    
    # 计算可见字数；章节完成必须由追踪事务提交，不能由创建接口直接声明。
    word_count = visible_char_count(chapter.content or "")
    
    chapter_data = chapter.model_dump()
    chapter_data["status"] = "draft"
    chapter_data["quality_status"] = "draft"
    chapter_data["tracking_status"] = "uninitialized"
    db_chapter = Chapter(**chapter_data, word_count=word_count)
    db.add(db_chapter)
    
    # 更新项目的当前字数
    project.current_words = project.current_words + word_count
    
    await db.commit()
    await db.refresh(db_chapter)
    return db_chapter


@router.get("/project/{project_id}", response_model=ChapterListResponse, summary="获取项目的所有章节")
async def get_project_chapters(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """获取指定项目的所有章节（带大纲信息）"""
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(project_id, user_id, db)
    
    # 获取总数
    count_result = await db.execute(
        select(func.count(Chapter.id)).where(Chapter.project_id == project_id)
    )
    total = count_result.scalar_one()
    
    # 获取章节列表，同时加载关联的大纲信息
    result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.chapter_number)
    )
    chapters = result.scalars().all()
    
    # 获取所有大纲信息（用于填充outline_title）
    outline_ids = [ch.outline_id for ch in chapters if ch.outline_id]
    outlines_map = {}
    if outline_ids:
        outlines_result = await db.execute(
            select(Outline).where(Outline.id.in_(outline_ids))
        )
        outlines_map = {o.id: o for o in outlines_result.scalars().all()}
    
    # 为所有章节添加大纲信息（统一处理）
    chapters_with_outline = []
    for chapter in chapters:
        chapter_dict = {
            "id": chapter.id,
            "project_id": chapter.project_id,
            "chapter_number": chapter.chapter_number,
            "title": chapter.title,
            "content": chapter.content,
            "summary": chapter.summary,
            "word_count": chapter.word_count,
            "status": chapter.status,
            "quality_status": chapter.quality_status,
            "tracking_status": chapter.tracking_status,
            "tracking_revision": chapter.tracking_revision,
            "outline_id": chapter.outline_id,
            "sub_index": chapter.sub_index,
            "expansion_plan": chapter.expansion_plan,
            "created_at": chapter.created_at,
            "updated_at": chapter.updated_at,
        }
        
        # 添加大纲信息
        if chapter.outline_id and chapter.outline_id in outlines_map:
            outline = outlines_map[chapter.outline_id]
            chapter_dict["outline_title"] = outline.title
            chapter_dict["outline_order"] = outline.order_index
        else:
            chapter_dict["outline_title"] = None
            chapter_dict["outline_order"] = None
        
        chapters_with_outline.append(chapter_dict)
    
    return ChapterListResponse(total=total, items=chapters_with_outline)


@router.get(
    "/project/{project_id}/tracking",
    response_model=TrackingProjectResponse,
    summary="获取项目连续性追踪状态卡",
)
async def get_project_tracking(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = getattr(request.state, "user_id", None)
    await verify_project_access(project_id, user_id, db)
    state_row = await ensure_project_state(db, project_id)
    card = await build_tracking_card(db, project_id)
    return TrackingProjectResponse(
        project_id=project_id,
        state_revision=state_row.state_revision,
        state_status=state_row.state_status,
        last_committed_chapter=state_row.last_committed_chapter,
        imported_through_chapter=state_row.imported_through_chapter,
        context_card=card.rendered,
        stale_chapters=await list_stale_chapters(db, project_id),
    )


@router.post(
    "/project/{project_id}/tracking/resync",
    response_model=TrackingResyncResponse,
    summary="按章节范围重分析连续性追踪",
)
async def resync_project_tracking(
    project_id: str,
    payload: TrackingResyncRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """创建项目级连续性追踪重分析总任务。"""
    user_id = getattr(request.state, "user_id", None)
    await verify_project_access(project_id, user_id, db)
    result = await create_tracking_resync_task(
        db,
        project_id=project_id,
        user_id=user_id,
        start_chapter=payload.start_chapter,
        end_chapter=payload.end_chapter,
    )
    return TrackingResyncResponse(**result)


@router.get("/{chapter_id}", response_model=ChapterResponse, summary="获取章节详情")
async def get_chapter(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """根据ID获取章节详情"""
    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(chapter.project_id, user_id, db)
    
    return chapter


@router.get("/{chapter_id}/navigation", summary="获取章节导航信息")
async def get_chapter_navigation(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    获取章节的导航信息（上一章/下一章）
    用于章节阅读器的翻页功能
    """
    # 获取当前章节
    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    current_chapter = result.scalar_one_or_none()
    
    if not current_chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(current_chapter.project_id, user_id, db)
    
    # 获取上一章
    prev_result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == current_chapter.project_id)
        .where(Chapter.chapter_number < current_chapter.chapter_number)
        .order_by(Chapter.chapter_number.desc())
        .limit(1)
    )
    prev_chapter = prev_result.scalar_one_or_none()
    
    # 获取下一章
    next_result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == current_chapter.project_id)
        .where(Chapter.chapter_number > current_chapter.chapter_number)
        .order_by(Chapter.chapter_number.asc())
        .limit(1)
    )
    next_chapter = next_result.scalar_one_or_none()
    
    return {
        "current": {
            "id": current_chapter.id,
            "chapter_number": current_chapter.chapter_number,
            "title": current_chapter.title
        },
        "previous": {
            "id": prev_chapter.id,
            "chapter_number": prev_chapter.chapter_number,
            "title": prev_chapter.title
        } if prev_chapter else None,
        "next": {
            "id": next_chapter.id,
            "chapter_number": next_chapter.chapter_number,
            "title": next_chapter.title
        } if next_chapter else None
    }


@router.put("/{chapter_id}", response_model=ChapterResponse, summary="更新章节")
async def update_chapter(
    chapter_id: str,
    chapter_update: ChapterUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """更新章节信息"""
    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(chapter.project_id, user_id, db)
    
    # 记录旧字数
    old_word_count = chapter.word_count or 0
    
    # 更新字段
    update_data = chapter_update.model_dump(exclude_unset=True)
    if "status" in update_data:
        requested_status = update_data["status"]
        if (
            requested_status == "completed"
            and (
                chapter.quality_status != "ready"
                or chapter.tracking_status != "current"
            )
        ):
            raise HTTPException(
                status_code=409,
                detail="章节尚未通过质量门禁并提交连续性追踪，不能标记为已完成",
            )
    for field, value in update_data.items():
        setattr(chapter, field, value)
    
    # 如果内容更新了，重新计算字数（包括清空内容的情况）
    if "content" in update_data:
        new_word_count = visible_char_count(chapter.content or "")
        chapter.word_count = new_word_count
        
        # 更新项目字数
        result = await db.execute(
            select(Project).where(Project.id == chapter.project_id)
        )
        project = result.scalar_one_or_none()
        if project:
            project.current_words = max(
                0,
                (project.current_words or 0) - old_word_count + new_word_count,
            )
        
        # 如果内容被清空，清理相关数据
        if not chapter.content or chapter.content.strip() == "":
                chapter.status = "draft"
                
                # 清理分析任务
                analysis_tasks_result = await db.execute(
                    select(AnalysisTask).where(AnalysisTask.chapter_id == chapter_id)
                )
                analysis_tasks = analysis_tasks_result.scalars().all()
                for task in analysis_tasks:
                    await db.delete(task)
                
                # 清理分析结果
                plot_analysis_result = await db.execute(
                    select(PlotAnalysis).where(PlotAnalysis.chapter_id == chapter_id)
                )
                plot_analyses = plot_analysis_result.scalars().all()
                for analysis in plot_analyses:
                    await db.delete(analysis)
                
                # 清理故事记忆（关系数据库）
                story_memories_result = await db.execute(
                    select(StoryMemory).where(StoryMemory.chapter_id == chapter_id)
                )
                story_memories = story_memories_result.scalars().all()
                for memory in story_memories:
                    await db.delete(memory)
                
                # 清理向量数据库中的记忆数据
                try:
                    await memory_service.delete_chapter_memories(
                        user_id=user_id,
                        project_id=chapter.project_id,
                        chapter_id=chapter_id
                    )
                    logger.info(f"✅ 已清理章节 {chapter_id[:8]} 的向量记忆数据")
                except Exception as e:
                    logger.warning(f"⚠️ 清理向量记忆数据失败: {str(e)}")
                
                # 🔮 清理章节相关的分析伏笔数据
                try:
                    foreshadow_result = await foreshadow_service.delete_chapter_foreshadows(
                        db=db,
                        project_id=chapter.project_id,
                        chapter_id=chapter_id,
                        only_analysis_source=True  # 只删除分析来源的伏笔，保留手动创建的
                    )
                    if foreshadow_result['deleted_count'] > 0:
                        logger.info(f"🔮 已清理章节 {chapter_id[:8]} 的 {foreshadow_result['deleted_count']} 个伏笔数据")
                except Exception as e:
                    logger.warning(f"⚠️ 清理伏笔数据失败: {str(e)}")
                
                logger.info(f"🗑️ 章节 {chapter_id[:8]} 内容已清空，已清理分析、记忆和伏笔数据")
    
    if "content" in update_data:
        if not (chapter.content or "").strip():
            await rebuild_authority_from_committed_transactions(
                db,
                chapter.project_id,
                through_chapter=max(0, chapter.chapter_number - 1),
            )
        await mark_chapter_stale(db, chapter, cascade=True, commit=False)

    # 单次提交可避免 updated_at 在第二次 UPDATE 后进入待加载状态；
    # refresh 确保响应装配阶段不再发生同步 ORM IO。
    await db.commit()
    await db.refresh(chapter)
    
    chapter_dict = {
        "id": chapter.id,
        "project_id": chapter.project_id,
        "chapter_number": chapter.chapter_number,
        "title": chapter.title,
        "content": chapter.content,
        "summary": chapter.summary,
        "word_count": chapter.word_count,
        "status": chapter.status,
        "quality_status": chapter.quality_status,
        "tracking_status": chapter.tracking_status,
        "tracking_revision": chapter.tracking_revision,
        "outline_id": chapter.outline_id,
        "sub_index": chapter.sub_index,
        "expansion_plan": chapter.expansion_plan,
        "created_at": chapter.created_at,
        "updated_at": chapter.updated_at,
        "outline_title": None,
        "outline_order": None
    }
    
    # 如果章节关联了大纲，查询大纲信息
    if chapter.outline_id:
        outline_result = await db.execute(
            select(Outline).where(Outline.id == chapter.outline_id)
        )
        outline = outline_result.scalar_one_or_none()
        if outline:
            chapter_dict["outline_title"] = outline.title
            chapter_dict["outline_order"] = outline.order_index
    
    return chapter_dict


@router.get("/{chapter_id}/polish-snapshot", summary="查询最近一次自动去味的原文快照")
async def get_polish_snapshot(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """返回快照元信息（不返回全文），供章节编辑器决定是否显示「恢复去味前原文」"""
    result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(chapter.project_id, user_id, db)

    snapshot = await latest_polish_snapshot(db, chapter_id)
    if not snapshot:
        return {"available": False}
    return {
        "available": True,
        "note": snapshot["note"],
        "word_count": len(snapshot["content"]),
        "created_at": snapshot["created_at"],
    }


@router.post("/{chapter_id}/polish-snapshot/restore", summary="恢复自动去味前的原文")
async def restore_polish_snapshot(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """把章节正文换回最近一次自动去味前的快照

    自动去味会改写整章，人工改过的内容也可能被覆盖；这里提供一键回滚，
    只恢复正文与字数，不删除去味留下的分析记录。
    """
    result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(chapter.project_id, user_id, db)

    snapshot = await latest_polish_snapshot(db, chapter_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="没有可恢复的去味前原文")

    old_word_count = chapter.word_count or 0
    chapter.content = snapshot["content"]
    chapter.word_count = visible_char_count(snapshot["content"])
    chapter.summary = _build_lightweight_chapter_summary(chapter.content)

    project_result = await db.execute(
        select(Project).where(Project.id == chapter.project_id)
    )
    project = project_result.scalar_one_or_none()
    if project:
        project.current_words = (
            (project.current_words or 0) - old_word_count + chapter.word_count
        )

    await db.commit()
    await db.refresh(chapter)
    await mark_chapter_stale(db, chapter, cascade=True)
    logger.info(f"↩️ 已恢复章节 {chapter_id[:8]} 自动去味前的原文")

    return {
        "success": True,
        "content": chapter.content,
        "word_count": chapter.word_count,
        "quality_status": chapter.quality_status,
        "tracking_status": chapter.tracking_status,
        "message": "已恢复自动去味前的原文",
    }


@router.delete("/{chapter_id}", summary="删除章节")
async def delete_chapter(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """删除章节"""
    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(chapter.project_id, user_id, db)
    await ensure_project_state(db, chapter.project_id)
    deleted_project_id = chapter.project_id
    deleted_chapter_number = chapter.chapter_number
    
    # 更新项目字数
    result = await db.execute(
        select(Project).where(Project.id == chapter.project_id)
    )
    project = result.scalar_one_or_none()
    if project:
        # 处理 word_count 和 current_words 可能为 None 的情况
        chapter_word_count = chapter.word_count or 0
        project.current_words = max(0, (project.current_words or 0) - chapter_word_count)
    
    # 🗑️ 清理向量数据库中的记忆数据
    try:
        await memory_service.delete_chapter_memories(
            user_id=user_id,
            project_id=chapter.project_id,
            chapter_id=chapter_id
        )
        logger.info(f"✅ 已清理章节 {chapter_id[:8]} 的向量记忆数据")
    except Exception as e:
        logger.warning(f"⚠️ 清理向量记忆数据失败: {str(e)}")
        # 不阻断删除流程，继续执行
    
    # 🔮 清理与该章节相关的伏笔数据（仅分析来源的伏笔）
    try:
        foreshadow_result = await foreshadow_service.delete_chapter_foreshadows(
            db=db,
            project_id=chapter.project_id,
            chapter_id=chapter_id,
            only_analysis_source=True  # 只删除分析来源的伏笔，保留手动创建的
        )
        if foreshadow_result['deleted_count'] > 0:
            logger.info(f"🔮 已清理章节 {chapter_id[:8]} 的 {foreshadow_result['deleted_count']} 个伏笔数据")
    except Exception as e:
        logger.warning(f"⚠️ 清理伏笔数据失败: {str(e)}")
        # 不阻断删除流程，继续执行
    
    # 先清理追踪事务，避免 SQLite 未启用外键级联时留下孤儿审计记录。
    await db.execute(
        delete(ChapterTrackingTransaction).where(
            ChapterTrackingTransaction.chapter_id == chapter_id
        )
    )

    # 删除章节（关系数据库中的记忆会被级联删除）
    await db.delete(chapter)
    await db.flush()
    await rebuild_after_chapter_deletion(
        db,
        deleted_project_id,
        deleted_chapter_number=deleted_chapter_number,
    )
    
    return {"message": "章节删除成功"}


async def check_prerequisites(db: AsyncSession, chapter: Chapter) -> tuple[bool, str, list[Chapter]]:
    """
    检查章节前置条件
    
    Args:
        db: 数据库会话
        chapter: 当前章节
        
    Returns:
        (可否生成, 错误信息, 前置章节列表)
    """
    state_row = await ensure_project_state(db, chapter.project_id)

    outline = None
    if chapter.outline_id:
        outline = (
            await db.execute(select(Outline).where(Outline.id == chapter.outline_id))
        ).scalar_one_or_none()
    else:
        outline = (
            await db.execute(
                select(Outline)
                .where(Outline.project_id == chapter.project_id)
                .where(Outline.order_index == chapter.chapter_number)
                .limit(1)
            )
        ).scalar_one_or_none()
    try:
        resolve_plan_contract(chapter, outline)
    except ValueError as exc:
        return False, f"本章细纲契约未就绪：{exc}", []

    # 如果是第一章，无需检查前置
    if chapter.chapter_number == 1:
        return True, "", []
    
    # 查询所有前置章节（序号小于当前章节的）
    result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == chapter.project_id)
        .where(Chapter.chapter_number < chapter.chapter_number)
        .order_by(Chapter.chapter_number)
    )
    previous_chapters = result.scalars().all()
    
    # 检查是否所有前置章节都有内容
    incomplete_chapters = [
        ch for ch in previous_chapters
        if not ch.content or ch.content.strip() == ""
    ]
    
    if incomplete_chapters:
        missing_numbers = [str(ch.chapter_number) for ch in incomplete_chapters]
        error_msg = f"需要先完成前置章节：第 {', '.join(missing_numbers)} 章"
        return False, error_msg, previous_chapters

    invalid_quality = [
        ch for ch in previous_chapters
        if (ch.quality_status or "draft") not in ("ready",)
    ]
    if invalid_quality:
        details = "、".join(
            f"第{ch.chapter_number}章({ch.quality_status})"
            for ch in invalid_quality[:5]
        )
        return False, f"前置章节尚未通过质量门禁：{details}", previous_chapters

    stale_tracking = [
        ch for ch in previous_chapters
        if (ch.tracking_status or "uninitialized") != "current"
    ]
    if stale_tracking:
        details = "、".join(
            f"第{ch.chapter_number}章({ch.tracking_status})"
            for ch in stale_tracking[:5]
        )
        return False, f"前置章节追踪状态未同步：{details}", previous_chapters

    previous_chapter = previous_chapters[-1]
    if (state_row.last_committed_chapter or 0) < previous_chapter.chapter_number:
        return False, "项目追踪状态落后于已写章节，请先完成同步", previous_chapters
    
    return True, "", previous_chapters


async def check_previous_analysis_ready(db: AsyncSession, chapter: Chapter) -> tuple[bool, str]:
    """检查上一章分析是否完成，避免下一章使用滞后的记忆和角色状态。"""
    if chapter.chapter_number <= 1:
        return True, ""

    prev_result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == chapter.project_id)
        .where(Chapter.chapter_number < chapter.chapter_number)
        .order_by(Chapter.chapter_number.desc())
        .limit(1)
    )
    prev_chapter = prev_result.scalar_one_or_none()
    if not prev_chapter or not prev_chapter.content:
        return True, ""

    # 只查询标量字段，避免复用当前 Session identity map 中的旧 ORM 实例。
    analysis_result = await db.execute(
        select(AnalysisTask.id, AnalysisTask.status)
        .where(AnalysisTask.chapter_id == prev_chapter.id)
        .order_by(AnalysisTask.created_at.desc())
        .limit(1)
    )
    analysis_task = analysis_result.first()
    if analysis_task and analysis_task.status == 'completed' and prev_chapter.tracking_status == "current":
        return True, ""

    if analysis_task and analysis_task.status == 'completed':
        return False, f"上一章（第{prev_chapter.chapter_number}章）分析已完成，但连续性追踪尚未提交"

    return False, f"上一章（第{prev_chapter.chapter_number}章）内容分析尚未完成，请等待分析完成后再生成下一章，以保证角色状态、记忆和伏笔连贯"


async def build_characters_info_with_careers(
    db: AsyncSession,
    project_id: str,
    characters: list[Character],
    filter_character_names: Optional[list[str]] = None
) -> str:
    """
    构建包含职业信息的角色上下文
    
    Args:
        db: 数据库会话
        project_id: 项目ID
        characters: 角色列表
        filter_character_names: 可选，筛选特定角色名称列表（用于1-1模式的structure.characters或1-n模式的expansion_plan.character_focus）
        
    Returns:
        格式化的角色信息字符串，包含职业信息
    """
    if not characters:
        return '暂无角色信息'
    
    # 如果提供了筛选名单，只保留匹配的角色
    if filter_character_names:
        filtered_characters = [c for c in characters if c.name in filter_character_names]
        if not filtered_characters:
            logger.warning(f"筛选后无匹配角色，使用全部角色。筛选名单: {filter_character_names}")
            filtered_characters = characters
        else:
            logger.info(f"根据筛选名单保留 {len(filtered_characters)}/{len(characters)} 个角色: {[c.name for c in filtered_characters]}")
        characters = filtered_characters
    
    # 获取所有职业信息（一次性查询，提高效率）
    careers_result = await db.execute(
        select(Career).where(Career.project_id == project_id)
    )
    careers_map = {c.id: c for c in careers_result.scalars().all()}
    
    # 获取所有角色的职业关联（一次性查询）
    character_ids = [c.id for c in characters]
    if not character_ids:
        return '暂无角色信息'
    
    # 构建全局角色名称映射（用于关系显示）
    all_chars_result = await db.execute(
        select(Character.id, Character.name).where(Character.project_id == project_id)
    )
    all_char_name_map = {row.id: row.name for row in all_chars_result.all()}
        
    character_careers_result = await db.execute(
        select(CharacterCareer).where(CharacterCareer.character_id.in_(character_ids))
    )
    character_careers = character_careers_result.scalars().all()
    
    # 获取所有角色的关系（一次性查询）
    from sqlalchemy import or_
    rels_result = await db.execute(
        select(CharacterRelationship).where(
            CharacterRelationship.project_id == project_id,
            or_(
                CharacterRelationship.character_from_id.in_(character_ids),
                CharacterRelationship.character_to_id.in_(character_ids)
            )
        )
    )
    all_relationships = rels_result.scalars().all()
    
    # 按角色ID分组关系
    char_rels_map: dict[str, list] = {cid: [] for cid in character_ids}
    for r in all_relationships:
        if r.character_from_id in char_rels_map:
            char_rels_map[r.character_from_id].append(r)
        if r.character_to_id in char_rels_map:
            char_rels_map[r.character_to_id].append(r)
    
    # 获取所有组织及其成员关系（一次性查询）
    orgs_result = await db.execute(
        select(Organization).where(Organization.project_id == project_id)
    )
    all_orgs = orgs_result.scalars().all()
    
    # 构建组织ID到组织名称的映射（通过关联的Character记录）
    org_name_map = {}  # org_id -> org_name
    char_id_to_org = {}  # character_id -> Organization（用于组织实体补充详情）
    for org in all_orgs:
        org_name_map[org.id] = all_char_name_map.get(org.character_id, '未知组织')
        char_id_to_org[org.character_id] = org
    
    # 获取所有组织的成员关系（一次性查询）
    org_ids = [org.id for org in all_orgs]
    all_org_members = []
    if org_ids:
        all_org_members_result = await db.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id.in_(org_ids)
            )
        )
        all_org_members = all_org_members_result.scalars().all()
    
    # 按组织ID分组成员（用于组织实体显示成员列表）
    org_members_map: dict[str, list] = {oid: [] for oid in org_ids}
    for m in all_org_members:
        if m.organization_id in org_members_map:
            org_members_map[m.organization_id].append(m)
    
    # 获取涉及当前非组织角色的成员关系
    non_org_char_ids = [c.id for c in characters if not c.is_organization]
    char_org_map: dict[str, list] = {cid: [] for cid in non_org_char_ids}
    for m in all_org_members:
        if m.character_id in char_org_map:
            char_org_map[m.character_id].append(m)
    
    # 构建角色ID到职业信息的映射
    char_career_map = {}
    for cc in character_careers:
        if cc.character_id not in char_career_map:
            char_career_map[cc.character_id] = {'main': None, 'sub': []}
        
        career = careers_map.get(cc.career_id)
        if not career:
            continue
            
        career_info = {
            'name': career.name,
            'stage': cc.current_stage,
            'max_stage': career.max_stage,
            'stage_progress': cc.stage_progress
        }
        
        if cc.career_type == 'main':
            char_career_map[cc.character_id]['main'] = career_info
        else:
            char_career_map[cc.character_id]['sub'].append(career_info)
    
    # 构建角色信息字符串
    characters_info_parts = []
    for c in characters:
        # 基本信息（含存活状态标记）
        entity_type = '组织' if c.is_organization else '角色'
        status_marker = ""
        char_status = getattr(c, 'status', None) or 'active'
        if char_status != 'active':
            STATUS_MARKERS = {
                'deceased': '💀已死亡',
                'missing': '❓已失踪',
                'retired': '📤已退场',
                'destroyed': '💀已覆灭'
            }
            status_marker = f" [{STATUS_MARKERS.get(char_status, char_status)}]"
        base_info = f"- {c.name}({entity_type}, {c.role_type}){status_marker}"
        
        # 组织实体：补充组织详情
        org_detail_str = ""
        if c.is_organization and c.id in char_id_to_org:
            org = char_id_to_org[c.id]
            org_detail_parts = []
            if c.organization_type:
                org_detail_parts.append(f"类型:{c.organization_type}")
            if c.organization_purpose:
                purpose_preview = c.organization_purpose[:60] if len(c.organization_purpose) > 60 else c.organization_purpose
                org_detail_parts.append(f"宗旨:{purpose_preview}")
            if org.power_level is not None:
                org_detail_parts.append(f"势力等级:{org.power_level}")
            if org.location:
                org_detail_parts.append(f"据点:{org.location}")
            if org.motto:
                org_detail_parts.append(f"口号:{org.motto}")
            if org.member_count:
                org_detail_parts.append(f"成员数:{org.member_count}")
            if org_detail_parts:
                org_detail_str = f" | {', '.join(org_detail_parts)}"
            
            # 显示组织的核心成员列表（最多5个）
            if org.id in org_members_map and org_members_map[org.id]:
                member_parts = []
                for m in sorted(org_members_map[org.id], key=lambda x: -(x.rank or 0))[:5]:
                    m_name = all_char_name_map.get(m.character_id, '未知')
                    m_desc = f"{m_name}({m.position})"
                    if m.status and m.status != 'active':
                        m_desc += f"[{m.status}]"
                    member_parts.append(m_desc)
                if member_parts:
                    org_detail_str += f" | 成员: {', '.join(member_parts)}"
        
        # 职业信息
        career_info_str = ""
        if c.id in char_career_map:
            career_data = char_career_map[c.id]
            
            # 主职业
            if career_data['main']:
                main = career_data['main']
                stage_desc = f"{main['stage']}/{main['max_stage']}阶"
                career_info_str += f" | 主职业: {main['name']}({stage_desc})"
            
            # 副职业
            if career_data['sub']:
                sub_list = []
                for sub in career_data['sub']:
                    stage_desc = f"{sub['stage']}/{sub['max_stage']}阶"
                    sub_list.append(f"{sub['name']}({stage_desc})")
                career_info_str += f" | 副职业: {', '.join(sub_list)}"
        
        # 心理状态（由章节分析自动更新）
        state_str = ""
        if c.current_state:
            state_preview = c.current_state[:50] if len(c.current_state) > 50 else c.current_state
            state_str = f" | 当前状态: {state_preview}"
            if c.state_updated_chapter:
                state_str += f"(第{c.state_updated_chapter}章)"
        
        # 组织成员信息（非组织角色才显示所属组织）
        org_str = ""
        if not c.is_organization and c.id in char_org_map and char_org_map[c.id]:
            org_parts = []
            for m in char_org_map[c.id][:3]:  # 最多显示3个组织
                o_name = org_name_map.get(m.organization_id, '未知组织')
                o_desc = f"{o_name}({m.position})"
                if m.loyalty is not None and m.loyalty != 50:
                    o_desc += f"[忠诚度:{m.loyalty}]"
                if m.status and m.status != 'active':
                    o_desc += f"[{m.status}]"
                org_parts.append(o_desc)
            if org_parts:
                org_str = f" | 所属组织: {', '.join(org_parts)}"
        
        # 关系信息
        rel_str = ""
        if c.id in char_rels_map and char_rels_map[c.id]:
            rel_parts = []
            seen_pairs = set()  # 避免重复显示同一对关系
            for r in char_rels_map[c.id][:5]:  # 最多显示5个关系
                # 确定对方角色名
                if r.character_from_id == c.id:
                    other_name = all_char_name_map.get(r.character_to_id, '未知')
                else:
                    other_name = all_char_name_map.get(r.character_from_id, '未知')
                
                pair_key = tuple(sorted([c.id, r.character_from_id if r.character_from_id != c.id else r.character_to_id]))
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                
                rel_name = r.relationship_name or '关联'
                rel_desc = f"{other_name}({rel_name})"
                if r.intimacy_level is not None and r.intimacy_level != 50:
                    rel_desc += f"[亲密度:{r.intimacy_level}]"
                rel_parts.append(rel_desc)
            
            if rel_parts:
                rel_str = f" | 关系: {', '.join(rel_parts)}"
        
        # 性格描述
        personality_str = ""
        if c.personality:
            personality_preview = c.personality[:100] if len(c.personality) > 100 else c.personality
            personality_str = f": {personality_preview}"
        
        # 组合完整信息
        full_info = base_info + org_detail_str + career_info_str + state_str + org_str + rel_str + personality_str
        characters_info_parts.append(full_info)
    
    return "\n".join(characters_info_parts)


@router.get("/{chapter_id}/can-generate", summary="检查章节是否可以生成")
async def check_can_generate(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    检查章节是否满足生成条件
    返回可生成状态和前置章节信息
    """
    # 获取章节
    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(chapter.project_id, user_id, db)
    
    # 检查前置条件
    can_generate, error_msg, previous_chapters = await check_prerequisites(db, chapter)
    
    # 构建前置章节信息
    previous_info = [
        {
            "id": ch.id,
            "chapter_number": ch.chapter_number,
            "title": ch.title,
            "has_content": bool(ch.content and ch.content.strip()),
            "word_count": ch.word_count or 0
        }
        for ch in previous_chapters
    ]
    
    return {
        "can_generate": can_generate,
        "reason": error_msg if not can_generate else "",
        "gate_status": "ready" if can_generate else "blocked",
        "quality_status": chapter.quality_status,
        "tracking_status": chapter.tracking_status,
        "next_actions": [] if can_generate else ["resync_tracking", "open_outline"],
        "previous_chapters": previous_info,
        "chapter_number": chapter.chapter_number
    }


@router.get("/{chapter_id}/quality", summary="获取章节质量门禁结果")
async def get_chapter_quality(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    chapter = (
        await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    ).scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    user_id = getattr(request.state, "user_id", None)
    await verify_project_access(chapter.project_id, user_id, db)

    transaction_row = await get_pending_transaction(db, chapter_id)
    report = (
        ChapterQualityReport.model_validate(transaction_row.quality_report)
        if transaction_row and transaction_row.quality_report
        else ChapterQualityReport(
            status=chapter.quality_status or "draft",
            word_count=len(re.sub(r"\s+", "", chapter.content or "")),
            available_actions=["resync_tracking"] if chapter.content else ["rewrite"],
        )
    )
    return {
        "chapter_id": chapter.id,
        "quality_status": chapter.quality_status,
        "tracking_status": chapter.tracking_status,
        "tracking_revision": chapter.tracking_revision,
        "report": report.model_dump(),
        "transaction_id": transaction_row.id if transaction_row else None,
    }


@router.post("/{chapter_id}/quality/decision", summary="处理章节质量门禁的人工决策")
async def decide_chapter_quality(
    chapter_id: str,
    decision: ChapterQualityDecisionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    chapter = (
        await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    ).scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    user_id = getattr(request.state, "user_id", None)
    await verify_project_access(chapter.project_id, user_id, db)

    if decision.action == "resync_tracking":
        result = await create_tracking_resync_task(
            db,
            project_id=chapter.project_id,
            user_id=user_id,
            start_chapter=chapter.chapter_number,
            end_chapter=max(
                (
                    await db.execute(
                        select(func.max(Chapter.chapter_number)).where(
                            Chapter.project_id == chapter.project_id,
                            Chapter.content.is_not(None),
                            func.trim(Chapter.content) != "",
                        )
                    )
                ).scalar_one_or_none()
                or chapter.chapter_number,
                chapter.chapter_number,
            ),
        )
        return {"queued": True, **result}

    if decision.action == "rewrite":
        chapter.quality_status = "blocked"
        await db.commit()
        return {
            "queued": False,
            "message": "请修改正文或重新生成后再次检查",
        }

    transaction_row = await get_pending_transaction(db, chapter_id)
    if not transaction_row or transaction_row.status == "committed":
        raise HTTPException(status_code=409, detail="没有待确认的章节追踪事务")
    outline = None
    if chapter.outline_id:
        outline = (
            await db.execute(select(Outline).where(Outline.id == chapter.outline_id))
        ).scalar_one_or_none()
    override = {
        "kind": decision.action,
        "reason": decision.reason or "",
        "accepted_by": user_id,
        "accepted_at": datetime.now().isoformat(),
    }
    report = await evaluate_chapter_quality(
        chapter,
        outline=outline,
        override=override,
    )
    if report.status.value != "ready":
        raise HTTPException(status_code=409, detail="该决策不足以解除当前阻断项")
    transaction_row.quality_report = report.model_dump()
    transaction_row.audit_json = {
        **dict(transaction_row.audit_json or {}),
        "override": override,
    }
    chapter.quality_status = "ready"
    await db.commit()
    try:
        committed = await commit_staged_transaction(db, transaction_row)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        "accepted": True,
        "quality_status": chapter.quality_status,
        "tracking_status": chapter.tracking_status,
        "tracking_revision": chapter.tracking_revision,
        "transaction_id": committed.id,
    }


async def analyze_chapter_background(
    chapter_id: str,
    user_id: str,
    project_id: str,
    task_id: str,
    progress_callback: Optional[Callable[[int], Awaitable[None]]] = None,
) -> bool:
    """执行有硬超时保障的章节分析，并确保中断后任务进入终态。

    章节分析统一使用「章节内容分析」专用文本模型配置（未配置时回退当前启用配置），
    不接受外部传入的 AI 服务实例，避免写作模型与分析方法混用。
    """
    try:
        return await asyncio.wait_for(
            _analyze_chapter_background_impl(
                chapter_id=chapter_id,
                user_id=user_id,
                project_id=project_id,
                task_id=task_id,
                progress_callback=progress_callback,
            ),
            timeout=ANALYSIS_TASK_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        error_message = f"分析任务超时（超过{ANALYSIS_TASK_TIMEOUT_SECONDS // 60}分钟）"
        logger.error(f"❌ {error_message}: chapter_id={chapter_id}, task_id={task_id}")
        analysis_monitor.emit(task_id, "error", error_message, None)
        analysis_monitor.finish(task_id, "failed")
        await _set_analysis_task_terminal_state(user_id, task_id, "failed", error_message)
        return False
    except asyncio.CancelledError:
        analysis_monitor.emit(task_id, "error", "分析任务被取消", None)
        analysis_monitor.finish(task_id, "failed")
        terminal_update = asyncio.create_task(
            _set_analysis_task_terminal_state(
                user_id,
                task_id,
                "failed",
                "分析任务被取消或服务关闭",
            )
        )
        await asyncio.shield(terminal_update)
        raise


async def _analyze_chapter_background_impl(
    chapter_id: str,
    user_id: str,
    project_id: str,
    task_id: str,
    progress_callback: Optional[Callable[[int], Awaitable[None]]] = None,
) -> bool:
    """
    后台异步分析章节（支持并发，使用锁保护数据库写入）
    
    Args:
        chapter_id: 章节ID
        user_id: 用户ID
        project_id: 项目ID
        task_id: 任务ID
        
    Returns:
        bool: True表示分析成功，False表示分析失败
    """
    db_session = None
    write_lock = await get_db_write_lock(user_id)

    async def report_progress(progress: int) -> None:
        if not progress_callback:
            return
        try:
            await progress_callback(progress)
        except Exception as callback_error:
            logger.warning(f"⚠️ 同步章节分析进度失败: {callback_error}")
    
    try:
        logger.info(f"🔍 开始分析章节: {chapter_id}, 任务ID: {task_id}")
        
        # 创建独立数据库会话
        from app.database import get_engine
        from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
        
        engine = await get_engine(user_id)
        AsyncSessionLocal = async_sessionmaker(
            engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
        db_session = AsyncSessionLocal()
        
        # 1. 获取任务（读操作）
        task_result = await db_session.execute(
            select(AnalysisTask).where(AnalysisTask.id == task_id)
        )
        task = task_result.scalar_one_or_none()
        
        if not task:
            logger.error(f"❌ 任务不存在: {task_id}")
            return False
        if task.status not in ("pending", "running"):
            logger.warning(f"分析任务已结束，跳过执行: {task_id}, status={task.status}")
            return False
        
        # 更新任务状态（写操作，需要锁）
        async with write_lock:
            task.status = 'running'
            task.started_at = datetime.now()
            task.progress = 10
            await db_session.commit()
        await report_progress(10)
        
        # 2. 获取章节信息（读操作）
        chapter_result = await db_session.execute(
            select(Chapter).where(Chapter.id == chapter_id)
        )
        chapter = chapter_result.scalar_one_or_none()
        if not chapter or not chapter.content:
            async with write_lock:
                task.status = 'failed'
                task.error_message = '章节不存在或内容为空'
                task.completed_at = datetime.now()
                await db_session.commit()
            logger.error(f"❌ 章节不存在或内容为空: {chapter_id}")
            analysis_monitor.start(
                task_id=task_id,
                project_id=project_id,
                chapter_id=chapter_id,
            )
            analysis_monitor.emit(task_id, "error", "章节不存在或内容为空", None)
            analysis_monitor.finish(task_id, "failed")
            return False

        # 过程监控：记录本章分析的分阶段日志，供前端「分析监控」面板查看
        analysis_monitor.start(
            task_id=task_id,
            project_id=project_id,
            chapter_id=chapter_id,
            chapter_number=chapter.chapter_number,
            chapter_title=chapter.title,
        )
        analysis_monitor.emit(
            task_id,
            "info",
            f"任务已领取：第{chapter.chapter_number}章《{chapter.title}》，正文 {len(chapter.content)} 字",
            20,
        )
        
        async with write_lock:
            task.progress = 20
            await db_session.commit()
        await report_progress(20)
        
        ai_service = await get_user_ai_service_from_db_by_usage(
            user_id=user_id,
            db=db_session,
            usage="chapter_analysis"
        )
        analysis_monitor.emit(task_id, "info", "AI 服务已就绪，开始加载伏笔与角色上下文", 22)

        # 获取已埋入的伏笔列表（用于回收匹配，传入当前章节号以启用智能标记）
        existing_foreshadows = await foreshadow_service.get_planted_foreshadows_for_analysis(
            db=db_session,
            project_id=project_id,
            current_chapter_number=chapter.chapter_number  # 传入当前章节号以启用智能标记
        )
        logger.info(f"📋 后台分析 - 已获取{len(existing_foreshadows)}个已埋入伏笔用于匹配（含智能回收标记）")
        analysis_monitor.emit(
            task_id,
            "info",
            f"已加载 {len(existing_foreshadows)} 个已埋入伏笔用于回收匹配",
            23,
        )
        
        # 获取项目角色信息（根据大纲/展开规划筛选本章相关角色）
        filter_character_names = None
        
        # 1-N模式：从expansion_plan中提取character_focus
        if chapter.expansion_plan:
            try:
                plan = json.loads(chapter.expansion_plan)
                focus_names = plan.get('character_focus', [])
                if focus_names:
                    filter_character_names = focus_names
                    logger.info(f"📋 从expansion_plan提取角色焦点: {filter_character_names}")
            except (json.JSONDecodeError, Exception):
                pass
        
        # 1-1模式：从outline.structure中提取characters
        if not filter_character_names and chapter.outline_id:
            try:
                outline_result = await db_session.execute(
                    select(Outline).where(Outline.id == chapter.outline_id)
                )
                chapter_outline = outline_result.scalar_one_or_none()
                if chapter_outline and chapter_outline.structure:
                    structure = json.loads(chapter_outline.structure)
                    raw_characters = structure.get('characters', [])
                    if raw_characters:
                        filter_character_names = [
                            c['name'] if isinstance(c, dict) else c
                            for c in raw_characters
                        ]
                        logger.info(f"📋 从outline.structure提取角色: {filter_character_names}")
            except (json.JSONDecodeError, Exception):
                pass
        
        # 查询角色（根据筛选名单或全部）
        characters_query = select(Character).where(Character.project_id == project_id)
        if filter_character_names:
            characters_query = characters_query.where(Character.name.in_(filter_character_names))
        characters_result = await db_session.execute(characters_query)
        project_characters = characters_result.scalars().all()
        
        # 如果筛选后无角色，降级为全部角色
        if not project_characters and filter_character_names:
            logger.warning(f"⚠️ 筛选后无匹配角色，降级为全部角色")
            characters_result = await db_session.execute(
                select(Character).where(Character.project_id == project_id)
            )
            project_characters = characters_result.scalars().all()
            filter_character_names = None
        
        characters_info = await build_characters_info_with_careers(
            db=db_session,
            project_id=project_id,
            characters=project_characters,
            filter_character_names=filter_character_names
        )
        logger.info(f"📋 后台分析 - 已获取{len(project_characters)}个角色信息用于分析")
        analysis_monitor.emit(
            task_id,
            "info",
            f"已加载 {len(project_characters)} 个角色信息",
            24,
        )
        
        # 定义重试回调函数，用于在重试时更新任务状态
        async def on_retry_callback(attempt: int, max_retries: int, wait_time: int, error_reason: str):
            """重试时更新任务状态，让前端能感知到重试进度"""
            analysis_monitor.emit(
                task_id,
                "warn",
                f"第 {attempt}/{max_retries} 次尝试失败（{error_reason[:120]}），{wait_time}s 后压缩输出重试",
                25,
            )
            try:
                async with write_lock:
                    # 重新获取任务（确保获取最新状态）
                    task_result_retry = await db_session.execute(
                        select(AnalysisTask).where(AnalysisTask.id == task_id)
                    )
                    task_retry = task_result_retry.scalar_one_or_none()
                    if task_retry:
                        # 更新任务状态，保持 running 但更新 started_at 以重置超时计时器
                        task_retry.status = 'running'
                        task_retry.started_at = datetime.now()  # 重置开始时间，防止超时检测误判
                        task_retry.progress = 25 + attempt * 5  # 根据重试次数更新进度
                        task_retry.error_message = f"正在重试({attempt}/{max_retries})：{error_reason[:100]}"
                        await db_session.commit()
                        logger.info(f"🔄 分析任务重试状态已更新: 尝试 {attempt}/{max_retries}, 等待 {wait_time}s, 原因: {error_reason[:50]}...")
                await report_progress(25 + attempt * 5)
            except Exception as callback_error:
                logger.warning(f"⚠️ 更新重试状态失败: {callback_error}")
        
        # 3. 使用PlotAnalyzer分析章节（传入已有伏笔列表、角色信息和重试回调）
        analyzer = PlotAnalyzer(ai_service)
        analysis_result = await analyzer.analyze_chapter(
            chapter_number=chapter.chapter_number,
            title=chapter.title,
            content=chapter.content,
            word_count=chapter.word_count or len(chapter.content),
            existing_foreshadows=existing_foreshadows,
            on_retry=on_retry_callback,
            characters_info=characters_info,
            on_event=lambda level, msg, progress=None: _monitor_event(
                task_id, level, msg, progress
            ),
        )
        
        if not analysis_result:
            failure_reason = getattr(analyzer, "last_error", None) or "AI 未返回有效分析结果"
            # 服务商审核拦截等明确原因不再叠加「AI分析失败」前缀，避免掩盖真实原因。
            is_explicit_reason = failure_reason.startswith(("模型服务商拒绝", "AI响应为空"))
            task_error = (
                failure_reason
                if is_explicit_reason
                else f"AI分析失败：{failure_reason}"
            )
            async with write_lock:
                task.status = 'failed'
                task.error_message = task_error[:500]
                task.completed_at = datetime.now()
                await db_session.commit()
            logger.error(f"❌ AI分析失败: {chapter_id}, 原因: {failure_reason}")
            analysis_monitor.emit(task_id, "error", task_error, None)
            analysis_monitor.finish(task_id, "failed")
            return False

        analysis_monitor.emit(task_id, "info", "分析结果已生成，开始写入数据库", 65)
        
        async with write_lock:
            task.progress = 60
            await db_session.commit()
        await report_progress(60)
        
        # 4. 保存分析结果到数据库（写操作，需要锁）
        async with write_lock:
            existing_analysis_result = await db_session.execute(
                select(PlotAnalysis).where(PlotAnalysis.chapter_id == chapter_id)
            )
            existing_analysis = existing_analysis_result.scalar_one_or_none()
            
            if existing_analysis:
                # 更新现有记录
                logger.info(f"  更新现有分析记录: {existing_analysis.id}")
                existing_analysis.plot_stage = analysis_result.get('plot_stage', '发展')
                existing_analysis.conflict_level = analysis_result.get('conflict', {}).get('level', 0)
                existing_analysis.conflict_types = analysis_result.get('conflict', {}).get('types', [])
                existing_analysis.emotional_tone = analysis_result.get('emotional_arc', {}).get('primary_emotion', '')
                existing_analysis.emotional_intensity = analysis_result.get('emotional_arc', {}).get('intensity', 0) / 10.0
                existing_analysis.hooks = analysis_result.get('hooks', [])
                existing_analysis.hooks_count = len(analysis_result.get('hooks', []))
                existing_analysis.foreshadows = analysis_result.get('foreshadows', [])
                existing_analysis.foreshadows_planted = sum(1 for f in analysis_result.get('foreshadows', []) if f.get('type') == 'planted')
                existing_analysis.foreshadows_resolved = sum(1 for f in analysis_result.get('foreshadows', []) if f.get('type') == 'resolved')
                existing_analysis.plot_points = analysis_result.get('plot_points', [])
                existing_analysis.plot_points_count = len(analysis_result.get('plot_points', []))
                existing_analysis.character_states = analysis_result.get('character_states', [])
                existing_analysis.scenes = analysis_result.get('scenes', [])
                existing_analysis.pacing = analysis_result.get('pacing', 'moderate')
                existing_analysis.overall_quality_score = analysis_result.get('scores', {}).get('overall', 0)
                existing_analysis.pacing_score = analysis_result.get('scores', {}).get('pacing', 0)
                existing_analysis.engagement_score = analysis_result.get('scores', {}).get('engagement', 0)
                existing_analysis.coherence_score = analysis_result.get('scores', {}).get('coherence', 0)
                existing_analysis.analysis_report = analyzer.generate_analysis_summary(analysis_result)
                existing_analysis.suggestions = analysis_result.get('suggestions', [])
                existing_analysis.dialogue_ratio = analysis_result.get('dialogue_ratio', 0)
                existing_analysis.description_ratio = analysis_result.get('description_ratio', 0)
            else:
                # 创建新记录
                logger.info(f"  创建新的分析记录")
                plot_analysis = PlotAnalysis(
                    chapter_id=chapter_id,
                    project_id=project_id,
                    plot_stage=analysis_result.get('plot_stage', '发展'),
                    conflict_level=analysis_result.get('conflict', {}).get('level', 0),
                    conflict_types=analysis_result.get('conflict', {}).get('types', []),
                    emotional_tone=analysis_result.get('emotional_arc', {}).get('primary_emotion', ''),
                    emotional_intensity=analysis_result.get('emotional_arc', {}).get('intensity', 0) / 10.0,
                    hooks=analysis_result.get('hooks', []),
                    hooks_count=len(analysis_result.get('hooks', [])),
                    foreshadows=analysis_result.get('foreshadows', []),
                    foreshadows_planted=sum(1 for f in analysis_result.get('foreshadows', []) if f.get('type') == 'planted'),
                    foreshadows_resolved=sum(1 for f in analysis_result.get('foreshadows', []) if f.get('type') == 'resolved'),
                    plot_points=analysis_result.get('plot_points', []),
                    plot_points_count=len(analysis_result.get('plot_points', [])),
                    character_states=analysis_result.get('character_states', []),
                    scenes=analysis_result.get('scenes', []),
                    pacing=analysis_result.get('pacing', 'moderate'),
                    overall_quality_score=analysis_result.get('scores', {}).get('overall', 0),
                    pacing_score=analysis_result.get('scores', {}).get('pacing', 0),
                    engagement_score=analysis_result.get('scores', {}).get('engagement', 0),
                    coherence_score=analysis_result.get('scores', {}).get('coherence', 0),
                    analysis_report=analyzer.generate_analysis_summary(analysis_result),
                    suggestions=analysis_result.get('suggestions', []),
                    dialogue_ratio=analysis_result.get('dialogue_ratio', 0),
                    description_ratio=analysis_result.get('description_ratio', 0)
                )
                db_session.add(plot_analysis)
            
            await db_session.commit()
            
            task.progress = 80
            await db_session.commit()
        await report_progress(80)
        
        # 5. 清理旧的分析伏笔（重新分析时需要先清理）
        try:
            async with write_lock:
                clean_result = await foreshadow_service.clean_chapter_analysis_foreshadows(
                    db=db_session,
                    project_id=project_id,
                    chapter_id=chapter_id
                )
            if clean_result['cleaned_count'] > 0:
                logger.info(f"🧹 重新分析前清理了 {clean_result['cleaned_count']} 个旧伏笔")
        except Exception as clean_error:
            logger.warning(f"⚠️ 清理旧伏笔失败（继续分析）: {str(clean_error)}")
        
        # 6. 提取记忆并保存到向量数据库（传入章节内容用于计算位置）
        memories = analyzer.extract_memories_from_analysis(
            analysis=analysis_result,
            chapter_id=chapter_id,
            chapter_number=chapter.chapter_number,
            chapter_content=chapter.content or "",
            chapter_title=chapter.title or ""
        )
        
        # 先删除该章节的旧记忆（写操作，需要锁）
        async with write_lock:
            old_memories_result = await db_session.execute(
                select(StoryMemory).where(StoryMemory.chapter_id == chapter_id)
            )
            old_memories = old_memories_result.scalars().all()
            for old_mem in old_memories:
                await db_session.delete(old_mem)
            await db_session.commit()
            logger.info(f"  删除旧记忆: {len(old_memories)}条")
        
        # 准备批量添加的记忆数据（不需要锁）
        memory_records = []
        for mem in memories:
            memory_id = f"{chapter_id}_{mem['type']}_{len(memory_records)}"
            memory_records.append({
                'id': memory_id,
                'content': mem['content'],
                'type': mem['type'],
                'metadata': mem['metadata']
            })
            
        # 保存到关系数据库（写操作，需要锁）
        async with write_lock:
            for index, mem in enumerate(memories):
                memory_id = memory_records[index]['id']
                text_position = mem['metadata'].get('text_position', -1)
                text_length = mem['metadata'].get('text_length', 0)
                
                story_memory = StoryMemory(
                    id=memory_id,
                    project_id=project_id,
                    chapter_id=chapter_id,
                    memory_type=mem['type'],
                    content=mem['content'],
                    title=mem['title'],
                    importance_score=mem['metadata'].get('importance_score', 0.5),
                    tags=mem['metadata'].get('tags', []),
                    is_foreshadow=mem['metadata'].get('is_foreshadow', 0),
                    story_timeline=chapter.chapter_number,
                    chapter_position=text_position,
                    text_length=text_length,
                    related_characters=mem['metadata'].get('related_characters', []),
                    related_locations=mem['metadata'].get('related_locations', [])
                )
                db_session.add(story_memory)
                
                if text_position >= 0:
                    logger.debug(f"  保存记忆 {memory_id}: position={text_position}, length={text_length}")
            
            await db_session.commit()
        
        # 批量添加到向量数据库
        if memory_records:
            added_count = await memory_service.batch_add_memories(
                user_id=user_id,
                project_id=project_id,
                memories=memory_records
            )
            logger.info(f"✅ 添加{added_count}条记忆到向量库")
        
        # 💼 更新角色职业（根据分析结果）
        if analysis_result.get('character_states'):
            try:
                from app.services.career_update_service import CareerUpdateService
                
                logger.info(f"💼 开始根据分析结果更新角色职业...")
                career_update_result = await CareerUpdateService.update_careers_from_analysis(
                    db=db_session,
                    project_id=project_id,
                    character_states=analysis_result.get('character_states', []),
                    chapter_id=chapter_id,
                    chapter_number=chapter.chapter_number
                )
                
                if career_update_result['updated_count'] > 0:
                    logger.info(
                        f"✅ 更新了 {career_update_result['updated_count']} 个角色的职业信息"
                    )
                    if career_update_result['changes']:
                        for change in career_update_result['changes']:
                            logger.info(f"  - {change}")
                else:
                    logger.info("ℹ️ 本章节无角色职业变化")
                    
            except Exception as career_error:
                # 职业更新失败不应影响整个分析流程
                logger.error(f"⚠️ 更新角色职业失败: {str(career_error)}", exc_info=True)
        else:
            logger.debug("📋 分析结果中无角色状态信息，跳过职业更新")
        
        # 👤 更新角色心理状态和关系（根据分析结果）
        if analysis_result.get('character_states'):
            try:
                from app.services.character_state_update_service import CharacterStateUpdateService
                
                logger.info(f"👤 开始根据分析结果更新角色状态、关系和组织成员...")
                async with write_lock:
                    state_update_result = await CharacterStateUpdateService.update_from_analysis(
                        db=db_session,
                        project_id=project_id,
                        character_states=analysis_result.get('character_states', []),
                        chapter_id=chapter_id,
                        chapter_number=chapter.chapter_number
                    )
                
                total_state_changes = (
                    state_update_result['state_updated_count'] +
                    state_update_result['relationship_created_count'] +
                    state_update_result['relationship_updated_count'] +
                    state_update_result.get('org_updated_count', 0)
                )
                if total_state_changes > 0:
                    logger.info(
                        f"✅ 角色状态更新: 心理状态{state_update_result['state_updated_count']}个, "
                        f"新建关系{state_update_result['relationship_created_count']}个, "
                        f"更新关系{state_update_result['relationship_updated_count']}个, "
                        f"组织变动{state_update_result.get('org_updated_count', 0)}个"
                    )
                    if state_update_result['changes']:
                        for change in state_update_result['changes'][:8]:
                            logger.info(f"  - {change}")
                else:
                    logger.info("ℹ️ 本章节无角色状态、关系或组织变化")
                    
            except Exception as state_error:
                # 角色状态更新失败不应影响整个分析流程
                logger.error(f"⚠️ 更新角色状态、关系和组织失败: {str(state_error)}", exc_info=True)
        
        # 🏛️ 更新组织自身状态（根据分析结果）
        if analysis_result.get('organization_states'):
            try:
                from app.services.character_state_update_service import CharacterStateUpdateService
                
                logger.info(f"🏛️ 开始根据分析结果更新组织自身状态...")
                async with write_lock:
                    org_state_result = await CharacterStateUpdateService.update_organization_states(
                        db=db_session,
                        project_id=project_id,
                        organization_states=analysis_result.get('organization_states', []),
                        chapter_number=chapter.chapter_number
                    )
                
                if org_state_result['updated_count'] > 0:
                    logger.info(
                        f"✅ 组织状态更新: {org_state_result['updated_count']}个组织"
                    )
                    if org_state_result['changes']:
                        for change in org_state_result['changes'][:5]:
                            logger.info(f"  - {change}")
                else:
                    logger.info("ℹ️ 本章节无组织自身状态变化")
                    
            except Exception as org_state_error:
                # 组织状态更新失败不应影响整个分析流程
                logger.error(f"⚠️ 更新组织自身状态失败: {str(org_state_error)}", exc_info=True)
        
        # 🔮 自动更新伏笔状态（根据分析结果）
        if analysis_result.get('foreshadows'):
            try:
                logger.info(f"🔮 开始根据分析结果自动更新伏笔状态...")
                async with write_lock:
                    foreshadow_stats = await foreshadow_service.auto_update_from_analysis(
                        db=db_session,
                        project_id=project_id,
                        chapter_id=chapter_id,
                        chapter_number=chapter.chapter_number,
                        analysis_foreshadows=analysis_result.get('foreshadows', [])
                    )
                
                if foreshadow_stats['planted_count'] > 0 or foreshadow_stats['resolved_count'] > 0:
                    logger.info(
                        f"✅ 伏笔自动更新: 埋入{foreshadow_stats['planted_count']}个, "
                        f"回收{foreshadow_stats['resolved_count']}个"
                    )
                else:
                    logger.info("ℹ️ 本章节无新的伏笔状态变化")
                    
            except Exception as foreshadow_error:
                # 伏笔更新失败不应影响整个分析流程
                logger.error(f"⚠️ 自动更新伏笔失败: {str(foreshadow_error)}", exc_info=True)
        else:
            logger.debug("📋 分析结果中无伏笔信息，跳过伏笔自动更新")

        # 7. 确定性质量门禁 + 权威追踪事务。正文只有在这里提交成功后才算完成。
        outline_result = await db_session.execute(
            select(Outline).where(
                Outline.project_id == project_id,
                Outline.order_index == chapter.chapter_number,
            ).limit(1)
        )
        outline = (
            await db_session.execute(
                select(Outline).where(Outline.id == chapter.outline_id)
            )
        ).scalar_one_or_none() if chapter.outline_id else outline_result.scalar_one_or_none()
        quality_report = await evaluate_chapter_quality(
            chapter,
            outline=outline,
            target_word_count=None,
        )
        analysis_monitor.emit(
            task_id,
            "info" if quality_report.status.value == "ready" else "warn",
            f"质量门禁：{quality_report.status.value}",
            88,
        )
        async with write_lock:
            _, transaction_row = await stage_and_commit_analysis(
                db_session,
                chapter,
                analysis_result,
                quality_report,
            )
        if quality_report.status.value == "ready" and (
            not transaction_row or transaction_row.status != "committed"
        ):
            raise ValueError("章节质量已通过，但追踪事务未提交")
        
        update_success = await _set_analysis_task_terminal_state(
            user_id, task_id, "completed"
        )
        if update_success:
            await report_progress(100)
            logger.info(
                "✅ 章节分析完成: %s, 提取%s条记忆, quality=%s, tracking=%s",
                chapter_id,
                len(memories),
                quality_report.status.value,
                chapter.tracking_status,
            )
            analysis_monitor.emit(
                task_id,
                "info",
                f"分析完成：质量状态 {quality_report.status.value}，追踪状态 {chapter.tracking_status}",
                100,
            )
            analysis_monitor.finish(task_id, "completed")
        else:
            logger.error(f"❌ 章节分析完成但无法更新任务终态: {chapter_id}")
            analysis_monitor.finish(task_id, "completed")
        return update_success
        
    except Exception as e:
        logger.error(f"❌ 后台分析异常: {str(e)}", exc_info=True)
        analysis_monitor.emit(task_id, "error", f"分析异常：{str(e)[:200]}", None)
        analysis_monitor.finish(task_id, "failed")
        if db_session:
            try:
                await db_session.rollback()
            except Exception as rollback_error:
                logger.warning(f"回滚分析事务失败: {rollback_error}")
        await _set_analysis_task_terminal_state(
            user_id, task_id, "failed", str(e)[:500]
        )
        return False
        
    finally:
        if db_session:
            await db_session.close()


@router.post("/{chapter_id}/generate-stream", summary="AI创作章节内容（流式）")
async def generate_chapter_content_stream(
    chapter_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    generate_request: ChapterGenerateRequest = ChapterGenerateRequest(),
    user_ai_service: AIService = Depends(get_user_ai_service)
):
    """
    根据大纲、前置章节内容和项目信息AI创作章节完整内容（流式返回）
    要求：必须按顺序生成，确保前置章节都已完成
    
    请求体参数：
    - style_id: 可选，指定使用的写作风格ID。不提供则不使用任何风格
    - target_word_count: 可选，目标字数，默认3000字，范围500-10000字
    - enable_mcp: 可选，是否启用MCP工具增强，默认True
    
    注意：此函数不使用依赖注入的db，而是在生成器内部创建独立的数据库会话
    以避免流式响应期间的连接泄漏问题
    """
    style_id = generate_request.style_id
    target_word_count = generate_request.target_word_count or 3000
    custom_model = generate_request.model if hasattr(generate_request, 'model') else None
    temp_narrative_perspective = generate_request.narrative_perspective if hasattr(generate_request, 'narrative_perspective') else None
    skill_key = generate_request.skill_key if hasattr(generate_request, 'skill_key') else None
    auto_polish = bool(getattr(generate_request, 'auto_polish', False))
    current_user_id = getattr(request.state, "user_id", "system")
    temp_db = await _create_db_session(current_user_id)
    try:
        result = await temp_db.execute(
            select(Chapter).where(Chapter.id == chapter_id)
        )
        chapter = result.scalar_one_or_none()
        if not chapter:
            raise HTTPException(status_code=404, detail="章节不存在")

        can_generate, error_msg, previous_chapters = await check_prerequisites(temp_db, chapter)
        if not can_generate:
            raise HTTPException(status_code=400, detail=error_msg)
        analysis_ready, analysis_msg = await check_previous_analysis_ready(temp_db, chapter)
        if not analysis_ready:
            raise HTTPException(status_code=409, detail=analysis_msg)

        previous_chapters_data = [
            {
                'id': ch.id,
                'chapter_number': ch.chapter_number,
                'title': ch.title,
                'content': ch.content
            }
            for ch in previous_chapters
        ]

        if not await _claim_chapter_generation(
            chapter_id, chapter.project_id, current_user_id, temp_db
        ):
            raise HTTPException(
                status_code=409,
                detail="该章节已有生成任务正在运行，请等待任务完成或先在后台任务面板取消该任务",
            )
    finally:
        await temp_db.close()
    
    async def event_generator():
        db_session = None
        db_committed = False
        session_cm = None
        generation_lease_owner: Optional[str] = None
        
        # 初始化标准进度追踪器
        from app.utils.sse_response import WizardProgressTracker
        tracker = WizardProgressTracker("章节")
        
        try:
            yield await tracker.start()

            session_cm = get_db(request)
            db_session = await anext(session_cm)
            generation_lease_owner = f"chapter-stream:{chapter_id}:{current_user_id}"
            lease_acquired, lease_error = await acquire_generation_lease(
                db_session,
                chapter.project_id,
                generation_lease_owner,
            )
            if not lease_acquired:
                yield await tracker.error(lease_error, 409)
                return
            while True:
                # === 加载阶段 ===
                yield await tracker.loading("加载章节信息...", 0.2)
                
                # 重新获取章节信息
                chapter_result = await db_session.execute(
                    select(Chapter).where(Chapter.id == chapter_id)
                )
                current_chapter = chapter_result.scalar_one_or_none()
                if not current_chapter:
                    yield await tracker.error("章节不存在", 404)
                    return
            
                yield await tracker.loading("加载项目信息...", 0.4)
                
                # 获取项目信息
                project_result = await db_session.execute(
                    select(Project).where(Project.id == current_chapter.project_id)
                )
                project = project_result.scalar_one_or_none()
                if not project:
                    yield await tracker.error("项目不存在", 404)
                    return
                
                # 获取项目的大纲模式
                outline_mode = project.outline_mode if project else 'one-to-many'
                logger.info(f"📋 项目大纲模式: {outline_mode}")
                
                # 获取对应的大纲（优先使用 chapter.outline_id 直接关联）
                if current_chapter.outline_id:
                    outline_result = await db_session.execute(
                        select(Outline)
                        .where(Outline.id == current_chapter.outline_id)
                        .execution_options(populate_existing=True)
                    )
                else:
                    # 回退到按序号查找
                    outline_result = await db_session.execute(
                        select(Outline)
                        .where(Outline.project_id == current_chapter.project_id)
                        .where(Outline.order_index == current_chapter.chapter_number)
                        .execution_options(populate_existing=True)
                    )
                outline = outline_result.scalar_one_or_none()
                
                yield await tracker.stage(
                    "context",
                    "正在加载连续性追踪状态与本章细纲",
                    12,
                )
                creation_input = await ChapterCreationService(db_session).prepare(
                    chapter=current_chapter,
                    project=project,
                    outline=outline,
                    user_id=current_user_id,
                    style_id=style_id,
                    target_word_count=target_word_count,
                    narrative_perspective=temp_narrative_perspective,
                    skill_key=skill_key,
                )
                chapter_context = creation_input.context
                style_content = creation_input.style_content
                prompt = creation_input.prompt
                system_prompt_with_style = creation_input.system_prompt
                logger.info(
                    "📊 创作输入已组装: chapter=%s input_chars=%s budget=%s trims=%s",
                    current_chapter.chapter_number,
                    creation_input.input_chars,
                    35000,
                    creation_input.trims,
                )

                # 🔢 计算 max_tokens 限制
                # 中文字符约 1.5-2 个 token，使用 2.5 倍系数确保有足够空间完成段落
                # 同时设置上限防止过长，下限确保基本可用
                calculated_max_tokens = int(target_word_count * 3)
                calculated_max_tokens = max(2000, min(calculated_max_tokens + 4096, 20000))
                logger.info(f"📊 目标字数: {target_word_count}, 计算 max_tokens: {calculated_max_tokens}")
                
                # 准备生成参数
                generate_kwargs = {
                    "prompt": prompt,
                    "system_prompt": system_prompt_with_style,
                    "tool_choice": "auto",
                    "max_tokens": calculated_max_tokens,
                    "auto_mcp": False,
                }
                if custom_model:
                    logger.info(f"  使用自定义模型: {custom_model}")
                    generate_kwargs["model"] = custom_model
                    # 注意：这里使用用户配置的AI服务，模型参数会覆盖默认模型
                    # 如果需要切换provider，需要在前端传递provider参数
                
                # === 生成阶段 ===
                full_content = ""
                chunk_count = 0
                length_guard = ChapterLengthGuard(target_word_count)
                
                yield await tracker.stage("writing", "上下文已就绪，开始生成正文", 20)
                yield await tracker.generating(
                    current_chars=0,
                    estimated_total=target_word_count
                )
                
                source = user_ai_service.generate_text_stream(**generate_kwargs)
                async for chunk in iter_guarded_chunks(source, length_guard):
                    full_content += chunk
                    chunk_count += 1
                    
                    # 发送内容块
                    yield await tracker.generating_chunk(chunk)
                    
                    # 每5个chunk发送一次进度更新
                    if chunk_count % 5 == 0:
                        yield await tracker.generating(
                            current_chars=visible_char_count(full_content),
                            estimated_total=target_word_count,
                            message=f'正在创作中... 已生成 {visible_char_count(full_content)} 字'
                        )
                    
                    # 每20个chunk发送心跳
                    if chunk_count % 20 == 0:
                        yield await tracker.heartbeat()
                    
                    await asyncio.sleep(0)  # 让出控制权

                length_result = length_guard.finish()
                full_content = length_result.content
                logger.info(
                    "章节流式长度保护: chapter=%s target=%s observed=%s output=%s "
                    "truncated=%s cutoff=%s",
                    current_chapter.chapter_number,
                    target_word_count,
                    length_result.observed_chars,
                    length_result.content_chars,
                    length_result.truncated,
                    length_result.cutoff_kind or "none",
                )
                if length_result.truncated:
                    yield await tracker.stage(
                        "writing",
                        (
                            f"已达到目标字数安全上限，正文按完整段落收尾，"
                            f"共 {length_result.content_chars} 字"
                        ),
                        84,
                    )

                generation_error = _chapter_generation_error(
                    full_content, target_word_count
                )
                if generation_error:
                    raise RuntimeError(generation_error)

                # === 生成后自动去味（可选）===
                polish_result = None
                if auto_polish:
                    yield await tracker.saving("正在自动去味（一轮改写 + 标点整理）...", 0.1)
                    full_content, polish_result = await polish_chapter_after_generation(
                        db=db_session,
                        chapter=current_chapter,
                        project=project,
                        generated_content=full_content,
                        ai_service=user_ai_service,
                        model=custom_model,
                        user_id=current_user_id,
                    )
                    yield await SSEResponse.send_event(
                        event='auto_polish',
                        data={
                            'applied': 'skipped' not in polish_result,
                            'skipped': polish_result.get('skipped'),
                            'score_before': polish_result.get('score_before', -1),
                            'score_after': polish_result.get('score_after', -1),
                            'blocking_before': polish_result.get('blocking_before', 0),
                            'blocking_after': polish_result.get('blocking_after', 0),
                            'punctuation_fixed': polish_result.get('punctuation_fixed', 0),
                            'word_count': len(full_content),
                        },
                    )

                # === 确定性检查、自动修复与保存 ===
                yield await tracker.stage("checking", "正在执行章节质量门禁...", 88)
                stage_events: list[tuple[str, str]] = []

                async def _quality_progress(stage: str, message: str) -> None:
                    stage_events.append((stage, message))

                generated = await ChapterCreationService(db_session).finalize_generated(
                    chapter=current_chapter,
                    project=project,
                    outline=outline,
                    prepared=creation_input,
                    content=full_content,
                    ai_service=user_ai_service,
                    model=custom_model,
                    progress=_quality_progress,
                )
                for stage, message in stage_events:
                    yield await tracker.stage(
                        stage,
                        message,
                        90 if stage == "repairing" else 92,
                    )
                full_content = generated.content
                yield await tracker.saving("正在保存章节...", 0.3)
                new_word_count = await ChapterCreationService(db_session).save_generated(
                    chapter=current_chapter,
                    project=project,
                    result=generated,
                    label=f"创作章节: 第{current_chapter.chapter_number}章 {current_chapter.title}",
                )
                db_committed = True
                await db_session.refresh(current_chapter)
                
                logger.info(
                    "成功创作章节 %s，共 %s 字，质量=%s，修复=%s，压缩=%s，扩写=%s",
                    chapter_id,
                    new_word_count,
                    generated.quality_report.status.value,
                    generated.repaired,
                    generated.compressed,
                    generated.expanded,
                )
                
                # 🔮 章节生成后自动标记计划在本章埋入的伏笔
                try:
                    plant_result = await foreshadow_service.auto_plant_pending_foreshadows(
                        db=db_session,
                        project_id=project.id,
                        chapter_id=chapter_id,
                        chapter_number=current_chapter.chapter_number,
                        chapter_content=full_content
                    )
                    if plant_result.get('planted_count', 0) > 0:
                        logger.info(f"🔮 自动标记伏笔已埋入: {plant_result['planted_count']}个")
                except Exception as plant_error:
                    logger.warning(f"⚠️ 自动标记伏笔埋入失败: {str(plant_error)}")
                
                # 创建分析任务
                analysis_task = AnalysisTask(
                    chapter_id=chapter_id,
                    user_id=current_user_id,
                    project_id=project.id,
                    status='pending',
                    progress=0
                )
                db_session.add(analysis_task)
                await db_session.commit()
                await db_session.refresh(analysis_task)
                
                task_id = analysis_task.id
                logger.info(f"📋 已创建分析任务: {task_id}")
                
                # 短暂延迟确保SQLite WAL完成写入
                await asyncio.sleep(0.05)
                
                # 直接启动后台分析（并发执行）
                background_tasks.add_task(
                    analyze_chapter_background,
                    chapter_id=chapter_id,
                    user_id=current_user_id,
                    project_id=project.id,
                    task_id=task_id,
                )
                
                yield await tracker.saving("章节保存完成", 0.8)
                yield await tracker.stage(
                    "tracking",
                    "正文已保存，正在分析章节并提交连续性追踪",
                    96,
                )
                
                # === 完成阶段 ===
                yield await tracker.complete("正文已保存，质量检查与追踪提交进行中")
                
                # 发送结果数据
                yield await tracker.result({
                    'word_count': new_word_count,
                    'analysis_task_id': task_id
                })
                
                # 发送分析开始事件（使用自定义事件）
                yield await SSEResponse.send_event(
                    event='analysis_started',
                    data={
                        'task_id': task_id,
                        'message': '章节分析已开始'
                    }
                )
                
                # 发送完成信号
                yield await tracker.done()
                
                break  # 退出async for db_session循环
        
        except GeneratorExit:
            logger.warning("章节生成器被提前关闭（SSE断开）")
        except Exception as e:
            logger.error(f"流式创作章节失败: {str(e)}")
            yield await tracker.error(str(e))
        finally:
            if generation_lease_owner and db_session:
                try:
                    await release_generation_lease(
                        db_session,
                        chapter.project_id,
                        generation_lease_owner,
                    )
                except Exception as lease_close_error:
                    logger.error(f"释放项目生成租约失败: {lease_close_error}")
            if session_cm is not None:
                try:
                    await session_cm.aclose()
                except Exception as close_error:
                    logger.error(f"关闭数据库会话失败: {str(close_error)}")
            _release_chapter_generation(chapter_id)
    
    return create_sse_response(event_generator())


@router.post("/{chapter_id}/generate-background", summary="AI创作章节内容（后台任务）")
async def generate_chapter_content_background(
    chapter_id: str,
    request: Request,
    generate_request: ChapterGenerateRequest = ChapterGenerateRequest(),
    db: AsyncSession = Depends(get_db)
):
    """
    创建后台任务来生成章节内容。
    任务创建后立即返回task_id，前端通过 GET /api/tasks/{task_id} 轮询进度。
    关闭浏览器不影响生成，生成完成后内容自动保存到数据库。
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    # 验证章节存在
    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    # 验证项目权限
    project = await verify_project_access(chapter.project_id, user_id, db)

    # 检查前置条件
    can_generate, error_msg, _ = await check_prerequisites(db, chapter)
    if not can_generate:
        raise HTTPException(status_code=400, detail=error_msg)
    analysis_ready, analysis_msg = await check_previous_analysis_ready(db, chapter)
    if not analysis_ready:
        raise HTTPException(status_code=409, detail=analysis_msg)

    if not await _claim_chapter_generation(
        chapter_id, chapter.project_id, user_id, db
    ):
        raise HTTPException(
            status_code=409,
            detail="该章节已有生成任务正在运行，请等待任务完成或先在后台任务面板取消该任务",
        )

    # 创建后台任务
    from app.services.background_task_service import background_task_service, TaskProgressTracker
    try:
        task = await background_task_service.create_task(
            user_id=user_id,
            project_id=chapter.project_id,
            task_type="chapter_generate",
            task_input={
                "chapter_id": chapter_id,
                "style_id": generate_request.style_id,
                "target_word_count": generate_request.target_word_count or 3000,
                "enable_mcp": generate_request.enable_mcp,
                "model": generate_request.model,
                "narrative_perspective": generate_request.narrative_perspective,
                "skill_key": generate_request.skill_key,
                "auto_polish": generate_request.auto_polish,
            },
            db=db
        )
    except Exception:
        _release_chapter_generation(chapter_id)
        raise

    _bind_chapter_generation_task(chapter_id, task.id)

    # 后台执行的函数
    async def _run_chapter_generation(task_id: str, bg_user_id: str):
        from app.database import get_engine
        from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession as BgAsyncSession

        engine = await get_engine(bg_user_id)
        AsyncSessionLocal = async_sessionmaker(engine, class_=BgAsyncSession, expire_on_commit=False)

        try:
            async with AsyncSessionLocal() as bg_db:
                tracker = TaskProgressTracker(task_id, bg_user_id, "章节")
                try:
                    await tracker.start()

                    # 获取AI服务
                    from app.api.settings import get_user_ai_service_from_db
                    bg_ai_service = await get_user_ai_service_from_db(bg_user_id, bg_db)
                    lease_owner = f"chapter-bg:{task_id}:{chapter_id}"
                    lease_acquired, lease_error = await acquire_generation_lease(
                        bg_db, chapter.project_id, lease_owner
                    )
                    if not lease_acquired:
                        await tracker.error(lease_error)
                        return
                    try:
                        await _run_chapter_generation_bg(
                            task_input={
                                "chapter_id": chapter_id,
                                "style_id": generate_request.style_id,
                                "target_word_count": generate_request.target_word_count or 3000,
                                "enable_mcp": generate_request.enable_mcp,
                                "model": generate_request.model,
                                "narrative_perspective": generate_request.narrative_perspective,
                                "skill_key": generate_request.skill_key,
                                "auto_polish": generate_request.auto_polish,
                            },
                            db=bg_db,
                            ai_service=bg_ai_service,
                            tracker=tracker,
                            user_id=bg_user_id,
                            task_id=task_id,
                        )
                    finally:
                        await release_generation_lease(
                            bg_db, chapter.project_id, lease_owner
                        )

                except Exception as e:
                    logger.error(f"❌ 后台章节生成失败: {e}", exc_info=True)
                    await tracker.error(str(e))
        finally:
            _release_chapter_generation(chapter_id)

    try:
        await background_task_service.spawn_background_task(
            task.id, user_id, _run_chapter_generation
        )
    except Exception:
        _release_chapter_generation(chapter_id)
        raise

    return {
        "task_id": task.id,
        "task_type": "chapter_generate",
        "status": "pending",
        "message": "任务已创建，请通过 GET /api/tasks/{task_id} 查询进度"
    }


def _build_analysis_task_status_payload(
    chapter_id: str,
    task: Optional[AnalysisTask],
    auto_recovered: bool = False
) -> dict:
    """统一构建分析任务状态响应"""
    if not task:
        return {
            "has_task": False,
            "chapter_id": chapter_id,
            "status": "none",
            "progress": 0,
            "error_message": None,
            "auto_recovered": False,
            "task_origin": "chapter_analysis",
            "task_id": None,
            "created_at": None,
            "started_at": None,
            "completed_at": None
        }

    return {
        "has_task": True,
        "task_id": task.id,
        "chapter_id": task.chapter_id,
        "status": task.status,
        "progress": task.progress,
        "error_message": task.error_message,
        "auto_recovered": auto_recovered,
        "task_origin": (
            "tracking_resync"
            if task.background_task_id
            else "chapter_analysis"
        ),
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None
    }


async def _recover_stale_analysis_tasks(
    db: AsyncSession,
    tasks: list[AnalysisTask],
) -> set[str]:
    """将失去执行协程的陈旧任务原子地恢复为失败状态。"""
    now = datetime.now()
    recovered_ids: set[str] = set()

    for task in tasks:
        error_message: Optional[str] = None
        if task.status == "running":
            reference_time = task.started_at or task.created_at
            if reference_time and (now - reference_time) > timedelta(seconds=ANALYSIS_TASK_STALE_SECONDS):
                error_message = "任务执行超时，已自动恢复"
        if not error_message:
            continue

        result = await db.execute(
            update(AnalysisTask)
            .where(
                AnalysisTask.id == task.id,
                AnalysisTask.status == task.status,
            )
            .values(
                status="failed",
                error_message=error_message,
                completed_at=now,
                progress=0,
            )
            .execution_options(synchronize_session="fetch")
        )
        if result.rowcount:
            recovered_ids.add(task.id)

    if recovered_ids:
        await db.commit()
        for task in tasks:
            if task.id in recovered_ids:
                await db.refresh(task)
        logger.warning(f"自动恢复陈旧章节分析任务: {len(recovered_ids)} 个")

    return recovered_ids


@router.post("/{chapter_id}/generate-background-legacy", summary="AI创作章节内容（后台任务兼容别名）")
async def generate_chapter_content_background_legacy(
    chapter_id: str,
    request: Request,
    generate_request: ChapterGenerateRequest = ChapterGenerateRequest(),
    db: AsyncSession = Depends(get_db)
):
    """
    创建后台任务来生成章节内容。
    任务创建后立即返回task_id，前端通过 GET /api/tasks/{task_id} 轮询进度。
    关闭浏览器不影响生成，生成完成后内容自动保存到数据库。
    """
    # 兼容旧地址：执行体已统一到 generate_chapter_content_background。
    return await generate_chapter_content_background(
        chapter_id=chapter_id,
        request=request,
        generate_request=generate_request,
        db=db,
    )


async def _run_chapter_generation_bg(
    task_input: dict,
    db: AsyncSession,
    ai_service: AIService,
    tracker,
    user_id: str,
    task_id: str,
):
    """后台执行章节生成（不使用SSE，直接生成并保存）"""
    from app.services.chapter_context_service import (
        OneToManyContextBuilder,
        OneToOneContextBuilder
    )

    chapter_id = task_input["chapter_id"]
    style_id = task_input.get("style_id")
    target_word_count = task_input.get("target_word_count", 3000)
    custom_model = task_input.get("model")
    temp_narrative_perspective = task_input.get("narrative_perspective")
    enable_mcp = task_input.get("enable_mcp", False)
    skill_key = task_input.get("skill_key")
    auto_polish = bool(task_input.get("auto_polish", False))
    write_lock = await get_db_write_lock(user_id)

    # === 加载阶段 ===
    await tracker.loading("加载章节信息...", 0.2)

    chapter_result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    current_chapter = chapter_result.scalar_one_or_none()
    if not current_chapter:
        await tracker.error("章节不存在")
        return

    await tracker.loading("加载项目信息...", 0.4)

    project_result = await db.execute(
        select(Project).where(Project.id == current_chapter.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        await tracker.error("项目不存在")
        return

    outline_mode = project.outline_mode if project else 'one-to-many'

    # 获取大纲
    if current_chapter.outline_id:
        outline_result = await db.execute(
            select(Outline).where(Outline.id == current_chapter.outline_id)
        )
    else:
        outline_result = await db.execute(
            select(Outline)
            .where(Outline.project_id == current_chapter.project_id)
            .where(Outline.order_index == current_chapter.chapter_number)
        )
    outline = outline_result.scalar_one_or_none()

    await tracker.stage(
        "context",
        "正在加载连续性追踪状态与本章细纲",
        12,
    )
    creation_input = await ChapterCreationService(db).prepare(
        chapter=current_chapter,
        project=project,
        outline=outline,
        user_id=user_id,
        style_id=style_id,
        target_word_count=target_word_count,
        narrative_perspective=temp_narrative_perspective,
        skill_key=skill_key,
    )
    chapter_context = creation_input.context
    style_content = creation_input.style_content
    prompt = creation_input.prompt
    system_prompt_with_style = creation_input.system_prompt
    logger.info(
        "后台创作输入已组装: chapter=%s input_chars=%s trims=%s",
        current_chapter.chapter_number,
        creation_input.input_chars,
        creation_input.trims,
    )

    calculated_max_tokens = int(target_word_count * 3)
    calculated_max_tokens = max(2000, min(calculated_max_tokens + 4096, 20000))

    generate_kwargs = {
        "prompt": prompt,
        "system_prompt": system_prompt_with_style,
        "tool_choice": "auto",
        "max_tokens": calculated_max_tokens,
        "auto_mcp": False,
    }
    if custom_model:
        generate_kwargs["model"] = custom_model

    # === 生成阶段 ===
    full_content = ""
    chunk_count = 0
    length_guard = ChapterLengthGuard(target_word_count)

    await tracker.generating(
        current_chars=0,
        estimated_total=target_word_count
    )

    source = ai_service.generate_text_stream(**generate_kwargs)
    async for chunk in iter_guarded_chunks(source, length_guard):
        # 检查是否被取消
        if chunk_count % 10 == 0 and await tracker.check_cancelled():
            logger.info(f"🚫 后台章节生成被取消: {chapter_id}")
            return

        full_content += chunk
        chunk_count += 1

        # 每10个chunk更新一次进度
        if chunk_count % 10 == 0:
            await tracker.generating(
                current_chars=visible_char_count(full_content),
                estimated_total=target_word_count,
                message=f'正在创作中... 已生成 {visible_char_count(full_content)} 字'
            )

        await asyncio.sleep(0)

    length_result = length_guard.finish()
    full_content = length_result.content
    logger.info(
        "后台章节长度保护: chapter=%s target=%s observed=%s output=%s "
        "truncated=%s cutoff=%s",
        current_chapter.chapter_number,
        target_word_count,
        length_result.observed_chars,
        length_result.content_chars,
        length_result.truncated,
        length_result.cutoff_kind or "none",
    )
    if length_result.truncated:
        await tracker.stage(
            "writing",
            (
                f"已达到目标字数安全上限，正文按完整段落收尾，"
                f"共 {length_result.content_chars} 字"
            ),
            86,
        )

    # === 生成后自动去味（可选）===
    if auto_polish:
        await tracker.saving("正在自动去味（一轮改写 + 标点整理）...", 0.2)
        full_content, polish_result = await polish_chapter_after_generation(
            db=db,
            chapter=current_chapter,
            project=project,
            generated_content=full_content,
            ai_service=ai_service,
            model=custom_model,
            user_id=user_id,
        )
        if 'skipped' in polish_result:
            await tracker.saving(f"自动去味已跳过：{polish_result['skipped']}", 0.3)
        else:
            await tracker.saving(
                "自动去味完成：干净度 "
                f"{polish_result['score_before']}→{polish_result['score_after']}，"
                f"必须改 {polish_result['blocking_before']}→{polish_result['blocking_after']}",
                0.3,
            )

    # === 确定性检查、自动修复与保存 ===
    await tracker.stage("checking", "正在执行章节质量门禁...", 90)

    async def _quality_stage(stage: str, message: str) -> None:
        await tracker.stage(stage, message, 91 if stage == "repairing" else 93)

    generated = await ChapterCreationService(db).finalize_generated(
        chapter=current_chapter,
        project=project,
        outline=outline,
        prepared=creation_input,
        content=full_content,
        ai_service=ai_service,
        model=custom_model,
        progress=_quality_stage,
    )
    full_content = generated.content

    await tracker.saving("正在保存章节...", 0.3)
    async with write_lock:
        chapter_result = await db.execute(
            select(Chapter).where(Chapter.id == chapter_id)
        )
        current_chapter = chapter_result.scalar_one_or_none()
        if not current_chapter:
            await tracker.error("保存时章节不存在")
            return
        project_obj = (
            await db.execute(select(Project).where(Project.id == current_chapter.project_id))
        ).scalar_one_or_none()
        if not project_obj:
            await tracker.error("保存时项目不存在")
            return
        new_word_count = await ChapterCreationService(db).save_generated(
            chapter=current_chapter,
            project=project_obj,
            result=generated,
            label=f"创作章节: 第{current_chapter.chapter_number}章 {current_chapter.title}",
        )

    logger.info(
        "✅ 后台创作章节 %s 完成，共 %s 字，质量=%s，修复=%s，压缩=%s，扩写=%s",
        chapter_id,
        new_word_count,
        generated.quality_report.status.value,
        generated.repaired,
        generated.compressed,
        generated.expanded,
    )

    # 🔮 自动标记伏笔
    try:
        plant_result = await foreshadow_service.auto_plant_pending_foreshadows(
            db=db,
            project_id=current_chapter.project_id,
            chapter_id=chapter_id,
            chapter_number=current_chapter.chapter_number,
            chapter_content=full_content
        )
        if plant_result.get('planted_count', 0) > 0:
            logger.info(f"🔮 自动标记伏笔已埋入: {plant_result['planted_count']}个")
    except Exception as plant_error:
        logger.warning(f"⚠️ 自动标记伏笔埋入失败: {str(plant_error)}")

    try:
        async with write_lock:
            analysis_task = AnalysisTask(
                chapter_id=chapter_id,
                user_id=user_id,
                project_id=current_chapter.project_id,
                status='pending',
                progress=0
            )
            db.add(analysis_task)
            await db.commit()
            await db.refresh(analysis_task)

        logger.info(f"📋 后台生成：已创建分析任务: {analysis_task.id}")
        await tracker.set_result({
            "chapter_id": chapter_id,
            "word_count": new_word_count,
            "analysis_task_id": analysis_task.id,
        })
        await tracker.analyzing(0, f"正文已保存，共 {new_word_count} 字；正在分析章节...")

        analysis_success = await analyze_chapter_background(
            chapter_id=chapter_id,
            user_id=user_id,
            project_id=current_chapter.project_id,
            task_id=analysis_task.id,
            progress_callback=tracker.analyzing,
        )
        if not analysis_success:
            await tracker.complete(f"章节创作完成，共 {new_word_count} 字；分析未完成，可稍后重新分析")
        else:
            await tracker.complete(f"章节创作与分析完成，共 {new_word_count} 字")
    except Exception as analysis_error:
        logger.error(f"⚠️ 章节正文已保存，但分析流程异常: {analysis_error}", exc_info=True)
        await tracker.complete(f"章节正文已保存，共 {new_word_count} 字；分析未完成，可稍后重新分析")


def _build_analysis_task_status_payload(
    chapter_id: str,
    task: Optional[AnalysisTask],
    auto_recovered: bool = False
) -> dict:
    """统一构建分析任务状态响应"""
    if not task:
        return {
            "has_task": False,
            "chapter_id": chapter_id,
            "status": "none",
            "progress": 0,
            "error_message": None,
            "auto_recovered": False,
            "task_origin": "chapter_analysis",
            "task_id": None,
            "created_at": None,
            "started_at": None,
            "completed_at": None
        }

    return {
        "has_task": True,
        "task_id": task.id,
        "chapter_id": task.chapter_id,
        "status": task.status,
        "progress": task.progress,
        "error_message": task.error_message,
        "auto_recovered": auto_recovered,
        "task_origin": (
            "tracking_resync"
            if task.background_task_id
            else "chapter_analysis"
        ),
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None
    }


@router.get("/{chapter_id}/analysis/status", summary="查询章节分析任务状态", response_model=AnalysisTaskStatusResponse)
async def get_analysis_task_status(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    查询指定章节的最新分析任务状态
    
    自动恢复机制：
    - 如果任务状态为running且超过1分钟未更新，自动标记为failed
    - 如果任务状态为pending且超过2分钟未启动，自动标记为failed
    
    返回:
    - has_task: 是否存在分析任务
    - task_id: 任务ID（如果存在）
    - status: pending/running/completed/failed/none（如果不存在则为none）
    - progress: 0-100
    - error_message: 错误信息(如果失败)
    - auto_recovered: 是否被自动恢复
    - created_at: 创建时间
    - completed_at: 完成时间
    
    注意：当章节不存在或无权访问时返回404，当没有分析任务时返回has_task=false
    """
    from datetime import timedelta
    
    # 先获取章节以验证存在性和权限
    chapter_result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = chapter_result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(chapter.project_id, user_id, db)
    
    # 获取该章节最新的分析任务
    result = await db.execute(
        select(AnalysisTask)
        .where(AnalysisTask.chapter_id == chapter_id)
        .order_by(AnalysisTask.created_at.desc())
        .limit(1)
    )
    task = result.scalar_one_or_none()
    
    if not task:
        # 返回无任务状态，而不是抛出404错误
        return _build_analysis_task_status_payload(chapter_id, None)
    
    recovered_ids = await _recover_stale_analysis_tasks(db, [task])
    auto_recovered = task.id in recovered_ids
    
    return _build_analysis_task_status_payload(chapter_id, task, auto_recovered)


@router.get("/project/{project_id}/analysis/monitor", summary="查询章节分析过程监控")
async def get_analysis_monitor(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    返回该项目当前进程中所有章节分析任务的过程日志。

    日志只保存在内存里（服务重启即清空），用于排查「分析卡住 / 输出被截断 /
    JSON 解析失败」这类问题；任务终态仍以 AnalysisTask 为准。
    """
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(project_id, user_id, db)

    tasks = analysis_monitor.list_by_project(project_id)
    return {
        "project_id": project_id,
        "total": len(tasks),
        "items": [task.to_payload() for task in tasks],
    }


@router.delete("/project/{project_id}/analysis/monitor", summary="清空章节分析过程监控")
async def clear_analysis_monitor(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(project_id, user_id, db)
    removed = analysis_monitor.clear_project(project_id)
    return {"project_id": project_id, "removed": removed}


@router.post("/project/{project_id}/analysis/statuses", summary="批量查询章节分析任务状态", response_model=BatchAnalysisStatusResponse)
async def get_project_analysis_task_statuses(
    project_id: str,
    payload: BatchAnalysisStatusRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """批量查询项目章节分析状态，避免前端逐章节请求造成请求风暴"""
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(project_id, user_id, db)

    # 先取项目章节列表
    chapter_query = select(Chapter.id).where(Chapter.project_id == project_id)
    if payload.chapter_ids and len(payload.chapter_ids) > 0:
        chapter_query = chapter_query.where(Chapter.id.in_(payload.chapter_ids))

    chapter_result = await db.execute(chapter_query)
    chapter_ids = [row[0] for row in chapter_result.all()]

    if not chapter_ids:
        return {
            "project_id": project_id,
            "total": 0,
            "items": {}
        }

    # 批量查询这些章节对应的所有分析任务，随后在内存中取最新一条
    tasks_result = await db.execute(
        select(AnalysisTask)
        .where(AnalysisTask.chapter_id.in_(chapter_ids))
        .order_by(AnalysisTask.chapter_id, AnalysisTask.created_at.desc())
    )
    all_tasks = tasks_result.scalars().all()

    latest_task_map: dict[str, AnalysisTask] = {}
    for task in all_tasks:
        if task.chapter_id not in latest_task_map:
            latest_task_map[task.chapter_id] = task

    recovered_ids = await _recover_stale_analysis_tasks(
        db, list(latest_task_map.values())
    )

    items: dict[str, dict] = {}
    for chapter_id in chapter_ids:
        task = latest_task_map.get(chapter_id)
        items[chapter_id] = _build_analysis_task_status_payload(
            chapter_id,
            task,
            task.id in recovered_ids if task else False,
        )

    return {
        "project_id": project_id,
        "total": len(chapter_ids),
        "items": items
    }


async def _run_batch_analysis_in_sequence(
    tasks_queue: list[dict[str, int | str]],
    user_id: str,
    project_id: str,
) -> None:
    """按章节顺序逐个执行分析任务。"""
    for index, task_item in enumerate(tasks_queue, start=1):
        chapter_id = str(task_item["chapter_id"])
        chapter_number = int(task_item["chapter_number"])
        task_id = str(task_item["task_id"])

        logger.info(f"🔁 一键分析顺序执行中 [{index}/{len(tasks_queue)}]：第{chapter_number}章")
        try:
            success = await analyze_chapter_background(
                chapter_id=chapter_id,
                user_id=user_id,
                project_id=project_id,
                task_id=task_id,
            )
            if not success:
                logger.warning(f"⚠️ 一键顺序分析返回失败: chapter_id={chapter_id}, task_id={task_id}")
        except Exception as e:
            # analyze_chapter_background 内部已处理任务失败状态，这里仅保护顺序队列不中断
            logger.error(
                f"❌ 一键顺序分析异常（已继续后续章节） chapter_id={chapter_id}, task_id={task_id}: {str(e)}",
                exc_info=True
            )


@router.post(
    "/project/{project_id}/analysis/analyze-unanalyzed",
    summary="一键按章节顺序分析未分析章节",
    response_model=BatchAnalyzeUnanalyzedResponse
)
async def batch_analyze_unanalyzed_chapters(
    project_id: str,
    payload: BatchAnalyzeUnanalyzedRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """自动识别项目中未完成分析的章节，并按章节顺序逐个启动分析。"""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    # 验证项目权限
    await verify_project_access(project_id, user_id, db)

    active_resync = await _active_tracking_resync_task(
        db,
        project_id=project_id,
        user_id=user_id,
    )
    if active_resync:
        raise HTTPException(
            status_code=409,
            detail="当前项目正在重分析连续性追踪，请等待任务完成后再批量分析章节",
        )

    # 查询目标章节（可选限制 chapter_ids）
    chapter_query = select(Chapter).where(Chapter.project_id == project_id).order_by(Chapter.chapter_number)
    if payload.chapter_ids and len(payload.chapter_ids) > 0:
        chapter_query = chapter_query.where(Chapter.id.in_(payload.chapter_ids))

    chapter_result = await db.execute(chapter_query)
    chapters = chapter_result.scalars().all()

    if not chapters:
        return {
            "project_id": project_id,
            "total_candidates": 0,
            "total_started": 0,
            "total_skipped_no_content": 0,
            "total_skipped_running": 0,
            "total_already_completed": 0,
            "started_tasks": {}
        }

    chapter_ids = [chapter.id for chapter in chapters]

    # 查询每个章节最新分析任务
    tasks_result = await db.execute(
        select(AnalysisTask)
        .where(AnalysisTask.chapter_id.in_(chapter_ids))
        .order_by(AnalysisTask.chapter_id, AnalysisTask.created_at.desc())
    )
    all_tasks = tasks_result.scalars().all()

    latest_task_map: dict[str, AnalysisTask] = {}
    for task in all_tasks:
        if task.chapter_id not in latest_task_map:
            latest_task_map[task.chapter_id] = task

    total_candidates = 0
    total_skipped_no_content = 0
    total_skipped_running = 0
    total_already_completed = 0
    started_tasks: dict[str, dict] = {}
    tasks_to_start: list[tuple[Chapter, AnalysisTask]] = []

    for chapter in chapters:
        # 无内容章节直接跳过
        if not chapter.content or chapter.content.strip() == "":
            total_skipped_no_content += 1
            continue

        total_candidates += 1
        latest_task = latest_task_map.get(chapter.id)

        # 已在队列/分析中，跳过
        if latest_task and latest_task.status in ("pending", "running"):
            total_skipped_running += 1
            continue

        # 已分析完成，跳过
        if latest_task and latest_task.status == "completed":
            total_already_completed += 1
            continue

        # 无任务/失败/未知状态，重新发起分析
        analysis_task = AnalysisTask(
            chapter_id=chapter.id,
            user_id=user_id,
            project_id=project_id,
            status='pending',
            progress=0
        )
        db.add(analysis_task)
        tasks_to_start.append((chapter, analysis_task))

    if tasks_to_start:
        try:
            await db.flush()

            for chapter, analysis_task in tasks_to_start:
                started_tasks[chapter.id] = _build_analysis_task_status_payload(chapter.id, analysis_task)

            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.error(f"❌ 一键分析创建任务失败: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"一键分析创建任务失败: {str(e)}")

        # 提交后立即按章节顺序调度后台分析（逐章执行）
        tasks_queue = [
            {
                "chapter_id": chapter.id,
                "chapter_number": chapter.chapter_number,
                "task_id": analysis_task.id
            }
            for chapter, analysis_task in tasks_to_start
        ]
        _schedule_analysis_background(
            _run_batch_analysis_in_sequence(
                tasks_queue=tasks_queue,
                user_id=user_id,
                project_id=project_id
            )
        )

    return {
        "project_id": project_id,
        "total_candidates": total_candidates,
        "total_started": len(tasks_to_start),
        "total_skipped_no_content": total_skipped_no_content,
        "total_skipped_running": total_skipped_running,
        "total_already_completed": total_already_completed,
        "started_tasks": started_tasks
    }


@router.get("/{chapter_id}/analysis", summary="获取章节分析结果")
async def get_chapter_analysis(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    获取章节的完整分析结果
    
    返回:
    - analysis_data: 完整的分析数据(JSON)
    - summary: 分析摘要文本
    - memories: 提取的记忆列表
    - created_at: 分析时间
    """
    # 先获取章节以验证权限
    chapter_result_check = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter_check = chapter_result_check.scalar_one_or_none()
    if chapter_check:
        # 验证用户权限
        user_id = getattr(request.state, 'user_id', None)
        await verify_project_access(chapter_check.project_id, user_id, db)
    
    # 获取分析结果
    analysis_result = await db.execute(
        select(PlotAnalysis)
        .where(PlotAnalysis.chapter_id == chapter_id)
        .order_by(PlotAnalysis.created_at.desc())
        .limit(1)
    )
    analysis = analysis_result.scalar_one_or_none()
    
    if not analysis:
        raise HTTPException(status_code=404, detail="该章节暂无分析结果")
    
    # 获取相关记忆
    memories_result = await db.execute(
        select(StoryMemory)
        .where(StoryMemory.chapter_id == chapter_id)
        .order_by(StoryMemory.importance_score.desc())
    )
    memories = memories_result.scalars().all()
    
    return {
        "chapter_id": chapter_id,
        "analysis": analysis.to_dict(),  # 使用to_dict()方法
        "memories": [
            {
                "id": mem.id,
                "type": mem.memory_type,
                "title": mem.title,
                "content": mem.content,
                "importance": mem.importance_score,
                "tags": mem.tags,
                "is_foreshadow": mem.is_foreshadow,
                "position": mem.chapter_position,
                "related_characters": mem.related_characters
            }
            for mem in memories
        ],
        "created_at": analysis.created_at.isoformat() if analysis.created_at else None
    }


@router.get("/{chapter_id}/annotations", summary="获取章节标注数据")
async def get_chapter_annotations(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    获取章节的标注数据（用于前端展示标注）
    
    返回格式化的标注列表，包含精确位置信息
    适用于章节内容的可视化标注展示
    """
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    
    # 获取章节
    chapter_result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = chapter_result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    # 验证项目访问权限
    await verify_project_access(chapter.project_id, user_id, db)
    
    # 获取分析结果
    analysis_result = await db.execute(
        select(PlotAnalysis)
        .where(PlotAnalysis.chapter_id == chapter_id)
        .order_by(PlotAnalysis.created_at.desc())
        .limit(1)
    )
    analysis = analysis_result.scalar_one_or_none()
    
    # 获取记忆
    memories_result = await db.execute(
        select(StoryMemory)
        .where(StoryMemory.chapter_id == chapter_id)
        .order_by(StoryMemory.importance_score.desc())
    )
    memories = memories_result.scalars().all()
    
    # 构建标注数据
    annotations = []
    
    for mem in memories:
        # 优先从数据库读取位置信息
        position = mem.chapter_position if mem.chapter_position is not None else -1
        length = mem.text_length if hasattr(mem, 'text_length') and mem.text_length is not None else 0
        metadata_extra = {}
        
        # 如果数据库中没有位置信息，尝试从分析数据中重新计算
        if position == -1 and analysis and chapter.content:
            # 根据记忆类型从分析数据中查找对应项
            if mem.memory_type == 'hook' and analysis.hooks:
                for hook in analysis.hooks:
                    # 通过标题或内容匹配
                    if mem.title and hook.get('type') in mem.title:
                        keyword = hook.get('keyword', '')
                        if keyword:
                            pos = chapter.content.find(keyword)
                            if pos != -1:
                                position = pos
                                length = len(keyword)
                        metadata_extra["strength"] = hook.get('strength', 5)
                        metadata_extra["position_desc"] = hook.get('position', '')
                        break
            
            elif mem.memory_type == 'foreshadow' and analysis.foreshadows:
                for foreshadow in analysis.foreshadows:
                    if foreshadow.get('content') in mem.content:
                        keyword = foreshadow.get('keyword', '')
                        if keyword:
                            pos = chapter.content.find(keyword)
                            if pos != -1:
                                position = pos
                                length = len(keyword)
                        metadata_extra["foreshadow_type"] = foreshadow.get('type', 'planted')
                        metadata_extra["strength"] = foreshadow.get('strength', 5)
                        break
            
            elif mem.memory_type == 'plot_point' and analysis.plot_points:
                for plot_point in analysis.plot_points:
                    if plot_point.get('content') in mem.content:
                        keyword = plot_point.get('keyword', '')
                        if keyword:
                            pos = chapter.content.find(keyword)
                            if pos != -1:
                                position = pos
                                length = len(keyword)
                        break
        else:
            # 如果数据库有位置，也从分析数据中提取额外的元数据
            if analysis:
                if mem.memory_type == 'hook' and analysis.hooks:
                    for hook in analysis.hooks:
                        if mem.title and hook.get('type') in mem.title:
                            metadata_extra["strength"] = hook.get('strength', 5)
                            metadata_extra["position_desc"] = hook.get('position', '')
                            break
                
                elif mem.memory_type == 'foreshadow' and analysis.foreshadows:
                    for foreshadow in analysis.foreshadows:
                        if foreshadow.get('content') in mem.content:
                            metadata_extra["foreshadow_type"] = foreshadow.get('type', 'planted')
                            metadata_extra["strength"] = foreshadow.get('strength', 5)
                            break
        
        annotation = {
            "id": mem.id,
            "type": mem.memory_type,
            "title": mem.title,
            "content": mem.content,
            "importance": mem.importance_score or 0.5,
            "position": position,
            "length": length,
            "tags": mem.tags or [],
            "metadata": {
                "is_foreshadow": mem.is_foreshadow,
                "related_characters": mem.related_characters or [],
                "related_locations": mem.related_locations or [],
                **metadata_extra
            }
        }
        
        annotations.append(annotation)
    
    return {
        "chapter_id": chapter_id,
        "chapter_number": chapter.chapter_number,
        "title": chapter.title,
        "word_count": chapter.word_count or 0,
        "annotations": annotations,
        "has_analysis": analysis is not None,
        "summary": {
            "total_annotations": len(annotations),
            "hooks": len([a for a in annotations if a["type"] == "hook"]),
            "foreshadows": len([a for a in annotations if a["type"] == "foreshadow"]),
            "plot_points": len([a for a in annotations if a["type"] == "plot_point"]),
            "character_events": len([a for a in annotations if a["type"] == "character_event"])
        }
    }


@router.post("/{chapter_id}/analyze", summary="手动触发章节分析")
async def trigger_chapter_analysis(
    chapter_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    手动触发章节分析(用于重新分析或分析旧章节)
    """
    # 从请求中获取用户ID
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    
    # 验证章节存在
    chapter_result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = chapter_result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    if not chapter.content or chapter.content.strip() == "":
        raise HTTPException(status_code=400, detail="章节内容为空，无法分析")
    
    # 获取项目信息
    project_result = await db.execute(
        select(Project).where(Project.id == chapter.project_id)
    )
    project = project_result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    active_resync = await _active_tracking_resync_task(
        db,
        project_id=project.id,
        user_id=user_id,
    )
    if active_resync:
        raise HTTPException(
            status_code=409,
            detail="当前项目正在重分析连续性追踪，请等待任务完成后再手动分析章节",
        )

    # 避免重复点击或状态轮询误判后创建并发分析任务。
    existing_task_result = await db.execute(
        select(AnalysisTask)
        .where(AnalysisTask.chapter_id == chapter_id)
        .order_by(AnalysisTask.created_at.desc())
        .limit(1)
    )
    existing_task = existing_task_result.scalar_one_or_none()
    if existing_task and existing_task.status in ("pending", "running"):
        return {
            "task_id": existing_task.id,
            "chapter_id": chapter_id,
            "status": existing_task.status,
            "message": "已有分析任务正在执行"
        }
    
    # 创建分析任务
    analysis_task = AnalysisTask(
        chapter_id=chapter_id,
        user_id=user_id,
        project_id=project.id,
        status='pending',
        progress=0
    )
    db.add(analysis_task)
    await db.commit()
    
    task_id = analysis_task.id
    logger.info(f"📋 创建分析任务: {task_id}, 章节: {chapter_id}")
    
    # 刷新数据库会话，确保其他会话可以看到新任务
    await db.refresh(analysis_task)
    
    # 短暂延迟确保SQLite WAL完成写入（让其他会话可见）
    await asyncio.sleep(3)
    
    # 直接启动后台分析（并发执行）
    background_tasks.add_task(
        analyze_chapter_background,
        chapter_id=chapter_id,
        user_id=user_id,
        project_id=project.id,
        task_id=task_id
    )
    
    return {
        "task_id": task_id,
        "chapter_id": chapter_id,
        "status": "pending",
        "message": "分析任务已创建并开始执行"
    }



def calculate_estimated_time(
    chapter_count: int,
    target_word_count: int,
    enable_analysis: bool
) -> int:
    """
    计算预估耗时（分钟）
    
    基准：
    - 生成3000字约需2分钟
    - 分析约需1分钟
    """
    generation_time_per_chapter = (target_word_count / 3000) * 2
    analysis_time_per_chapter = 1 if enable_analysis else 0
    
    total_time = chapter_count * (generation_time_per_chapter + analysis_time_per_chapter)
    
    return max(1, int(total_time))


@router.post("/project/{project_id}/batch-generate", response_model=BatchGenerateResponse, summary="批量顺序生成章节内容")
async def batch_generate_chapters_in_order(
    project_id: str,
    batch_request: BatchGenerateRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service)
):
    """
    从指定章节开始，按顺序批量生成指定数量的章节
    
    特性：
    1. 严格按章节序号顺序生成（不可跳过）
    2. 自动检测起始章节是否可生成
    3. 可选同步分析（影响耗时和质量）
    4. 失败后终止，不继续后续章节
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    
    # 验证项目存在和用户权限
    project = await verify_project_access(project_id, user_id, db)
    
    # 获取项目的所有章节，按序号排序
    result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.chapter_number)
    )
    all_chapters = result.scalars().all()
    
    if not all_chapters:
        raise HTTPException(status_code=404, detail="项目没有章节")
    
    # 计算要生成的章节范围
    start_number = batch_request.start_chapter_number
    end_number = start_number + batch_request.count - 1
    
    # 筛选出要生成的章节
    chapters_to_generate = [
        ch for ch in all_chapters
        if start_number <= ch.chapter_number <= end_number
    ]
    
    if not chapters_to_generate:
        raise HTTPException(status_code=404, detail="指定范围内没有章节")
    
    # 验证起始章节的前置条件
    first_chapter = chapters_to_generate[0]
    can_generate, error_msg, _ = await check_prerequisites(db, first_chapter)
    if not can_generate:
        raise HTTPException(status_code=400, detail=f"起始章节无法生成：{error_msg}")

    # 批量生成必须同步分析，否则下一章无法获得最新角色状态、记忆和伏笔上下文。
    enable_analysis = True
    
    # 创建批量生成任务
    batch_task = BatchGenerationTask(
        project_id=project_id,
        user_id=user_id,
        start_chapter_number=start_number,
        chapter_count=len(chapters_to_generate),
        chapter_ids=[ch.id for ch in chapters_to_generate],
        style_id=batch_request.style_id,
        target_word_count=batch_request.target_word_count,
        enable_analysis=enable_analysis,
        max_retries=batch_request.max_retries,
        status='pending',
        total_chapters=len(chapters_to_generate),
        completed_chapters=0,
        failed_chapters=[],
        current_retry_count=0
    )
    db.add(batch_task)
    await db.commit()
    await db.refresh(batch_task)
    
    batch_id = batch_task.id
    
    # 计算预估耗时
    estimated_time = calculate_estimated_time(
        chapter_count=len(chapters_to_generate),
        target_word_count=batch_request.target_word_count,
        enable_analysis=enable_analysis
    )
    
    logger.info(f"📦 创建批量生成任务: {batch_id}, 章节: 第{start_number}-{end_number}章, 预估耗时: {estimated_time}分钟")
    
    # 启动后台批量生成任务，传递model参数和skill_key
    background_tasks.add_task(
        execute_batch_generation_in_order,
        batch_id=batch_id,
        user_id=user_id,
        ai_service=user_ai_service,
        custom_model=batch_request.model,
        skill_key=batch_request.skill_key,
        enable_mcp=batch_request.enable_mcp,
        narrative_perspective=batch_request.narrative_perspective,
        auto_polish=batch_request.auto_polish,
    )
    
    return BatchGenerateResponse(
        batch_id=batch_id,
        message=f"批量生成任务已创建，将生成 {len(chapters_to_generate)} 个章节",
        chapters_to_generate=[
            {
                "id": ch.id,
                "chapter_number": ch.chapter_number,
                "title": ch.title
            }
            for ch in chapters_to_generate
        ],
        estimated_time_minutes=estimated_time
    )


@router.get("/batch-generate/{batch_id}/status", response_model=BatchGenerateStatusResponse, summary="查询批量生成任务状态")
async def get_batch_generation_status(
    batch_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """查询批量生成任务的状态和进度"""
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    result = await db.execute(
        select(BatchGenerationTask).where(
            BatchGenerationTask.id == batch_id,
            BatchGenerationTask.user_id == user_id
        )
    )
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(status_code=404, detail="批量生成任务不存在")
    
    return BatchGenerateStatusResponse(
        batch_id=task.id,
        status=task.status,
        total=task.total_chapters,
        completed=task.completed_chapters,
        current_chapter_id=task.current_chapter_id,
        current_chapter_number=task.current_chapter_number,
        current_retry_count=task.current_retry_count,
        max_retries=task.max_retries,
        failed_chapters=task.failed_chapters or [],
        created_at=task.created_at.isoformat() if task.created_at else None,
        started_at=task.started_at.isoformat() if task.started_at else None,
        completed_at=task.completed_at.isoformat() if task.completed_at else None,
        error_message=task.error_message
    )


@router.get("/project/{project_id}/batch-generate/active", summary="获取项目当前运行中的批量生成任务")
async def get_active_batch_generation(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    获取项目当前运行中的批量生成任务
    用于页面刷新后恢复任务状态
    """
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    await verify_project_access(project_id, user_id, db)
    
    result = await db.execute(
        select(BatchGenerationTask)
        .where(BatchGenerationTask.project_id == project_id)
        .where(BatchGenerationTask.user_id == user_id)
        .where(BatchGenerationTask.status.in_(['pending', 'running']))
        .order_by(BatchGenerationTask.created_at.desc())
        .limit(1)
    )
    task = result.scalar_one_or_none()
    
    if not task:
        return {
            "has_active_task": False,
            "task": None
        }
    
    return {
        "has_active_task": True,
        "task": {
            "batch_id": task.id,
            "status": task.status,
            "total": task.total_chapters,
            "completed": task.completed_chapters,
            "current_chapter_id": task.current_chapter_id,
            "current_chapter_number": task.current_chapter_number,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "started_at": task.started_at.isoformat() if task.started_at else None
        }
    }


@router.post("/batch-generate/{batch_id}/cancel", summary="取消批量生成任务")
async def cancel_batch_generation(
    batch_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """取消正在进行的批量生成任务"""
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    result = await db.execute(
        select(BatchGenerationTask).where(
            BatchGenerationTask.id == batch_id,
            BatchGenerationTask.user_id == user_id
        )
    )
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(status_code=404, detail="批量生成任务不存在")
    
    if task.status in ['completed', 'failed', 'cancelled']:
        raise HTTPException(status_code=400, detail=f"任务已处于 {task.status} 状态，无法取消")
    
    task.status = 'cancelled'
    task.completed_at = datetime.now()
    await db.commit()
    
    logger.info(f"🛑 批量生成任务已取消: {batch_id}")
    
    return {
        "message": "批量生成任务已取消",
        "batch_id": batch_id,
        "completed_chapters": task.completed_chapters,
        "total_chapters": task.total_chapters
    }


async def execute_batch_generation_in_order(
    batch_id: str,
    user_id: str,
    ai_service: AIService,
    custom_model: Optional[str] = None,
    skill_key: Optional[str] = None,
    enable_mcp: bool = True,
    narrative_perspective: Optional[str] = None,
    auto_polish: bool = False,
):
    """
    按顺序执行批量生成任务（后台任务）
    - 严格按章节序号顺序
    - 任一章节失败则终止后续生成
    - 可选同步分析
    """
    db_session = None
    task = None
    write_lock = await get_db_write_lock(user_id)
    
    try:
        logger.info(f"📦 开始执行顺序批量生成任务: {batch_id}")
        
        # 创建独立数据库会话
        from app.database import get_engine
        from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
        
        engine = await get_engine(user_id)
        AsyncSessionLocal = async_sessionmaker(
            engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
        db_session = AsyncSessionLocal()
        
        # 获取任务
        task_result = await db_session.execute(
            select(BatchGenerationTask).where(BatchGenerationTask.id == batch_id)
        )
        task = task_result.scalar_one_or_none()
        
        if not task:
            logger.error(f"❌ 批量生成任务不存在: {batch_id}")
            return

        if task.status == 'cancelled':
            logger.info(f"🛑 批量生成任务启动前已取消: {batch_id}")
            return
        
        # 更新任务状态为运行中
        async with write_lock:
            await db_session.refresh(task)
            if task.status == 'cancelled':
                logger.info(f"🛑 批量生成任务启动前已取消: {batch_id}")
                return
            task.status = 'running'
            task.started_at = datetime.now()
            await db_session.commit()
        
        # 维护上一章的摘要，用于传递给下一章（防重复上下文）
        last_generated_summary = None

        # 按顺序生成每个章节
        for idx, chapter_id in enumerate(task.chapter_ids, 1):
            # 检查任务是否被取消
            await db_session.refresh(task)
            if task.status == 'cancelled':
                logger.info(f"🛑 批量生成任务已被取消: {batch_id}")
                return
            
            # 更新当前章节
            async with write_lock:
                task.current_chapter_id = chapter_id
                task.current_retry_count = 0  # 重置重试计数
                await db_session.commit()
            
            # 重试循环
            retry_count = 0
            chapter_success = False
            chapter = None
            last_error = None
            
            while retry_count <= task.max_retries and not chapter_success:
                try:
                    await db_session.refresh(task)
                    if task.status == 'cancelled':
                        logger.info(f"🛑 批量生成任务已被取消: {batch_id}")
                        return

                    # 获取章节信息
                    chapter_result = await db_session.execute(
                        select(Chapter).where(Chapter.id == chapter_id)
                    )
                    chapter = chapter_result.scalar_one_or_none()
                    
                    if not chapter:
                        raise Exception(f"章节 {chapter_id} 不存在")
                    
                    # 更新当前章节序号和重试次数
                    async with write_lock:
                        task.current_chapter_number = chapter.chapter_number
                        task.current_retry_count = retry_count
                        await db_session.commit()
                    
                    if retry_count > 0:
                        logger.info(f"🔄 [{idx}/{task.total_chapters}] 重试生成章节 (第{retry_count}次): 第{chapter.chapter_number}章 《{chapter.title}》")
                    else:
                        logger.info(f"📝 [{idx}/{task.total_chapters}] 开始生成章节: 第{chapter.chapter_number}章 《{chapter.title}》")
                    
                    # 检查前置条件（每次都检查，确保顺序性）
                    can_generate, error_msg, _ = await check_prerequisites(db_session, chapter)
                    if not can_generate:
                        raise Exception(f"前置条件不满足: {error_msg}")
                    analysis_ready, analysis_msg = await check_previous_analysis_ready(db_session, chapter)
                    if not analysis_ready:
                        raise Exception(analysis_msg)
                    
                    lease_owner = f"chapter-batch:{batch_id}:{chapter_id}"
                    lease_acquired, lease_error = await acquire_generation_lease(
                        db_session, task.project_id, lease_owner
                    )
                    if not lease_acquired:
                        raise Exception(lease_error)
                    try:
                        generated_summary = await generate_single_chapter_for_batch(
                            db_session=db_session,
                            chapter=chapter,
                            user_id=user_id,
                            style_id=task.style_id,
                            target_word_count=task.target_word_count,
                            ai_service=ai_service,
                            write_lock=write_lock,
                            custom_model=custom_model,
                            previous_summary_context=last_generated_summary,
                            skill_key=skill_key,
                            batch_id=batch_id,
                            enable_mcp=enable_mcp,
                            temp_narrative_perspective=narrative_perspective,
                            auto_polish=auto_polish,
                        )
                    finally:
                        await release_generation_lease(
                            db_session, task.project_id, lease_owner
                        )

                    await db_session.refresh(task)
                    if task.status == 'cancelled':
                        logger.info(f"🛑 批量生成任务已被取消，跳过后续处理: {batch_id}")
                        return
                    
                    # 更新上一章摘要，供下一章使用
                    if generated_summary:
                        last_generated_summary = f"第{chapter.chapter_number}章《{chapter.title}》：{generated_summary}"
                        logger.info(f"📝 已更新上一章摘要上下文: {last_generated_summary[:50]}...")
                    
                    logger.info(f"✅ 章节生成完成: 第{chapter.chapter_number}章")
                    
                    # 追踪提交是完成章节的必要条件；enable_analysis 仅保留接口兼容。
                    await db_session.refresh(task)
                    if task.status == 'cancelled':
                        logger.info(f"🛑 批量生成任务已被取消，跳过同步分析: {batch_id}")
                        return
                    logger.info(f"🔍 开始同步分析章节: 第{chapter.chapter_number}章")

                    async with write_lock:
                        analysis_task = AnalysisTask(
                            chapter_id=chapter_id,
                            user_id=user_id,
                            project_id=task.project_id,
                            status='pending',
                            progress=0
                        )
                        db_session.add(analysis_task)
                        await db_session.commit()
                        await db_session.refresh(analysis_task)

                    analysis_result = await analyze_chapter_background(
                        chapter_id=chapter_id,
                        user_id=user_id,
                        project_id=task.project_id,
                        task_id=analysis_task.id
                    )

                    if not analysis_result:
                        # 透出真实原因（例如服务商内容审核拦截），避免只显示"分析函数返回失败"
                        analysis_error = (
                            await db_session.execute(
                                select(AnalysisTask.error_message).where(
                                    AnalysisTask.id == analysis_task.id
                                )
                            )
                        ).scalar_one_or_none()
                        error_message = (
                            analysis_error
                            or getattr(analysis_task, "error_message", None)
                            or "分析函数返回失败"
                        )
                        logger.error(f"❌ 章节分析失败，批量生成中断: 第{chapter.chapter_number}章")

                        failed_info = {
                            'chapter_id': chapter_id,
                            'chapter_number': chapter.chapter_number,
                            'title': chapter.title,
                            'error': f"分析失败: {error_message}",
                            'retry_count': 1
                        }

                        async with write_lock:
                            if task.failed_chapters is None:
                                task.failed_chapters = []
                            task.failed_chapters.append(failed_info)

                            task.status = 'failed'
                            task.error_message = f"第{chapter.chapter_number}章分析失败: {error_message}"[:500]
                            task.completed_at = datetime.now()
                            task.current_retry_count = 0
                            await db_session.commit()

                        return

                    await db_session.refresh(chapter)
                    if chapter.quality_status != "ready" or chapter.tracking_status != "current":
                        gate_error = (
                            f"第{chapter.chapter_number}章质量门禁未通过："
                            f"{chapter.quality_status}/{chapter.tracking_status}"
                        )
                        async with write_lock:
                            task.status = 'failed'
                            task.error_message = gate_error[:500]
                            task.completed_at = datetime.now()
                            task.current_retry_count = 0
                            await db_session.commit()
                        logger.error(gate_error)
                        return
                    logger.info(f"✅ 章节分析与追踪提交成功: 第{chapter.chapter_number}章")
                    
                    # 标记成功
                    chapter_success = True
                    
                    # 更新完成数
                    async with write_lock:
                        task.completed_chapters += 1
                        task.current_retry_count = 0  # 重置重试计数
                        await db_session.commit()
                    
                    logger.info(f"✅ 进度: {task.completed_chapters}/{task.total_chapters}")
                    
                except Exception as e:
                    last_error = str(e)
                    await db_session.refresh(task)
                    if task.status == 'cancelled':
                        logger.info(f"🛑 批量生成任务已被取消: {batch_id}")
                        return
                    error_msg = f"第{chapter.chapter_number if chapter else '?'}章出错: {last_error}"
                    logger.error(f"❌ {error_msg}")
                    
                    retry_count += 1
                    
                    # 如果还有重试机会，等待一小段时间后重试
                    if retry_count <= task.max_retries:
                        wait_time = min(2 ** retry_count, 10)  # 指数退避，最多等待10秒
                        logger.info(f"⏳ 等待 {wait_time} 秒后重试...")
                        await asyncio.sleep(wait_time)
                    else:
                        # 达到最大重试次数，记录失败信息
                        logger.error(f"❌ 章节生成失败，已达最大重试次数({task.max_retries}): 第{chapter.chapter_number if chapter else '?'}章")
                        
                        failed_info = {
                            'chapter_id': chapter_id,
                            'chapter_number': chapter.chapter_number if chapter else -1,
                            'title': chapter.title if chapter else '未知',
                            'error': last_error,
                            'retry_count': retry_count - 1
                        }
                        
                        async with write_lock:
                            if task.failed_chapters is None:
                                task.failed_chapters = []
                            task.failed_chapters.append(failed_info)
                            
                            # 标记任务失败并终止
                            task.status = 'failed'
                            task.error_message = f"第{chapter.chapter_number}章生成失败(重试{retry_count-1}次): {last_error}"[:500]
                            task.completed_at = datetime.now()
                            task.current_retry_count = 0
                            await db_session.commit()
                        
                        # ⚠️ 如果启用了同步分析，任何错误都应该中断任务
                        # 因为章节生成或分析失败会影响后续章节的职业更新和剧情连贯性
                        if task.enable_analysis:
                            logger.error(f"🛑 批量生成中断: 因启用同步分析，任何错误都会中断任务以确保职业信息和剧情连贯性")
                        else:
                            logger.error(f"🛑 批量生成终止于第{chapter.chapter_number}章")
                        
                        return
        
        # 全部完成
        async with write_lock:
            await db_session.refresh(task)
            if task.status == 'cancelled':
                logger.info(f"🛑 批量生成任务已被取消，跳过完成状态覆盖: {batch_id}")
                return
            task.status = 'completed'
            task.completed_at = datetime.now()
            task.current_chapter_id = None
            task.current_chapter_number = None
            await db_session.commit()
        
        logger.info(f"✅ 批量生成任务全部完成: {batch_id}, 成功生成 {task.completed_chapters} 章")
        
    except Exception as e:
        logger.error(f"❌ 批量生成任务异常: {str(e)}", exc_info=True)
        if db_session and task:
            try:
                async with write_lock:
                    await db_session.refresh(task)
                    if task.status != 'cancelled':
                        task.status = 'failed'
                        task.error_message = str(e)[:500]
                        task.completed_at = datetime.now()
                        await db_session.commit()
            except Exception as commit_error:
                logger.error(f"❌ 更新任务失败状态失败: {str(commit_error)}")
    finally:
        if db_session:
            await db_session.close()


async def generate_single_chapter_for_batch(
    db_session: AsyncSession,
    chapter: Chapter,
    user_id: str,
    style_id: Optional[int],
    target_word_count: int,
    ai_service: AIService,
    write_lock: Lock,
    custom_model: Optional[str] = None,
    previous_summary_context: Optional[str] = None,
    skill_key: Optional[str] = None,
    batch_id: Optional[str] = None,
    enable_mcp: bool = True,
    temp_narrative_perspective: Optional[str] = None,
    auto_polish: bool = False,
) -> Optional[str]:
    """
    为批量生成执行单个章节的生成（非流式）
    复用现有生成逻辑的核心部分
    
    Returns:
        生成章节的摘要（前200字）
    """
    # 获取项目信息
    project_result = await db_session.execute(
        select(Project).where(Project.id == chapter.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise Exception("项目不存在")
    
    # 获取项目的大纲模式
    outline_mode = project.outline_mode if project else 'one-to-many'
    logger.info(f"📋 批量生成 - 项目大纲模式: {outline_mode}")
    
    # 获取对应的大纲（优先使用 chapter.outline_id 直接关联）
    if chapter.outline_id:
        outline_result = await db_session.execute(
            select(Outline).where(Outline.id == chapter.outline_id)
        )
    else:
        # 回退到按序号查找
        outline_result = await db_session.execute(
            select(Outline)
            .where(Outline.project_id == chapter.project_id)
            .where(Outline.order_index == chapter.chapter_number)
        )
    outline = outline_result.scalar_one_or_none()
    
    # 获取写作风格
    style_content = ""
    if style_id:
        style_result = await db_session.execute(
            select(WritingStyle).where(WritingStyle.id == style_id)
        )
        style = style_result.scalar_one_or_none()
        if style:
            if style.user_id is None or style.user_id == user_id:
                style_content = style.prompt_content or ""
    
    creation_input = await ChapterCreationService(db_session).prepare(
        chapter=chapter,
        project=project,
        outline=outline,
        user_id=user_id,
        style_id=style_id,
        target_word_count=target_word_count,
        narrative_perspective=temp_narrative_perspective,
        skill_key=skill_key,
    )
    chapter_context = creation_input.context
    style_content = creation_input.style_content
    prompt = creation_input.prompt
    system_prompt_with_style = creation_input.system_prompt
    logger.info(
        "批量创作输入已组装: chapter=%s input_chars=%s trims=%s",
        chapter.chapter_number,
        creation_input.input_chars,
        creation_input.trims,
    )
    
    # 🔢 计算 max_tokens 限制（批量生成）
    # 中文字符约 1.5-2 个 token，使用 2.5 倍系数确保有足够空间完成段落
    # 同时设置上限防止过长，下限确保基本可用
    calculated_max_tokens = int(target_word_count * 3)
    calculated_max_tokens = max(2000, min(calculated_max_tokens + 4096, 20000))
    logger.info(f"📊 批量生成 - 目标字数: {target_word_count}, 计算 max_tokens: {calculated_max_tokens}")
    
    # 非流式生成内容
    full_content = ""
    # 准备生成参数
    generate_kwargs = {
        "prompt": prompt,
        "system_prompt": system_prompt_with_style,
        "tool_choice": "auto",
        "max_tokens": calculated_max_tokens,
        "auto_mcp": False,
    }
    # 如果传入了自定义模型，使用指定的模型
    if custom_model:
        generate_kwargs["model"] = custom_model
        logger.info(f"  批量生成使用自定义模型: {custom_model}")
    
    async def _is_batch_cancelled() -> bool:
        if not batch_id:
            return False
        result = await db_session.execute(
            select(BatchGenerationTask.status).where(BatchGenerationTask.id == batch_id)
        )
        return result.scalar_one_or_none() == 'cancelled'

    # 批量生成中的流式生成（非SSE，不需要修改进度显示）
    chunk_count = 0
    length_guard = ChapterLengthGuard(target_word_count)
    source = ai_service.generate_text_stream(**generate_kwargs)
    async for chunk in iter_guarded_chunks(source, length_guard):
        if chunk_count % 10 == 0 and await _is_batch_cancelled():
            logger.info(f"🛑 批量生成单章流式生成被取消: batch={batch_id}, chapter={chapter.id}")
            raise Exception("批量生成任务已取消")
        full_content += chunk
        chunk_count += 1

    length_result = length_guard.finish()
    full_content = length_result.content
    logger.info(
        "批量章节长度保护: chapter=%s target=%s observed=%s output=%s "
        "truncated=%s cutoff=%s",
        chapter.chapter_number,
        target_word_count,
        length_result.observed_chars,
        length_result.content_chars,
        length_result.truncated,
        length_result.cutoff_kind or "none",
    )

    if await _is_batch_cancelled():
        logger.info(f"🛑 批量生成保存前被取消: batch={batch_id}, chapter={chapter.id}")
        raise Exception("批量生成任务已取消")
    
    # === 生成后自动去味（可选）===
    if auto_polish:
        full_content, polish_result = await polish_chapter_after_generation(
            db=db_session,
            chapter=chapter,
            project=project,
            generated_content=full_content,
            ai_service=ai_service,
            model=custom_model,
            user_id=user_id,
            label="批量生成后自动去味",
        )
        if 'skipped' in polish_result:
            logger.warning(f"⚠️ 批量生成自动去味已跳过: {polish_result['skipped']}")

    generated = await ChapterCreationService(db_session).finalize_generated(
        chapter=chapter,
        project=project,
        outline=outline,
        prepared=creation_input,
        content=full_content,
        ai_service=ai_service,
        model=custom_model,
    )
    full_content = generated.content
    # 更新章节内容到数据库（使用锁保护）
    async with write_lock:
        new_word_count = await ChapterCreationService(db_session).save_generated(
            chapter=chapter,
            project=project,
            result=generated,
            label=f"批量生成: 第{chapter.chapter_number}章 {chapter.title}",
        )
        await db_session.refresh(chapter)
    
    logger.info(
        "✅ 单章节生成完成: 第%s章，共%s字，质量=%s，修复=%s，压缩=%s，扩写=%s",
        chapter.chapter_number,
        new_word_count,
        generated.quality_report.status.value,
        generated.repaired,
        generated.compressed,
        generated.expanded,
    )
    
    # 生成简短摘要返回
    summary_preview = _build_lightweight_chapter_summary(full_content)
    
    # 🔮 批量生成后自动标记计划在本章埋入的伏笔
    try:
        async with write_lock:
            plant_result = await foreshadow_service.auto_plant_pending_foreshadows(
                db=db_session,
                project_id=chapter.project_id,
                chapter_id=chapter.id,
                chapter_number=chapter.chapter_number,
                chapter_content=full_content
            )
        if plant_result.get('planted_count', 0) > 0:
            logger.info(f"🔮 批量生成 - 自动标记伏笔已埋入: {plant_result['planted_count']}个")
    except Exception as plant_error:
        logger.warning(f"⚠️ 批量生成 - 自动标记伏笔埋入失败: {str(plant_error)}")
        
    return summary_preview




# ==================== 章节重新生成相关API ====================

@router.post("/{chapter_id}/regenerate-stream", summary="流式重新生成章节内容")
async def regenerate_chapter_stream(
    chapter_id: str,
    request: Request,
    regenerate_request: ChapterRegenerateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service)
):
    """
    根据分析建议或自定义指令重新生成章节内容（流式返回）
    
    工作流程：
    1. 验证章节和分析结果
    2. 创建重新生成任务
    3. 构建修改指令
    4. 流式生成新内容
    5. 保存为版本历史
    6. 可选自动应用
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    
    # 验证章节存在
    chapter_result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = chapter_result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    if not chapter.content or chapter.content.strip() == "":
        raise HTTPException(status_code=400, detail="章节内容为空，无法重新生成")
    
    # 验证用户权限
    await verify_project_access(chapter.project_id, user_id, db)
    
    # 获取分析结果（如果使用分析建议）
    analysis = None
    if regenerate_request.modification_source in ['analysis_suggestions', 'mixed']:
        analysis_result = await db.execute(
            select(PlotAnalysis)
            .where(PlotAnalysis.chapter_id == chapter_id)
            .order_by(PlotAnalysis.created_at.desc())
            .limit(1)
        )
        analysis = analysis_result.scalar_one_or_none()
        
        if not analysis:
            raise HTTPException(status_code=404, detail="该章节暂无分析结果")
    
    # 预先获取项目上下文数据和写作风格
    async for temp_db in get_db(request):
        try:
            # 获取项目信息
            project_result = await temp_db.execute(
                select(Project).where(Project.id == chapter.project_id)
            )
            project = project_result.scalar_one_or_none()
            
            # 获取角色信息（包含职业信息）
            characters_result = await temp_db.execute(
                select(Character).where(Character.project_id == chapter.project_id)
            )
            characters = characters_result.scalars().all()
            
            # 📝 根据大纲模式智能筛选相关角色（重新生成）
            outline_mode_result = await temp_db.execute(
                select(Project.outline_mode).where(Project.id == chapter.project_id)
            )
            outline_mode = outline_mode_result.scalar_one_or_none() or 'one-to-many'
            
            filter_character_names = None
            if outline_mode == 'one-to-one':
                # 1-1模式：从outline.structure中提取characters字段（优先使用 outline_id）
                if chapter.outline_id:
                    outline_result_temp = await temp_db.execute(
                        select(Outline.structure)
                        .where(Outline.id == chapter.outline_id)
                    )
                else:
                    outline_result_temp = await temp_db.execute(
                        select(Outline.structure)
                        .where(Outline.project_id == chapter.project_id)
                        .where(Outline.order_index == chapter.chapter_number)
                    )
                outline_structure = outline_result_temp.scalar_one_or_none()
                if outline_structure:
                    try:
                        structure = json.loads(outline_structure)
                        filter_character_names = structure.get('characters', [])
                        if filter_character_names:
                            logger.info(f"📋 重新生成 - 1-1模式：从structure提取角色列表 {filter_character_names}")
                    except json.JSONDecodeError:
                        logger.warning(f"⚠️ 重新生成 - outline.structure解析失败，使用全部角色")
            else:
                # 1-n模式：从chapter.expansion_plan中提取character_focus字段
                if chapter.expansion_plan:
                    try:
                        plan = json.loads(chapter.expansion_plan)
                        filter_character_names = plan.get('character_focus', [])
                        if filter_character_names:
                            logger.info(f"📋 重新生成 - 1-n模式：从expansion_plan提取角色焦点 {filter_character_names}")
                    except json.JSONDecodeError:
                        logger.warning(f"⚠️ 重新生成 - expansion_plan解析失败，使用全部角色")
            
            characters_info_with_careers = await build_characters_info_with_careers(
                db=temp_db,
                project_id=chapter.project_id,
                characters=characters,
                filter_character_names=filter_character_names
            )
            
            # 获取章节大纲（优先使用 chapter.outline_id 直接关联）
            if chapter.outline_id:
                outline_result = await temp_db.execute(
                    select(Outline).where(Outline.id == chapter.outline_id)
                )
            else:
                # 回退到按序号查找
                outline_result = await temp_db.execute(
                    select(Outline)
                    .where(Outline.project_id == chapter.project_id)
                    .where(Outline.order_index == chapter.chapter_number)
                )
            outline = outline_result.scalar_one_or_none()
            
            # 获取写作风格
            style_content = ""
            style_id = regenerate_request.style_id
            
            # 如果没有指定风格，尝试使用项目的默认风格
            if not style_id:
                from app.models.project_default_style import ProjectDefaultStyle
                default_style_result = await temp_db.execute(
                    select(ProjectDefaultStyle.style_id)
                    .where(ProjectDefaultStyle.project_id == chapter.project_id)
                )
                default_style_id = default_style_result.scalar_one_or_none()
                if default_style_id:
                    style_id = default_style_id
                    logger.info(f"📝 使用项目默认写作风格: {style_id}")
            
            # 获取风格内容
            if style_id:
                style_result = await temp_db.execute(
                    select(WritingStyle).where(WritingStyle.id == style_id)
                )
                style = style_result.scalar_one_or_none()
                if style:
                    # 验证风格是否可用：全局预设风格（user_id为NULL）或者当前用户的自定义风格
                    if style.user_id is None or style.user_id == user_id:
                        style_content = style.prompt_content or ""
                        style_type = "全局预设" if style.user_id is None else "用户自定义"
                        logger.info(f"✅ 使用写作风格: {style.name} ({style_type})")
                    else:
                        logger.warning(f"⚠️ 风格 {style_id} 不属于当前项目，跳过")
                else:
                    logger.warning(f"⚠️ 未找到风格 {style_id}")
            else:
                logger.info("ℹ️ 未指定写作风格，使用默认提示词")

            regeneration_input = await ChapterCreationService(temp_db).prepare(
                chapter=chapter,
                project=project,
                outline=outline,
                user_id=user_id,
                style_id=style_id,
                target_word_count=regenerate_request.target_word_count,
                narrative_perspective=project.narrative_perspective,
                skill_key=None,
            )
            
            # 构建项目上下文
            project_context = {
                'project_title': project.title if project else '未知',
                'genre': project.genre if project else '未设定',
                'theme': project.theme if project else '未设定',
                'narrative_perspective': project.narrative_perspective if project else '第三人称',
                'time_period': project.world_time_period if project else '未设定',
                'location': project.world_location if project else '未设定',
                'atmosphere': project.world_atmosphere if project else '未设定',
                'characters_info': characters_info_with_careers,
                'chapter_outline': outline.content if outline else chapter.summary or '暂无大纲',
                'previous_context': ''  # 可以后续扩展添加前置章节上下文
            }
        finally:
            await temp_db.close()
        break

    regeneration_instructions = ChapterRegenerator(
        user_ai_service
    )._build_modification_instructions(analysis, regenerate_request)
    regeneration_prefix = "\n\n【本章重写任务】\n"
    available_chars = max(
        0,
        MAX_CREATION_INPUT_CHARS
        - len(regeneration_input.prompt)
        - len(regeneration_input.system_prompt or "")
        - len(regeneration_prefix),
    )
    if len(regeneration_instructions) > available_chars:
        regeneration_instructions = (
            regeneration_instructions[: max(0, available_chars - 80)]
            + "\n[修改指令因 35K 输入预算截断]"
        )
    regeneration_prompt = (
        regeneration_input.prompt
        + regeneration_prefix
        + regeneration_instructions
    )
    
    async def event_generator():
        """流式生成事件生成器"""
        db_session = None
        db_committed = False
        generation_lease_owner = None
        
        # 初始化标准进度追踪器
        from app.utils.sse_response import WizardProgressTracker
        tracker = WizardProgressTracker("章节重新生成")
        
        try:
            yield await tracker.start()
            
            # 创建独立数据库会话
            async for db_session in get_db(request):
                yield await tracker.loading("加载章节信息...", 0.5)
                
                # 创建重新生成任务
                regen_task = RegenerationTask(
                    chapter_id=chapter_id,
                    analysis_id=analysis.id if analysis else None,
                    user_id=user_id,
                    project_id=chapter.project_id,
                    modification_instructions="",  # 稍后填充
                    original_suggestions=analysis.suggestions if analysis else None,
                    selected_suggestion_indices=regenerate_request.selected_suggestion_indices,
                    custom_instructions=regenerate_request.custom_instructions,
                    style_id=regenerate_request.style_id,
                    target_word_count=regenerate_request.target_word_count,
                    focus_areas=regenerate_request.focus_areas,
                    preserve_elements=regenerate_request.preserve_elements.model_dump() if regenerate_request.preserve_elements else None,
                    status='running',
                    original_content=chapter.content,
                    original_word_count=chapter.word_count or len(chapter.content),
                    version_note=regenerate_request.version_note,
                    started_at=datetime.now()
                )
                db_session.add(regen_task)
                await db_session.commit()
                await db_session.refresh(regen_task)
                
                task_id = regen_task.id
                generation_lease_owner = (
                    f"chapter-regenerate-generation:{chapter_id}:{task_id}"
                )
                lease_acquired, lease_error = await acquire_generation_lease(
                    db_session,
                    chapter.project_id,
                    generation_lease_owner,
                )
                if not lease_acquired:
                    raise RuntimeError(lease_error)
                logger.info(f"📝 创建重新生成任务: {task_id}")
                
                yield await tracker.preparing("准备重新生成...")
                
                yield await SSEResponse.send_event(
                    event='task_created',
                    data={'task_id': task_id}
                )
                
                # 初始化重新生成器
                regenerator = ChapterRegenerator(user_ai_service)
                
                # === 生成阶段 ===
                full_content = ""
                estimated_total = regenerate_request.target_word_count or len(chapter.content)
                
                yield await tracker.generating(
                    current_chars=0,
                    estimated_total=estimated_total
                )
                
                async for event in regenerator.regenerate_with_feedback(
                    chapter=chapter,
                    analysis=analysis,
                    regenerate_request=regenerate_request,
                    project_context=project_context,
                    style_content=style_content,
                    user_id=user_id,
                    db=db_session,
                    base_prompt=regeneration_prompt,
                    system_prompt=regeneration_input.system_prompt,
                ):
                    # 处理不同类型的事件
                    if event['type'] == 'chunk':
                        # 内容块
                        chunk = event['content']
                        full_content += chunk
                        yield await tracker.generating_chunk(chunk)
                        
                        # 定期更新进度
                        if len(full_content) % 500 == 0:
                            yield await tracker.generating(
                                current_chars=len(full_content),
                                estimated_total=estimated_total,
                                message=f'重新生成中... 已生成 {len(full_content)} 字'
                            )
                    elif event['type'] == 'progress':
                        # 进度更新 - 映射到对应阶段
                        progress = event.get('progress', 0)
                        message = event.get('message', '')
                        if progress < 20:
                            yield await tracker.preparing(message)
                        elif progress < 85:
                            yield await tracker.generating(
                                current_chars=len(full_content),
                                estimated_total=estimated_total,
                                message=message
                            )
                        else:
                            yield await tracker.parsing(message)
                    
                    await asyncio.sleep(0)
                
                # === 保存阶段 ===
                yield await tracker.saving("保存重新生成的内容...", 0.5)
                
                applied_quality_status = None
                analysis_task_id = None
                if regenerate_request.auto_apply:
                    lease_owner = generation_lease_owner
                    lease_acquired, lease_error = await acquire_generation_lease(
                        db_session, chapter.project_id, lease_owner
                    )
                    if not lease_acquired:
                        raise RuntimeError(lease_error)
                    try:
                        project_obj = (
                            await db_session.execute(
                                select(Project).where(Project.id == chapter.project_id)
                            )
                        ).scalar_one_or_none()
                        outline_obj = (
                            await db_session.execute(
                                select(Outline).where(Outline.id == chapter.outline_id)
                            )
                        ).scalar_one_or_none() if chapter.outline_id else None
                        quality_stage_events: list[tuple[str, str]] = []

                        async def _regen_quality_progress(stage: str, message: str) -> None:
                            quality_stage_events.append((stage, message))

                        generated = await ChapterCreationService(
                            db_session
                        ).finalize_generated(
                            chapter=chapter,
                            project=project_obj,
                            outline=outline_obj,
                            prepared=regeneration_input,
                            content=full_content,
                            ai_service=user_ai_service,
                            model=None,
                            progress=_regen_quality_progress,
                        )
                        for stage, message in quality_stage_events:
                            yield await tracker.stage(stage, message, 92)
                        full_content = generated.content
                        await mark_chapter_stale(
                            db_session,
                            chapter,
                            cascade=True,
                            commit=False,
                        )
                        await ChapterCreationService(db_session).save_generated(
                            chapter=chapter,
                            project=project_obj,
                            result=generated,
                            label=f"整章重生成: 第{chapter.chapter_number}章 {chapter.title}",
                        )
                        applied_quality_status = generated.quality_report.status.value
                        logger.info(
                            "整章重生成完成: chapter=%s words=%s quality=%s "
                            "repaired=%s compressed=%s expanded=%s",
                            chapter.chapter_number,
                            visible_char_count(full_content),
                            applied_quality_status,
                            generated.repaired,
                            generated.compressed,
                            generated.expanded,
                        )
                        analysis_task = AnalysisTask(
                            chapter_id=chapter_id,
                            user_id=user_id,
                            project_id=chapter.project_id,
                            status="pending",
                            progress=0,
                        )
                        db_session.add(analysis_task)
                        await db_session.commit()
                        await db_session.refresh(analysis_task)
                        analysis_task_id = analysis_task.id
                        yield await tracker.stage(
                            "tracking",
                            "正文已应用，正在执行章节分析与追踪提交",
                            96,
                        )
                        await analyze_chapter_background(
                            chapter_id=chapter_id,
                            user_id=user_id,
                            project_id=chapter.project_id,
                            task_id=analysis_task.id,
                        )
                    finally:
                        await release_generation_lease(
                            db_session, chapter.project_id, lease_owner
                        )

                # 更新任务状态
                regen_task.status = 'completed'
                regen_task.regenerated_content = full_content
                regen_task.regenerated_word_count = len(full_content)
                regen_task.completed_at = datetime.now()
                
                # 计算差异统计
                diff_stats = regenerator.calculate_content_diff(chapter.content, full_content)
                
                await db_session.commit()
                db_committed = True
                
                yield await tracker.saving("保存完成", 0.9)
                
                # === 完成阶段 ===
                yield await tracker.complete("重新生成完成！")
                
                # 发送结果数据
                yield await tracker.result({
                    'task_id': task_id,
                    'word_count': len(full_content),
                    'version_number': regen_task.version_number,
                    'auto_applied': regenerate_request.auto_apply,
                    'quality_status': applied_quality_status,
                    'analysis_task_id': analysis_task_id,
                    'diff_stats': diff_stats
                })
                
                # 发送完成信号
                yield await tracker.done()
                
                logger.info(f"✅ 章节重新生成完成: {chapter_id}, 任务: {task_id}")
                
                break
        
        except Exception as e:
            logger.error(f"❌ 重新生成失败: {str(e)}", exc_info=True)
            
            # 更新任务状态为失败
            if db_session and not db_committed:
                try:
                    # finalize/compress 失败时，先撤销正文和追踪状态的未提交改动。
                    await db_session.rollback()
                    task_result = await db_session.execute(
                        select(RegenerationTask).where(RegenerationTask.chapter_id == chapter_id)
                        .order_by(RegenerationTask.created_at.desc()).limit(1)
                    )
                    task = task_result.scalar_one_or_none()
                    if task:
                        task.status = 'failed'
                        task.error_message = str(e)[:500]
                        task.completed_at = datetime.now()
                        await db_session.commit()
                except Exception as update_error:
                    logger.error(f"更新任务失败状态失败: {str(update_error)}")
            
            yield await tracker.error(str(e))
        
        finally:
            if db_session:
                try:
                    if generation_lease_owner:
                        await release_generation_lease(
                            db_session,
                            chapter.project_id,
                            generation_lease_owner,
                        )
                    if not db_committed and db_session.in_transaction():
                        await db_session.rollback()
                    await db_session.close()
                except Exception as close_error:
                    logger.error(f"关闭数据库会话失败: {str(close_error)}")
    
    return create_sse_response(event_generator())


@router.get("/{chapter_id}/regeneration/tasks", summary="获取章节的重新生成任务列表")
async def get_regeneration_tasks(
    chapter_id: str,
    request: Request,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db)
):
    """获取指定章节的重新生成任务历史"""
    user_id = getattr(request.state, 'user_id', None)
    
    # 验证章节存在和权限
    chapter_result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = chapter_result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    await verify_project_access(chapter.project_id, user_id, db)
    
    # 获取任务列表
    result = await db.execute(
        select(RegenerationTask)
        .where(RegenerationTask.chapter_id == chapter_id)
        .order_by(RegenerationTask.created_at.desc())
        .limit(limit)
    )
    tasks = result.scalars().all()
    
    return {
        "chapter_id": chapter_id,
        "total": len(tasks),
        "tasks": [
            {
                "task_id": task.id,
                "status": task.status,
                "version_number": task.version_number,
                "version_note": task.version_note,
                "original_word_count": task.original_word_count,
                "regenerated_word_count": task.regenerated_word_count,
                "created_at": task.created_at.isoformat() if task.created_at else None,
                "completed_at": task.completed_at.isoformat() if task.completed_at else None
            }
            for task in tasks
        ]
    }


@router.put("/{chapter_id}/expansion-plan", response_model=dict, summary="更新章节规划信息")
async def update_chapter_expansion_plan(
    chapter_id: str,
    expansion_plan: ExpansionPlanUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    更新章节的展开规划信息和情节概要
    
    Args:
        chapter_id: 章节ID
        expansion_plan: 规划信息更新数据(包含summary和expansion_plan字段)
    
    Returns:
        更新后的章节规划信息
    """
    # 获取章节
    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    # 验证用户权限
    user_id = getattr(request.state, 'user_id', None)
    await verify_project_access(chapter.project_id, user_id, db)
    
    # 准备更新数据(排除None值)
    plan_data = expansion_plan.model_dump(exclude_unset=True, exclude_none=True)
    
    # 分离summary和expansion_plan数据
    summary_value = plan_data.pop('summary', None)
    
    # 更新summary字段(如果提供)
    if summary_value is not None:
        chapter.summary = summary_value
        logger.info(f"更新章节概要: {chapter_id}")
    
    # 更新expansion_plan字段(如果有其他字段)
    if plan_data:
        if chapter.expansion_plan:
            try:
                existing_plan = json.loads(chapter.expansion_plan)
                # 合并更新
                existing_plan.update(plan_data)
                chapter.expansion_plan = json.dumps(existing_plan, ensure_ascii=False)
            except json.JSONDecodeError:
                logger.warning(f"章节 {chapter_id} 的expansion_plan格式错误,将覆盖")
                chapter.expansion_plan = json.dumps(plan_data, ensure_ascii=False)
        else:
            chapter.expansion_plan = json.dumps(plan_data, ensure_ascii=False)
    
    await db.commit()
    await db.refresh(chapter)
    
    logger.info(f"章节规划更新成功: {chapter_id}")
    
    # 返回更新后的规划数据
    updated_plan = json.loads(chapter.expansion_plan) if chapter.expansion_plan else None
    
    return {
        "id": chapter.id,
        "summary": chapter.summary,
        "expansion_plan": updated_plan,
        "message": "规划信息更新成功"
    }


# ==================== 局部重写相关API ====================

@router.post("/{chapter_id}/partial-regenerate-stream", summary="流式局部重写选中内容")
async def partial_regenerate_stream(
    chapter_id: str,
    request: Request,
    partial_request: PartialRegenerateRequest,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service)
):
    """
    对章节中选中的部分内容进行流式重写
    
    工作流程：
    1. 验证章节和选中内容的有效性
    2. 截取上下文（前后文）
    3. 根据用户要求构建提示词
    4. 流式生成重写内容
    5. 返回重写结果（不自动保存，由前端决定是否应用）
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    
    # 验证章节存在
    chapter_result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = chapter_result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    if not chapter.content or chapter.content.strip() == "":
        raise HTTPException(status_code=400, detail="章节内容为空")
    
    # 验证用户权限
    await verify_project_access(chapter.project_id, user_id, db)
    
    # 验证位置参数
    content_length = len(chapter.content)
    if partial_request.start_position >= content_length:
        raise HTTPException(status_code=400, detail="起始位置超出内容范围")
    if partial_request.end_position > content_length:
        raise HTTPException(status_code=400, detail="结束位置超出内容范围")
    if partial_request.start_position >= partial_request.end_position:
        raise HTTPException(status_code=400, detail="起始位置必须小于结束位置")
    
    # 验证选中的文本是否匹配
    actual_selected = chapter.content[partial_request.start_position:partial_request.end_position]
    if actual_selected != partial_request.selected_text:
        # 位置可能有偏差，尝试在附近查找
        search_start = max(0, partial_request.start_position - 50)
        search_end = min(content_length, partial_request.end_position + 50)
        search_area = chapter.content[search_start:search_end]
        
        if partial_request.selected_text in search_area:
            # 找到了，更新位置
            offset = search_area.find(partial_request.selected_text)
            partial_request.start_position = search_start + offset
            partial_request.end_position = partial_request.start_position + len(partial_request.selected_text)
            logger.info(f"⚠️ 选中文本位置校正: {partial_request.start_position}-{partial_request.end_position}")
        else:
            raise HTTPException(
                status_code=400,
                detail="选中的文本与章节内容不匹配，请刷新页面后重试"
            )
    
    # 预先获取项目信息和写作风格
    project_result = await db.execute(
        select(Project).where(Project.id == chapter.project_id)
    )
    project = project_result.scalar_one_or_none()
    
    # 获取写作风格
    style_content = ""
    style_id = partial_request.style_id
    
    # 如果没有指定风格，尝试使用项目的默认风格
    if not style_id:
        from app.models.project_default_style import ProjectDefaultStyle
        default_style_result = await db.execute(
            select(ProjectDefaultStyle.style_id)
            .where(ProjectDefaultStyle.project_id == chapter.project_id)
        )
        default_style_id = default_style_result.scalar_one_or_none()
        if default_style_id:
            style_id = default_style_id
            logger.info(f"📝 局部重写 - 使用项目默认写作风格: {style_id}")
    
    # 获取风格内容
    if style_id:
        style_result = await db.execute(
            select(WritingStyle).where(WritingStyle.id == style_id)
        )
        style = style_result.scalar_one_or_none()
        if style:
            if style.user_id is None or style.user_id == user_id:
                style_content = style.prompt_content or ""
                style_type = "全局预设" if style.user_id is None else "用户自定义"
                logger.info(f"✅ 局部重写 - 使用写作风格: {style.name} ({style_type})")
            else:
                logger.warning(f"⚠️ 风格 {style_id} 不属于当前用户，跳过")
    
    async def event_generator():
        """流式生成事件生成器"""
        from app.utils.sse_response import WizardProgressTracker
        tracker = WizardProgressTracker("局部重写")
        
        try:
            yield await tracker.start()
            yield await tracker.loading("准备重写上下文...", 0.3)
            
            # 截取上下文
            context_chars = partial_request.context_chars
            start_pos = partial_request.start_position
            end_pos = partial_request.end_position
            
            # 前文：从start_pos往前截取context_chars个字符
            context_before_start = max(0, start_pos - context_chars)
            context_before = chapter.content[context_before_start:start_pos]
            
            # 后文：从end_pos往后截取context_chars个字符
            context_after_end = min(content_length, end_pos + context_chars)
            context_after = chapter.content[end_pos:context_after_end]
            
            # 原文
            original_text = partial_request.selected_text
            original_word_count = len(original_text)
            
            logger.info(f"📝 局部重写 - 原文: {original_word_count}字, 前文: {len(context_before)}字, 后文: {len(context_after)}字")
            
            yield await tracker.loading("构建提示词...", 0.5)
            
            # 构建字数要求
            length_requirement = ""
            if partial_request.length_mode == "similar":
                min_words = int(original_word_count * 0.8)
                max_words = int(original_word_count * 1.2)
                length_requirement = f"保持与原文相近的字数（约{original_word_count}字，允许{min_words}-{max_words}字浮动）"
            elif partial_request.length_mode == "expand":
                min_words = int(original_word_count * 1.2)
                max_words = int(original_word_count * 2.0)
                length_requirement = f"适当扩展内容（目标{min_words}-{max_words}字）"
            elif partial_request.length_mode == "condense":
                min_words = int(original_word_count * 0.5)
                max_words = int(original_word_count * 0.8)
                length_requirement = f"精简压缩内容（目标{min_words}-{max_words}字）"
            elif partial_request.length_mode == "custom" and partial_request.target_word_count:
                length_requirement = f"目标字数：约{partial_request.target_word_count}字（允许±20%浮动）"
            else:
                length_requirement = f"保持与原文相近的字数（约{original_word_count}字）"
            
            # 获取提示词模板
            template = await PromptService.get_template("PARTIAL_REGENERATE", user_id, db)
            if not template:
                template = PromptService.PARTIAL_REGENERATE
            
            # 构建提示词
            prompt = PromptService.format_prompt(
                template,
                context_before=context_before if context_before else "（这是章节开头）",
                original_word_count=original_word_count,
                selected_text=original_text,
                context_after=context_after if context_after else "（这是章节结尾）",
                user_instructions=partial_request.user_instructions,
                length_requirement=length_requirement,
                style_content=style_content if style_content else "保持与原文一致的叙事风格"
            )
            
            yield await tracker.preparing("开始生成...")
            
            # 计算 max_tokens
            if partial_request.length_mode == "expand":
                target_words = int(original_word_count * 2.0)
            elif partial_request.length_mode == "custom" and partial_request.target_word_count:
                target_words = partial_request.target_word_count
            else:
                target_words = int(original_word_count * 1.5)
            
            # 输出预算按目标字数动态计算，并为推理模型的思考预留空间。
            # 1000 字重写时约 7096 token，上限 20000 可覆盖约 5000 字以内的局部重写。
            calculated_max_tokens = max(2000, min(int(target_words * 3) + 4096, 20000))
            
            # 流式生成
            full_content = ""
            chunk_count = 0
            
            yield await tracker.generating(
                current_chars=0,
                estimated_total=target_words
            )

            # 仅在尚未输出任何正文时自动重试；已有正文时保留内容，避免重复和丢失。
            max_attempts = 3
            for attempt in range(1, max_attempts + 1):
                try:
                    async for chunk in user_ai_service.generate_text_stream(
                        prompt=prompt,
                        max_tokens=calculated_max_tokens,
                    ):
                        full_content += chunk
                        chunk_count += 1

                        yield await tracker.generating_chunk(chunk)

                        if chunk_count % 5 == 0:
                            yield await tracker.generating(
                                current_chars=len(full_content),
                                estimated_total=target_words,
                                message=f'正在重写中... 已生成 {len(full_content)} 字'
                            )

                        await asyncio.sleep(0)
                    break
                except asyncio.CancelledError:
                    raise
                except (httpx.TransportError, httpx.TimeoutException) as stream_error:
                    if full_content.strip():
                        raise RuntimeError(
                            f"AI 输出中断（已生成 {len(full_content.strip())} 字），请重试"
                        ) from stream_error
                    if attempt >= max_attempts:
                        raise RuntimeError(
                            "AI 服务连续中断，未生成任何内容，请稍后重试"
                        ) from stream_error
                    wait_time = 2 ** attempt
                    logger.warning(
                        f"⚠️ 局部重写流式连接中断，{wait_time}秒后重试 "
                        f"({attempt}/{max_attempts - 1}): {stream_error}"
                    )
                    yield await tracker.generating(
                        current_chars=0,
                        estimated_total=target_words,
                        message=f'连接中断，{wait_time} 秒后重试...'
                    )
                    await asyncio.sleep(wait_time)
            
            # 清理输出（移除可能的前后缀）
            full_content = full_content.strip()
            
            # 移除常见的AI输出前缀
            prefixes_to_remove = [
                "重写后：", "重写后:", "改写后：", "改写后:",
                "以下是重写后的内容：", "以下是重写后的内容:",
                "重写内容：", "重写内容:"
            ]
            for prefix in prefixes_to_remove:
                if full_content.startswith(prefix):
                    full_content = full_content[len(prefix):].strip()
                    break
            
            # 移除首尾可能的引号
            if (full_content.startswith('"') and full_content.endswith('"')) or \
               (full_content.startswith("'") and full_content.endswith("'")):
                full_content = full_content[1:-1]
            if (full_content.startswith('「') and full_content.endswith('」')) or \
               (full_content.startswith('『') and full_content.endswith('』')):
                full_content = full_content[1:-1]
            
            new_word_count = len(full_content)

            if not full_content:
                raise RuntimeError(
                    "AI 未返回重写正文（可能把全部输出用于思考）。本次结果未应用，请重试或更换模型"
                )
            
            logger.info(f"✅ 局部重写完成: 原文{original_word_count}字 -> 新文{new_word_count}字")
            
            # 完成
            yield await tracker.complete("重写完成！")
            
            # 发送结果数据
            yield await tracker.result({
                'new_text': full_content,
                'word_count': new_word_count,
                'original_word_count': original_word_count,
                'start_position': partial_request.start_position,
                'end_position': partial_request.end_position
            })
            
            yield await tracker.done()
            
        except Exception as e:
            logger.error(f"❌ 局部重写失败: {str(e)}", exc_info=True)
            yield await tracker.error(str(e))
    
    return create_sse_response(event_generator())


@router.post("/{chapter_id}/apply-partial-regenerate", summary="应用局部重写结果")
async def apply_partial_regenerate(
    chapter_id: str,
    request: Request,
    apply_request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    将局部重写的结果应用到章节内容中
    
    请求体：
    - new_text: 重写后的新内容
    - start_position: 原文起始位置
    - end_position: 原文结束位置
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    
    # 验证章节存在
    chapter_result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )
    chapter = chapter_result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    
    # 验证用户权限
    await verify_project_access(chapter.project_id, user_id, db)
    
    # 获取参数
    new_text = apply_request.get('new_text', '')
    start_position = apply_request.get('start_position', 0)
    end_position = apply_request.get('end_position', 0)
    
    if not new_text:
        raise HTTPException(status_code=400, detail="新内容不能为空")
    
    # 验证位置有效性
    content_length = len(chapter.content)
    if start_position < 0 or end_position > content_length or start_position >= end_position:
        raise HTTPException(status_code=400, detail="位置参数无效")
    
    # 构建新内容
    old_word_count = chapter.word_count or 0
    new_content = chapter.content[:start_position] + new_text + chapter.content[end_position:]
    new_word_count = visible_char_count(new_content)
    
    # 更新章节
    chapter.content = new_content
    chapter.word_count = new_word_count
    
    # 更新项目字数
    project_result = await db.execute(
        select(Project).where(Project.id == chapter.project_id)
    )
    project = project_result.scalar_one_or_none()
    if project:
        project.current_words = max(
            0,
            (project.current_words or 0) - old_word_count + new_word_count,
        )
    
    await db.commit()
    await db.refresh(chapter)
    await mark_chapter_stale(db, chapter, cascade=True)
    
    logger.info(f"✅ 局部重写已应用: 章节{chapter_id}, {old_word_count}字 -> {new_word_count}字")
    
    return {
        "success": True,
        "chapter_id": chapter_id,
        "word_count": new_word_count,
        "old_word_count": old_word_count,
        "quality_status": chapter.quality_status,
        "tracking_status": chapter.tracking_status,
        "message": "局部重写已应用"
    }

