"""管理员邀请码管理 API"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import get_engine
from app.logger import get_logger
from app.models.invite_code import InviteCode
from app.models.user import User
from app.services.invite_code_service import (
    format_invite_code,
    generate_invite_code,
    normalize_invite_code,
)

router = APIRouter(prefix="/admin/invites", tags=["邀请码管理"])
logger = get_logger(__name__)

class InviteCodeCreateRequest(BaseModel):
    """批量创建邀请码请求"""
    count: int = Field(default=1, ge=1, le=50, description="创建数量")
    note: Optional[str] = Field(default=None, max_length=200, description="管理员备注")


class InviteCodeToggleRequest(BaseModel):
    """启用或禁用邀请码请求"""
    is_disabled: bool


class InviteCodeItem(BaseModel):
    """邀请码响应"""
    id: str
    code: str
    note: Optional[str]
    created_by_user_id: str
    created_by_username: Optional[str]
    created_at: datetime
    is_used: bool
    used_at: Optional[datetime]
    used_by_user_id: Optional[str]
    used_by_username: Optional[str]
    is_disabled: bool
    disabled_at: Optional[datetime]
    disabled_by_user_id: Optional[str]
    disabled_by_username: Optional[str]


class InviteCodeSummary(BaseModel):
    """邀请码汇总"""
    total: int
    unused: int
    used: int
    disabled: int


class InviteCodeListResponse(BaseModel):
    """邀请码分页响应"""
    items: list[InviteCodeItem]
    total: int
    page: int
    limit: int
    summary: InviteCodeSummary


async def check_admin(request: Request) -> User:
    """检查管理员权限"""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


async def _get_global_session() -> AsyncSession:
    engine = await get_engine("_global_users_")
    session_maker = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    return session_maker()


def _to_item(record: InviteCode) -> InviteCodeItem:
    return InviteCodeItem(
        id=record.id,
        code=format_invite_code(record.code),
        note=record.note,
        created_by_user_id=record.created_by_user_id,
        created_by_username=record.created_by_username,
        created_at=record.created_at,
        is_used=record.used_at is not None,
        used_at=record.used_at,
        used_by_user_id=record.used_by_user_id,
        used_by_username=record.used_by_username,
        is_disabled=record.disabled_at is not None,
        disabled_at=record.disabled_at,
        disabled_by_user_id=record.disabled_by_user_id,
        disabled_by_username=record.disabled_by_username,
    )


@router.get("", response_model=InviteCodeListResponse)
async def list_invite_codes(
    status: str = Query(default="all", pattern="^(all|unused|used|disabled)$"),
    q: Optional[str] = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    admin: User = Depends(check_admin),
):
    """获取邀请码列表及使用情况。"""
    filters = []
    if status == "used":
        filters.append(InviteCode.used_at.is_not(None))
    elif status == "unused":
        filters.append(InviteCode.used_at.is_(None))
        filters.append(InviteCode.disabled_at.is_(None))
    elif status == "disabled":
        filters.append(InviteCode.disabled_at.is_not(None))

    keyword = (q or "").strip()
    if keyword:
        canonical_keyword = normalize_invite_code(keyword) or keyword
        like_value = f"%{canonical_keyword}%"
        filters.append(
            or_(
                InviteCode.code.ilike(like_value),
                InviteCode.note.ilike(like_value),
                InviteCode.used_by_username.ilike(like_value),
            )
        )

    async with await _get_global_session() as session:
        total_result = await session.execute(
            select(func.count()).select_from(InviteCode).where(*filters)
        )
        total = int(total_result.scalar_one() or 0)

        result = await session.execute(
            select(InviteCode)
            .where(*filters)
            .order_by(InviteCode.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
        records = result.scalars().all()

        summary_total_result = await session.execute(
            select(func.count()).select_from(InviteCode)
        )
        summary_used_result = await session.execute(
            select(func.count())
            .select_from(InviteCode)
            .where(InviteCode.used_at.is_not(None))
        )
        summary_disabled_result = await session.execute(
            select(func.count())
            .select_from(InviteCode)
            .where(InviteCode.disabled_at.is_not(None))
        )
        summary_total = int(summary_total_result.scalar_one() or 0)
        summary_used = int(summary_used_result.scalar_one() or 0)
        summary_disabled = int(summary_disabled_result.scalar_one() or 0)

    logger.info(f"管理员 {admin.user_id} 获取邀请码列表，筛选总数 {total}")
    return InviteCodeListResponse(
        items=[_to_item(record) for record in records],
        total=total,
        page=page,
        limit=limit,
        summary=InviteCodeSummary(
            total=summary_total,
            unused=max(summary_total - summary_used - summary_disabled, 0),
            used=summary_used,
            disabled=summary_disabled,
        ),
    )


@router.post("", response_model=list[InviteCodeItem])
async def create_invite_codes(
    data: InviteCodeCreateRequest,
    admin: User = Depends(check_admin),
):
    """批量创建一次性邀请码。"""
    note = (data.note or "").strip() or None
    now = datetime.now()

    async with await _get_global_session() as session:
        generated: set[str] = set()
        while len(generated) < data.count:
            candidate = generate_invite_code()
            if candidate in generated:
                continue
            exists_result = await session.execute(
                select(InviteCode.id).where(InviteCode.code == candidate)
            )
            if exists_result.scalar_one_or_none() is None:
                generated.add(candidate)

        records = [
            InviteCode(
                id=str(uuid.uuid4()),
                code=code,
                note=note,
                created_by_user_id=admin.user_id,
                created_by_username=admin.username,
                created_at=now,
            )
            for code in sorted(generated)
        ]
        session.add_all(records)
        await session.commit()

    logger.info(f"管理员 {admin.user_id} 创建了 {len(records)} 个邀请码")
    return [_to_item(record) for record in records]


@router.post("/{invite_id}/toggle-status", response_model=InviteCodeItem)
async def toggle_invite_code_status(
    invite_id: str,
    data: InviteCodeToggleRequest,
    admin: User = Depends(check_admin),
):
    """禁用或重新启用一个尚未使用的邀请码。"""
    async with await _get_global_session() as session:
        result = await session.execute(
            select(InviteCode).where(InviteCode.id == invite_id)
        )
        invite = result.scalar_one_or_none()
        if not invite:
            raise HTTPException(status_code=404, detail="邀请码不存在")
        if invite.used_at is not None:
            raise HTTPException(status_code=400, detail="已使用的邀请码不能禁用")

        if data.is_disabled:
            invite.disabled_at = datetime.now()
            invite.disabled_by_user_id = admin.user_id
            invite.disabled_by_username = admin.username
        else:
            invite.disabled_at = None
            invite.disabled_by_user_id = None
            invite.disabled_by_username = None

        await session.commit()
        await session.refresh(invite)

    action = "禁用" if data.is_disabled else "启用"
    logger.info(f"管理员 {admin.user_id} {action}了邀请码 {invite.code[:4]}****")
    return _to_item(invite)


@router.delete("/{invite_id}")
async def delete_invite_code(
    invite_id: str,
    admin: User = Depends(check_admin),
):
    """永久删除邀请码，删除后该邀请码立即不可使用。"""
    async with await _get_global_session() as session:
        result = await session.execute(
            select(InviteCode).where(InviteCode.id == invite_id)
        )
        invite = result.scalar_one_or_none()
        if not invite:
            raise HTTPException(status_code=404, detail="邀请码不存在")

        code_prefix = invite.code[:4]
        await session.delete(invite)
        await session.commit()

    logger.info(f"管理员 {admin.user_id} 删除了邀请码 {code_prefix}****")
    return {
        "success": True,
        "message": "邀请码已删除，且不能再用于注册",
    }
