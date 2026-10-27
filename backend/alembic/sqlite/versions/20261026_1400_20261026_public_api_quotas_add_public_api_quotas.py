"""add public API quotas

Revision ID: 20261026_public_api_quotas
Revises: 20261026_shared_img_configs
Create Date: 2026-10-26 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261026_public_api_quotas"
down_revision: Union[str, None] = "20261026_shared_img_configs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("shared_api_configs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "daily_call_limit",
                sa.Integer(),
                nullable=True,
                comment="每用户每日调用上限；NULL 表示不限",
            )
        )
        batch_op.add_column(
            sa.Column(
                "total_call_limit",
                sa.Integer(),
                nullable=True,
                comment="每用户累计调用上限；NULL 表示不限",
            )
        )

    with op.batch_alter_table("shared_image_api_configs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "daily_call_limit",
                sa.Integer(),
                nullable=True,
                comment="每用户每日生成封面上限；NULL 表示不限",
            )
        )
        batch_op.add_column(
            sa.Column(
                "total_call_limit",
                sa.Integer(),
                nullable=True,
                comment="每用户累计生成封面上限；NULL 表示不限",
            )
        )

    op.create_table(
        "api_usage_counters",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=100), nullable=False, comment="调用用户ID"),
        sa.Column(
            "config_type",
            sa.String(length=20),
            nullable=False,
            comment="配置类型：text / image",
        ),
        sa.Column("config_id", sa.String(length=36), nullable=False, comment="公共配置ID"),
        sa.Column("usage_date", sa.String(length=10), nullable=False, comment="自然日 YYYY-MM-DD"),
        sa.Column("daily_calls", sa.Integer(), server_default="0", nullable=False, comment="当天已调用次数"),
        sa.Column("total_calls", sa.Integer(), server_default="0", nullable=False, comment="该配置累计调用次数"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
            comment="创建时间",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
            comment="更新时间",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "config_type",
            "config_id",
            name="uq_api_usage_user_config",
        ),
    )
    with op.batch_alter_table("api_usage_counters", schema=None) as batch_op:
        batch_op.create_index("ix_api_usage_counters_user_id", ["user_id"], unique=False)
        batch_op.create_index("ix_api_usage_counters_config_id", ["config_id"], unique=False)
        batch_op.create_index("ix_api_usage_counters_usage_date", ["usage_date"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("api_usage_counters", schema=None) as batch_op:
        batch_op.drop_index("ix_api_usage_counters_usage_date")
        batch_op.drop_index("ix_api_usage_counters_config_id")
        batch_op.drop_index("ix_api_usage_counters_user_id")

    op.drop_table("api_usage_counters")
    with op.batch_alter_table("shared_image_api_configs", schema=None) as batch_op:
        batch_op.drop_column("total_call_limit")
        batch_op.drop_column("daily_call_limit")
    with op.batch_alter_table("shared_api_configs", schema=None) as batch_op:
        batch_op.drop_column("total_call_limit")
        batch_op.drop_column("daily_call_limit")
