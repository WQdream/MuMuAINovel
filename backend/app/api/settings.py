"""
设置管理 API
"""
from fastapi import APIRouter, HTTPException, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict, Any, List, Optional
from pathlib import Path
from pydantic import BaseModel
from datetime import datetime
import httpx
import json
import time
import uuid

from app.database import get_db
from app.models.settings import Settings
from app.services.cover_generation_service import cover_generation_service
from app.schemas.settings import (
    SettingsCreate, SettingsUpdate, SettingsResponse,
    SystemSMTPSettingsResponse, SystemSMTPSettingsUpdate, SMTPTestRequest,
    TextModelConfig, TextModelConfigCreateRequest, TextModelConfigUpdateRequest,
    TextModelConfigListResponse, ChapterAnalysisTextModelSelectionRequest,
    SharedApiConfigSummary, SharedApiConfigImportRequest,
    ImageModelConfig, ImageModelConfigCreateRequest, ImageModelConfigUpdateRequest,
    ImageModelConfigListResponse,
)
from app.user_manager import User
from app.logger import get_logger, safe_preview
from app.config import settings as app_settings, PROJECT_ROOT
from app.services.ai_service import AIService, create_user_ai_service, create_user_ai_service_with_mcp, normalize_provider
from app.services.api_quota_service import (
    CONFIG_TYPE_IMAGE,
    CONFIG_TYPE_TEXT,
    consume_quota,
    get_quota_status,
    quota_payload,
    refund_quota,
)
from app.services.image_config_service import (
    ACTIVE_SHARED_IMAGE_PREF_KEY,
    DISMISSED_SHARED_IMAGE_PREF_KEY,
    IMAGE_MODELS_PREF_KEY,
    apply_image_model_to_settings,
    compose_user_image_configs,
    find_image_config,
    get_enabled_shared_image_config,
    get_image_models_payload,
    is_shared_image_card_id,
    present_image_configs,
    resolve_effective_image_settings,
    rollback_invalid_shared_image_config,
    safe_load_preferences,
    shared_image_id_from_card,
)
from app.services.email_service import email_service
from app.security import validate_ai_http_url

logger = get_logger(__name__)

router = APIRouter(prefix="/settings", tags=["设置管理"])


class CoverSettingsTestRequest(BaseModel):
    cover_api_provider: str
    cover_api_key: str
    cover_api_base_url: Optional[str] = None
    cover_image_model: str


def read_env_defaults() -> Dict[str, Any]:
    """从.env文件读取默认配置（仅读取，不修改）"""
    default_provider = (app_settings.default_ai_provider or "openai").lower().strip()
    provider_defaults = _resolve_provider_defaults(default_provider)
    return {
        "api_provider": default_provider,
        "api_key": "" if default_provider == "xiaomi_mimo" else provider_defaults["api_key"],
        "api_base_url": provider_defaults["api_base_url"],
        "llm_model": app_settings.default_model,
        "temperature": app_settings.default_temperature,
        "max_tokens": app_settings.default_max_tokens,
    }


def _normalize_raw_provider(provider: Optional[str]) -> str:
    """保留内置适配器名称，仅做大小写/空白标准化。"""
    return (provider or "openai").lower().strip()


def _resolve_provider_defaults(provider: Optional[str]) -> Dict[str, str]:
    """按 provider 解析环境变量默认配置，避免在代码中硬编码真实密钥。"""
    raw_provider = _normalize_raw_provider(provider)
    if raw_provider == "xiaomi_mimo":
        return {
            "api_key": app_settings.xiaomi_mimo_api_key or "",
            "api_base_url": app_settings.xiaomi_mimo_base_url or "https://token-plan-cn.xiaomimimo.com/v1",
        }
    if raw_provider == "anthropic":
        return {
            "api_key": app_settings.anthropic_api_key or "",
            "api_base_url": app_settings.anthropic_base_url or "",
        }
    if raw_provider == "gemini":
        return {
            "api_key": app_settings.gemini_api_key or "",
            "api_base_url": app_settings.gemini_base_url or "",
        }
    return {
        "api_key": app_settings.openai_api_key or "",
        "api_base_url": app_settings.openai_base_url or "",
    }


def _apply_provider_defaults(provider: Optional[str], api_key: Optional[str], api_base_url: Optional[str]) -> Dict[str, str]:
    """补齐内置适配器或环境变量中的 key/base_url。"""
    defaults = _resolve_provider_defaults(provider)
    return {
        "api_key": api_key or defaults["api_key"],
        "api_base_url": api_base_url or defaults["api_base_url"],
    }


def resolve_runtime_ai_config(provider: Optional[str], api_key: Optional[str], api_base_url: Optional[str]) -> Dict[str, str]:
    """在 API 层解析运行时 AI 配置。

    内置适配器（如 Xiaomi MiMo）只在数据库/前端保留 provider 标识与地址，真实 Key
    仅从后端环境变量读取；传给 AIService 时转换为底层兼容 provider（OpenAI 格式）。
    """
    raw_provider = _normalize_raw_provider(provider)
    resolved = _apply_provider_defaults(raw_provider, api_key, api_base_url)
    runtime_provider = "openai" if raw_provider == "xiaomi_mimo" else (normalize_provider(raw_provider) or "openai")
    return {
        "raw_provider": raw_provider,
        "api_provider": runtime_provider,
        "api_key": resolved["api_key"],
        "api_base_url": resolved["api_base_url"],
    }


def _safe_load_preferences(raw_preferences: Optional[str]) -> Dict[str, Any]:
    """安全解析用户偏好设置。"""
    try:
        return json.loads(raw_preferences or '{}')
    except (json.JSONDecodeError, TypeError):
        return {}


def _get_text_models_payload(prefs: Dict[str, Any]) -> Dict[str, Any]:
    """获取文本模型配置容器，并迁移旧的「配置预设」数据。"""
    _migrate_legacy_presets(prefs)
    payload = prefs.get('text_models')
    if not isinstance(payload, dict):
        payload = {'configs': [], 'version': '1.0'}
    if not isinstance(payload.get('configs'), list):
        payload['configs'] = []
    payload.setdefault('version', '1.0')
    return payload


def _get_chapter_analysis_config_id(prefs: Dict[str, Any]) -> Optional[str]:
    """读取章节内容分析专用文本模型配置 ID。"""
    config_id = prefs.get('chapter_analysis_config_id')
    return config_id if isinstance(config_id, str) and config_id.strip() else None


def _migrate_legacy_presets(prefs: Dict[str, Any]) -> None:
    """把旧版 `api_presets` 合并进 `text_models`，并移除旧字段。

    旧版把同一份 API 配置存了两份（文本模型卡片 + 配置预设），这里按 id 与
    配置指纹去重后合并，只保留一个启用项，避免迁移后出现双份「使用中」。
    """
    legacy = prefs.pop('api_presets', None)
    legacy_chapter_id = prefs.pop('chapter_analysis_preset_id', None)

    payload = prefs.get('text_models')
    if not isinstance(payload, dict):
        payload = {'configs': [], 'version': '1.0'}
    configs = payload.get('configs')
    if not isinstance(configs, list):
        configs = []

    def fingerprint(cfg: Dict[str, Any]) -> tuple:
        return (
            _normalize_raw_provider(cfg.get('api_provider')),
            cfg.get('api_key') or '',
            (cfg.get('api_base_url') or '').rstrip('/'),
            cfg.get('llm_model') or '',
            float(cfg.get('temperature') if cfg.get('temperature') is not None else 0.7),
            int(cfg.get('max_tokens') if cfg.get('max_tokens') is not None else 2000),
        )

    by_id = {cfg.get('id'): cfg for cfg in configs if isinstance(cfg, dict)}
    by_fingerprint = {
        fingerprint(cfg): cfg for cfg in configs if isinstance(cfg, dict)
    }
    legacy_id_map: Dict[str, str] = {}
    legacy_active_id: Optional[str] = None

    legacy_presets = legacy.get('presets') if isinstance(legacy, dict) else None
    if isinstance(legacy_presets, list):
        for preset in legacy_presets:
            if not isinstance(preset, dict):
                continue
            config = preset.get('config')
            if not isinstance(config, dict):
                continue
            record = {
                'id': preset.get('id') or f"tm_{int(datetime.now().timestamp() * 1000)}",
                'name': preset.get('name') or '未命名配置',
                'note': preset.get('description'),
                'is_active': bool(preset.get('is_active')),
                'created_at': preset.get('created_at') or datetime.now().isoformat(),
                'api_provider': _normalize_raw_provider(config.get('api_provider')),
                'api_key': config.get('api_key') or '',
                'api_base_url': config.get('api_base_url'),
                'llm_model': config.get('llm_model'),
                'temperature': config.get('temperature', 0.7),
                'max_tokens': config.get('max_tokens', 2000),
                'system_prompt': config.get('system_prompt'),
                'disable_thinking': bool(config.get('disable_thinking', False)),
            }
            existing = by_id.get(record['id']) or by_fingerprint.get(fingerprint(record))
            if existing:
                # 旧预设与已有卡片是同一份配置，直接复用已有卡片
                legacy_id_map[str(preset.get('id') or '')] = existing.get('id')
                if record['is_active']:
                    legacy_active_id = existing.get('id')
                continue
            configs.append(record)
            by_id[record['id']] = record
            by_fingerprint[fingerprint(record)] = record
            legacy_id_map[str(preset.get('id') or '')] = record['id']
            if record['is_active']:
                legacy_active_id = record['id']

    if legacy_active_id:
        # 旧版中「生效的预设」就是主设置里的配置，迁移后应继续是启用项
        for cfg in configs:
            if isinstance(cfg, dict):
                cfg['is_active'] = (cfg.get('id') == legacy_active_id)

    active_seen = False
    for cfg in configs:
        if not isinstance(cfg, dict):
            continue
        if cfg.get('is_active') and active_seen:
            cfg['is_active'] = False
        elif cfg.get('is_active'):
            active_seen = True

    if legacy_chapter_id:
        migrated_chapter_id = legacy_id_map.get(str(legacy_chapter_id), str(legacy_chapter_id))
        if any(cfg.get('id') == migrated_chapter_id for cfg in configs if isinstance(cfg, dict)):
            prefs['chapter_analysis_config_id'] = migrated_chapter_id

    payload['configs'] = configs
    prefs['text_models'] = payload


async def _get_shared_api_config(db: AsyncSession, config_id: Optional[str]):
    """读取一条「开放中」的公共配置；已停用/已删除返回 None。"""
    if not isinstance(config_id, str) or not config_id.strip():
        return None

    from app.models.shared_api_config import SharedApiConfig

    result = await db.execute(
        select(SharedApiConfig).where(
            SharedApiConfig.id == config_id.strip(),
            SharedApiConfig.is_enabled.is_(True),
        )
    )
    return result.scalar_one_or_none()


async def _annotate_shared_text_quota(
    db: AsyncSession,
    user_id: str,
    cards: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """给用户端公共文本卡片补上额度信息，不修改卡片里的其它字段。"""
    for card in cards:
        shared_config_id = card.get('shared_config_id')
        if not shared_config_id:
            continue
        status = await get_quota_status(
            db,
            user_id=user_id,
            config_type=CONFIG_TYPE_TEXT,
            config_id=shared_config_id,
            daily_limit=card.get('daily_call_limit'),
            total_limit=card.get('total_call_limit'),
        )
        for key, value in quota_payload(status).items():
            card[f'quota_{key}'] = value
    return cards


def _shared_config_to_settings(shared) -> Dict[str, Any]:
    """把公共配置转换成运行时配置字典。

    `llm_model` 必须始终是真实模型名，用于真正发起请求；
    `model_display_name` 只是可选的对外展示别名，不参与 API 调用。
    """
    return {
        'shared_config_id': shared.id,
        'api_provider': shared.api_provider,
        'api_key': shared.api_key or "",
        'api_base_url': shared.api_base_url,
        'llm_model': shared.llm_model,
        'model_display_name': shared.model_display_name,
        'model_aliases': sorted(
            {
                name
                for name in (shared.llm_model, shared.model_display_name)
                if name
            }
        ),
        'temperature': shared.temperature,
        'max_tokens': shared.max_tokens,
        'system_prompt': shared.system_prompt,
        'disable_thinking': bool(shared.disable_thinking),
        'shared_config_name': shared.name,
        'daily_call_limit': shared.daily_call_limit,
        'total_call_limit': shared.total_call_limit,
    }


async def resolve_effective_ai_settings(settings: Settings, db: AsyncSession) -> Dict[str, Any]:
    """解析「当前真正生效」的 AI 配置。

    公共配置卡片在用户 Settings 里只存 `active_shared_config_id`，真实密钥
    始终留在 shared_api_configs 表，因此用户永远读不到明文 Key。
    """
    effective: Dict[str, Any] = {
        'shared_config_id': None,
        'api_provider': settings.api_provider,
        'api_key': settings.api_key,
        'api_base_url': settings.api_base_url,
        'llm_model': settings.llm_model,
        'model_aliases': [],
        'temperature': settings.temperature,
        'max_tokens': settings.max_tokens,
        'system_prompt': settings.system_prompt,
        'disable_thinking': bool(getattr(settings, 'disable_thinking', False)),
    }

    prefs = _safe_load_preferences(settings.preferences)
    shared_id = prefs.get('active_shared_config_id')
    if not shared_id:
        return effective

    shared = await _get_shared_api_config(db, shared_id)
    if not shared:
        logger.warning(f"生效中的公共 API 配置不可用，回退用户自有配置: {shared_id}")
        snapshot = prefs.get('pre_shared_settings')
        if isinstance(snapshot, dict) and snapshot:
            effective.update(
                {
                    'api_provider': snapshot.get('api_provider'),
                    'api_key': snapshot.get('api_key') or '',
                    'api_base_url': snapshot.get('api_base_url'),
                    'llm_model': snapshot.get('llm_model'),
                    'model_aliases': [],
                    'temperature': snapshot.get('temperature'),
                    'max_tokens': snapshot.get('max_tokens'),
                    'system_prompt': snapshot.get('system_prompt'),
                    'disable_thinking': bool(snapshot.get('disable_thinking', False)),
                }
            )
            return effective

        own_active = next(
            (
                cfg
                for cfg in _get_text_models_payload(prefs).get('configs', [])
                if isinstance(cfg, dict)
                and cfg.get('is_active')
                and not cfg.get('shared_config_id')
            ),
            None,
        )
        if own_active:
            effective.update(
                {
                    'api_provider': _normalize_raw_provider(own_active.get('api_provider')),
                    'api_key': own_active.get('api_key') or effective['api_key'],
                    'api_base_url': own_active.get('api_base_url'),
                    'llm_model': own_active.get('llm_model'),
                    'model_aliases': [],
                    'temperature': own_active.get('temperature'),
                    'max_tokens': own_active.get('max_tokens'),
                    'system_prompt': own_active.get('system_prompt'),
                    'disable_thinking': bool(own_active.get('disable_thinking', False)),
                }
            )
        return effective

    effective.update(_shared_config_to_settings(shared))
    return effective


async def apply_shared_fallback(settings: Settings, db: AsyncSession) -> bool:
    """如果生效中的公共配置已停用/删除，把 Settings 主字段还原成快照。

    读接口与写接口都会调用：任何入口看到「公共配置已失效」时都能就地修复，
    避免主字段一直停留在公共配置的模型名上。
    """
    prefs = _safe_load_preferences(settings.preferences)
    shared_id = prefs.get('active_shared_config_id')
    if not shared_id:
        return False
    if await _get_shared_api_config(db, shared_id):
        return False

    snapshot = prefs.get('pre_shared_settings')
    if isinstance(snapshot, dict) and snapshot:
        settings.api_provider = snapshot.get('api_provider') or settings.api_provider
        settings.api_key = snapshot.get('api_key') or ''
        settings.api_base_url = snapshot.get('api_base_url')
        settings.llm_model = snapshot.get('llm_model')
        settings.temperature = snapshot.get('temperature')
        settings.max_tokens = snapshot.get('max_tokens')
        settings.system_prompt = snapshot.get('system_prompt')
        settings.disable_thinking = bool(snapshot.get('disable_thinking', False))
        logger.info(f"公共配置已失效，已还原快照: user={settings.user_id}, shared={shared_id}")

    prefs.pop('active_shared_config_id', None)
    prefs.pop('pre_shared_settings', None)
    settings.preferences = json.dumps(prefs, ensure_ascii=False)
    return True


async def _present_settings_response(settings: Settings, db: AsyncSession) -> SettingsResponse:
    """构造设置响应：公共配置生效时隐藏管理员侧的接口地址与密钥。"""
    response = SettingsResponse.model_validate(settings)
    prefs = _safe_load_preferences(settings.preferences)
    shared_id = prefs.get('active_shared_config_id')
    shared = await _get_shared_api_config(db, shared_id) if shared_id else None
    if shared:
        # 接口地址与密钥属于管理员侧信息，运行时由后端按 shared_config_id 解析
        response = response.model_copy(
            update={
                'api_key': '',
                'api_base_url': None,
                'llm_model': shared.model_display_name or shared.llm_model,
                'model_display_name': shared.model_display_name or shared.llm_model,
                'shared_config_active': True,
            }
        )
    return response


async def _build_ai_service_from_config(
    *,
    config: Dict[str, Any],
    user_id: str,
    db: AsyncSession,
    enable_mcp: bool,
) -> AIService:
    """基于指定配置创建AI服务。"""
    resolved_config = resolve_runtime_ai_config(
        config.get('api_provider'),
        config.get('api_key'),
        config.get('api_base_url'),
    )
    return create_user_ai_service_with_mcp(
        api_provider=resolved_config["api_provider"],
        api_key=resolved_config["api_key"],
        api_base_url=resolved_config["api_base_url"],
        model_name=config.get('llm_model') or app_settings.default_model,
        model_aliases=config.get('model_aliases'),
        temperature=config.get('temperature') if config.get('temperature') is not None else app_settings.default_temperature,
        max_tokens=config.get('max_tokens') if config.get('max_tokens') is not None else app_settings.default_max_tokens,
        user_id=user_id,
        db_session=db,
        system_prompt=config.get('system_prompt'),
        enable_mcp=enable_mcp,
        disable_thinking=bool(config.get('disable_thinking', False)),
        quota_config_id=config.get('shared_config_id'),
        quota_config_name=config.get('shared_config_name') or config.get('name'),
        quota_daily_limit=config.get('daily_call_limit'),
        quota_total_limit=config.get('total_call_limit'),
    )


def require_login(request: Request):
    """依赖：要求用户已登录"""
    if not hasattr(request.state, "user") or not request.state.user:
        raise HTTPException(status_code=401, detail="需要登录")
    return request.state.user


def require_admin(user: User = Depends(require_login)):
    """依赖：要求管理员权限"""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="仅管理员可访问系统设置")
    return user


async def get_or_create_admin_settings(db: AsyncSession, user: User) -> Settings:
    """获取或创建管理员设置，系统级 SMTP 配置挂在管理员设置记录上"""
    result = await db.execute(
        select(Settings).where(Settings.user_id == user.user_id)
    )
    settings = result.scalar_one_or_none()

    if not settings:
        env_defaults = read_env_defaults()
        settings = Settings(
            user_id=user.user_id,
            smtp_provider=app_settings.SMTP_PROVIDER,
            smtp_host=app_settings.SMTP_HOST,
            smtp_port=app_settings.SMTP_PORT,
            smtp_username=app_settings.SMTP_USERNAME,
            smtp_password=app_settings.SMTP_PASSWORD,
            smtp_use_tls=app_settings.SMTP_USE_TLS,
            smtp_use_ssl=app_settings.SMTP_USE_SSL,
            smtp_from_email=app_settings.SMTP_FROM_EMAIL,
            smtp_from_name=app_settings.SMTP_FROM_NAME,
            email_auth_enabled=app_settings.EMAIL_AUTH_ENABLED,
            email_register_enabled=app_settings.EMAIL_REGISTER_ENABLED,
            verification_code_ttl_minutes=app_settings.EMAIL_VERIFICATION_CODE_TTL_MINUTES,
            verification_resend_interval_seconds=app_settings.EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS,
            **env_defaults
        )
        db.add(settings)
        await db.commit()
        await db.refresh(settings)

    return settings


async def get_user_ai_service(
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db)
) -> AIService:
    """
    依赖：获取当前用户的AI服务实例（支持MCP工具自动加载）
    
    从数据库读取用户设置并创建对应的AI服务。
    自动传递 user_id 和 db_session，使得 AIService 能够加载用户配置的MCP工具。
    根据用户的所有MCP插件状态决定是否启用MCP：如果有启用的插件则启用，否则禁用。
    """
    from app.models.mcp_plugin import MCPPlugin
    
    result = await db.execute(
        select(Settings).where(Settings.user_id == user.user_id)
    )
    settings = result.scalar_one_or_none()
    
    if not settings:
        # 如果用户没有设置，从.env读取并保存
        env_defaults = read_env_defaults()
        settings = Settings(
            user_id=user.user_id,
            **env_defaults
        )
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
        logger.info(f"用户 {user.user_id} 首次使用AI服务，已从.env同步设置到数据库")
    
    # 查询用户的所有MCP插件状态
    mcp_result = await db.execute(
        select(MCPPlugin).where(MCPPlugin.user_id == user.user_id)
    )
    mcp_plugins = mcp_result.scalars().all()
    
    # 检查是否有启用的MCP插件
    enable_mcp = any(plugin.enabled for plugin in mcp_plugins) if mcp_plugins else False
    
    if mcp_plugins:
        enabled_count = sum(1 for p in mcp_plugins if p.enabled)
        logger.info(f"用户 {user.user_id} 有 {len(mcp_plugins)} 个MCP插件，{enabled_count} 个启用，{enable_mcp} 决定使用MCP")
    else:
        logger.debug(f"用户 {user.user_id} 没有配置MCP插件，禁用MCP")
    
    # ✅ 使用支持MCP的工厂函数创建AI服务实例
    # 传递 user_id 和 db_session，使得 AIService 能够自动加载用户配置的MCP工具
    # 若用户当前生效的是管理员下发的公共配置，这里会解出真实密钥
    effective = await resolve_effective_ai_settings(settings, db)
    resolved_settings = resolve_runtime_ai_config(
        effective['api_provider'], effective['api_key'], effective['api_base_url']
    )
    return create_user_ai_service_with_mcp(
        api_provider=resolved_settings["api_provider"],
        api_key=resolved_settings["api_key"],
        api_base_url=resolved_settings["api_base_url"],
        model_name=effective['llm_model'],
        model_aliases=effective.get('model_aliases'),
        temperature=effective['temperature'],
        max_tokens=effective['max_tokens'],
        user_id=user.user_id,          # ✅ 传递 user_id
        db_session=db,                 # ✅ 传递 db_session
        system_prompt=effective['system_prompt'],
        enable_mcp=enable_mcp,         # 根据MCP插件状态动态决定
        disable_thinking=bool(effective['disable_thinking']),
        quota_config_id=effective.get('shared_config_id'),
        quota_config_name=effective.get('shared_config_name'),
        quota_daily_limit=effective.get('daily_call_limit'),
        quota_total_limit=effective.get('total_call_limit'),
    )


async def get_user_ai_service_from_db(user_id: str, db: AsyncSession) -> AIService:
    """
    从数据库直接创建用户AI服务实例（用于后台任务，不依赖FastAPI的Depends）
    """
    return await get_user_ai_service_from_db_by_usage(user_id, db, usage="default")


async def get_user_ai_service_from_db_by_usage(
    user_id: str,
    db: AsyncSession,
    usage: str = "default"
) -> AIService:
    """按用途创建用户AI服务实例。"""
    from app.models.mcp_plugin import MCPPlugin

    result = await db.execute(
        select(Settings).where(Settings.user_id == user_id)
    )
    settings = result.scalar_one_or_none()

    if not settings:
        env_defaults = read_env_defaults()
        settings = Settings(user_id=user_id, **env_defaults)
        db.add(settings)
        await db.commit()
        await db.refresh(settings)

    mcp_result = await db.execute(
        select(MCPPlugin).where(MCPPlugin.user_id == user_id)
    )
    mcp_plugins = mcp_result.scalars().all()
    enable_mcp = any(plugin.enabled for plugin in mcp_plugins) if mcp_plugins else False

    if usage == "chapter_analysis":
        prefs = _safe_load_preferences(settings.preferences)
        config_id = _get_chapter_analysis_config_id(prefs)
        if config_id:
            configs = await _compose_user_configs(prefs, db)
            target_config = await _resolve_card_by_id(configs, config_id)
            if target_config:
                merged = target_config
                if target_config.get('shared_config_id'):
                    shared = await _get_shared_api_config(db, target_config['shared_config_id'])
                    merged = _shared_config_to_settings(shared) if shared else {}
                if not merged:
                    logger.warning(
                        f"章节内容分析配置引用的公共配置已停用，回退默认配置: {target_config.get('name')}"
                    )
                else:
                    logger.info(f"用户 {user_id} 使用章节内容分析专用文本模型配置: {target_config.get('name')}")
                    return await _build_ai_service_from_config(
                        config=merged,
                        user_id=user_id,
                        db=db,
                        enable_mcp=enable_mcp,
                    )
            logger.warning(f"用户 {user_id} 配置的章节内容分析模型不存在，回退默认API配置: {config_id}")

    effective = await resolve_effective_ai_settings(settings, db)
    resolved_settings = resolve_runtime_ai_config(
        effective['api_provider'], effective['api_key'], effective['api_base_url']
    )
    return create_user_ai_service_with_mcp(
        api_provider=resolved_settings["api_provider"],
        api_key=resolved_settings["api_key"],
        api_base_url=resolved_settings["api_base_url"],
        model_name=effective['llm_model'],
        model_aliases=effective.get('model_aliases'),
        temperature=effective['temperature'],
        max_tokens=effective['max_tokens'],
        user_id=user_id,
        db_session=db,
        system_prompt=effective['system_prompt'],
        enable_mcp=enable_mcp,
        disable_thinking=bool(effective['disable_thinking']),
        quota_config_id=effective.get('shared_config_id'),
        quota_config_name=effective.get('shared_config_name'),
        quota_daily_limit=effective.get('daily_call_limit'),
        quota_total_limit=effective.get('total_call_limit'),
    )


@router.get("", response_model=SettingsResponse)
async def get_settings(
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db)
):
    """
    获取当前用户的设置
    如果用户没有保存过设置，自动从.env创建并保存到数据库
    """
    result = await db.execute(
        select(Settings).where(Settings.user_id == user.user_id)
    )
    settings = result.scalar_one_or_none()
    
    if not settings:
        # 如果用户没有保存过设置，从.env读取默认配置并保存到数据库
        env_defaults = read_env_defaults()
        logger.info(f"用户 {user.user_id} 首次获取设置，自动从.env同步到数据库")
        
        # 创建新设置并保存到数据库
        settings = Settings(
            user_id=user.user_id,
            **env_defaults
        )
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
        logger.info(f"用户 {user.user_id} 的设置已从.env同步到数据库")
    
    if await apply_shared_fallback(settings, db):
        await db.commit()
        await db.refresh(settings)

    logger.info(f"用户 {user.user_id} 获取已保存的设置")

    # 生效中的是管理员公共配置时，接口地址与密钥属于管理员侧信息，
    # 不下发给客户端，运行时由后端按 shared_config_id 解析。
    return await _present_settings_response(settings, db)


@router.post("/cover/test")
async def test_cover_settings(
    data: CoverSettingsTestRequest,
    user: User = Depends(require_login),
):
    result = await cover_generation_service.test_cover_settings(
        provider=data.cover_api_provider,
        api_key=data.cover_api_key,
        api_base_url=data.cover_api_base_url,
        model=data.cover_image_model,
    )
    return {
        "success": result.success,
        "message": result.message,
        "provider": result.provider,
        "model": result.model,
    }


# ========== 图片模型多配置 ==========

@router.get("/image-models", response_model=ImageModelConfigListResponse)
async def list_image_models(
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """获取图片模型卡片（含管理员开放的公共图片配置）。"""
    settings = await get_user_settings(user.user_id, db)
    prefs = safe_load_preferences(settings.preferences)
    payload = get_image_models_payload(prefs, settings)
    configs = await compose_user_image_configs(prefs, db, settings)
    for config in configs:
        shared_config_id = config.get("shared_config_id")
        if not shared_config_id:
            continue
        status = await get_quota_status(
            db,
            user_id=user.user_id,
            config_type=CONFIG_TYPE_IMAGE,
            config_id=shared_config_id,
            daily_limit=config.get("daily_call_limit"),
            total_limit=config.get("total_call_limit"),
        )
        for key, value in quota_payload(status).items():
            config[f"quota_{key}"] = value

    active_shared_id = prefs.get(ACTIVE_SHARED_IMAGE_PREF_KEY)
    active_id = None
    if active_shared_id:
        shared_card_id = f"shared_img_{active_shared_id}"
        active = find_image_config(configs, shared_card_id)
        if not active:
            rollback_invalid_shared_image_config(settings, prefs)
            restored = next(
                (
                    cfg
                    for cfg in payload.get("configs", [])
                    if isinstance(cfg, dict) and cfg.get("is_active")
                ),
                None,
            )
            active_id = restored.get("id") if restored else None
        else:
            active_id = shared_card_id
    else:
        active = next(
            (
                cfg
                for cfg in payload.get("configs", [])
                if isinstance(cfg, dict) and cfg.get("is_active")
            ),
            None,
        )
        active_id = active.get("id") if active else None

    # 首次读取时把旧版单套封面配置或公共配置失效回退持久化。
    settings.preferences = json.dumps(prefs, ensure_ascii=False)
    await db.commit()

    return {
        "configs": present_image_configs(configs),
        "total": len(configs),
        "active_config_id": active_id,
    }


@router.post("/image-models", response_model=ImageModelConfig)
async def create_image_model(
    data: ImageModelConfigCreateRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """新增一套个人图片模型配置（不自动启用）。"""
    settings = await get_user_settings(user.user_id, db)
    prefs = safe_load_preferences(settings.preferences)
    payload = get_image_models_payload(prefs, settings)
    configs = payload.get("configs", [])

    record = {
        "id": f"img_{uuid.uuid4().hex}",
        "name": data.name.strip(),
        "note": data.note,
        "is_active": False,
        "created_at": datetime.now().isoformat(),
        **data.model_dump(exclude={"name", "note"}),
        "api_provider": _normalize_raw_provider(data.api_provider),
        "model_display_name": (data.model_display_name or "").strip() or None,
    }
    configs.append(record)
    if len(configs) == 1:
        record["is_active"] = True
        apply_image_model_to_settings(settings, record, prefs)
    payload["configs"] = configs
    prefs[IMAGE_MODELS_PREF_KEY] = payload
    settings.preferences = json.dumps(prefs, ensure_ascii=False)
    await db.commit()
    logger.info(f"用户 {user.user_id} 新增图片模型配置: {record['name']}")
    return present_image_configs([record])[0]


@router.put("/image-models/{config_id}", response_model=ImageModelConfig)
async def update_image_model(
    config_id: str,
    data: ImageModelConfigUpdateRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """更新个人图片模型配置；公共配置不允许用户修改。"""
    if is_shared_image_card_id(config_id):
        raise HTTPException(status_code=400, detail="公共图片配置由管理员统一维护，无法修改")

    settings = await get_user_settings(user.user_id, db)
    prefs = safe_load_preferences(settings.preferences)
    payload = get_image_models_payload(prefs, settings)
    configs = payload.get("configs", [])
    target = next((cfg for cfg in configs if cfg.get("id") == config_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="图片配置不存在")

    updates = data.model_dump(exclude_unset=True)
    if "api_provider" in updates and updates["api_provider"]:
        updates["api_provider"] = _normalize_raw_provider(updates["api_provider"])
    if "model_display_name" in updates:
        updates["model_display_name"] = (updates["model_display_name"] or "").strip() or None
    target.update(updates)

    payload["configs"] = configs
    prefs[IMAGE_MODELS_PREF_KEY] = payload
    settings.preferences = json.dumps(prefs, ensure_ascii=False)
    if target.get("is_active"):
        apply_image_model_to_settings(settings, target, prefs)
    await db.commit()
    logger.info(f"用户 {user.user_id} 更新图片模型配置: {config_id}")
    return present_image_configs([target])[0]


@router.post("/image-models/{config_id}/activate")
async def activate_image_model(
    config_id: str,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """启用一张图片模型卡片，其余个人卡片自动取消启用。"""
    settings = await get_user_settings(user.user_id, db)
    prefs = safe_load_preferences(settings.preferences)
    payload = get_image_models_payload(prefs, settings)
    configs = await compose_user_image_configs(prefs, db, settings)
    target = find_image_config(configs, config_id)
    if not target:
        raise HTTPException(status_code=404, detail="图片配置不存在")

    if target.get("shared_config_id"):
        shared = await get_enabled_shared_image_config(db, target["shared_config_id"])
        if not shared:
            raise HTTPException(status_code=400, detail="该公共图片配置已被管理员停用或删除")
        apply_image_model_to_settings(settings, target, prefs)
        name = target.get("name")
    else:
        for cfg in payload.get("configs", []):
            if isinstance(cfg, dict):
                cfg["is_active"] = cfg.get("id") == config_id
        payload["configs"] = payload.get("configs", [])
        prefs[IMAGE_MODELS_PREF_KEY] = payload
        apply_image_model_to_settings(settings, target, prefs)
        name = target.get("name")

    await db.commit()
    logger.info(f"用户 {user.user_id} 启用图片模型配置: {name}")
    return {"message": "已启用", "config_id": config_id, "config_name": name}


@router.delete("/image-models/{config_id}")
async def delete_image_model(
    config_id: str,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """删除个人图片配置；公共配置只从当前用户列表中隐藏。"""
    settings = await get_user_settings(user.user_id, db)
    prefs = safe_load_preferences(settings.preferences)

    if is_shared_image_card_id(config_id):
        shared_id = shared_image_id_from_card(config_id)
        dismissed = prefs.get(DISMISSED_SHARED_IMAGE_PREF_KEY)
        dismissed_ids = set(dismissed) if isinstance(dismissed, list) else set()
        dismissed_ids.add(shared_id)
        prefs[DISMISSED_SHARED_IMAGE_PREF_KEY] = sorted(dismissed_ids)
        if prefs.get(ACTIVE_SHARED_IMAGE_PREF_KEY) == shared_id:
            rollback_invalid_shared_image_config(settings, prefs)
        await db.commit()
        return {"message": "已从列表移除", "config_id": config_id}

    payload = get_image_models_payload(prefs, settings)
    configs = payload.get("configs", [])
    target = next((cfg for cfg in configs if cfg.get("id") == config_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="图片配置不存在")
    payload["configs"] = [cfg for cfg in configs if cfg.get("id") != config_id]
    prefs[IMAGE_MODELS_PREF_KEY] = payload
    settings.preferences = json.dumps(prefs, ensure_ascii=False)
    await db.commit()
    return {"message": "已删除", "config_id": config_id}


@router.post("/image-models/{config_id}/test")
async def test_image_model(
    config_id: str,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """测试单张图片卡片，不影响当前启用配置。"""
    settings = await get_user_settings(user.user_id, db)
    prefs = safe_load_preferences(settings.preferences)
    configs = await compose_user_image_configs(prefs, db, settings)
    target = find_image_config(configs, config_id)
    if not target:
        raise HTTPException(status_code=404, detail="图片配置不存在")

    if target.get("shared_config_id"):
        shared = await get_enabled_shared_image_config(db, target["shared_config_id"])
        if not shared:
            raise HTTPException(status_code=404, detail="公共图片配置不存在或已停用")
        provider = shared.api_provider
        api_key = shared.api_key or ""
        api_base_url = shared.api_base_url
        image_model = shared.image_model
        quota_status = await get_quota_status(
            db,
            user_id=user.user_id,
            config_type=CONFIG_TYPE_IMAGE,
            config_id=shared.id,
            daily_limit=shared.daily_call_limit,
            total_limit=shared.total_call_limit,
        )
        if quota_status.is_exhausted:
            raise HTTPException(
                status_code=429,
                detail=f"「{shared.name}」生成次数已达上限，请切换其他配置或稍后再试",
            )
        await consume_quota(
            db,
            user_id=user.user_id,
            config_type=CONFIG_TYPE_IMAGE,
            config_id=shared.id,
            config_name=shared.name,
            daily_limit=shared.daily_call_limit,
            total_limit=shared.total_call_limit,
        )
    else:
        provider = target.get("api_provider")
        api_key = target.get("api_key") or ""
        api_base_url = target.get("api_base_url")
        image_model = target.get("image_model")

    try:
        result = await cover_generation_service.test_cover_settings(
            provider=provider,
            api_key=api_key,
            api_base_url=api_base_url,
            model=image_model,
        )
    except Exception:
        if target.get("shared_config_id"):
            await refund_quota(
                db,
                user_id=user.user_id,
                config_type=CONFIG_TYPE_IMAGE,
                config_id=target["shared_config_id"],
            )
        raise
    if target.get("shared_config_id") and not result.success:
        await refund_quota(
            db,
            user_id=user.user_id,
            config_type=CONFIG_TYPE_IMAGE,
            config_id=target["shared_config_id"],
        )
    return {
        "success": result.success,
        "message": result.message,
        "provider": result.provider,
        "model": target.get("model_display_name") or result.model,
    }


@router.get("/system/smtp", response_model=SystemSMTPSettingsResponse)
async def get_system_smtp_settings(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """获取系统 SMTP 设置（仅管理员）"""
    settings = await get_or_create_admin_settings(db, user)
    return settings


@router.put("/system/smtp", response_model=SystemSMTPSettingsResponse)
async def update_system_smtp_settings(
    data: SystemSMTPSettingsUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """更新系统 SMTP 设置（仅管理员）"""
    settings = await get_or_create_admin_settings(db, user)
    update_data = data.model_dump(exclude_unset=True)

    if update_data.get("smtp_provider") == "qq":
        update_data.setdefault("smtp_host", "smtp.qq.com")
        update_data.setdefault("smtp_port", 465)
        update_data.setdefault("smtp_use_ssl", True)
        update_data.setdefault("smtp_use_tls", False)

    if update_data.get("smtp_use_ssl") and update_data.get("smtp_use_tls"):
        raise HTTPException(status_code=400, detail="SSL 和 TLS 不能同时启用")

    for key, value in update_data.items():
        setattr(settings, key, value)

    await db.commit()
    await db.refresh(settings)
    logger.info(f"管理员 {user.user_id} 更新系统 SMTP 设置")
    return settings


@router.post("/system/smtp/test")
async def test_system_smtp_settings(
    data: SMTPTestRequest,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """测试系统 SMTP 设置（真实发送测试邮件）"""
    settings = await get_or_create_admin_settings(db, user)

    if not settings.smtp_host or not settings.smtp_username or not settings.smtp_password:
        raise HTTPException(status_code=400, detail="请先完善 SMTP 主机、用户名和授权码")

    if settings.smtp_provider == "qq" and settings.smtp_host != "smtp.qq.com":
        raise HTTPException(status_code=400, detail="QQ 邮箱 SMTP 主机必须为 smtp.qq.com")

    if "@" not in data.to_email or "." not in data.to_email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="测试收件邮箱格式不正确")

    from_email = settings.smtp_from_email or settings.smtp_username
    if not from_email:
        raise HTTPException(status_code=400, detail="请先配置发件人邮箱或 SMTP 用户名")

    subject = "小新工坊 SMTP 测试邮件"
    text_body = (
        "这是一封来自小新工坊系统设置页面的 SMTP 测试邮件。\n\n"
        f"发送时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"SMTP 服务商：{settings.smtp_provider}\n"
        f"SMTP 主机：{settings.smtp_host}:{settings.smtp_port}\n"
        "如果你收到这封邮件，说明当前 SMTP 配置可正常发送邮件。"
    )
    html_body = f"""
    <div style=\"font-family: Arial, sans-serif; line-height: 1.7; color: #1f1f1f;\">
      <h2 style=\"margin-bottom: 12px;\">小新工坊 SMTP 测试邮件</h2>
      <p>这是一封来自系统设置页面的 SMTP 测试邮件。</p>
      <ul>
        <li><strong>发送时间：</strong>{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</li>
        <li><strong>SMTP 服务商：</strong>{settings.smtp_provider}</li>
        <li><strong>SMTP 主机：</strong>{settings.smtp_host}:{settings.smtp_port}</li>
      </ul>
      <p>如果你收到这封邮件，说明当前 SMTP 配置可正常发送邮件。</p>
    </div>
    """

    try:
        await email_service.send_mail(
            host=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            use_tls=settings.smtp_use_tls,
            use_ssl=settings.smtp_use_ssl,
            from_email=from_email,
            from_name=settings.smtp_from_name,
            to_email=data.to_email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
        )
    except Exception as exc:
        logger.exception(f"SMTP 测试邮件发送失败: {exc}")
        raise HTTPException(status_code=400, detail=f"SMTP 测试邮件发送失败: {str(exc)}") from exc

    return {
        "success": True,
        "message": f"测试邮件已发送至 {data.to_email}，请检查收件箱和垃圾箱",
        "provider": settings.smtp_provider,
        "host": settings.smtp_host,
        "port": settings.smtp_port,
    }


@router.post("", response_model=SettingsResponse)
async def save_settings(
    data: SettingsCreate,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db)
):
    """
    创建或更新当前用户的设置（Upsert）
    如果设置已存在则更新，否则创建新设置
    仅保存到数据库
    
    注意：手动保存配置后会自动取消文本模型卡片的启用状态，
    因为手动修改的配置可能与卡片不一致
    """
    # 查找现有设置
    result = await db.execute(
        select(Settings).where(Settings.user_id == user.user_id)
    )
    settings = result.scalar_one_or_none()
    
    # 准备数据
    settings_dict = data.model_dump(exclude_unset=True)
    
    if settings:
        # 更新现有设置
        for key, value in settings_dict.items():
            setattr(settings, key, value)
        
        # 手动保存配置意味着用户改用自定义凭据：
        # 取消卡片启用状态，并解除管理员公共配置的引用
        try:
            prefs = _safe_load_preferences(settings.preferences)
            had_legacy = 'api_presets' in prefs or 'chapter_analysis_preset_id' in prefs
            payload = _get_text_models_payload(prefs)
            active_config = _find_active_text_model(payload.get('configs', []))
            prefs_changed = had_legacy

            if active_config:
                effective = {
                    'api_provider': settings.api_provider,
                    'api_key': settings.api_key,
                    'api_base_url': settings.api_base_url,
                    'llm_model': settings.llm_model,
                    'temperature': settings.temperature,
                    'max_tokens': settings.max_tokens,
                }
                if not _same_ai_config(active_config, effective):
                    active_config['is_active'] = False
                    prefs_changed = True
                    logger.info(
                        f"用户 {user.user_id} 手动修改配置，已取消卡片 {active_config.get('name')} 的启用状态"
                    )

            # 只有真的提交文本模型凭据时才解除公共配置引用；
            # 只保存封面等其它设置时不应把用户从公共配置上踢下来。
            touched_ai = any(
                key in settings_dict
                for key in ('api_provider', 'api_key', 'api_base_url', 'llm_model')
            )
            if touched_ai:
                if prefs.pop('active_shared_config_id', None) is not None:
                    prefs_changed = True
                prefs.pop('pre_shared_settings', None)

            if prefs_changed:
                prefs['text_models'] = payload
                settings.preferences = json.dumps(prefs, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"解析用户 {user.user_id} 的preferences失败: {e}")

        await db.commit()
        await db.refresh(settings)
        logger.info(f"用户 {user.user_id} 更新设置")
    else:
        # 创建新设置
        settings = Settings(
            user_id=user.user_id,
            **settings_dict
        )
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
        logger.info(f"用户 {user.user_id} 创建设置")

    return await _present_settings_response(settings, db)


@router.put("", response_model=SettingsResponse)
async def update_settings(
    data: SettingsUpdate,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db)
):
    """
    更新当前用户的设置
    仅保存到数据库
    """
    result = await db.execute(
        select(Settings).where(Settings.user_id == user.user_id)
    )
    settings = result.scalar_one_or_none()
    
    if not settings:
        raise HTTPException(status_code=404, detail="设置不存在，请先创建设置")
    
    # 更新设置
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(settings, key, value)
    
    await db.commit()
    await db.refresh(settings)
    logger.info(f"用户 {user.user_id} 更新设置")

    return await _present_settings_response(settings, db)


@router.delete("")
async def delete_settings(
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db)
):
    """
    删除当前用户的设置
    """
    result = await db.execute(
        select(Settings).where(Settings.user_id == user.user_id)
    )
    settings = result.scalar_one_or_none()
    
    if not settings:
        raise HTTPException(status_code=404, detail="设置不存在")
    
    await db.delete(settings)
    await db.commit()
    logger.info(f"用户 {user.user_id} 删除设置")
    
    return {"message": "设置已删除", "user_id": user.user_id}


@router.get("/models")
async def get_available_models(
    api_key: Optional[str] = "",
    api_base_url: Optional[str] = "",
    provider: Optional[str] = None,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db)
):
    """
    从配置的 API 获取可用的模型列表
    
    Args:
        api_key: API 密钥
        api_base_url: API 基础 URL
        provider: API 提供商 (openai, anthropic, azure, custom)
    
    Returns:
        模型列表
    """
    try:
        if not api_base_url:
            # 未显式传参时按当前生效配置解析（含管理员公共配置），
            # 密钥只在服务端使用，不回传给客户端。
            current = await get_user_settings(user.user_id, db)
            effective = await resolve_effective_ai_settings(current, db)
            if effective.get('shared_config_id'):
                # 公共配置生效时不能把上游真实模型列表透给用户，
                # 否则前面的显示名称就被绕过了。
                display_model = (
                    effective.get('model_display_name')
                    or effective.get('llm_model')
                )
                return {
                    "provider": effective.get('api_provider'),
                    "models": [
                        {
                            "value": display_model,
                            "label": display_model,
                            "description": "公共配置",
                        }
                    ],
                    "count": 1,
                }
            api_key = effective.get('api_key') or ''
            api_base_url = effective.get('api_base_url') or ''
            provider = effective.get('api_provider') or provider or 'openai'
        if not api_base_url:
            raise HTTPException(status_code=400, detail="尚未配置可用的接口地址")

        raw_provider = _normalize_raw_provider(provider)
        resolved_config = resolve_runtime_ai_config(raw_provider, api_key, api_base_url)
        provider = resolved_config["api_provider"]
        api_key = resolved_config["api_key"]
        api_base_url = validate_ai_http_url(resolved_config["api_base_url"])
        async with httpx.AsyncClient(timeout=10.0) as client:
            if provider == "openai" or provider == "azure" or provider == "custom":
                # OpenAI 兼容接口获取模型列表
                url = f"{api_base_url.rstrip('/')}/models"
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                
                logger.info(f"正在从 {url} 获取模型列表")
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                
                data = response.json()
                models = []
                
                if "data" in data and isinstance(data["data"], list):
                    for model in data["data"]:
                        model_id = model.get("id", "")
                        # 返回所有模型，不进行过滤
                        if model_id:
                            models.append({
                                "value": model_id,
                                "label": model_id,
                                "description": model.get("description", "") or f"Created: {model.get('created', 'N/A')}"
                            })
                
                if not models:
                    raise HTTPException(
                        status_code=404,
                        detail="未能从 API 获取到可用的模型列表"
                    )
                
                logger.info(f"成功获取 {len(models)} 个模型")
                return {
                    "provider": provider,
                    "models": models,
                    "count": len(models)
                }
                
            elif provider == "anthropic":
                # Anthropic models API
                url = f"{api_base_url.rstrip('/')}/v1/models"
                headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()
                models = [{"value": m["id"], "label": m["id"], "description": m.get("display_name", "")} for m in data.get("data", [])]
                return {"provider": provider, "models": models, "count": len(models)}
            
            elif provider == "gemini":
                # Gemini models API
                url = f"{api_base_url.rstrip('/')}/models?key={api_key}"
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()
                models = []
                for m in data.get("models", []):
                    if "generateContent" in m.get("supportedGenerationMethods", []):
                        mid = m.get("name", "").replace("models/", "")
                        models.append({"value": mid, "label": m.get("displayName", mid), "description": ""})
                return {"provider": provider, "models": models, "count": len(models)}
            
            else:
                raise HTTPException(status_code=400, detail=f"不支持的提供商: {provider}")
            
    except httpx.HTTPStatusError as e:
        logger.error(f"获取模型列表失败 (HTTP {e.response.status_code}): {safe_preview(e.response.text, 500)}")
        if e.response.status_code == 404:
            raise HTTPException(
                status_code=400,
                detail=f"该 API 提供商不支持模型列表查询接口 (/models 返回 404)，请手动输入模型名称。当前请求地址: {api_base_url.rstrip('/')}/models"
            )
        raise HTTPException(
            status_code=400,
            detail=f"无法从 API 获取模型列表 (HTTP {e.response.status_code})"
        )
    except httpx.RequestError as e:
        logger.error(f"请求模型列表失败: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"无法连接到 API: {str(e)}"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取模型列表时发生错误: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"获取模型列表失败: {str(e)}"
        )


class ApiTestRequest(BaseModel):
    """API 测试请求模型"""
    api_key: Optional[str] = ""
    api_base_url: Optional[str] = ""
    provider: str
    llm_model: str
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


@router.post("/check-function-calling")
async def check_function_calling_support(
    data: ApiTestRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """
    检查模型是否支持 Function Calling（工具调用）
    
    基于业界最佳实践的测试方法：
    1. 发送包含工具定义的请求
    2. 检查响应的 finish_reason 是否为 "tool_calls"
    3. 验证响应中是否包含有效的 tool_calls 数据
    
    Args:
        data: 包含 API 配置的请求数据
    
    Returns:
        检测结果包含支持状态、详细信息和建议
    """
    api_key = data.api_key
    api_base_url = data.api_base_url
    provider_input = data.provider
    llm_model = data.llm_model
    display_model: Optional[str] = None
    quota_config_id: Optional[str] = None
    quota_config_name: Optional[str] = None
    quota_daily_limit: Optional[int] = None
    quota_total_limit: Optional[int] = None
    if not api_base_url:
        # 公共配置生效时前端拿不到接口地址与密钥，按当前生效配置在服务端解析
        current = await get_user_settings(user.user_id, db)
        effective = await resolve_effective_ai_settings(current, db)
        api_key = effective.get('api_key') or ''
        api_base_url = effective.get('api_base_url') or ''
        provider_input = effective.get('api_provider') or provider_input
        display_model = effective.get('model_display_name')
        if effective.get('shared_config_id'):
            display_model = effective.get('model_display_name') or effective.get('llm_model')
            quota_config_id = effective.get('shared_config_id')
            quota_config_name = effective.get('shared_config_name')
            quota_daily_limit = effective.get('daily_call_limit')
            quota_total_limit = effective.get('total_call_limit')
        if (
            effective.get('shared_config_id')
            and display_model
            and llm_model in (display_model, effective.get('llm_model'))
        ):
            llm_model = effective.get('llm_model') or llm_model

    raw_provider = _normalize_raw_provider(provider_input)
    resolved_config = resolve_runtime_ai_config(raw_provider, api_key, api_base_url)
    api_key = resolved_config["api_key"]
    api_base_url = resolved_config["api_base_url"]
    provider = resolved_config["api_provider"]
    
    try:
        start_time = time.time()
        
        # 定义一个简单的测试工具（天气查询）
        test_tools = [{
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "获取指定城市的当前天气信息",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {
                            "type": "string",
                            "description": "城市名称，例如：北京、上海、深圳"
                        },
                        "unit": {
                            "type": "string",
                            "enum": ["celsius", "fahrenheit"],
                            "description": "温度单位"
                        }
                    },
                    "required": ["city"]
                }
            }
        }]
        
        # 测试提示：故意设计一个需要调用工具的问题
        test_prompt = "请告诉我北京现在的天气情况如何？"
        
        logger.info(f"🧪 开始检测 Function Calling 支持")
        logger.info(f"  - 提供商: {provider}")
        logger.info(f"  - 模型: {llm_model}")
        logger.info(f"  - 测试工具: get_weather")
        
        # 创建临时 AI 服务实例进行测试
        test_service = AIService(
            api_provider=provider,
            api_key=api_key,
            api_base_url=api_base_url,
            default_model=llm_model,
            default_temperature=0.3,  # 使用较低温度以获得更确定的行为
            default_max_tokens=200,
            user_id=user.user_id,
            db_session=db,
            enable_mcp=False,
            quota_config_id=quota_config_id,
            quota_config_name=quota_config_name,
            quota_daily_limit=quota_daily_limit,
            quota_total_limit=quota_total_limit,
        )
        
        # 发送带工具的测试请求
        response = await test_service.generate_text(
            prompt=test_prompt,
            provider=provider,
            model=llm_model,
            temperature=0.3,
            max_tokens=200,
            tools=test_tools,
            tool_choice="auto",  # 让模型自动决定是否使用工具
            auto_mcp=False  # 禁用 MCP 自动加载
        )
        
        end_time = time.time()
        response_time = round((end_time - start_time) * 1000, 2)
        
        # 分析响应以确定是否支持 Function Calling
        supported = False
        finish_reason = None
        tool_calls = None
        response_content = None
        
        if isinstance(response, dict):
            # 检查 finish_reason（OpenAI 标准）
            finish_reason = response.get("finish_reason")
            
            # 检查是否有 tool_calls
            if "tool_calls" in response and response["tool_calls"]:
                supported = True
                tool_calls = response["tool_calls"]
                logger.info(f"✅ 检测到工具调用: {len(tool_calls)} 个")
            
            # 记录返回的内容（如果有）
            if "content" in response:
                response_content = response["content"]
        elif isinstance(response, str):
            # 如果只返回字符串，说明不支持工具调用
            response_content = response
        
        logger.info(f"  - 响应时间: {response_time}ms")
        logger.info(f"  - finish_reason: {finish_reason}")
        logger.info(f"  - 支持状态: {'✅ 支持' if supported else '❌ 不支持'}")
        
        # 构建详细的返回信息
        result = {
            "success": True,
            "supported": supported,
            "message": "✅ 模型支持 Function Calling" if supported else "❌ 模型不支持 Function Calling",
            "response_time_ms": response_time,
            "provider": provider,
            "model": display_model or llm_model,
            "details": {
                "finish_reason": finish_reason,
                "has_tool_calls": bool(tool_calls),
                "tool_call_count": len(tool_calls) if tool_calls else 0,
                "test_tool": "get_weather",
                "test_prompt": test_prompt,
                "response_type": "tool_calls" if supported else "text"
            }
        }
        
        # 添加工具调用详情
        if tool_calls:
            result["tool_calls"] = tool_calls
            result["suggestions"] = [
                "✅ 该模型支持 Function Calling，可以正常使用 MCP 插件",
                "建议：启用需要的 MCP 插件以扩展 AI 能力",
                "提示：测试成功检测到工具调用，模型能够正确解析和使用外部工具"
            ]
        else:
            result["response_preview"] = response_content[:200] if response_content else None
            result["suggestions"] = [
                "❌ 该模型不支持 Function Calling，无法使用 MCP 插件功能",
                "建议：更换支持工具调用的模型",
                "推荐模型：GPT-4 系列、GPT-4-turbo、Claude 3 Opus/Sonnet、Gemini 1.5 Pro 等",
                "说明：模型返回了文本回复而非工具调用，表明不支持该功能"
            ]
        
        return result
        
    except HTTPException:
        # 公共配置额度耗尽等 HTTP 错误需要保留状态码，不能在检测接口里被吞成普通失败。
        raise

    except ValueError as e:
        error_msg = str(e)
        logger.error(f"❌ Function Calling 检测配置错误: {error_msg}")
        return {
            "success": False,
            "supported": False,
            "message": "配置错误",
            "error": error_msg,
            "error_type": "ConfigurationError",
            "suggestions": [
                "请检查 API Key 是否正确",
                "请确认 API Base URL 格式是否正确",
                "请验证所选提供商与配置是否匹配"
            ]
        }
        
    except TimeoutError as e:
        error_msg = str(e)
        logger.error(f"❌ Function Calling 检测超时: {error_msg}")
        return {
            "success": False,
            "supported": None,
            "message": "检测超时",
            "error": error_msg,
            "error_type": "TimeoutError",
            "suggestions": [
                "请检查网络连接是否正常",
                "请确认 API 服务是否可访问",
                "建议：稍后重试或使用其他网络环境"
            ]
        }
        
    except Exception as e:
        error_msg = str(e)
        error_type = type(e).__name__
        
        logger.error(f"❌ Function Calling 检测失败: {error_msg}")
        logger.error(f"  - 错误类型: {error_type}")
        
        # 智能分析错误原因
        suggestions = []
        if "tool" in error_msg.lower() or "function" in error_msg.lower():
            suggestions = [
                "该模型可能不支持 Function Calling 功能",
                "API 返回了与工具调用相关的错误",
                "建议：更换支持工具调用的模型或联系 API 提供商"
            ]
        elif "unauthorized" in error_msg.lower() or "401" in error_msg:
            suggestions = [
                "API Key 认证失败",
                "请检查 API Key 是否正确且有效",
                "请确认 API Key 是否有足够的权限"
            ]
        elif "not found" in error_msg.lower() or "404" in error_msg:
            suggestions = [
                "模型不存在或不可用",
                "请检查模型名称是否正确",
                "请确认该模型在当前 API 中是否可用"
            ]
        else:
            suggestions = [
                "检测过程中遇到未知错误",
                "建议：检查所有配置参数是否正确",
                "提示：查看详细错误信息以获取更多线索"
            ]
        
        return {
            "success": False,
            "supported": False,
            "message": "Function Calling 检测失败",
            "error": error_msg,
            "error_type": error_type,
            "suggestions": suggestions
        }


@router.post("/test")
async def test_api_connection(data: ApiTestRequest):
    """
    测试 API 连接和配置是否正确
    
    Args:
        data: 包含 API 配置的请求数据（包括 temperature 和 max_tokens）
    
    Returns:
        测试结果包含状态、响应时间和详细信息
    """
    raw_provider = _normalize_raw_provider(data.provider)
    resolved_config = resolve_runtime_ai_config(raw_provider, data.api_key, data.api_base_url)
    api_key = resolved_config["api_key"]
    api_base_url = resolved_config["api_base_url"]
    provider = resolved_config["api_provider"]
    llm_model = data.llm_model
    # 使用前端传递的参数，如果未传递则使用默认值
    temperature = data.temperature if data.temperature is not None else 0.7
    max_tokens = data.max_tokens if data.max_tokens is not None else 2000
    import time
    
    try:
        start_time = time.time()
        
        # 创建临时 AI 服务实例，使用前端传递的参数
        test_service = AIService(
            api_provider=provider,
            api_key=api_key,
            api_base_url=api_base_url,
            default_model=llm_model,
            default_temperature=temperature,
            default_max_tokens=max_tokens
        )
        
        # 发送简单的测试请求
        test_prompt = "请用一句话回复：测试成功"
        
        logger.info(f"🧪 开始测试 API 连接")
        logger.info(f"  - 提供商: {provider}")
        logger.info(f"  - 模型: {llm_model}")
        logger.info(f"  - Base URL: {api_base_url}")
        logger.info(f"  - Temperature: {temperature}")
        logger.info(f"  - Max Tokens: {max_tokens}")
        
        response = await test_service.generate_text(
            prompt=test_prompt,
            provider=provider,
            model=llm_model,
            temperature=temperature,
            max_tokens=max_tokens,
            auto_mcp=False  # 测试时不加载MCP工具
        )
        
        end_time = time.time()
        response_time = round((end_time - start_time) * 1000, 2)  # 转换为毫秒
        
        logger.info(f"✅ API 测试成功")
        logger.info(f"  - 响应时间: {response_time}ms")
        
        # 安全地处理响应内容（确保是字符串）
        response_str = str(response) if response else 'N/A'
        logger.info(f"  - 响应内容长度: {len(response_str)}")
        
        return {
            "success": True,
            "message": "API 连接测试成功",
            "response_time_ms": response_time,
            "provider": provider,
            "model": llm_model,
            "response_preview": response_str[:100] if len(response_str) > 100 else response_str,
            "details": {
                "api_available": True,
                "model_accessible": True,
                "response_valid": bool(response),
                "temperature": temperature,
                "max_tokens": max_tokens
            }
        }
        
    except json.JSONDecodeError as e:
        # 上游接口返回了 HTTP 成功状态，但响应体不是合法 JSON。
        error_msg = str(e)
        logger.error(f"❌ API 响应解析失败: {error_msg}")
        logger.error(f"  - 错误类型: {type(e).__name__}")
        return {
            "success": False,
            "message": "API 响应解析失败",
            "error": error_msg,
            "error_type": "JSONDecodeError",
            "suggestions": [
                "上游服务可能返回了空响应、HTML 错误页或非 OpenAI 兼容 JSON",
                "请查看后端日志中的 AI HTTP 响应 JSON 解析失败，确认 status、content-type 和 body_preview",
                "请确认 API Base URL 是否指向正确的 OpenAI 兼容 /v1 接口"
            ]
        }

    except ValueError as e:
        # 配置错误
        error_msg = str(e)
        logger.error(f"❌ API 配置错误: {error_msg}")
        return {
            "success": False,
            "message": "API 配置错误",
            "error": error_msg,
            "error_type": "ConfigurationError",
            "suggestions": [
                "请检查 API Key 是否正确",
                "请确认 API Base URL 格式正确",
                "请验证所选提供商是否匹配"
            ]
        }
        
    except TimeoutError as e:
        # 超时错误
        error_msg = str(e)
        logger.error(f"❌ API 请求超时: {error_msg}")
        return {
            "success": False,
            "message": "API 请求超时",
            "error": error_msg,
            "error_type": "TimeoutError",
            "suggestions": [
                "请检查网络连接",
                "请确认 API Base URL 是否可访问",
                "如果使用代理，请检查代理设置"
            ]
        }
        
    except Exception as e:
        # 其他错误
        error_msg = str(e)
        error_type = type(e).__name__
        
        logger.error(f"❌ API 测试失败: {error_msg}")
        logger.error(f"  - 错误类型: {error_type}")
        
        # 分析错误原因并提供建议
        suggestions = []
        if "blocked" in error_msg.lower():
            suggestions = [
                "请求被 API 提供商阻止",
                "可能原因：API Key 被限制或地区限制",
                "建议：检查 API Key 状态和账户余额",
                "建议：尝试更换 API Base URL 或使用代理"
            ]
        elif "unauthorized" in error_msg.lower() or "401" in error_msg:
            suggestions = [
                "API Key 认证失败",
                "建议：检查 API Key 是否正确",
                "建议：确认 API Key 是否过期"
            ]
        elif "not found" in error_msg.lower() or "404" in error_msg:
            suggestions = [
                "API 端点不存在或模型不可用",
                "建议：检查 API Base URL 是否正确",
                "建议：确认模型名称是否正确"
            ]
        elif "rate limit" in error_msg.lower() or "429" in error_msg:
            suggestions = [
                "API 请求频率超限",
                "建议：稍后重试",
                "建议：升级 API 套餐"
            ]
        elif "insufficient" in error_msg.lower() or "quota" in error_msg.lower():
            suggestions = [
                "API 配额不足",
                "建议：检查账户余额",
                "建议：充值或升级套餐"
            ]
        else:
            suggestions = [
                "请检查所有配置参数是否正确",
                "请确认网络连接正常",
                "请查看详细错误信息"
            ]
        
        return {
            "success": False,
            "message": "API 测试失败",
            "error": error_msg,
            "error_type": error_type,
            "suggestions": suggestions
        }


# ========== 用户设置读取 ==========

async def get_user_settings(user_id: str, db: AsyncSession) -> Settings:
    """获取用户settings，如果不存在则创建"""
    result = await db.execute(
        select(Settings).where(Settings.user_id == user_id)
    )
    settings = result.scalar_one_or_none()
    
    if not settings:
        # 创建默认设置
        env_defaults = read_env_defaults()
        settings = Settings(
            user_id=user_id,
            **env_defaults,
            preferences='{}'  # 初始化为空JSON
        )
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
        logger.info(f"用户 {user_id} 首次访问，已创建默认设置")
    
    return settings


# ========== 文本模型配置 ==========
# 存储位置：preferences['text_models'] = {"configs": [...], "version": "1.0"}

def _find_active_text_model(configs: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """返回当前启用的文本模型配置。"""
    return next((cfg for cfg in configs if cfg.get('is_active')), None)


def _same_ai_config(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    """比较两份 AI 配置是否等价（用于判断卡片是否仍与生效配置一致）。"""
    def key(cfg: Dict[str, Any]) -> tuple:
        resolved = _apply_provider_defaults(
            cfg.get('api_provider'), cfg.get('api_key'), cfg.get('api_base_url')
        )
        return (
            _normalize_raw_provider(cfg.get('api_provider')),
            cfg.get('api_key') or resolved['api_key'] or '',
            (cfg.get('api_base_url') or resolved['api_base_url'] or '').rstrip('/'),
            cfg.get('llm_model') or '',
            float(cfg.get('temperature') if cfg.get('temperature') is not None else 0.7),
            int(cfg.get('max_tokens') if cfg.get('max_tokens') is not None else 2000),
        )

    return key(left) == key(right)


def _virtual_card(shared) -> Dict[str, Any]:
    """把管理员公共配置映射成用户列表里的一张卡片（不含密钥与接口地址）。

    接口地址同样属于管理员侧的基础设施信息，用户端只需要知道「能用」，
    真正调用时由后端按 shared_config_id 从库里取完整参数。
    """
    display_model = shared.model_display_name or shared.llm_model
    return {
        "id": f"shared_{shared.id}",
        "name": shared.name,
        "note": shared.note,
        "is_active": False,
        "created_at": shared.created_at.isoformat() if shared.created_at else datetime.now().isoformat(),
        "shared_config_id": shared.id,
        "api_provider": shared.api_provider,
        "api_key": "",
        "api_base_url": "",
        # 用户端只看到展示名；真实模型名只用于后端运行时解析。
        # 未配置展示名时，llm_model 就保持真实模型名。
        "llm_model": display_model,
        "model_display_name": display_model,
        "model_aliases": sorted({shared.llm_model, display_model}),
        "temperature": shared.temperature,
        "max_tokens": shared.max_tokens,
        # 系统提示词属于管理员侧的编排信息，同样不下发
        "system_prompt": "",
        "disable_thinking": bool(shared.disable_thinking),
        "daily_call_limit": shared.daily_call_limit,
        "total_call_limit": shared.total_call_limit,
    }


async def _compose_user_configs(
    prefs: Dict[str, Any],
    db: AsyncSession,
) -> List[Dict[str, Any]]:
    """用户最终看到的卡片列表 = 他自己的卡片 + 管理员开放的公共配置。

    公共配置不落进用户 preferences，每次读取时按管理员最新内容拼出来，
    因此管理员改参数、停用、删除都会立刻反映到用户端。
    """
    from app.models.shared_api_config import SharedApiConfig

    configs = [
        cfg
        for cfg in _get_text_models_payload(prefs).get("configs", [])
        if isinstance(cfg, dict) and not cfg.get("shared_config_id")
    ]

    dismissed = prefs.get("shared_dismissed")
    dismissed_ids = set(dismissed) if isinstance(dismissed, list) else set()

    result = await db.execute(
        select(SharedApiConfig)
        .where(SharedApiConfig.is_enabled.is_(True))
        .order_by(SharedApiConfig.sort_order.asc(), SharedApiConfig.created_at.asc())
    )
    for shared in result.scalars().all():
        if shared.id in dismissed_ids:
            continue
        configs.append(_virtual_card(shared))
    return configs


def _is_shared_card_id(config_id: Optional[str]) -> bool:
    """公共配置卡片使用 `shared_<uuid>` 形式，便于和用户卡片区分。"""
    return isinstance(config_id, str) and config_id.startswith("shared_")


def _shared_id_from_card(config_id: str) -> str:
    return config_id[len("shared_"):]


async def _resolve_card_by_id(
    configs: List[Dict[str, Any]],
    config_id: str,
) -> Optional[Dict[str, Any]]:
    """按卡片 ID 在组合列表里查找，公共卡片以 `shared_<uuid>` 命中。"""
    for cfg in configs:
        if cfg.get("id") == config_id:
            return cfg
        shared_id = cfg.get("shared_config_id")
        if shared_id and config_id == f"shared_{shared_id}":
            return cfg
    return None

def _present_text_model(configs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """输出给前端的卡片：公共配置永远不回显密钥与接口地址。"""
    presented: List[Dict[str, Any]] = []
    for cfg in configs:
        if not isinstance(cfg, dict):
            continue
        item = dict(cfg)
        if item.get('shared_config_id'):
            item['api_key'] = ''
            item['api_base_url'] = ''
            item['system_prompt'] = ''
            item['shared_available'] = True
        presented.append(item)
    return presented


@router.get("/text-models", response_model=TextModelConfigListResponse)
async def list_text_models(
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """获取文本模型卡片列表（含管理员开放给所有人的公共配置）。"""
    settings = await get_user_settings(user.user_id, db)
    prefs = _safe_load_preferences(settings.preferences)
    had_legacy_data = 'api_presets' in prefs or 'chapter_analysis_preset_id' in prefs
    payload = _get_text_models_payload(prefs)
    configs = await _compose_user_configs(prefs, db)
    await _annotate_shared_text_quota(db, user.user_id, configs)
    active_shared_id = prefs.get('active_shared_config_id')
    active = _find_active_text_model(payload.get('configs', []))
    if active_shared_id:
        shared_card = next(
            (cfg for cfg in configs if cfg.get('shared_config_id') == active_shared_id),
            None,
        )
        if shared_card:
            active = shared_card
        else:
            # 公共配置被停用/删除后自动回退到用户自己的启用卡片
            prefs.pop('active_shared_config_id', None)
            active_shared_id = None
            had_legacy_data = True
            if active:
                await _apply_text_model_to_settings(settings, active, prefs)
                logger.info(
                    f"用户 {user.user_id} 的公共配置已失效，回退到自有配置: {active.get('name')}"
                )
    chapter_config_id = _get_chapter_analysis_config_id(prefs)
    if chapter_config_id and not await _resolve_card_by_id(configs, chapter_config_id):
        # 引用已失效（配置被删除/迁移前遗留），回退为跟随当前启用配置
        prefs.pop('chapter_analysis_config_id', None)
        chapter_config_id = None
        had_legacy_data = True
    if had_legacy_data:
        settings.preferences = json.dumps(prefs, ensure_ascii=False)
        await db.commit()
        logger.info(f"用户 {user.user_id} 的旧配置预设已合并到文本模型配置")
    return {
        "configs": _present_text_model(configs),
        "total": len(configs),
        "active_config_id": active.get('id') if active else None,
        "chapter_analysis_config_id": chapter_config_id,
    }


@router.post("/text-models", response_model=TextModelConfig)
async def create_text_model(
    data: TextModelConfigCreateRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """保存一条新的文本模型配置（不自动启用）。"""
    settings = await get_user_settings(user.user_id, db)
    prefs = _safe_load_preferences(settings.preferences)
    payload = _get_text_models_payload(prefs)
    configs = payload.get('configs', [])

    record = {
        "id": f"tm_{int(datetime.now().timestamp() * 1000)}",
        "name": data.name,
        "note": data.note,
        "is_active": False,
        "created_at": datetime.now().isoformat(),
        **data.model_dump(exclude={"name", "note"}),
        "api_provider": _normalize_raw_provider(data.api_provider),
    }
    configs.append(record)
    payload['configs'] = configs
    prefs['text_models'] = payload
    settings.preferences = json.dumps(prefs, ensure_ascii=False)

    await db.commit()
    logger.info(f"用户 {user.user_id} 新增文本模型配置: {data.name}")
    return record


@router.put("/text-models/usage/chapter-analysis")
async def set_chapter_analysis_text_model(
    data: ChapterAnalysisTextModelSelectionRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """设置章节内容分析专用的文本模型配置；为空则沿用当前启用配置。"""
    settings = await get_user_settings(user.user_id, db)
    prefs = _safe_load_preferences(settings.preferences)
    configs = _get_text_models_payload(prefs).get('configs', [])

    config_id = data.config_id.strip() if data.config_id else None
    config_name = None
    if config_id:
        target = await _resolve_card_by_id(
            await _compose_user_configs(prefs, db), config_id
        )
        if not target:
            raise HTTPException(status_code=404, detail="配置不存在")
        prefs['chapter_analysis_config_id'] = config_id
        config_name = target.get('name')
    else:
        prefs.pop('chapter_analysis_config_id', None)

    settings.preferences = json.dumps(prefs, ensure_ascii=False)
    await db.commit()

    logger.info(f"用户 {user.user_id} 设置章节内容分析模型: {config_id or '跟随当前启用配置'}")
    return {
        "message": "章节内容分析模型已更新",
        "chapter_analysis_config_id": config_id,
        "config_name": config_name,
    }


@router.put("/text-models/{config_id}", response_model=TextModelConfig)
async def update_text_model(
    config_id: str,
    data: TextModelConfigUpdateRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """更新一条用户自己的文本模型配置。

    公共配置卡片由管理员统一维护，不允许用户改任何字段。
    """
    if _is_shared_card_id(config_id):
        raise HTTPException(
            status_code=400,
            detail="公共配置由管理员统一维护，无法修改",
        )

    settings = await get_user_settings(user.user_id, db)
    prefs = _safe_load_preferences(settings.preferences)
    payload = _get_text_models_payload(prefs)
    configs = payload.get('configs', [])

    target = next((cfg for cfg in configs if cfg.get('id') == config_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="配置不存在")

    updates = data.model_dump(exclude_unset=True)
    if 'api_provider' in updates and updates['api_provider']:
        updates['api_provider'] = _normalize_raw_provider(updates['api_provider'])
    target.update(updates)

    payload['configs'] = configs
    prefs['text_models'] = payload
    settings.preferences = json.dumps(prefs, ensure_ascii=False)

    if target.get('is_active'):
        await _apply_text_model_to_settings(settings, target, prefs)

    await db.commit()
    logger.info(f"用户 {user.user_id} 更新文本模型配置: {config_id}")
    return (_present_text_model([target]))[0]


@router.post("/text-models/{config_id}/activate")
async def activate_text_model(
    config_id: str,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """启用某条文本模型配置，其余配置自动取消启用。"""
    settings = await get_user_settings(user.user_id, db)
    prefs = _safe_load_preferences(settings.preferences)
    payload = _get_text_models_payload(prefs)
    configs = payload.get('configs', [])

    if _is_shared_card_id(config_id):
        shared_id = _shared_id_from_card(config_id)
        shared = await _get_shared_api_config(db, shared_id)
        if not shared:
            raise HTTPException(status_code=400, detail="该公共配置已被管理员停用或删除")

        # 保留用户自己卡片的 is_active，公共配置只通过 active_shared_config_id 生效，
        # 这样管理员停用后可以立刻回退到他原本的那一套
        await _apply_text_model_to_settings(settings, _shared_config_to_settings(shared), prefs)

        payload['configs'] = configs
        prefs['text_models'] = payload
        prefs['active_shared_config_id'] = shared.id
        settings.preferences = json.dumps(prefs, ensure_ascii=False)
        await db.commit()
        logger.info(f"用户 {user.user_id} 启用公共 API 配置: {shared.name}")
        return {"message": "已启用", "config_id": config_id, "config_name": shared.name}

    target = next((cfg for cfg in configs if cfg.get('id') == config_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="配置不存在")

    for cfg in configs:
        cfg['is_active'] = (cfg.get('id') == config_id)
    await _apply_text_model_to_settings(settings, target, prefs)

    payload['configs'] = configs
    prefs['text_models'] = payload
    prefs.pop('active_shared_config_id', None)
    settings.preferences = json.dumps(prefs, ensure_ascii=False)

    await db.commit()
    logger.info(f"用户 {user.user_id} 启用文本模型配置: {target.get('name')}")
    return {"message": "已启用", "config_id": config_id, "config_name": target.get('name')}


@router.delete("/text-models/{config_id}")
async def delete_text_model(
    config_id: str,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """删除文本模型配置。

    公共配置卡片不能真删（管理员还在开放），删除只是把它从自己的列表隐藏。
    """
    settings = await get_user_settings(user.user_id, db)
    prefs = _safe_load_preferences(settings.preferences)

    if _is_shared_card_id(config_id):
        shared_id = _shared_id_from_card(config_id)
        dismissed = prefs.get('shared_dismissed')
        dismissed_ids = set(dismissed) if isinstance(dismissed, list) else set()
        dismissed_ids.add(shared_id)
        prefs['shared_dismissed'] = sorted(dismissed_ids)
        if prefs.get('chapter_analysis_config_id') == config_id:
            prefs.pop('chapter_analysis_config_id', None)
        if prefs.get('active_shared_config_id') == shared_id:
            # 隐藏正在生效的公共配置时，立刻把主配置还原成启用前的快照
            snapshot = prefs.get('pre_shared_settings')
            if isinstance(snapshot, dict) and snapshot:
                settings.api_provider = snapshot.get('api_provider') or settings.api_provider
                settings.api_key = snapshot.get('api_key') or ''
                settings.api_base_url = snapshot.get('api_base_url')
                settings.llm_model = snapshot.get('llm_model')
                settings.temperature = snapshot.get('temperature')
                settings.max_tokens = snapshot.get('max_tokens')
                settings.system_prompt = snapshot.get('system_prompt')
                settings.disable_thinking = bool(snapshot.get('disable_thinking', False))
            prefs.pop('active_shared_config_id', None)
            prefs.pop('pre_shared_settings', None)
        settings.preferences = json.dumps(prefs, ensure_ascii=False)
        await db.commit()
        logger.info(f"用户 {user.user_id} 隐藏公共 API 配置: {shared_id}")
        return {"message": "已从列表移除", "config_id": config_id}

    payload = _get_text_models_payload(prefs)
    configs = payload.get('configs', [])

    target = next((cfg for cfg in configs if cfg.get('id') == config_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="配置不存在")

    payload['configs'] = [cfg for cfg in configs if cfg.get('id') != config_id]
    if prefs.get('chapter_analysis_config_id') == config_id:
        prefs.pop('chapter_analysis_config_id', None)
    prefs['text_models'] = payload
    settings.preferences = json.dumps(prefs, ensure_ascii=False)

    await db.commit()
    logger.info(f"用户 {user.user_id} 删除文本模型配置: {config_id}")
    return {"message": "已删除", "config_id": config_id}


@router.post("/text-models/{config_id}/test")
async def test_text_model(
    config_id: str,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """测试单条文本模型配置的 API 连接，不影响当前生效配置。"""
    if _is_shared_card_id(config_id):
        shared = await _get_shared_api_config(db, _shared_id_from_card(config_id))
        if not shared:
            raise HTTPException(status_code=404, detail="公共配置不存在或已停用")
        target = _shared_config_to_settings(shared)
        target["shared_config_id"] = shared.id
        target["shared_config_name"] = shared.name
        target["model_display_name"] = shared.model_display_name or shared.llm_model
        logger.info(f"用户 {user.user_id} 测试公共 API 配置: {shared.name}")
    else:
        settings = await get_user_settings(user.user_id, db)
        prefs = _safe_load_preferences(settings.preferences)
        configs = _get_text_models_payload(prefs).get('configs', [])
        found = next((cfg for cfg in configs if cfg.get('id') == config_id), None)
        if not found:
            raise HTTPException(status_code=404, detail="配置不存在")
        target = found
        logger.info(f"用户 {user.user_id} 测试文本模型配置: {found.get('name')}")

    if _is_shared_card_id(config_id):
        quota_status = await get_quota_status(
            db,
            user_id=user.user_id,
            config_type=CONFIG_TYPE_TEXT,
            config_id=target["shared_config_id"],
            daily_limit=target.get("daily_call_limit"),
            total_limit=target.get("total_call_limit"),
        )
        if quota_status.is_exhausted:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"「{target['shared_config_name']}」调用次数已达上限，"
                    "请切换其他配置或稍后再试"
                ),
            )
        await consume_quota(
            db,
            user_id=user.user_id,
            config_type=CONFIG_TYPE_TEXT,
            config_id=target["shared_config_id"],
            config_name=target["shared_config_name"],
            daily_limit=target.get("daily_call_limit"),
            total_limit=target.get("total_call_limit"),
        )
        result = await test_api_connection(
            ApiTestRequest(
                api_key=target.get('api_key') or '',
                api_base_url=target.get('api_base_url') or '',
                provider=target.get('api_provider') or 'openai',
                llm_model=target.get('llm_model') or '',
                temperature=target.get('temperature'),
                max_tokens=target.get('max_tokens'),
            )
        )
        if not result.get("success"):
            await refund_quota(
                db,
                user_id=user.user_id,
                config_type=CONFIG_TYPE_TEXT,
                config_id=target["shared_config_id"],
            )
        else:
            # 测试请求也走通了公共配置，但仍返回给前端别名模型名
            result["model"] = target.get('model_display_name') or target.get('llm_model')
    else:
        result = await test_api_connection(
            ApiTestRequest(
                api_key=target.get('api_key') or '',
                api_base_url=target.get('api_base_url') or '',
                provider=target.get('api_provider') or 'openai',
                llm_model=target.get('llm_model') or '',
                temperature=target.get('temperature'),
                max_tokens=target.get('max_tokens'),
            )
        )
    if _is_shared_card_id(config_id) and isinstance(result, dict):
        # 测试结果也不回显真实模型名
        result["model"] = target.get('model_display_name') or target.get('llm_model')
    return result


# ========== 管理员下发的公共配置（用户侧） ==========

@router.get("/shared-api-configs", response_model=List[SharedApiConfigSummary])
async def list_shared_api_configs_for_user(
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """列出管理员开放的公共配置（不含密钥），供用户端展示说明。"""
    from app.models.shared_api_config import SharedApiConfig

    result = await db.execute(
        select(SharedApiConfig)
        .where(SharedApiConfig.is_enabled.is_(True))
        .order_by(SharedApiConfig.sort_order.asc(), SharedApiConfig.created_at.asc())
    )
    return [
        SharedApiConfigSummary(
            id=record.id,
            name=record.name,
            note=record.note,
            api_provider=record.api_provider,
            # 用户端只判断「是否可用」，接口地址不下发，避免暴露管理员的基础设施
            api_base_url=None,
            llm_model=record.model_display_name or record.llm_model,
            model_display_name=record.model_display_name or record.llm_model,
            temperature=record.temperature,
            max_tokens=record.max_tokens,
            disable_thinking=bool(record.disable_thinking),
            daily_call_limit=record.daily_call_limit,
            total_call_limit=record.total_call_limit,
            already_imported=False,
        )
        for record in result.scalars().all()
    ]


@router.post("/shared-api-configs/{config_id}/import", response_model=TextModelConfig)
async def import_shared_api_config(
    config_id: str,
    data: SharedApiConfigImportRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """兼容旧入口：公共配置已自动出现在用户列表，这里只做「启用」。"""
    shared = await _get_shared_api_config(db, config_id)
    if not shared:
        raise HTTPException(status_code=404, detail="公共配置不存在或已停用")

    if data.activate:
        await activate_text_model(f"shared_{shared.id}", user=user, db=db)

    return (_present_text_model([_virtual_card(shared)]))[0]


async def _apply_text_model_to_settings(
    settings: Settings,
    config: Dict[str, Any],
    prefs: Optional[Dict[str, Any]] = None,
) -> None:
    """把文本模型配置写入主设置字段，使其真正生效。

    公共配置（带 `shared_config_id`）只记录引用：主字段写入非敏感信息，
    密钥始终留在 shared_api_configs 表，由运行时解析，避免用户拿到明文。
    """
    shared_id = config.get('shared_config_id')
    resolved = resolve_runtime_ai_config(
        config.get('api_provider'),
        config.get('api_key'),
        config.get('api_base_url'),
    )

    if prefs is not None and shared_id and not prefs.get('pre_shared_settings'):
        # 首次切到公共配置时快照当前的生效配置，供管理员停用后回退
        prefs['pre_shared_settings'] = {
            'api_provider': settings.api_provider,
            'api_key': settings.api_key,
            'api_base_url': settings.api_base_url,
            'llm_model': settings.llm_model,
            'temperature': settings.temperature,
            'max_tokens': settings.max_tokens,
            'system_prompt': settings.system_prompt,
            'disable_thinking': bool(getattr(settings, 'disable_thinking', False)),
        }

    settings.api_provider = _normalize_raw_provider(config.get('api_provider'))
    if shared_id:
        # 公共配置不在用户身上存密钥：保留他原本的 Key，
        # 管理员停用后可以继续回退到自己的一套，不至于直接不可用
        settings.api_key = settings.api_key or ""
    else:
        settings.api_key = config.get('api_key') or ""
    settings.api_base_url = resolved["api_base_url"]
    settings.llm_model = config.get('llm_model')
    settings.temperature = config.get('temperature')
    settings.max_tokens = config.get('max_tokens')
    if not shared_id:
        # 公共配置的系统提示词由管理员侧在运行时注入，不落到用户记录里
        settings.system_prompt = config.get('system_prompt')
    settings.disable_thinking = bool(config.get('disable_thinking', False))

    if prefs is not None:
        if shared_id:
            prefs['active_shared_config_id'] = shared_id
        else:
            prefs.pop('active_shared_config_id', None)
            # 切回自己的卡片时清掉快照，避免下次误用旧值
            prefs.pop('pre_shared_settings', None)
        settings.preferences = json.dumps(prefs, ensure_ascii=False)
