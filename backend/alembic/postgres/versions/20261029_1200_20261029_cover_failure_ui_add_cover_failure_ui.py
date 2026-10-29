"""add cover failure category and dismissal

Revision ID: 20261029_cover_failure_ui_pg
Revises: 20261029_invite_actions_pg
Create Date: 2026-10-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261029_cover_failure_ui_pg"
down_revision: Union[str, None] = "20261029_invite_actions_pg"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("cover_error_category", sa.String(length=20), nullable=True, comment="封面失败类型: auth/timeout/other"),
    )
    op.add_column(
        "projects",
        sa.Column("cover_error_dismissed_at", sa.DateTime(), nullable=True, comment="封面失败提示被用户隐藏的时间"),
    )


def downgrade() -> None:
    op.drop_column("projects", "cover_error_dismissed_at")
    op.drop_column("projects", "cover_error_category")
