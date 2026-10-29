"""add email login policy

Revision ID: 20261029_email_login_sqlite
Revises: 20261026_public_api_quotas
Create Date: 2026-10-29 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261029_email_login_sqlite"
down_revision: Union[str, None] = "20261026_public_api_quotas"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("settings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "email_login_enabled",
                sa.Boolean(),
                server_default="1",
                nullable=False,
                comment="是否启用邮箱验证码登录",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("settings", schema=None) as batch_op:
        batch_op.drop_column("email_login_enabled")
