"""章节分析过程监控 - 记录分析任务的分阶段实时日志

分析任务本身已有 AnalysisTask 表记录状态，但只有一个粗糙的 progress。
这里额外维护一份内存级过程日志，供前端「分析监控」面板实时查看，
用于排查分析卡住、输出被截断、JSON 解析失败等问题。

日志只保留在内存中（按任务做环形缓冲），不落库：
分析过程属于高频临时数据，写库成本高且无长期价值；
任务终态仍然由 AnalysisTask 持久化，页面刷新后依然能看到结果。
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Deque, Dict, List, Optional

from app.logger import get_logger

logger = get_logger(__name__)

# 每个任务最多保留的事件条数
MAX_EVENTS_PER_TASK = 200
# 最多同时跟踪的任务数，超出后淘汰最早的
MAX_TRACKED_TASKS = 200


@dataclass
class MonitorEvent:
    ts: str
    level: str
    message: str
    progress: Optional[int] = None


@dataclass
class MonitorTask:
    task_id: str
    project_id: str
    chapter_id: str
    chapter_number: Optional[int] = None
    chapter_title: Optional[str] = None
    status: str = "running"
    events: Deque[MonitorEvent] = field(
        default_factory=lambda: deque(maxlen=MAX_EVENTS_PER_TASK)
    )

    def to_payload(self) -> dict:
        return {
            "task_id": self.task_id,
            "project_id": self.project_id,
            "chapter_id": self.chapter_id,
            "chapter_number": self.chapter_number,
            "chapter_title": self.chapter_title,
            "status": self.status,
            "events": [
                {
                    "ts": event.ts,
                    "level": event.level,
                    "message": event.message,
                    "progress": event.progress,
                }
                for event in self.events
            ],
        }


class AnalysisMonitor:
    """分析过程事件的内存注册表。"""

    def __init__(self) -> None:
        self._tasks: Dict[str, MonitorTask] = {}

    def start(
        self,
        *,
        task_id: str,
        project_id: str,
        chapter_id: str,
        chapter_number: Optional[int] = None,
        chapter_title: Optional[str] = None,
    ) -> MonitorTask:
        if len(self._tasks) >= MAX_TRACKED_TASKS and task_id not in self._tasks:
            oldest_key = next(iter(self._tasks))
            self._tasks.pop(oldest_key, None)

        task = MonitorTask(
            task_id=task_id,
            project_id=project_id,
            chapter_id=chapter_id,
            chapter_number=chapter_number,
            chapter_title=chapter_title,
        )
        self._tasks[task_id] = task
        return task

    def emit(
        self,
        task_id: str,
        level: str,
        message: str,
        progress: Optional[int] = None,
    ) -> None:
        task = self._tasks.get(task_id)
        if task is None:
            return
        task.events.append(
            MonitorEvent(
                ts=datetime.now().strftime("%H:%M:%S"),
                level=level,
                message=message,
                progress=progress,
            )
        )

    def finish(self, task_id: str, status: str) -> None:
        task = self._tasks.get(task_id)
        if task is not None:
            task.status = status

    def get(self, task_id: str) -> Optional[MonitorTask]:
        return self._tasks.get(task_id)

    def list_by_project(self, project_id: str) -> List[MonitorTask]:
        tasks = [task for task in self._tasks.values() if task.project_id == project_id]
        tasks.sort(
            key=lambda task: task.events[-1].ts if task.events else "",
            reverse=True,
        )
        return tasks

    def clear_project(self, project_id: str) -> int:
        removed = [
            task_id
            for task_id, task in self._tasks.items()
            if task.project_id == project_id
        ]
        for task_id in removed:
            self._tasks.pop(task_id, None)
        return len(removed)


analysis_monitor = AnalysisMonitor()
