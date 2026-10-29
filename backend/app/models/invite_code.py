"""邀请码数据模型"""
from sqlalchemy import Column, DateTime, Index, String
from sqlalchemy.sql import func
from app.database import Base


class InviteCode(Base):
    """一次性注册邀请码"""
    __tablename__ = "invite_codes"

    id = Column(String(36), primary_key=True, comment="UUID")
    code = Column(String(32), nullable=False, unique=True, index=True, comment="规范化后的邀请码")
    note = Column(String(200), nullable=True, comment="管理员备注")
    created_by_user_id = Column(String(100), nullable=False, comment="创建管理员ID")
    created_by_username = Column(String(100), nullable=True, comment="创建管理员用户名")
    created_at = Column(DateTime, server_default=func.now(), nullable=False, comment="创建时间")
    used_at = Column(DateTime, nullable=True, comment="使用时间")
    used_by_user_id = Column(String(100), nullable=True, comment="使用邀请码注册的用户ID")
    used_by_username = Column(String(100), nullable=True, comment="使用邀请码注册的用户名")
    disabled_at = Column(DateTime, nullable=True, comment="禁用时间")
    disabled_by_user_id = Column(String(100), nullable=True, comment="执行禁用的管理员ID")
    disabled_by_username = Column(String(100), nullable=True, comment="执行禁用的管理员用户名")

    __table_args__ = (
        Index("idx_invite_codes_used_at", "used_at"),
        Index("idx_invite_codes_disabled_at", "disabled_at"),
    )

    def __repr__(self):
        return f"<InviteCode(code={self.code}, used={bool(self.used_at)})>"
