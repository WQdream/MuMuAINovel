"""add shared image api configs table

Revision ID: 20261026_shared_img_configs
Revises: 20261026_model_display_name
Create Date: 2026-10-26 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261026_shared_img_configs"
down_revision: Union[str, None] = "20261026_model_display_name"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shared_image_api_configs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False, comment="配置名称"),
        sa.Column("note", sa.String(length=200), nullable=True, comment="备注/使用说明"),
        sa.Column("api_provider", sa.String(length=50), nullable=False, comment="图片 API 提供商"),
        sa.Column("api_key", sa.String(length=500), nullable=True, comment="API 密钥（仅管理员可见）"),
        sa.Column("api_base_url", sa.String(length=500), nullable=True, comment="自定义 API 地址"),
        sa.Column("image_model", sa.String(length=100), nullable=False, comment="真实图片模型名称"),
        sa.Column(
            "model_display_name",
            sa.String(length=100),
            nullable=True,
            comment="用户端显示的模型名称；留空则显示真实模型名",
        ),
        sa.Column("is_enabled", sa.Boolean(), server_default="1", nullable=False, comment="是否开放给用户加载"),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False, comment="排序权重"),
        sa.Column("created_by", sa.String(length=100), nullable=True, comment="创建管理员ID"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True, comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True, comment="更新时间"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("shared_image_api_configs")
