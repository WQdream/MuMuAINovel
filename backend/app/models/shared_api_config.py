"""公共 API 配置数据模型（由管理员在管理后台统一维护）

设计要点：
- 密钥只存在这张表里，用户端只保存 `shared_config_id` 引用，
  这样管理员可以随时轮换密钥，用户拿不到明文。
- `is_enabled` 表示「是否允许用户加载」，与用户卡片的 `is_active`（当前生效）无关。
"""
from sqlalchemy import Column, String, Text, Float, Integer, Boolean, DateTime
from sqlalchemy.sql import func
from app.database import Base
import uuid


class SharedApiConfig(Base):
    """管理员发布的公共 API 配置"""

    __tablename__ = "shared_api_configs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(50), nullable=False, comment="配置名称")
    note = Column(String(200), comment="备注/使用说明")
    api_provider = Column(String(50), nullable=False, default="openai", comment="API提供商")
    api_key = Column(String(500), comment="API密钥（仅管理员可见）")
    api_base_url = Column(String(500), comment="自定义API地址")
    llm_model = Column(String(100), nullable=False, comment="模型名称")
    model_display_name = Column(String(100), comment="用户端显示的模型名称；留空则显示真实模型名")
    temperature = Column(Float, default=0.7, comment="温度参数默认值")
    max_tokens = Column(Integer, default=2000, comment="最大token数默认值")
    system_prompt = Column(Text, comment="系统提示词默认值")
    disable_thinking = Column(Boolean, default=False, server_default="0", nullable=False, comment="是否关闭模型思考")
    is_enabled = Column(Boolean, default=True, server_default="1", nullable=False, comment="是否开放给用户加载")
    daily_call_limit = Column(Integer, comment="每用户每日调用上限；NULL 表示不限")
    total_call_limit = Column(Integer, comment="每用户累计调用上限；NULL 表示不限")
    sort_order = Column(Integer, default=0, server_default="0", nullable=False, comment="排序权重，越小越前")
    created_by = Column(String(100), comment="创建管理员ID")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def __repr__(self):
        return f"<SharedApiConfig(id={self.id}, name={self.name}, is_enabled={self.is_enabled})>"
