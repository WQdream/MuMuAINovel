"""设置相关的Pydantic模型"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime


class SettingsBase(BaseModel):
    """设置基础模型"""
    model_config = ConfigDict(protected_namespaces=())
    
    api_provider: Optional[str] = Field(default="openai", description="API提供商")
    api_key: Optional[str] = Field(default=None, description="API密钥")
    api_base_url: Optional[str] = Field(default=None, description="自定义API地址")
    llm_model: Optional[str] = Field(default="gpt-4", description="模型名称")
    temperature: Optional[float] = Field(default=0.7, ge=0.0, le=2.0, description="温度参数")
    max_tokens: Optional[int] = Field(default=2000, ge=1, description="最大token数")
    system_prompt: Optional[str] = Field(default=None, description="系统级别提示词，每次AI调用都会使用")
    disable_thinking: Optional[bool] = Field(default=False, description="关闭模型思考：思考型模型跳过思考阶段直接输出正文，减少token消耗与等待时间")
    cover_api_provider: Optional[str] = Field(default=None, description="封面图片API提供商")
    cover_api_key: Optional[str] = Field(default=None, description="封面图片API密钥")
    cover_api_base_url: Optional[str] = Field(default=None, description="封面图片自定义API地址")
    cover_image_model: Optional[str] = Field(default=None, description="封面图片模型名称")
    cover_enabled: Optional[bool] = Field(default=False, description="是否启用封面图片生成")
    preferences: Optional[str] = Field(default=None, description="其他偏好设置(JSON)")


class SettingsCreate(SettingsBase):
    """创建设置请求模型"""
    pass


class SettingsUpdate(SettingsBase):
    """更新设置请求模型"""
    pass


class SettingsResponse(SettingsBase):
    """设置响应模型"""
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: str
    user_id: str
    shared_config_active: bool = Field(
        default=False,
        description="当前生效的是否为管理员下发的公共配置；此时 api_key / api_base_url 已被清空",
    )
    created_at: datetime
    updated_at: datetime


class SystemSMTPSettingsBase(BaseModel):
    """系统 SMTP 设置基础模型"""
    model_config = ConfigDict(protected_namespaces=())

    smtp_provider: str = Field(default="qq", description="SMTP 提供商")
    smtp_host: Optional[str] = Field(default=None, description="SMTP 主机")
    smtp_port: int = Field(default=465, ge=1, le=65535, description="SMTP 端口")
    smtp_username: Optional[str] = Field(default=None, description="SMTP 用户名")
    smtp_password: Optional[str] = Field(default=None, description="SMTP 密码或授权码")
    smtp_use_tls: bool = Field(default=False, description="是否启用 TLS")
    smtp_use_ssl: bool = Field(default=True, description="是否启用 SSL")
    smtp_from_email: Optional[str] = Field(default=None, description="发件人邮箱")
    smtp_from_name: str = Field(default="MuMuAINovel", description="发件人名称")
    email_auth_enabled: bool = Field(default=True, description="是否启用邮箱认证")
    email_register_enabled: bool = Field(default=True, description="是否启用邮箱注册")
    verification_code_ttl_minutes: int = Field(default=10, ge=1, le=120, description="验证码有效期（分钟）")
    verification_resend_interval_seconds: int = Field(default=60, ge=10, le=3600, description="验证码重发间隔（秒）")


class SystemSMTPSettingsUpdate(SystemSMTPSettingsBase):
    """系统 SMTP 设置更新模型"""
    pass


class SystemSMTPSettingsResponse(SystemSMTPSettingsBase):
    """系统 SMTP 设置响应模型"""
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: str
    user_id: str
    created_at: datetime
    updated_at: datetime


class SMTPTestRequest(BaseModel):
    """SMTP 测试请求模型"""
    model_config = ConfigDict(protected_namespaces=())

    to_email: str = Field(..., min_length=3, max_length=255, description="测试收件邮箱")


# ========== 文本模型配置 ==========

class TextModelConfigPayload(BaseModel):
    """一条文本模型配置的内容"""
    model_config = ConfigDict(protected_namespaces=())

    api_provider: str = Field(..., description="API提供商")
    api_key: str = Field(default="", description="API密钥")
    api_base_url: Optional[str] = Field(None, description="自定义API地址")
    llm_model: str = Field(..., description="模型名称")
    model_display_name: Optional[str] = Field(
        default=None,
        description="用户端展示名；仅公共配置会由管理员设置",
    )
    temperature: float = Field(default=0.7, ge=0.0, le=2.0, description="温度参数")
    max_tokens: int = Field(default=2000, ge=1, description="最大token数")
    system_prompt: Optional[str] = Field(default=None, description="系统级别提示词")
    disable_thinking: bool = Field(default=False, description="关闭模型思考")


class TextModelConfig(TextModelConfigPayload):
    """保存的文本模型配置"""
    id: str = Field(..., description="配置ID")
    name: str = Field(..., min_length=1, max_length=50, description="配置名称")
    note: Optional[str] = Field(None, max_length=200, description="备注")
    is_active: bool = Field(default=False, description="是否为当前启用")
    shared_config_id: Optional[str] = Field(
        default=None, description="引用管理员公共配置时的来源ID；存在即为公共配置卡片"
    )
    shared_available: Optional[bool] = Field(
        default=None, description="公共配置是否仍处于开放状态；仅在 shared_config_id 存在时有意义"
    )
    quota_daily_limit: Optional[int] = Field(None, description="公共配置每用户每日调用上限；为空表示不限")
    quota_daily_used: Optional[int] = Field(None, description="公共配置今日已调用次数")
    quota_daily_remaining: Optional[int] = Field(None, description="公共配置今日剩余调用次数；为空表示不限")
    quota_total_limit: Optional[int] = Field(None, description="公共配置每用户累计调用上限；为空表示不限")
    quota_total_used: Optional[int] = Field(None, description="公共配置累计已调用次数")
    quota_total_remaining: Optional[int] = Field(None, description="公共配置累计剩余调用次数；为空表示不限")
    created_at: datetime = Field(..., description="创建时间")


class TextModelConfigCreateRequest(TextModelConfigPayload):
    """新增文本模型配置"""
    name: str = Field(..., min_length=1, max_length=50, description="配置名称")
    note: Optional[str] = Field(None, max_length=200, description="备注")


class TextModelConfigUpdateRequest(BaseModel):
    """更新文本模型配置（字段均可选）"""
    model_config = ConfigDict(protected_namespaces=())

    name: Optional[str] = Field(None, min_length=1, max_length=50)
    note: Optional[str] = Field(None, max_length=200)
    api_provider: Optional[str] = None
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(None, ge=1)
    system_prompt: Optional[str] = None
    disable_thinking: Optional[bool] = None


class TextModelConfigListResponse(BaseModel):
    """文本模型配置列表"""
    model_config = ConfigDict(protected_namespaces=())

    configs: List[TextModelConfig] = Field(default_factory=list, description="配置列表")
    total: int = Field(0, description="总数")
    active_config_id: Optional[str] = Field(None, description="当前启用的配置ID")
    chapter_analysis_config_id: Optional[str] = Field(None, description="章节内容分析专用的配置ID，为空则沿用当前启用配置")


class ChapterAnalysisTextModelSelectionRequest(BaseModel):
    """章节内容分析专用配置选择请求"""
    model_config = ConfigDict(protected_namespaces=())

    config_id: Optional[str] = Field(None, description="章节内容分析使用的配置ID；为空则沿用当前启用配置")


class SharedApiConfigSummary(BaseModel):
    """用户端可见的公共配置摘要（不含密钥）"""
    model_config = ConfigDict(protected_namespaces=())

    id: str
    name: str
    note: Optional[str] = None
    api_provider: str
    api_base_url: Optional[str] = None
    # 公共配置对外展示的模型名；真实模型名不会下发给普通用户
    llm_model: str
    model_display_name: Optional[str] = Field(
        default=None,
        description="用户端展示的模型名（未单独配置时与 llm_model 相同）",
    )
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    disable_thinking: bool = False
    already_imported: bool = Field(default=False, description="当前用户是否已导入过")
    daily_call_limit: Optional[int] = None
    total_call_limit: Optional[int] = None


class SharedApiConfigImportRequest(BaseModel):
    """导入公共配置请求"""
    model_config = ConfigDict(protected_namespaces=())

    activate: bool = Field(default=False, description="导入后是否立即启用")


# ========== 图片模型配置 ==========

class ImageModelConfigPayload(BaseModel):
    """一套图片模型配置。"""

    model_config = ConfigDict(protected_namespaces=())

    api_provider: str = Field(..., description="图片 API 提供商")
    api_key: str = Field(default="", description="图片 API 密钥")
    api_base_url: Optional[str] = Field(None, description="自定义 API 地址")
    image_model: str = Field(..., description="图片模型名称")
    model_display_name: Optional[str] = Field(
        default=None,
        description="用户端展示名；留空则显示真实图片模型名",
    )


class ImageModelConfig(ImageModelConfigPayload):
    """用户端图片模型卡片。"""

    id: str
    name: str = Field(..., min_length=1, max_length=50)
    note: Optional[str] = Field(None, max_length=200)
    is_active: bool = False
    shared_config_id: Optional[str] = Field(
        default=None,
        description="引用管理员公共图片配置时的来源 ID",
    )
    shared_available: Optional[bool] = None
    shared_config_name: Optional[str] = Field(
        default=None,
        description="公共配置名称快照，仅用于详情页展示",
    )
    quota_daily_limit: Optional[int] = Field(None, description="公共配置每用户每日生成封面上限")
    quota_daily_used: Optional[int] = None
    quota_daily_remaining: Optional[int] = Field(None, description="今日剩余生成次数；为空表示不限")
    quota_total_limit: Optional[int] = None
    quota_total_used: Optional[int] = None
    quota_total_remaining: Optional[int] = Field(None, description="累计剩余生成次数；为空表示不限")
    created_at: datetime


class ImageModelConfigCreateRequest(ImageModelConfigPayload):
    """新增个人图片模型配置。"""

    name: str = Field(..., min_length=1, max_length=50)
    note: Optional[str] = Field(None, max_length=200)


class ImageModelConfigUpdateRequest(BaseModel):
    """更新个人图片模型配置。"""

    model_config = ConfigDict(protected_namespaces=())

    name: Optional[str] = Field(None, min_length=1, max_length=50)
    note: Optional[str] = Field(None, max_length=200)
    api_provider: Optional[str] = None
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    image_model: Optional[str] = None
    model_display_name: Optional[str] = Field(None, max_length=100)


class ImageModelConfigListResponse(BaseModel):
    """图片模型卡片列表。"""

    configs: List[ImageModelConfig] = Field(default_factory=list)
    total: int = 0
    active_config_id: Optional[str] = None
