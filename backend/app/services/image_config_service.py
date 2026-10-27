"""图片模型多配置的存储、组合与运行时解析。

用户自己的图片配置保存在 `Settings.preferences['image_models']`，管理员公共配置
保存在 `shared_image_api_configs`。两个来源在读取时组合成同一组卡片，实际生图前
再解析出当前启用配置，避免把公共配置的密钥带到用户记录或前端响应里。
"""
from __future__ import annotations

from datetime import datetime
import json
from typing import Any, Dict, List, Optional
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import Settings

IMAGE_MODELS_PREF_KEY = "image_models"
ACTIVE_SHARED_IMAGE_PREF_KEY = "active_shared_image_config_id"
PRE_SHARED_IMAGE_PREF_KEY = "pre_shared_image_settings"
DISMISSED_SHARED_IMAGE_PREF_KEY = "shared_image_dismissed"


def safe_load_preferences(raw: Optional[str]) -> Dict[str, Any]:
    """解析用户 preferences，异常时返回空字典。"""
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def get_image_models_payload(
    prefs: Dict[str, Any],
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """读取图片配置容器，并把旧版单套封面配置迁移成一张卡片。

    这里只在内存中补出迁移后的内容，调用方读取接口时会统一持久化。
    """
    payload = prefs.get(IMAGE_MODELS_PREF_KEY)
    if isinstance(payload, dict):
        configs = payload.get("configs")
        if not isinstance(configs, list):
            payload["configs"] = []
        payload.setdefault("version", "1.0")
        return payload

    configs: List[Dict[str, Any]] = []
    if settings and settings.cover_api_provider and settings.cover_image_model:
        configs.append(
            {
                "id": f"img_{uuid.uuid4().hex}",
                "name": "默认图片配置",
                "note": "由旧版单套封面配置自动迁移",
                "is_active": True,
                "created_at": datetime.now().isoformat(),
                "api_provider": settings.cover_api_provider,
                "api_key": settings.cover_api_key or "",
                "api_base_url": settings.cover_api_base_url,
                "image_model": settings.cover_image_model,
                "model_display_name": None,
            }
        )

    payload = {"configs": configs, "version": "1.0"}
    prefs[IMAGE_MODELS_PREF_KEY] = payload
    return payload


def is_shared_image_card_id(config_id: Optional[str]) -> bool:
    return isinstance(config_id, str) and config_id.startswith("shared_img_")


def shared_image_id_from_card(config_id: str) -> str:
    return config_id[len("shared_img_"):]


def shared_image_to_config(record) -> Dict[str, Any]:
    """把公共图片配置转换为一张用户卡片。"""
    display_model = record.model_display_name or record.image_model
    return {
        "id": f"shared_img_{record.id}",
        "name": record.name,
        "note": record.note,
        "is_active": False,
        "created_at": record.created_at.isoformat() if record.created_at else datetime.now().isoformat(),
        "shared_config_id": record.id,
        "api_provider": record.api_provider,
        "api_key": "",
        "api_base_url": "",
        "image_model": display_model,
        "model_display_name": display_model,
        "shared_config_name": record.name,
        "daily_call_limit": record.daily_call_limit,
        "total_call_limit": record.total_call_limit,
    }


async def get_enabled_shared_image_config(db: AsyncSession, config_id: Optional[str]):
    if not isinstance(config_id, str) or not config_id.strip():
        return None

    from app.models.shared_image_api_config import SharedImageApiConfig

    result = await db.execute(
        select(SharedImageApiConfig).where(
            SharedImageApiConfig.id == config_id.strip(),
            SharedImageApiConfig.is_enabled.is_(True),
        )
    )
    return result.scalar_one_or_none()


async def compose_user_image_configs(
    prefs: Dict[str, Any],
    db: AsyncSession,
    settings: Optional[Settings] = None,
) -> List[Dict[str, Any]]:
    """用户最终看到的图片卡片 = 自己的配置 + 管理员开放配置。"""
    from app.models.shared_image_api_config import SharedImageApiConfig

    payload = get_image_models_payload(prefs, settings)
    configs = [
        dict(cfg)
        for cfg in payload.get("configs", [])
        if isinstance(cfg, dict) and not cfg.get("shared_config_id")
    ]

    dismissed = prefs.get(DISMISSED_SHARED_IMAGE_PREF_KEY)
    dismissed_ids = set(dismissed) if isinstance(dismissed, list) else set()

    result = await db.execute(
        select(SharedImageApiConfig)
        .where(SharedImageApiConfig.is_enabled.is_(True))
        .order_by(SharedImageApiConfig.sort_order.asc(), SharedImageApiConfig.created_at.asc())
    )
    for record in result.scalars().all():
        if record.id not in dismissed_ids:
            configs.append(shared_image_to_config(record))
    return configs


def find_image_config(configs: List[Dict[str, Any]], config_id: str) -> Optional[Dict[str, Any]]:
    return next((cfg for cfg in configs if cfg.get("id") == config_id), None)


def present_image_configs(configs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """公共图片卡片不回显管理员接口地址与密钥。"""
    presented: List[Dict[str, Any]] = []
    for cfg in configs:
        item = dict(cfg)
        if item.get("shared_config_id"):
            item["api_key"] = ""
            item["api_base_url"] = ""
            item["shared_available"] = True
        presented.append(item)
    return presented


def apply_image_model_to_settings(
    settings: Settings,
    config: Dict[str, Any],
    prefs: Dict[str, Any],
) -> None:
    """将图片卡片应用到 Settings 旧字段，并为公共配置保存回退快照。"""
    shared_id = config.get("shared_config_id")
    if shared_id and not prefs.get(PRE_SHARED_IMAGE_PREF_KEY):
        prefs[PRE_SHARED_IMAGE_PREF_KEY] = {
            "cover_api_provider": settings.cover_api_provider,
            "cover_api_key": settings.cover_api_key,
            "cover_api_base_url": settings.cover_api_base_url,
            "cover_image_model": settings.cover_image_model,
            "active_config_id": next(
                (
                    cfg.get("id")
                    for cfg in prefs.get(IMAGE_MODELS_PREF_KEY, {}).get("configs", [])
                    if isinstance(cfg, dict) and cfg.get("is_active")
                ),
                None,
            ),
        }

    settings.cover_api_provider = config.get("api_provider")
    settings.cover_api_base_url = config.get("api_base_url")
    settings.cover_image_model = config.get("image_model")
    if not shared_id:
        settings.cover_api_key = config.get("api_key") or ""

    if shared_id:
        prefs[ACTIVE_SHARED_IMAGE_PREF_KEY] = shared_id
        for cfg in prefs.get(IMAGE_MODELS_PREF_KEY, {}).get("configs", []):
            if isinstance(cfg, dict):
                cfg["is_active"] = False
    else:
        prefs.pop(ACTIVE_SHARED_IMAGE_PREF_KEY, None)
        prefs.pop(PRE_SHARED_IMAGE_PREF_KEY, None)
    settings.preferences = json.dumps(prefs, ensure_ascii=False)


def rollback_invalid_shared_image_config(
    settings: Settings,
    prefs: Dict[str, Any],
) -> bool:
    """公共图片配置已停用/删除时，把旧字段还原到切换前快照。"""
    snapshot = prefs.get(PRE_SHARED_IMAGE_PREF_KEY)
    if isinstance(snapshot, dict) and snapshot:
        settings.cover_api_provider = snapshot.get("cover_api_provider")
        settings.cover_api_key = snapshot.get("cover_api_key") or ""
        settings.cover_api_base_url = snapshot.get("cover_api_base_url")
        settings.cover_image_model = snapshot.get("cover_image_model")
        restore_id = snapshot.get("active_config_id")
        for cfg in prefs.get(IMAGE_MODELS_PREF_KEY, {}).get("configs", []):
            if isinstance(cfg, dict):
                cfg["is_active"] = cfg.get("id") == restore_id

    prefs.pop(ACTIVE_SHARED_IMAGE_PREF_KEY, None)
    prefs.pop(PRE_SHARED_IMAGE_PREF_KEY, None)
    settings.preferences = json.dumps(prefs, ensure_ascii=False)
    return bool(snapshot)


async def resolve_effective_image_settings(
    settings: Settings,
    db: AsyncSession,
) -> Dict[str, Any]:
    """解析实际生图应使用的配置；公共配置始终从数据库读取最新密钥。"""
    prefs = safe_load_preferences(settings.preferences)
    payload = get_image_models_payload(prefs, settings)

    shared_id = prefs.get(ACTIVE_SHARED_IMAGE_PREF_KEY)
    if isinstance(shared_id, str) and shared_id.strip():
        shared = await get_enabled_shared_image_config(db, shared_id)
        if shared:
            return {
                "shared_config_id": shared.id,
                "cover_api_provider": shared.api_provider,
                "cover_api_key": shared.api_key or "",
                "cover_api_base_url": shared.api_base_url,
                "cover_image_model": shared.image_model,
                "model_display_name": shared.model_display_name,
                "shared_config_name": shared.name,
                "daily_call_limit": shared.daily_call_limit,
                "total_call_limit": shared.total_call_limit,
            }
        snapshot = prefs.get(PRE_SHARED_IMAGE_PREF_KEY)
        if isinstance(snapshot, dict) and snapshot:
            return {
                "shared_config_id": None,
                "cover_api_provider": snapshot.get("cover_api_provider"),
                "cover_api_key": snapshot.get("cover_api_key") or "",
                "cover_api_base_url": snapshot.get("cover_api_base_url"),
                "cover_image_model": snapshot.get("cover_image_model"),
                "model_display_name": None,
                "shared_config_name": None,
                "daily_call_limit": None,
                "total_call_limit": None,
            }

    own_active = next(
        (
            cfg
            for cfg in payload.get("configs", [])
            if isinstance(cfg, dict)
            and cfg.get("is_active")
            and not cfg.get("shared_config_id")
        ),
        None,
    )
    source = own_active or {}
    return {
        "shared_config_id": None,
        "cover_api_provider": source.get("api_provider") or settings.cover_api_provider,
        "cover_api_key": source.get("api_key") or settings.cover_api_key or "",
        "cover_api_base_url": source.get("api_base_url") or settings.cover_api_base_url,
        "cover_image_model": source.get("image_model") or settings.cover_image_model,
        "model_display_name": source.get("model_display_name"),
        "shared_config_name": None,
        "daily_call_limit": None,
        "total_call_limit": None,
    }
