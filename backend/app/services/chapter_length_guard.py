"""章节正文长度的确定性保护。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import AsyncIterable, AsyncIterator, Literal, Optional


MAX_LENGTH_RATIO_PERCENT = 115
MIN_LENGTH_RATIO_PERCENT = 85

PARAGRAPH_BOUNDARY_RE = re.compile(r"\r?\n")
SENTENCE_BOUNDARY_RE = re.compile(
    r"(?:[。！？!?…]+|\.{1,3})(?:[”’\"」』】）)\]]+)?"
)

CutoffKind = Literal["paragraph", "sentence", "hard"]


def visible_char_count(content: str) -> int:
    return len(re.sub(r"\s+", "", content or ""))


class ChapterLengthExceededError(RuntimeError):
    """章节仍超过硬性字数上限，调用方不得保存。"""


@dataclass(frozen=True)
class GuardedChapterText:
    content: str
    observed_chars: int
    content_chars: int
    truncated: bool
    cutoff_kind: Optional[CutoffKind] = None


def chapter_length_limits(target_word_count: int) -> tuple[int, int]:
    """返回与质量门禁一致的可见字符上下限，避免浮点误差。"""
    target = max(1, int(target_word_count))
    lower = max(500, target * MIN_LENGTH_RATIO_PERCENT // 100)
    upper = target * MAX_LENGTH_RATIO_PERCENT // 100
    return lower, upper


def chapter_length_error(
    *,
    actual: int,
    target_word_count: int,
) -> ChapterLengthExceededError:
    _, upper = chapter_length_limits(target_word_count)
    return ChapterLengthExceededError(
        f"正文仍有 {actual} 字，超过目标 {target_word_count} 字的"
        f" {MAX_LENGTH_RATIO_PERCENT}% 上限（{upper} 字）。"
        "自动压缩未能在本次安全完成，旧正文已保留，请重试或更换模型。"
    )


class ChapterLengthGuard:
    """累计流式正文，并在不完整段落越过上限前截断。"""

    def __init__(self, target_word_count: int):
        self.target_word_count = max(1, int(target_word_count))
        _, self.upper = chapter_length_limits(self.target_word_count)
        self._text = ""
        self._emitted_pos = 0
        self._observed_chars = 0
        self._result: Optional[GuardedChapterText] = None

    @property
    def truncated(self) -> bool:
        return bool(self._result and self._result.truncated)

    def accept(self, chunk: str) -> tuple[str, bool]:
        """接收原始块，返回可安全发送的增量以及是否应停止上游。"""
        if self._result is not None:
            return "", True
        if chunk:
            self._text += chunk
            self._observed_chars = visible_char_count(self._text)

        if self._observed_chars > self.upper:
            cut = self._cut_index(self.upper)
            self._result = GuardedChapterText(
                content=self._text[:cut],
                observed_chars=self._observed_chars,
                content_chars=visible_char_count(self._text[:cut]),
                truncated=True,
                cutoff_kind=self._cut_kind,
            )
            emitted = self._text[self._emitted_pos:cut]
            self._emitted_pos = cut
            return emitted, True

        # 只实时发送完整段落，末尾未完成段落留到 EOF 或截断时再处理。
        boundary = self._last_boundary_end(PARAGRAPH_BOUNDARY_RE)
        if boundary <= self._emitted_pos:
            return "", False
        emitted = self._text[self._emitted_pos:boundary]
        self._emitted_pos = boundary
        return emitted, False

    def finish(self) -> GuardedChapterText:
        """结束接收；正常结束时发送尚未发送的完整尾部。"""
        if self._result is not None:
            return self._result
        self._result = GuardedChapterText(
            content=self._text,
            observed_chars=visible_char_count(self._text),
            content_chars=visible_char_count(self._text),
            truncated=False,
        )
        return self._result

    def drain_tail(self) -> str:
        """返回尚未发出的正常结束尾部。"""
        if self._result is None:
            self.finish()
        if self._result is None:
            return ""
        emitted = self._result.content[self._emitted_pos:]
        self._emitted_pos = len(self._result.content)
        return emitted

    def _last_boundary_end(self, pattern: re.Pattern[str]) -> int:
        latest = self._emitted_pos
        for match in pattern.finditer(self._text):
            if visible_char_count(self._text[:match.end()]) > self.upper:
                break
            latest = match.end()
        return latest

    def _cut_index(self, upper: int) -> int:
        paragraph_end = self._last_boundary_end(PARAGRAPH_BOUNDARY_RE)
        if paragraph_end > 0 and paragraph_end >= self._emitted_pos:
            self._cut_kind: CutoffKind = "paragraph"
            return paragraph_end

        sentence_end = self._last_boundary_end(SENTENCE_BOUNDARY_RE)
        if sentence_end > 0 and sentence_end >= self._emitted_pos:
            self._cut_kind = "sentence"
            return sentence_end

        self._cut_kind = "hard"
        visible = 0
        for index, char in enumerate(self._text, start=1):
            if not char.isspace():
                visible += 1
                if visible > upper:
                    return index - 1
        return len(self._text)


async def iter_guarded_chunks(
    source: AsyncIterable[str],
    guard: ChapterLengthGuard,
) -> AsyncIterator[str]:
    """消费上游流，仅产出安全前缀；达到上限时主动关闭上游。"""
    iterator = source.__aiter__()
    source_done = False
    try:
        while True:
            try:
                chunk = await iterator.__anext__()
            except StopAsyncIteration:
                source_done = True
                guard.finish()
                tail = guard.drain_tail()
                if tail:
                    yield tail
                return

            emitted, should_stop = guard.accept(chunk)
            if emitted:
                yield emitted
            if should_stop:
                return
    finally:
        close = getattr(iterator, "aclose", None)
        if not source_done and close is not None:
            await close()
