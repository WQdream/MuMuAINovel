"""管理员公共图片模型配置 API。"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_api_config import require_admin
from app.api.settings import _normalize_raw_provider
from app.database import get_db
from app.logger import get_logger
from app.services.cover_generation_service import cover_generation_service

logger = get_logger(__name__)

router = APIRouter(prefix="/admin", tags=["管理员-公共图片模型配置"])


class SharedImageApiConfigPayload(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    api_provider: str = Field(..., description="图片 API 提供商")
    api_key: str = Field(default="", description="API 密钥（仅管理员可见）")
    api_base_url: Optional[str] = Field(None, description="自定义 API 地址")
    image_model: str = Field(..., description="真实图片模型名称")
    model_display_name: Optional[str] = Field(
        None,
        max_length=100,
        description="用户端显示的模型名称；留空则显示真实模型名",
    )
    daily_call_limit: Optional[int] = Field(
        default=None,
        ge=1,
        description="每用户每日封面生成上限；留空表示不限",
    )
    total_call_limit: Optional[int] = Field(
        default=None,
        ge=1,
        description="每用户累计封面生成上限；留空表示不限",
    )


class SharedImageApiConfigCreateRequest(SharedImageApiConfigPayload):
    name: str = Field(..., min_length=1, max_length=50)
    note: Optional[str] = Field(None, max_length=200)
    is_enabled: bool = True


class SharedImageApiConfigUpdateRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: Optional[str] = Field(None, min_length=1, max_length=50)
    note: Optional[str] = Field(None, max_length=200)
    api_provider: Optional[str] = None
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    image_model: Optional[str] = None
    model_display_name: Optional[str] = Field(None, max_length=100)
    daily_call_limit: Optional[int] = Field(None, ge=1)
    total_call_limit: Optional[int] = Field(None, ge=1)
    is_enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class SharedImageApiConfigToggleRequest(BaseModel):
    is_enabled: bool


class SharedImageApiConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: str
    name: str
    note: Optional[str] = None
    api_provider: str
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    image_model: str
    model_display_name: Optional[str] = None
    daily_call_limit: Optional[int] = None
    total_call_limit: Optional[int] = None
    is_enabled: bool = True
    sort_order: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


def _to_response(record) -> SharedImageApiConfigResponse:
    return SharedImageApiConfigResponse.model_validate(record)


async def _get_record(db: AsyncSession, config_id: str):
    from app.models.shared_image_api_config import SharedImageApiConfig

    result = await db.execute(
        select(SharedImageApiConfig).where(SharedImageApiConfig.id == config_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="公共图片配置不存在")
    return record


@router.get("/image-api-configs", response_model=List[SharedImageApiConfigResponse])
async def list_shared_image_api_configs(
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.shared_image_api_config import SharedImageApiConfig

    result = await db.execute(
        select(SharedImageApiConfig).order_by(
            SharedImageApiConfig.sort_order.asc(),
            SharedImageApiConfig.created_at.asc(),
        )
    )
    return [_to_response(record) for record in result.scalars().all()]


@router.post("/image-api-configs", response_model=SharedImageApiConfigResponse)
async def create_shared_image_api_config(
    data: SharedImageApiConfigCreateRequest,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.shared_image_api_config import SharedImageApiConfig

    record = SharedImageApiConfig(
        name=data.name.strip(),
        note=data.note,
        api_provider=_normalize_raw_provider(data.api_provider),
        api_key=data.api_key or "",
        api_base_url=data.api_base_url,
        image_model=data.image_model.strip(),
        model_display_name=(data.model_display_name or "").strip() or None,
        daily_call_limit=data.daily_call_limit,
        total_call_limit=data.total_call_limit,
        is_enabled=data.is_enabled,
        created_by=user.user_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    logger.info(f"管理员 {user.user_id} 新增公共图片配置: {record.name}")
    return _to_response(record)


@router.put("/image-api-configs/{config_id}", response_model=SharedImageApiConfigResponse)
async def update_shared_image_api_config(
    config_id: str,
    data: SharedImageApiConfigUpdateRequest,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    record = await _get_record(db, config_id)
    updates = data.model_dump(exclude_unset=True)
    if "api_provider" in updates and updates["api_provider"]:
        updates["api_provider"] = _normalize_raw_provider(updates["api_provider"])
    if "model_display_name" in updates:
        updates["model_display_name"] = (updates["model_display_name"] or "").strip() or None
    if "image_model" in updates and updates["image_model"]:
        updates["image_model"] = updates["image_model"].strip()
    if "api_key" in updates and not updates["api_key"]:
        updates.pop("api_key")
    for key in ("daily_call_limit", "total_call_limit"):
        if key in updates:
            updates[key] = updates[key] or None
    for key, value in updates.items():
        setattr(record, key, value)

    await db.commit()
    await db.refresh(record)
    logger.info(f"管理员 {user.user_id} 更新公共图片配置: {record.name}")
    return _to_response(record)


@router.post(
    "/image-api-configs/{config_id}/toggle",
    response_model=SharedImageApiConfigResponse,
)
async def toggle_shared_image_api_config(
    config_id: str,
    data: SharedImageApiConfigToggleRequest,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    record = await _get_record(db, config_id)
    record.is_enabled = data.is_enabled
    await db.commit()
    await db.refresh(record)
    logger.info(
        f"管理员 {user.user_id} {'启用' if data.is_enabled else '停用'}公共图片配置: {record.name}"
    )
    return _to_response(record)


@router.delete("/image-api-configs/{config_id}")
async def delete_shared_image_api_config(
    config_id: str,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    record = await _get_record(db, config_id)
    name = record.name
    await db.delete(record)
    await db.commit()
    logger.info(f"管理员 {user.user_id} 删除公共图片配置: {name}")
    return {"message": "已删除", "config_id": config_id}


@router.post("/image-api-configs/{config_id}/test")
async def test_shared_image_api_config(
    config_id: str,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    record = await _get_record(db, config_id)
    logger.info(f"管理员 {user.user_id} 测试公共图片配置: {record.name}")
    result = await cover_generation_service.test_cover_settings(
        provider=record.api_provider,
        api_key=record.api_key or "",
        api_base_url=record.api_base_url,
        model=record.image_model,
    )
    return {
        "success": result.success,
        "message": result.message,
        "provider": result.provider,
        "model": record.model_display_name or result.model,
    }
