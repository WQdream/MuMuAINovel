"""管理员公共 API 配置 API

管理员在这里维护一组可下发给普通用户的模型配置：
- 密钥只存在 `shared_api_configs` 表里，用户端只保存 `shared_config_id` 引用；
- `is_enabled` 控制某条配置是否对用户可见可加载，与用户卡片的 `is_active` 无关；
- 管理员轮换密钥后，所有引用该配置的用户立即生效，无需重新导入。
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.settings import (
    ApiTestRequest,
    _normalize_raw_provider,
    require_login,
    test_api_connection,
)
from app.database import get_db
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/admin", tags=["管理员-公共API配置"])


def require_admin(user=Depends(require_login)):
    """依赖：要求管理员权限（独立文案）"""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="仅管理员可访问管理后台")
    return user


# ==================== 请求/响应模型 ====================

class SharedApiConfigPayload(BaseModel):
    """公共配置的接口内容"""

    model_config = ConfigDict(protected_namespaces=())

    api_provider: str = Field(..., description="API提供商")
    api_key: str = Field(default="", description="API密钥（仅管理员可见）")
    api_base_url: Optional[str] = Field(None, description="自定义API地址")
    llm_model: str = Field(..., description="模型名称")
    model_display_name: Optional[str] = Field(
        None,
        max_length=100,
        description="用户端显示的模型名称；留空则显示真实模型名",
    )
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2000, ge=1)
    system_prompt: Optional[str] = None
    disable_thinking: bool = Field(default=False)
    daily_call_limit: Optional[int] = Field(
        default=None,
        ge=1,
        description="每用户每日调用上限；留空表示不限",
    )
    total_call_limit: Optional[int] = Field(
        default=None,
        ge=1,
        description="每用户累计调用上限；留空表示不限",
    )


class SharedApiConfigCreateRequest(SharedApiConfigPayload):
    """新增公共配置"""

    name: str = Field(..., min_length=1, max_length=50)
    note: Optional[str] = Field(None, max_length=200)
    is_enabled: bool = Field(default=True)


class SharedApiConfigUpdateRequest(BaseModel):
    """更新公共配置（字段均可选）"""

    model_config = ConfigDict(protected_namespaces=())

    name: Optional[str] = Field(None, min_length=1, max_length=50)
    note: Optional[str] = Field(None, max_length=200)
    api_provider: Optional[str] = None
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    model_display_name: Optional[str] = Field(None, max_length=100)
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(None, ge=1)
    system_prompt: Optional[str] = None
    disable_thinking: Optional[bool] = None
    daily_call_limit: Optional[int] = Field(None, ge=1)
    total_call_limit: Optional[int] = Field(None, ge=1)
    is_enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class SharedApiConfigToggleRequest(BaseModel):
    """启用/停用公共配置"""

    is_enabled: bool


class SharedApiConfigResponse(BaseModel):
    """公共配置响应（管理员视角，含密钥）"""

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: str
    name: str
    note: Optional[str] = None
    api_provider: str
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    llm_model: str
    model_display_name: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    system_prompt: Optional[str] = None
    disable_thinking: bool = False
    daily_call_limit: Optional[int] = None
    total_call_limit: Optional[int] = None
    is_enabled: bool = True
    sort_order: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


def _to_response(record) -> SharedApiConfigResponse:
    return SharedApiConfigResponse.model_validate(record)


async def _get_record(db: AsyncSession, config_id: str):
    from app.models.shared_api_config import SharedApiConfig

    result = await db.execute(select(SharedApiConfig).where(SharedApiConfig.id == config_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="公共配置不存在")
    return record


# ==================== 端点 ====================

@router.get("/api-configs", response_model=List[SharedApiConfigResponse])
async def list_shared_api_configs(
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """列出全部公共配置（含已停用）。"""
    from app.models.shared_api_config import SharedApiConfig

    result = await db.execute(
        select(SharedApiConfig).order_by(
            SharedApiConfig.sort_order.asc(), SharedApiConfig.created_at.asc()
        )
    )
    return [_to_response(record) for record in result.scalars().all()]


@router.post("/api-configs", response_model=SharedApiConfigResponse)
async def create_shared_api_config(
    data: SharedApiConfigCreateRequest,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """新增一条公共配置。"""
    from app.models.shared_api_config import SharedApiConfig

    record = SharedApiConfig(
        name=data.name.strip(),
        note=data.note,
        api_provider=_normalize_raw_provider(data.api_provider),
        api_key=data.api_key or "",
        api_base_url=data.api_base_url,
        llm_model=data.llm_model,
        model_display_name=(data.model_display_name or "").strip() or None,
        temperature=data.temperature,
        max_tokens=data.max_tokens,
        system_prompt=data.system_prompt,
        disable_thinking=data.disable_thinking,
        daily_call_limit=data.daily_call_limit,
        total_call_limit=data.total_call_limit,
        is_enabled=data.is_enabled,
        created_by=user.user_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    logger.info(f"管理员 {user.user_id} 新增公共 API 配置: {record.name}")
    return _to_response(record)


@router.put("/api-configs/{config_id}", response_model=SharedApiConfigResponse)
async def update_shared_api_config(
    config_id: str,
    data: SharedApiConfigUpdateRequest,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新公共配置。密钥字段留空表示保持原值。"""
    record = await _get_record(db, config_id)
    updates = data.model_dump(exclude_unset=True)
    if "api_provider" in updates and updates["api_provider"]:
        updates["api_provider"] = _normalize_raw_provider(updates["api_provider"])
    if "model_display_name" in updates:
        updates["model_display_name"] = (updates["model_display_name"] or "").strip() or None
    if "api_key" in updates and not updates["api_key"]:
        # 空密钥视为「不修改」，避免管理员只想改名字时把 Key 清空
        updates.pop("api_key")
    for key in ("daily_call_limit", "total_call_limit"):
        if key in updates:
            updates[key] = updates[key] or None
    for key, value in updates.items():
        setattr(record, key, value)

    await db.commit()
    await db.refresh(record)
    logger.info(f"管理员 {user.user_id} 更新公共 API 配置: {record.name}")
    return _to_response(record)


@router.post("/api-configs/{config_id}/toggle", response_model=SharedApiConfigResponse)
async def toggle_shared_api_config(
    config_id: str,
    data: SharedApiConfigToggleRequest,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """启用或停用一条公共配置。"""
    record = await _get_record(db, config_id)
    record.is_enabled = data.is_enabled
    await db.commit()
    await db.refresh(record)
    logger.info(
        f"管理员 {user.user_id} {'启用' if data.is_enabled else '停用'}公共 API 配置: {record.name}"
    )
    return _to_response(record)


@router.delete("/api-configs/{config_id}")
async def delete_shared_api_config(
    config_id: str,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """删除公共配置；已导入的用户卡片会因引用失效而不可用。"""
    record = await _get_record(db, config_id)
    name = record.name
    await db.delete(record)
    await db.commit()
    logger.info(f"管理员 {user.user_id} 删除公共 API 配置: {name}")
    return {"message": "已删除", "config_id": config_id}


@router.post("/api-configs/{config_id}/test")
async def test_shared_api_config(
    config_id: str,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """测试一条已保存的公共配置。"""
    record = await _get_record(db, config_id)
    request = ApiTestRequest(
        api_key=record.api_key or "",
        api_base_url=record.api_base_url or "",
        provider=record.api_provider,
        llm_model=record.llm_model,
        temperature=record.temperature,
        max_tokens=record.max_tokens,
    )
    logger.info(f"管理员 {user.user_id} 测试公共 API 配置: {record.name}")
    return await test_api_connection(request)
