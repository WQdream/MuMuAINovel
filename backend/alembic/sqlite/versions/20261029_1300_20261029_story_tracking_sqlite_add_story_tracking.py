"""add authoritative story tracking state

Revision ID: 20261029_story_tracking_sqlite
Revises: 20261029_cover_failure_ui_sqlite
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261029_story_tracking_sqlite"
down_revision: Union[str, None] = "20261029_cover_failure_ui_sqlite"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("chapters", schema=None) as batch_op:
        batch_op.add_column(sa.Column("quality_status", sa.String(length=30), server_default="draft", nullable=False))
        batch_op.add_column(sa.Column("tracking_status", sa.String(length=30), server_default="uninitialized", nullable=False))
        batch_op.add_column(sa.Column("tracking_revision", sa.Integer(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("tracking_body_sha256", sa.String(length=64), nullable=True))

    op.create_table(
        "story_tracking_states",
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("state_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_committed_chapter", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("imported_through_chapter", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("state_status", sa.String(length=30), nullable=False, server_default="needs_review"),
        sa.Column("state_json", sa.JSON(), nullable=False),
        sa.Column("lease_owner", sa.String(length=100), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id"),
    )
    op.create_table(
        "chapter_tracking_transactions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("chapter_id", sa.String(length=36), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False, server_default="append"),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("expected_state_revision", sa.Integer(), nullable=False),
        sa.Column("result_state_revision", sa.Integer(), nullable=True),
        sa.Column("body_sha256", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("transaction_json", sa.JSON(), nullable=False),
        sa.Column("quality_report", sa.JSON(), nullable=False),
        sa.Column("audit_json", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("committed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["chapter_id"], ["chapters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id",
            "chapter_id",
            "revision",
            "body_sha256",
            name="uq_chapter_tracking_transaction",
        ),
    )
    op.create_index(
        "ix_chapter_tracking_transactions_project_id",
        "chapter_tracking_transactions",
        ["project_id"],
    )
    op.create_index(
        "ix_chapter_tracking_transactions_chapter_id",
        "chapter_tracking_transactions",
        ["chapter_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_chapter_tracking_transactions_chapter_id", table_name="chapter_tracking_transactions")
    op.drop_index("ix_chapter_tracking_transactions_project_id", table_name="chapter_tracking_transactions")
    op.drop_table("chapter_tracking_transactions")
    op.drop_table("story_tracking_states")
    with op.batch_alter_table("chapters", schema=None) as batch_op:
        batch_op.drop_column("tracking_body_sha256")
        batch_op.drop_column("tracking_revision")
        batch_op.drop_column("tracking_status")
        batch_op.drop_column("quality_status")
