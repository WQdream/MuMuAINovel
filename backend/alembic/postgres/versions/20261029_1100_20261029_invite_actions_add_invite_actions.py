"""add invite code disable fields

Revision ID: 20261029_invite_actions_pg
Revises: 20261029_invite_codes_pg
Create Date: 2026-10-29 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261029_invite_actions_pg"
down_revision: Union[str, None] = "20261029_invite_codes_pg"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("invite_codes", sa.Column("disabled_at", sa.DateTime(), nullable=True, comment="禁用时间"))
    op.add_column(
        "invite_codes",
        sa.Column("disabled_by_user_id", sa.String(length=100), nullable=True, comment="执行禁用的管理员ID"),
    )
    op.add_column(
        "invite_codes",
        sa.Column("disabled_by_username", sa.String(length=100), nullable=True, comment="执行禁用的管理员用户名"),
    )
    op.create_index("idx_invite_codes_disabled_at", "invite_codes", ["disabled_at"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_invite_codes_disabled_at", table_name="invite_codes")
    op.drop_column("invite_codes", "disabled_by_username")
    op.drop_column("invite_codes", "disabled_by_user_id")
    op.drop_column("invite_codes", "disabled_at")
