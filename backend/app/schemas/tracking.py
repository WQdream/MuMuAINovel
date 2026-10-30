"""连续性追踪、章节契约与质量门禁的数据结构。"""
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class ChapterQualityStatus(str, Enum):
    draft = "draft"
    checking = "checking"
    ready = "ready"
    needs_decision = "needs_decision"
    blocked = "blocked"
    invalid = "invalid"
    tool_unavailable = "tool_unavailable"
    stale = "stale"


class ChapterTrackingStatus(str, Enum):
    uninitialized = "uninitialized"
    pending = "pending"
    current = "current"
    stale = "stale"
    failed = "failed"


class ChapterPlanningContract(BaseModel):
    """作者可编辑、模型必须消费的细纲契约。"""

    schema_version: int = 1
    contract_status: Literal["valid", "needs_review", "legacy_normalized"] = "needs_review"
    core_event: str = "[待补充]"
    target_word_count: int = Field(3000, ge=500, le=20000)
    word_count_basis: str = "visible_chars_v1"
    unit_position: str = "[待补充]"
    target_emotion: str = ""
    protagonist_goal_and_key_choice: str = ""
    opening_hook: str = "[待补充]"
    payoff: str = "[待补充]"
    forbidden_early_release: str = "[待补充]"
    required_events: List[str] = Field(default_factory=list)
    active_characters: List[str] = Field(default_factory=list)
    scene_beats: List[Any] = Field(default_factory=list)
    next_chapter_commitments: List[str] = Field(default_factory=list)
    continuity_constraints: List[str] = Field(default_factory=list)
    extras: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_intent_fields(self):
        for name, value in (
            ("target_emotion", self.target_emotion),
            ("protagonist_goal_and_key_choice", self.protagonist_goal_and_key_choice),
        ):
            normalized = str(value or "").replace("[待补充]", "").strip()
            if not normalized:
                raise ValueError(f"{name} 必须写出实际内容，不能使用占位符")
        return self

    @classmethod
    def from_legacy(
        cls,
        raw: Optional[Dict[str, Any]],
        *,
        fallback_summary: str = "",
        fallback_characters: Optional[List[str]] = None,
    ) -> "ChapterPlanningContract":
        source = dict(raw or {})
        core_event = (
            source.get("core_event")
            or source.get("plot_summary")
            or source.get("summary")
            or fallback_summary
            or "[待补充]"
        )
        target_emotion = (
            source.get("target_emotion")
            or source.get("emotional_tone")
            or source.get("emotion")
            or ""
        )
        goal_and_choice = (
            source.get("protagonist_goal_and_key_choice")
            or source.get("goal")
            or source.get("narrative_goal")
            or ""
        )
        characters = (
            source.get("active_characters")
            or source.get("character_focus")
            or source.get("characters")
            or fallback_characters
            or []
        )
        normalized_characters = [
            str(item.get("name") if isinstance(item, dict) else item).strip()
            for item in characters
            if item
        ]
        scene_beats = source.get("scene_beats") or source.get("scenes") or []
        required_events = source.get("required_events") or source.get("key_events") or []
        return cls(
            contract_status="legacy_normalized",
            core_event=str(core_event).strip() or "[待补充]",
            target_word_count=int(source.get("target_word_count") or source.get("estimated_words") or 3000),
            word_count_basis=str(source.get("word_count_basis") or "visible_chars_v1"),
            unit_position=str(source.get("unit_position") or source.get("chapter_position") or "[待补充]"),
            target_emotion=str(target_emotion).strip(),
            protagonist_goal_and_key_choice=str(goal_and_choice).strip(),
            opening_hook=str(source.get("opening_hook") or "[待补充]"),
            payoff=str(source.get("payoff") or "[待补充]"),
            forbidden_early_release=str(source.get("forbidden_early_release") or "[待补充]"),
            required_events=[str(item).strip() for item in required_events if str(item).strip()],
            active_characters=[item for item in normalized_characters if item],
            scene_beats=list(scene_beats),
            next_chapter_commitments=[
                str(item).strip()
                for item in (source.get("next_chapter_commitments") or [])
                if str(item).strip()
            ],
            continuity_constraints=[
                str(item).strip()
                for item in (source.get("continuity_constraints") or [])
                if str(item).strip()
            ],
            extras=source,
        )

    def to_storage(self) -> Dict[str, Any]:
        return {**self.extras, **self.model_dump()}


class TrackingContextCard(BaseModel):
    position: Dict[str, Any] = Field(default_factory=dict)
    long_term_constraints: List[str] = Field(default_factory=list)
    active_character_names: List[str] = Field(default_factory=list)
    continuity_risks: List[str] = Field(default_factory=list)
    active_foreshadows: List[Dict[str, Any]] = Field(default_factory=list)
    recent_chapters: List[Dict[str, Any]] = Field(default_factory=list)
    next_chapter_commitments: List[str] = Field(default_factory=list)
    rendered: str = ""
    byte_size: int = 0


class QualityFinding(BaseModel):
    severity: Literal["blocking", "advisory", "info"]
    code: str
    message: str
    evidence: Optional[str] = None


class ChapterQualityReport(BaseModel):
    status: ChapterQualityStatus
    findings: List[QualityFinding] = Field(default_factory=list)
    word_count: int = 0
    target_word_count: int = 3000
    checker_available: bool = True
    checker_error: Optional[str] = None
    available_actions: List[str] = Field(default_factory=list)
    override: Optional[Dict[str, Any]] = None


class ChapterQualityDecisionRequest(BaseModel):
    action: Literal[
        "accept_current_length",
        "accept_unchecked",
        "rewrite",
        "resync_tracking",
    ]
    reason: Optional[str] = Field(None, max_length=1000)


class TrackingResyncRequest(BaseModel):
    start_chapter: int = Field(..., ge=1, description="起始章节序号（包含）")
    end_chapter: int = Field(..., ge=1, description="结束章节序号（包含）")

    @model_validator(mode="after")
    def validate_range(self):
        if self.end_chapter < self.start_chapter:
            raise ValueError("结束章节不能早于起始章节")
        return self


class TrackingResyncResponse(BaseModel):
    task_id: str
    task_type: Literal["tracking_resync"] = "tracking_resync"
    status: Literal["pending"] = "pending"
    start_chapter: int
    end_chapter: int
    selected_chapters: int
    downstream_stale_chapters: int
    message: str


class TrackingProjectResponse(BaseModel):
    project_id: str
    state_revision: int
    state_status: str
    last_committed_chapter: int
    imported_through_chapter: int
    context_card: str
    stale_chapters: List[Dict[str, Any]] = Field(default_factory=list)
