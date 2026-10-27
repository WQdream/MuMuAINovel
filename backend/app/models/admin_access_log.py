"""管理员访问审计日志数据模型"""
from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base
import uuid


class AdminAccessLog(Base):
    """管理员查阅用户作品的审计记录（仅记录到项目级）"""

    __tablename__ = "admin_access_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    admin_id = Column(String(100), nullable=False, index=True, comment="访问管理员ID")
    admin_name = Column(String(200), comment="管理员显示名快照")
    target_user_id = Column(String(100), nullable=False, index=True, comment="被访问的用户ID")
    target_username = Column(String(200), comment="被访问用户显示名快照")
    project_id = Column(String(36), nullable=False, index=True, comment="被访问的项目ID")
    project_title = Column(String(200), comment="项目标题快照")
    action = Column(String(50), nullable=False, default="view_project", comment="动作类型")
    ip = Column(String(100), comment="请求来源IP")
    user_agent = Column(Text, comment="请求User-Agent")
    created_at = Column(DateTime, nullable=False, server_default=func.now(), index=True, comment="创建时间")

    def __repr__(self):
        return (
            f"<AdminAccessLog(admin_id={self.admin_id}, "
            f"project_id={self.project_id}, action={self.action})>"
        )
