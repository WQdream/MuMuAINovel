"""公共 API 配置的用户调用计数。"""
from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint, func

from app.database import Base


class ApiUsageCounter(Base):
    """按「用户 × 公共配置」累计调用次数。

    `daily_calls` 只对 `usage_date` 当天有效，换日时原子地重置为 1；
    `total_calls` 跨天累计。两者共用一行，避免总上限校验出现竞态。
    """

    __tablename__ = "api_usage_counters"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "config_type",
            "config_id",
            name="uq_api_usage_user_config",
        ),
    )

    id = Column(String(36), primary_key=True)
    user_id = Column(String(100), nullable=False, index=True, comment="调用用户ID")
    config_type = Column(
        String(20),
        nullable=False,
        comment="配置类型：text / image",
    )
    config_id = Column(String(36), nullable=False, index=True, comment="公共配置ID")
    usage_date = Column(String(10), nullable=False, index=True, comment="自然日 YYYY-MM-DD")
    daily_calls = Column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="当天已调用次数",
    )
    total_calls = Column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="该配置累计调用次数",
    )
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    def __repr__(self):
        return (
            f"<ApiUsageCounter(user_id={self.user_id}, config_type={self.config_type}, "
            f"config_id={self.config_id}, usage_date={self.usage_date})>"
        )
