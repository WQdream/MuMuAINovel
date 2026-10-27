"""公共 API 配置的调用额度校验与计数。"""
from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncIterator, Dict, Optional
import uuid
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import case, delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.logger import get_logger
from app.models.api_usage import ApiUsageCounter

logger = get_logger(__name__)

CONFIG_TYPE_TEXT = "text"
CONFIG_TYPE_IMAGE = "image"
SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")


@dataclass(frozen=True)
class QuotaStatus:
    daily_limit: Optional[int]
    total_limit: Optional[int]
    daily_used: int
    total_used: int

    @property
    def daily_remaining(self) -> Optional[int]:
        if self.daily_limit is None:
            return None
        return max(0, self.daily_limit - self.daily_used)

    @property
    def total_remaining(self) -> Optional[int]:
        if self.total_limit is None:
            return None
        return max(0, self.total_limit - self.total_used)

    @property
    def is_exhausted(self) -> bool:
        return (
            self.daily_remaining is not None and self.daily_remaining <= 0
        ) or (
            self.total_remaining is not None and self.total_remaining <= 0
        )


def _today() -> str:
    """额度按北京时间自然日重置，不受服务器时区设置影响。"""
    return datetime.now(SHANGHAI_TZ).date().isoformat()


def normalize_limit(value: Optional[int]) -> Optional[int]:
    """0 或空值表示不限制；负数在 API 层已经拦截。"""
    if value is None or value <= 0:
        return None
    return value


@asynccontextmanager
async def _dedicated_session(db: AsyncSession) -> AsyncIterator[AsyncSession]:
    """额度计数使用独立事务，避免 AI 调用失败回滚或端点提交牵连计数。"""
    bind = db.bind
    if bind is None:
        yield db
        return

    session_factory = async_sessionmaker(bind, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


def _limits(daily_limit: Optional[int], total_limit: Optional[int]) -> tuple:
    return normalize_limit(daily_limit), normalize_limit(total_limit)


async def get_quota_status(
    db: AsyncSession,
    *,
    user_id: str,
    config_type: str,
    config_id: str,
    daily_limit: Optional[int],
    total_limit: Optional[int],
) -> QuotaStatus:
    """读取只读额度状态，用于卡片展示与预检。"""
    daily_limit, total_limit = _limits(daily_limit, total_limit)
    if daily_limit is None and total_limit is None:
        return QuotaStatus(None, None, 0, 0)

    result = await db.execute(
        select(ApiUsageCounter).where(
            ApiUsageCounter.user_id == user_id,
            ApiUsageCounter.config_type == config_type,
            ApiUsageCounter.config_id == config_id,
        )
    )
    counter = result.scalar_one_or_none()
    return _status_from_counter(
        counter,
        daily_limit=daily_limit,
        total_limit=total_limit,
    )


def _status_from_counter(
    counter: Optional[ApiUsageCounter],
    *,
    daily_limit: Optional[int],
    total_limit: Optional[int],
) -> QuotaStatus:
    today = _today()
    return QuotaStatus(
        daily_limit=daily_limit,
        total_limit=total_limit,
        daily_used=(
            (counter.daily_calls or 0)
            if counter and counter.usage_date == today
            else 0
        ),
        total_used=(counter.total_calls or 0) if counter else 0,
    )


async def consume_quota(
    db: AsyncSession,
    *,
    user_id: str,
    config_type: str,
    config_id: str,
    config_name: str,
    daily_limit: Optional[int],
    total_limit: Optional[int],
) -> QuotaStatus:
    """原子地占用一次额度；调用失败时应由 `refund_quota` 归还。"""
    daily_limit, total_limit = _limits(daily_limit, total_limit)
    if daily_limit is None and total_limit is None:
        return QuotaStatus(None, None, 0, 0)

    today = _today()
    async with _dedicated_session(db) as quota_db:
        result = await quota_db.execute(
            select(ApiUsageCounter).where(
                ApiUsageCounter.user_id == user_id,
                ApiUsageCounter.config_type == config_type,
                ApiUsageCounter.config_id == config_id,
            )
        )
        counter = result.scalar_one_or_none()

        if counter is None:
            counter = ApiUsageCounter(
                id=str(uuid.uuid4()),
                user_id=user_id,
                config_type=config_type,
                config_id=config_id,
                usage_date=today,
                daily_calls=0,
                total_calls=0,
            )
            quota_db.add(counter)
            try:
                await quota_db.flush()
            except IntegrityError:
                # 并发首次调用：另一请求已创建计数行，回滚后走原子更新
                await quota_db.rollback()
                result = await quota_db.execute(
                    select(ApiUsageCounter).where(
                        ApiUsageCounter.user_id == user_id,
                        ApiUsageCounter.config_type == config_type,
                        ApiUsageCounter.config_id == config_id,
                    )
                )
                counter = result.scalar_one()

        update_stmt = (
            update(ApiUsageCounter)
            .where(ApiUsageCounter.id == counter.id)
            .values(
                daily_calls=case(
                    (ApiUsageCounter.usage_date == today, ApiUsageCounter.daily_calls + 1),
                    else_=1,
                ),
                total_calls=ApiUsageCounter.total_calls + 1,
                usage_date=today,
            )
        )
        if daily_limit is not None:
            update_stmt = update_stmt.where(
                (ApiUsageCounter.usage_date != today)
                | (ApiUsageCounter.daily_calls < daily_limit)
            )
        if total_limit is not None:
            update_stmt = update_stmt.where(ApiUsageCounter.total_calls < total_limit)
        update_stmt = update_stmt.execution_options(synchronize_session=False)

        update_result = await quota_db.execute(update_stmt)
        if update_result.rowcount != 1:
            await quota_db.rollback()
            status = await _get_status_in_session(
                quota_db,
                user_id=user_id,
                config_type=config_type,
                config_id=config_id,
                daily_limit=daily_limit,
                total_limit=total_limit,
            )
            raise HTTPException(
                status_code=429,
                detail=_quota_error_message(status, config_name),
            )

        await quota_db.commit()
        status = await _get_status_in_session(
            quota_db,
            user_id=user_id,
            config_type=config_type,
            config_id=config_id,
            daily_limit=daily_limit,
            total_limit=total_limit,
        )
        logger.info(
            "公共配置额度占用: user=%s type=%s config=%s daily=%s/%s total=%s/%s",
            user_id,
            config_type,
            config_id,
            status.daily_used,
            status.daily_limit,
            status.total_used,
            status.total_limit,
        )
        return status


async def _get_status_in_session(
    db: AsyncSession,
    *,
    user_id: str,
    config_type: str,
    config_id: str,
    daily_limit: Optional[int],
    total_limit: Optional[int],
) -> QuotaStatus:
    result = await db.execute(
        select(ApiUsageCounter).where(
            ApiUsageCounter.user_id == user_id,
            ApiUsageCounter.config_type == config_type,
            ApiUsageCounter.config_id == config_id,
        )
    )
    return _status_from_counter(
        result.scalar_one_or_none(),
        daily_limit=daily_limit,
        total_limit=total_limit,
    )


async def refund_quota(
    db: AsyncSession,
    *,
    user_id: str,
    config_type: str,
    config_id: str,
) -> None:
    """上游调用失败时归还刚占用的次数，避免把网络错误计入用户额度。"""
    today = _today()
    async with _dedicated_session(db) as quota_db:
        result = await quota_db.execute(
            select(ApiUsageCounter).where(
                ApiUsageCounter.user_id == user_id,
                ApiUsageCounter.config_type == config_type,
                ApiUsageCounter.config_id == config_id,
            )
        )
        counter = result.scalar_one_or_none()
        if counter is None:
            return

        values: Dict[str, object] = {
            "total_calls": case(
                (ApiUsageCounter.total_calls > 0, ApiUsageCounter.total_calls - 1),
                else_=0,
            ),
        }
        if counter.usage_date == today:
            values["daily_calls"] = case(
                (ApiUsageCounter.daily_calls > 0, ApiUsageCounter.daily_calls - 1),
                else_=0,
            )

        await quota_db.execute(
            update(ApiUsageCounter)
            .where(ApiUsageCounter.id == counter.id)
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        await quota_db.execute(
            delete(ApiUsageCounter).where(
                ApiUsageCounter.id == counter.id,
                ApiUsageCounter.total_calls <= 0,
            )
        )
        await quota_db.commit()
    logger.info(
        "公共配置额度已归还: user=%s type=%s config=%s",
        user_id,
        config_type,
        config_id,
    )


def _quota_error_message(status: QuotaStatus, config_name: str) -> str:
    if status.daily_limit is not None and (status.daily_remaining or 0) <= 0:
        return (
            f"「{config_name}」今日调用次数已达上限 "
            f"（{status.daily_limit} 次），请明天再试或切换其他配置"
        )
    if status.total_limit is not None and (status.total_remaining or 0) <= 0:
        return (
            f"「{config_name}」累计调用次数已达上限 "
            f"（{status.total_limit} 次），请切换其他配置"
        )
    return f"「{config_name}」调用额度不足"


def quota_payload(status: QuotaStatus) -> Dict[str, Optional[int]]:
    """序列化给用户端的额度信息。"""
    return {
        "daily_limit": status.daily_limit,
        "daily_used": status.daily_used,
        "daily_remaining": status.daily_remaining,
        "total_limit": status.total_limit,
        "total_used": status.total_used,
        "total_remaining": status.total_remaining,
    }
