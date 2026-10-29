"""项目连续性追踪状态与章节事务。"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.database import Base
import uuid


class StoryTrackingState(Base):
    """项目连续性的唯一权威状态。"""

    __tablename__ = "story_tracking_states"

    project_id = Column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    schema_version = Column(Integer, nullable=False, default=1)
    state_revision = Column(Integer, nullable=False, default=0)
    last_committed_chapter = Column(Integer, nullable=False, default=0)
    imported_through_chapter = Column(Integer, nullable=False, default=0)
    state_status = Column(String(30), nullable=False, default="needs_review")
    state_json = Column(JSON, nullable=False, default=dict)
    lease_owner = Column(String(100))
    lease_expires_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ChapterTrackingTransaction(Base):
    """一次章节追踪提交的审计与幂等记录。"""

    __tablename__ = "chapter_tracking_transactions"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "chapter_id",
            "revision",
            "body_sha256",
            name="uq_chapter_tracking_transaction",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chapter_id = Column(
        String(36),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    mode = Column(String(20), nullable=False, default="append")
    revision = Column(Integer, nullable=False)
    expected_state_revision = Column(Integer, nullable=False)
    result_state_revision = Column(Integer)
    body_sha256 = Column(String(64), nullable=False)
    status = Column(String(30), nullable=False, default="pending")
    transaction_json = Column(JSON, nullable=False, default=dict)
    quality_report = Column(JSON, nullable=False, default=dict)
    audit_json = Column(JSON, nullable=False, default=dict)
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    committed_at = Column(DateTime)
