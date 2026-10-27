"""add admin access logs table

Revision ID: 20261026_admin_access_logs
Revises: 20260914_knowledge
Create Date: 2026-10-26 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20261026_admin_access_logs'
down_revision: Union[str, None] = '20260914_knowledge'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'admin_access_logs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('admin_id', sa.String(length=100), nullable=False, comment='访问管理员ID'),
        sa.Column('admin_name', sa.String(length=200), nullable=True, comment='管理员显示名快照'),
        sa.Column('target_user_id', sa.String(length=100), nullable=False, comment='被访问的用户ID'),
        sa.Column('target_username', sa.String(length=200), nullable=True, comment='被访问用户显示名快照'),
        sa.Column('project_id', sa.String(length=36), nullable=False, comment='被访问的项目ID'),
        sa.Column('project_title', sa.String(length=200), nullable=True, comment='项目标题快照'),
        sa.Column('action', sa.String(length=50), nullable=False, comment='动作类型'),
        sa.Column('ip', sa.String(length=100), nullable=True, comment='请求来源IP'),
        sa.Column('user_agent', sa.Text(), nullable=True, comment='请求User-Agent'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False, comment='创建时间'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('admin_access_logs', schema=None) as batch_op:
        batch_op.create_index('ix_admin_access_logs_admin_id', ['admin_id'], unique=False)
        batch_op.create_index('ix_admin_access_logs_created_at', ['created_at'], unique=False)
        batch_op.create_index('ix_admin_access_logs_project_id', ['project_id'], unique=False)
        batch_op.create_index('ix_admin_access_logs_target_user_id', ['target_user_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('admin_access_logs', schema=None) as batch_op:
        batch_op.drop_index('ix_admin_access_logs_target_user_id')
        batch_op.drop_index('ix_admin_access_logs_project_id')
        batch_op.drop_index('ix_admin_access_logs_created_at')
        batch_op.drop_index('ix_admin_access_logs_admin_id')

    op.drop_table('admin_access_logs')
