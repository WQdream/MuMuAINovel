"""link child analysis tasks to tracking resync background tasks

Revision ID: 20261030_tracking_resync_pg
Revises: 20261029_story_tracking_pg
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261030_tracking_resync_pg"
down_revision: Union[str, None] = "20261029_story_tracking_pg"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "analysis_tasks",
        sa.Column("background_task_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_analysis_tasks_background_task_id",
        "analysis_tasks",
        "background_tasks",
        ["background_task_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "idx_analysis_task_background_task",
        "analysis_tasks",
        ["background_task_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_analysis_task_background_task", table_name="analysis_tasks")
    op.drop_constraint(
        "fk_analysis_tasks_background_task_id",
        "analysis_tasks",
        type_="foreignkey",
    )
    op.drop_column("analysis_tasks", "background_task_id")
