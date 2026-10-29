"""add invite code disable fields

Revision ID: 20261029_invite_actions_sqlite
Revises: 20261029_invite_codes_sqlite
Create Date: 2026-10-29 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261029_invite_actions_sqlite"
down_revision: Union[str, None] = "20261029_invite_codes_sqlite"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("invite_codes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("disabled_at", sa.DateTime(), nullable=True, comment="禁用时间"))
        batch_op.add_column(
            sa.Column("disabled_by_user_id", sa.String(length=100), nullable=True, comment="执行禁用的管理员ID"),
        )
        batch_op.add_column(
            sa.Column("disabled_by_username", sa.String(length=100), nullable=True, comment="执行禁用的管理员用户名"),
        )
        batch_op.create_index("idx_invite_codes_disabled_at", ["disabled_at"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("invite_codes", schema=None) as batch_op:
        batch_op.drop_index("idx_invite_codes_disabled_at")
        batch_op.drop_column("disabled_by_username")
        batch_op.drop_column("disabled_by_user_id")
        batch_op.drop_column("disabled_at")
