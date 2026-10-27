"""管理员作品审阅 API（只读）

这些端点有意绕开 `verify_project_access`：
- 后者以 `Project.user_id == user_id` 硬隔离，改造它等于给全站写端点开后门。
- 本模块只提供 SELECT，且入口依赖 `require_admin`，不提供任何写操作。
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.settings import require_login
from app.database import get_db
from app.logger import get_logger
from app.models.admin_access_log import AdminAccessLog
from app.models.chapter import Chapter
from app.models.project import Project
from app.user_manager import User, user_manager

logger = get_logger(__name__)

router = APIRouter(prefix="/admin", tags=["管理员-作品审阅"])

AUDIT_DEDUPE_SECONDS = 60


def require_admin(user: User = Depends(require_login)) -> User:
    """依赖：要求管理员权限（本模块独立文案，避免复用系统设置提示）"""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="仅管理员可访问管理后台")
    return user


def _client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:100]
    return request.client.host if request.client else None


async def _record_project_view(
    *,
    db: AsyncSession,
    request: Request,
    admin: User,
    project: Project,
) -> None:
    """写入项目级审计记录；同一管理员在 60 秒内重复打开同一项目时去重。"""
    # 显式写入本地时间：数据库的 CURRENT_TIMESTAMP 在 SQLite 下是 UTC，
    # 与本进程的 datetime.now() 相差 8 小时会让去重窗口永远匹配不上。
    now = datetime.now()
    since = now - timedelta(seconds=AUDIT_DEDUPE_SECONDS)
    recent_result = await db.execute(
        select(AdminAccessLog.id).where(
            AdminAccessLog.admin_id == admin.user_id,
            AdminAccessLog.project_id == project.id,
            AdminAccessLog.created_at >= since,
        ).limit(1)
    )
    if recent_result.scalar_one_or_none():
        return

    target_user = await user_manager.get_user(project.user_id)
    log = AdminAccessLog(
        admin_id=admin.user_id,
        admin_name=admin.display_name or admin.username,
        target_user_id=project.user_id,
        target_username=(
            (target_user.display_name or target_user.username) if target_user else None
        ),
        project_id=project.id,
        project_title=project.title,
        action="view_project",
        ip=_client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:1000] or None,
        created_at=now,
    )
    db.add(log)
    await db.commit()
    logger.info(
        f"管理员 {admin.user_id} 查阅用户 {project.user_id} 的项目 {project.id}"
    )


def _pagination_offset(page: int, limit: int) -> tuple[int, int]:
    return (max(page, 1) - 1) * max(limit, 1), max(limit, 1)


@router.get("/users/{user_id}/projects", summary="管理员查看指定用户的项目列表")
async def list_user_projects(
    user_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    q: Optional[str] = Query(None, max_length=100),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """按用户查看项目元信息，不含任何正文内容。"""
    target_user = await user_manager.get_user(user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    conditions = [Project.user_id == user_id]
    if q and q.strip():
        conditions.append(Project.title.ilike(f"%{q.strip()}%"))

    total = (
        await db.execute(select(func.count(Project.id)).where(*conditions))
    ).scalar_one()

    offset, page_limit = _pagination_offset(page, limit)
    projects = (
        await db.execute(
            select(Project)
            .where(*conditions)
            .order_by(Project.updated_at.desc())
            .offset(offset)
            .limit(page_limit)
        )
    ).scalars().all()

    chapter_stats: dict[str, int] = {}
    if projects:
        stats_result = await db.execute(
            select(Chapter.project_id, func.count(Chapter.id))
            .where(Chapter.project_id.in_([p.id for p in projects]))
            .group_by(Chapter.project_id)
        )
        chapter_stats = {row[0]: row[1] for row in stats_result.all()}

    items = [
        {
            "id": project.id,
            "title": project.title,
            "genre": project.genre,
            "status": project.status,
            "chapter_count": chapter_stats.get(project.id, 0),
            "current_words": project.current_words or 0,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
        }
        for project in projects
    ]

    return {
        "total": total,
        "page": page,
        "limit": page_limit,
        "user": {
            "user_id": target_user.user_id,
            "username": target_user.username,
            "display_name": target_user.display_name,
        },
        "items": items,
    }


@router.get("/projects/{project_id}", summary="管理员查看项目详情（写入审计）")
async def get_project_detail(
    project_id: str,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """返回项目元信息与归属用户；成功返回前必须写入审计记录。"""
    project = (
        await db.execute(select(Project).where(Project.id == project_id))
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    try:
        await _record_project_view(db=db, request=request, admin=admin, project=project)
    except Exception as exc:  # 审计失败即拒绝返回内容
        logger.error(f"写入审计记录失败: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="审计记录写入失败，已阻止本次查阅")

    target_user = await user_manager.get_user(project.user_id)
    chapter_count = (
        await db.execute(
            select(func.count(Chapter.id)).where(Chapter.project_id == project.id)
        )
    ).scalar_one()

    return {
        "id": project.id,
        "title": project.title,
        "description": project.description,
        "genre": project.genre,
        "theme": project.theme,
        "status": project.status,
        "chapter_count": chapter_count,
        "current_words": project.current_words or 0,
        "target_words": project.target_words or 0,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "owner": {
            "user_id": project.user_id,
            "username": target_user.username if target_user else None,
            "display_name": target_user.display_name if target_user else None,
        },
    }


@router.get("/projects/{project_id}/chapters", summary="管理员查看项目章节列表")
async def list_project_chapters(
    project_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """只返回章节标题与元信息，不含正文。"""
    project_exists = (
        await db.execute(select(Project.id).where(Project.id == project_id))
    ).scalar_one_or_none()
    if not project_exists:
        raise HTTPException(status_code=404, detail="项目不存在")

    # 显式只取列表所需字段：章节正文可能很大，列表接口不应把它读进内存
    rows = (
        await db.execute(
            select(
                Chapter.id,
                Chapter.chapter_number,
                Chapter.title,
                Chapter.word_count,
                Chapter.status,
                Chapter.updated_at,
            )
            .where(Chapter.project_id == project_id)
            .order_by(Chapter.chapter_number.asc())
        )
    ).all()

    return {
        "total": len(rows),
        "items": [
            {
                "id": row.id,
                "chapter_number": row.chapter_number,
                "title": row.title,
                "word_count": row.word_count or 0,
                "status": row.status,
                "updated_at": row.updated_at,
            }
            for row in rows
        ],
    }


@router.get("/chapters/{chapter_id}", summary="管理员查看单章正文")
async def get_chapter_detail(
    chapter_id: str,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """只读返回章节正文。

    正文端点同样补一条项目级审计：从审阅页进入时会被 60 秒去重吸收，
    但直接调用本接口绕过项目详情时依然留痕。
    """
    chapter = (
        await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    ).scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    project = (
        await db.execute(select(Project).where(Project.id == chapter.project_id))
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    try:
        await _record_project_view(db=db, request=request, admin=admin, project=project)
    except Exception as exc:  # 审计失败即拒绝返回内容
        logger.error(f"写入章节审计记录失败: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="审计记录写入失败，已阻止本次查阅")

    return {
        "id": chapter.id,
        "project_id": chapter.project_id,
        "chapter_number": chapter.chapter_number,
        "title": chapter.title,
        "content": chapter.content or "",
        "word_count": chapter.word_count or 0,
        "status": chapter.status,
        "updated_at": chapter.updated_at,
    }


@router.get("/audit-logs", summary="管理员查看审阅审计日志")
async def list_audit_logs(
    admin_id: Optional[str] = Query(None, max_length=100),
    target_user_id: Optional[str] = Query(None, max_length=100),
    project_id: Optional[str] = Query(None, max_length=36),
    project_q: Optional[str] = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """按时间倒序返回审计记录。

    `project_id` 精确匹配；`project_q` 同时匹配项目标题与项目 ID 前缀，
    这样即使项目已被删除、只剩标题快照也能查到。
    """
    conditions = []
    if admin_id:
        conditions.append(AdminAccessLog.admin_id == admin_id)
    if target_user_id:
        conditions.append(AdminAccessLog.target_user_id == target_user_id)
    if project_id:
        conditions.append(AdminAccessLog.project_id == project_id)
    if project_q and project_q.strip():
        keyword = project_q.strip()
        conditions.append(
            or_(
                AdminAccessLog.project_title.ilike(f"%{keyword}%"),
                AdminAccessLog.project_id.ilike(f"{keyword}%"),
            )
        )

    count_stmt = select(func.count(AdminAccessLog.id))
    if conditions:
        count_stmt = count_stmt.where(*conditions)
    total = (await db.execute(count_stmt)).scalar_one()

    offset, page_limit = _pagination_offset(page, limit)
    stmt = select(AdminAccessLog)
    if conditions:
        stmt = stmt.where(*conditions)
    stmt = (
        stmt.order_by(AdminAccessLog.created_at.desc(), AdminAccessLog.id.desc())
        .offset(offset)
        .limit(page_limit)
    )
    logs = (await db.execute(stmt)).scalars().all()

    return {
        "total": total,
        "page": page,
        "limit": page_limit,
        "items": [
            {
                "id": log.id,
                "admin_id": log.admin_id,
                "admin_name": log.admin_name,
                "target_user_id": log.target_user_id,
                "target_username": log.target_username,
                "project_id": log.project_id,
                "project_title": log.project_title,
                "action": log.action,
                "ip": log.ip,
                "created_at": log.created_at,
            }
            for log in logs
        ],
    }
