"""add model display name to shared api configs

Revision ID: 20261026_model_display_name
Revises: 20261026_shared_api_configs
Create Date: 2026-10-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20261026_model_display_name'
down_revision: Union[str, None] = '20261026_shared_api_configs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('shared_api_configs', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'model_display_name',
                sa.String(length=100),
                nullable=True,
                comment='用户端显示的模型名称；留空则显示真实模型名',
            )
        )


def downgrade() -> None:
    with op.batch_alter_table('shared_api_configs', schema=None) as batch_op:
        batch_op.drop_column('model_display_name')
