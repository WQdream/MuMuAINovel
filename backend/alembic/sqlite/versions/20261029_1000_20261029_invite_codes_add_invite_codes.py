"""add invite codes

Revision ID: 20261029_invite_codes_sqlite
Revises: 20261029_email_login_sqlite
Create Date: 2026-10-29 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261029_invite_codes_sqlite"
down_revision: Union[str, None] = "20261029_email_login_sqlite"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "invite_codes",
        sa.Column("id", sa.String(length=36), nullable=False, comment="UUID"),
        sa.Column("code", sa.String(length=32), nullable=False, comment="规范化后的邀请码"),
        sa.Column("note", sa.String(length=200), nullable=True, comment="管理员备注"),
        sa.Column("created_by_user_id", sa.String(length=100), nullable=False, comment="创建管理员ID"),
        sa.Column("created_by_username", sa.String(length=100), nullable=True, comment="创建管理员用户名"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False, comment="创建时间"),
        sa.Column("used_at", sa.DateTime(), nullable=True, comment="使用时间"),
        sa.Column("used_by_user_id", sa.String(length=100), nullable=True, comment="使用邀请码注册的用户ID"),
        sa.Column("used_by_username", sa.String(length=100), nullable=True, comment="使用邀请码注册的用户名"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("invite_codes", schema=None) as batch_op:
        batch_op.create_index("ix_invite_codes_code", ["code"], unique=True)
        batch_op.create_index("idx_invite_codes_used_at", ["used_at"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("invite_codes", schema=None) as batch_op:
        batch_op.drop_index("idx_invite_codes_used_at")
        batch_op.drop_index("ix_invite_codes_code")
    op.drop_table("invite_codes")
