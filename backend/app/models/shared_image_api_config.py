"""管理员发布的公共图片模型配置。

图片配置只包含生图所需字段，与文本模型的温度、Token 和提示词无关。
密钥仅保存在服务端，用户卡片只持有 `shared_img_<id>` 引用。
"""
from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.sql import func

from app.database import Base
import uuid


class SharedImageApiConfig(Base):
    """管理员发布的公共图片模型配置"""

    __tablename__ = "shared_image_api_configs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(50), nullable=False, comment="配置名称")
    note = Column(String(200), comment="备注/使用说明")
    api_provider = Column(String(50), nullable=False, comment="图片 API 提供商")
    api_key = Column(String(500), comment="API 密钥（仅管理员可见）")
    api_base_url = Column(String(500), comment="自定义 API 地址")
    image_model = Column(String(100), nullable=False, comment="真实图片模型名称")
    model_display_name = Column(String(100), comment="用户端显示的模型名称；留空则显示真实模型名")
    is_enabled = Column(Boolean, default=True, server_default="1", nullable=False, comment="是否开放给用户加载")
    daily_call_limit = Column(Integer, comment="每用户每日生成封面上限；NULL 表示不限")
    total_call_limit = Column(Integer, comment="每用户累计生成封面上限；NULL 表示不限")
    sort_order = Column(Integer, default=0, server_default="0", nullable=False, comment="排序权重")
    created_by = Column(String(100), comment="创建管理员ID")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def __repr__(self):
        return (
            f"<SharedImageApiConfig(id={self.id}, name={self.name}, "
            f"is_enabled={self.is_enabled})>"
        )
