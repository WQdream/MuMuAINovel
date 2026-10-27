"""Detect provider-side content-policy refusals hidden inside "successful" responses.

Some OpenAI-compatible relays answer with HTTP 200 and a refusal notice written in
prose instead of the requested JSON. Downstream parsers then report a bogus
"JSON truncated" failure, so the user never learns that the provider blocked the
content. These helpers turn that notice into an explicit, actionable error.
"""
from __future__ import annotations

import re
from typing import Optional

_REFUSAL_MARKERS = (
    "涉嫌违反",
    "违反用户协议",
    "违反平台规则",
    "违反内容政策",
    "触发风控",
    "content policy",
    "content_filter",
    "safety system",
)

# A refusal is short prose; real analysis JSON is long and brace-terminated.
_MAX_REFUSAL_LENGTH = 400
# Refusal notices are single-line system messages, never multi-paragraph prose.
_MAX_REFUSAL_NEWLINES = 3

_LINK_RE = re.compile(r"\[[^\]]*\]\([^)]*\)|https?://\S+")
# After dropping a link, an empty "（）"/"()" pair often remains.
_EMPTY_PARENS_RE = re.compile(r"[（(]\s*[）)]")
_TRAILING_PUNCT_RE = re.compile(r"[。．.！!；;，,]+$")


def detect_policy_refusal(text: Optional[str]) -> Optional[str]:
    """Return the refusal notice when `text` looks like a provider content block."""
    if not text:
        return None

    cleaned = text.strip()
    if not cleaned or len(cleaned) > _MAX_REFUSAL_LENGTH:
        return None

    if cleaned.count("\n") > _MAX_REFUSAL_NEWLINES:
        return None

    lowered = cleaned.lower()
    if not any(marker in lowered for marker in _REFUSAL_MARKERS):
        return None

    # Never treat JSON-ish payloads as a refusal: analysis output always carries
    # braces, and novels can legitimately mention "违反" inside plot summaries.
    if "{" in cleaned:
        return None

    notice = _EMPTY_PARENS_RE.sub("", _LINK_RE.sub("", cleaned)).strip()
    return notice or cleaned


def policy_refusal_error(provider_text: str) -> str:
    """Build the user-facing message for a detected content-policy refusal."""
    notice = _TRAILING_PUNCT_RE.sub("", provider_text.strip())[:160]
    return (
        f"模型服务商拒绝了本次请求（内容审核拦截）：{notice}。"
        "送审内容未通过该服务商的内容安全策略，重试无效。"
        "请在「设置 → API 设置」更换模型或服务商，也可按其提示申诉误判。"
    )
