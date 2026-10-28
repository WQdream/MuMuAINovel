"""Extract and validate the prose returned by the AI de-slop request.

The upstream story-deslop skill is written for an agent chat and normally
returns a scan/report followed by the revised text.  The Web workspace only
stores prose, so accepting the raw model response writes analysis into the
chapter.  These helpers keep that parsing deterministic and reject incomplete
output instead of silently damaging the manuscript.
"""

from __future__ import annotations

import re
from typing import Iterable, Tuple


class PolishOutputError(ValueError):
    """Raised when the model response cannot be safely used as chapter prose."""

    def __init__(self, message: str, *, code: str = "invalid_output"):
        super().__init__(message)
        self.code = code


class PolishExtraction:
    """Parsed model response: prose for the editor and report for the analysis tab."""

    __slots__ = ("body", "analysis", "notes")

    def __init__(self, body: str, analysis: str, notes: list[str]):
        self.body = body
        self.analysis = analysis
        self.notes = notes


_BODY_LABELS = (
    "最后正文",
    "正文终稿",
    "交付正文",
    "输出正文",
    "改后完整正文",
    "改稿完整正文",
    "改写后完整正文",
    "修改后完整正文",
    "最终完整正文",
    "最终正文",
    "改写后正文",
    "修改后正文",
    "改后正文",
    "完整正文",
)

_BODY_MARKER_RE = re.compile(
    rf"(?im)^[ \t]*(?:#{{1,6}}[ \t]*)?(?:\*{{1,2}})?"
    rf"(?:【|\[)?(?:{'|'.join(map(re.escape, _BODY_LABELS))})(?:】|\])?"
    rf"(?:\*{{1,2}})?[ \t]*[:：]?[ \t]*$"
)

_STRUCTURED_BODY_RE = re.compile(r"(?is)<正文>\s*(.*?)\s*</正文>")
_STRUCTURED_BODY_OPEN_RE = re.compile(r"(?is)<正文>\s*")
_STRUCTURED_ANALYSIS_RE = re.compile(r"(?is)<分析>\s*(.*?)\s*</分析>")
_STRUCTURED_ANALYSIS_OPEN_RE = re.compile(r"(?is)<分析>\s*")

_REPORT_SECTION_RE = re.compile(
    r"(?im)^[ \t]*(?:#{1,6}[ \t]*)?"
    r"(?:三层扫描|扫描结果|检查结果|改稿结果|修改结果|处理说明|改动说明|"
    r"表达层|用笔层|故事层|代表性改动|尚需处理|技术备注|"
    r"原文与改后对照|对照说明|自检报告)[ \t]*[:：]?[ \t]*$"
)

_BODY_BEFORE_ANALYSIS_RE = re.compile(
    r"(?is)(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:改后|改写后|修改后|最终)?"
    r"(?:完整)?正文[ \t]*[:：]?[ \t]*\n"
)

_REPORT_CUT_RE = re.compile(
    r"(?im)^[ \t]*(?:#{1,6}[ \t]*)"
    r"(?:三层扫描|扫描结果|检查结果|改稿结果|修改结果|处理说明|改动说明|"
    r"表达层|用笔层|故事层|代表性改动|尚需处理|技术备注|"
    r"原文与改后对照|对照说明|自检报告)[ \t]*[:：]?[ \t]*$"
)

_REPORT_HEADING_RE = re.compile(
    r"(?im)^[ \t]*(?:#{1,6}[ \t]*)"
    r"(?:三层扫描|扫描结果|检查结果|改稿结果|修改结果|处理说明|改动说明|"
    r"表达层|用笔层|故事层|代表性改动|尚需处理|技术备注|"
    r"原文与改后对照|对照说明|自检报告)[ \t]*[:：]?[ \t]*$"
)

_LEAD_IN_RE = re.compile(
    r"(?im)^[ \t]*(?:以下是|下面是|这是)"
    r"(?:本次)?(?:改后|改写后|修改后|最终)?(?:的)?(?:完整)?正文"
    r"[ \t]*[:：]?[ \t]*$"
)

_REPORT_PROSE_MARKERS = (
    "本次为 Web 环境",
    "本次环境无脚本",
    "未做机器校验",
    "三层扫描结果",
    "以下是三层扫描",
)

_TRUNCATED_FINISH_REASONS = {
    "length",
    "max_tokens",
    "max_output_tokens",
    "max_completion_tokens",
}

_SENTENCE_ENDINGS = frozenset("。！？!?….”’」』）)\"'")


def _strip_code_fence(text: str) -> str:
    """Remove one Markdown fence wrapping the whole result."""
    stripped = text.strip()
    lines = stripped.splitlines()
    if len(lines) < 2 or not re.match(r"^\s*```[\w+-]*\s*$", lines[0]):
        return stripped
    if not re.match(r"^\s*```\s*$", lines[-1]):
        return stripped
    return "\n".join(lines[1:-1]).strip()


def _strip_trailing_report(body: str) -> str:
    """Cut report sections accidentally appended after the rewritten prose."""
    candidates: Iterable[re.Match] = _REPORT_SECTION_RE.finditer(body)
    cut_at = None
    for match in candidates:
        # A title such as "检查结果" inside a very short stub is more likely
        # leaked analysis than an intentional trailing section.
        if match.start() > 0:
            cut_at = match.start()
            break
    if cut_at is not None:
        body = body[:cut_at]
    return body


def _clean_body(body: str) -> str:
    body = _strip_code_fence(body).replace("\r\n", "\n").replace("\r", "\n")
    body = _LEAD_IN_RE.sub("", body, count=1)
    body = _strip_trailing_report(body)
    body = re.sub(r"(?m)^[ \t]*---+[ \t]*$", "", body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def _extract_body_from_marker(raw: str) -> Tuple[str, str, int | None]:
    matches = list(_BODY_MARKER_RE.finditer(raw))
    if not matches:
        return raw, "", None

    # The last marker is the actual delivery.  Earlier occurrences are often
    # references to "改后正文" inside the model's analysis.
    marker = matches[-1]
    return raw[marker.end():], raw[:marker.start()], marker.start()


def _extract_structured_output(raw: str) -> Tuple[str, str, bool] | None:
    """Parse body-first output requested by the Web workspace.

    The body is closed before analysis starts, so a token limit can truncate
    the report without truncating the manuscript.
    """
    body_match = _STRUCTURED_BODY_RE.search(raw)
    if not body_match:
        return None

    body = body_match.group(1)
    tail = raw[body_match.end():]
    analysis_match = _STRUCTURED_ANALYSIS_RE.search(tail)
    analysis_complete = bool(analysis_match)

    if analysis_match:
        analysis = analysis_match.group(1)
    else:
        analysis_open = _STRUCTURED_ANALYSIS_OPEN_RE.search(tail)
        if analysis_open:
            analysis = tail[analysis_open.end():]
        else:
            analysis = tail

    if not analysis.strip():
        analysis = ""
        analysis_complete = True

    return body, analysis, analysis_complete


def _has_incomplete_structured_body(raw: str) -> bool:
    """True only when the body itself has no closing tag."""
    body_open = _STRUCTURED_BODY_OPEN_RE.search(raw)
    if not body_open:
        return False
    body_close = re.search(r"(?is)</正文>", raw[body_open.end():])
    return body_close is None


def _extract_body_before_analysis(raw: str) -> Tuple[str, str] | None:
    """Recover body-first Markdown output from models that ignore XML tags."""
    body_marker = _BODY_BEFORE_ANALYSIS_RE.search(raw)
    report = _REPORT_CUT_RE.search(raw)
    if not body_marker or not report or report.start() <= body_marker.end():
        return None

    body = raw[body_marker.end():report.start()]
    analysis = raw[report.start():]
    return body, analysis


def _clean_analysis(prefix: str) -> str:
    """Keep the model's actual scan notes, without delivery-only scaffolding."""
    analysis = _strip_code_fence(prefix).replace("\r\n", "\n").replace("\r", "\n")
    analysis = re.sub(
        r"(?im)^[ \t]*(?:#{1,6}[ \t]*)?(?:\*{1,2})?"
        r"(?:三层扫描(?:结果)?|分析|诊断报告)(?:\*{1,2})?[ \t]*[:：]?[ \t]*$",
        "",
        analysis,
        count=1,
    )
    analysis = re.sub(r"(?m)^[ \t]*(?:---+|___+|\*\*\*+)[ \t]*$", "", analysis)
    analysis = re.sub(r"\n{3,}", "\n\n", analysis)
    return analysis.strip()


def _units(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def _ensure_no_report(body: str) -> None:
    if _REPORT_HEADING_RE.search(body):
        raise PolishOutputError(
            "模型返回的内容仍包含分析或报告标题，没有返回纯正文",
            code="contains_report",
        )
    for marker in _REPORT_PROSE_MARKERS:
        if marker in body:
            raise PolishOutputError(
                "模型返回的内容仍包含分析说明，没有返回纯正文",
                code="contains_report",
            )


def _ensure_complete(body: str, original_text: str) -> None:
    original_units = _units(original_text)
    body_units = _units(body)

    if original_units >= 200 and body_units < original_units * 0.55:
        raise PolishOutputError(
            "模型返回的正文明显不完整，可能只保留了部分段落",
            code="incomplete",
        )

    original_tail = original_text.rstrip()
    if (
        original_units >= 40
        and original_tail
        and original_tail[-1] in _SENTENCE_ENDINGS
        and body
        and body.rstrip()[-1] not in _SENTENCE_ENDINGS
    ):
        raise PolishOutputError(
            "模型返回的正文没有正常结束，可能被输出长度上限截断",
            code="incomplete",
        )

    if body.count("```") % 2:
        raise PolishOutputError(
            "模型返回的正文包含未闭合的代码块，可能被截断",
            code="incomplete",
        )

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", original_text) if p.strip()]
    if paragraphs:
        final_paragraph = paragraphs[-1]
        final_key = re.sub(r"[\W_]+", "", final_paragraph)
        body_key = re.sub(r"[\W_]+", "", body)
        if len(final_key) >= 16:
            anchors = {
                final_key[i:i + 3]
                for i in range(len(final_key) - 2)
            }
            matched = sum(1 for anchor in anchors if anchor in body_key)
            if not anchors or matched / len(anchors) < 0.08:
                raise PolishOutputError(
                    "模型返回的正文没有覆盖原稿结尾，后文可能被遗漏",
                    code="incomplete",
                )


def extract_polish_output(
    raw_response: str,
    *,
    original_text: str,
    finish_reason: str | None = None,
) -> PolishExtraction:
    """Return body-first prose and the separate analysis report.

    Accepted forms are the body-first <正文>/<分析> protocol, a body-first
    Markdown layout, or the legacy report-then-body answer.  Anything without
    a reliable body boundary is rejected so analysis never reaches the chapter.
    """
    raw = (raw_response or "").strip()
    if not raw:
        raise PolishOutputError("模型未返回改写结果", code="empty")

    reason = (finish_reason or "").strip().lower()
    structured = _extract_structured_output(raw)
    if structured:
        body, analysis, analysis_complete = structured
        marker_start = None
        used_marker = True
    elif _has_incomplete_structured_body(raw):
        raise PolishOutputError(
            "模型没有写完正文结束标记，正文可能被截断",
            code="truncated" if reason in _TRUNCATED_FINISH_REASONS else "incomplete",
        )
    else:
        body_first = _extract_body_before_analysis(raw)
        if body_first:
            body, analysis = body_first
            marker_start = None
            analysis_complete = True
            used_marker = True
        else:
            if reason in _TRUNCATED_FINISH_REASONS:
                raise PolishOutputError(
                    "模型输出达到长度上限，正文可能被截断",
                    code="truncated",
                )
            body, analysis, marker_start = _extract_body_from_marker(raw)
            analysis_complete = True
            used_marker = marker_start is not None

    body = _clean_body(body)
    analysis = _clean_analysis(analysis) if used_marker else ""
    if not body:
        raise PolishOutputError("模型没有返回可用的正文", code="empty")

    _ensure_no_report(body)
    _ensure_complete(body, original_text)

    # A scan report can consume the whole output budget while finish_reason
    # still says "stop" on some OpenAI-compatible proxies.  With a body marker
    # we can recover the prose; compare it against how much of the output was
    # spent before the marker, and reject the likely-shortened tail.
    if marker_start is not None:
        prefix_units = _units(raw[:marker_start])
        if (
            len(original_text) >= 600
            and prefix_units > _units(body) * 1.5
            and _units(body) < _units(original_text) * 0.85
        ):
            raise PolishOutputError(
                "模型把大量输出预算用在分析报告上，正文可能未完整写完",
                code="incomplete",
            )

    notes: list[str] = []
    if analysis:
        notes.append("分析与正文已分离，分析仅用于查看")
    if (
        reason in _TRUNCATED_FINISH_REASONS
        and analysis
        and not analysis_complete
    ):
        notes.append("分析报告可能被输出长度上限截断，正文已完整结束")
    return PolishExtraction(body=body, analysis=analysis, notes=notes)


def extract_polished_body(
    raw_response: str,
    *,
    original_text: str,
    finish_reason: str | None = None,
) -> Tuple[str, list[str]]:
    """Compatibility wrapper for callers that only need the polished prose."""
    result = extract_polish_output(
        raw_response,
        original_text=original_text,
        finish_reason=finish_reason,
    )
    return result.body, result.notes


def extract_analysis_only(raw_response: str) -> str:
    """从「只诊断不改写」的回答里取出分析正文

    与改写不同，这里没有必须保护的正文，所以解析要宽松：优先取 <分析> 标签，
    其次取 </正文> 之后的内容（模型偶尔仍会先写一遍正文），最后整段当作分析。
    只做清理，不做完整性校验。
    """
    raw = (raw_response or "").strip()
    if not raw:
        raise PolishOutputError("模型没有返回诊断内容", code="empty")

    analysis_match = _STRUCTURED_ANALYSIS_RE.search(raw)
    if analysis_match:
        analysis = analysis_match.group(1)
    else:
        analysis_open = _STRUCTURED_ANALYSIS_OPEN_RE.search(raw)
        if analysis_open:
            analysis = raw[analysis_open.end():]
        else:
            body_close = re.search(r"(?is)</正文>", raw)
            analysis = raw[body_close.end():] if body_close else raw

    analysis = _clean_analysis(analysis)
    if not analysis:
        raise PolishOutputError("模型没有返回可用的诊断内容", code="empty")
    return analysis
