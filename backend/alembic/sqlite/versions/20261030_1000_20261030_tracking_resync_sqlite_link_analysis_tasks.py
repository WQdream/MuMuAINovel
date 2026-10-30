"""link child analysis tasks to tracking resync background tasks

Revision ID: 20261030_tracking_resync_sqlite
Revises: 20261029_story_tracking_sqlite
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261030_tracking_resync_sqlite"
down_revision: Union[str, None] = "20261029_story_tracking_sqlite"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("analysis_tasks", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("background_task_id", sa.String(length=36), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_analysis_tasks_background_task_id",
            "background_tasks",
            ["background_task_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index(
            "idx_analysis_task_background_task",
            ["background_task_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("analysis_tasks", schema=None) as batch_op:
        batch_op.drop_index("idx_analysis_task_background_task")
        batch_op.drop_constraint(
            "fk_analysis_tasks_background_task_id",
            type_="foreignkey",
        )
        batch_op.drop_column("background_task_id")
