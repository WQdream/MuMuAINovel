"""add cover failure category and dismissal

Revision ID: 20261029_cover_failure_ui_sqlite
Revises: 20261029_invite_actions_sqlite
Create Date: 2026-10-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261029_cover_failure_ui_sqlite"
down_revision: Union[str, None] = "20261029_invite_actions_sqlite"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("cover_error_category", sa.String(length=20), nullable=True, comment="封面失败类型: auth/timeout/other"),
        )
        batch_op.add_column(
            sa.Column("cover_error_dismissed_at", sa.DateTime(), nullable=True, comment="封面失败提示被用户隐藏的时间"),
        )


def downgrade() -> None:
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.drop_column("cover_error_dismissed_at")
        batch_op.drop_column("cover_error_category")
