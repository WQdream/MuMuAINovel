"""网文 AI 味检测服务：包装上游 oh-story 的确定性 Node 脚本。

零 npm 依赖，只用 fs/path，低版本 Node 即可运行。check-ai-patterns / check-degeneration
为报告模式（`--json`），用于在「AI 去味」改写前后给出可量化分数；normalize-punctuation
为确定性文本转换（省略号/破折号/分隔线），只在临时文件上改写，不触碰用户目录。
运行环境没有 Node 时全部优雅降级，调用方据此标注「未检测」。
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Dict, List, Optional

from app.config import PROJECT_ROOT
from app.logger import get_logger

logger = get_logger(__name__)

# 上游脚本随 Skill 一起分发，路径固定，避免被用户配置改写
SKILL_SCRIPTS_DIR = PROJECT_ROOT / "app" / "skills" / "story-deslop" / "scripts"
PATTERNS_SCRIPT = SKILL_SCRIPTS_DIR / "check-ai-patterns.js"
DEGENERATION_SCRIPT = SKILL_SCRIPTS_DIR / "check-degeneration.js"
NORMALIZE_SCRIPT = SKILL_SCRIPTS_DIR / "normalize-punctuation.js"

# 单次检测超时：脚本本身是毫秒级，留出冷启动余量
CHECK_TIMEOUT_SECONDS = 20.0


class DeslopCheckUnavailable(RuntimeError):
    """运行环境缺少 Node 或脚本文件时抛出，调用方据此降级为「未检测」"""


@dataclass
class CheckReport:
    """一次检测的结构化结果"""

    blocking: int = 0
    advisory: int = 0
    findings: List[Dict[str, Any]] = field(default_factory=list)
    available: bool = True
    error: Optional[str] = None

    @property
    def score(self) -> int:
        """0–100 的干净度分数：blocking 权重远高于 advisory，便于界面直接展示

        上游明确说明这是本地风格/可读性门禁，不是 AIGC 检测器分数，
        因此命名与文案都避免暗示「AI 率」。
        """
        if not self.available:
            return -1
        penalty = self.blocking * 12 + min(self.advisory, 20) * 2
        return max(0, 100 - penalty)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "available": self.available,
            "blocking": self.blocking,
            "advisory": self.advisory,
            "score": self.score,
            "findings": self.findings[:80],
            "truncated": len(self.findings) > 80,
            "error": self.error,
        }


@lru_cache(maxsize=1)
def _node_binary() -> Optional[str]:
    return shutil.which("node")


def scripts_available() -> bool:
    return bool(_node_binary()) and PATTERNS_SCRIPT.is_file() and DEGENERATION_SCRIPT.is_file()


async def _run_node(script_path, text: str, extra_args: List[str]) -> tuple[str, str, str, int]:
    """在临时文件上跑一次上游脚本，返回 (stdout, stderr, 脚本侧的文件内容, 退出码)

    文本一律经临时文件传入：上游脚本只接受文件路径参数。写回型脚本
    （normalize-punctuation）会就地改这个文件，所以在删除前读回来，不碰用户目录。
    """
    node = _node_binary()
    if not node:
        raise DeslopCheckUnavailable("运行环境未安装 Node，无法执行去味脚本")
    if not script_path.is_file():
        raise DeslopCheckUnavailable(f"脚本缺失: {script_path}")

    fd, tmp_path = tempfile.mkstemp(suffix=".md", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)

        process = await asyncio.create_subprocess_exec(
            node, str(script_path), *extra_args, tmp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=CHECK_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise DeslopCheckUnavailable(f"脚本执行超时（>{CHECK_TIMEOUT_SECONDS}s）")

        try:
            with open(tmp_path, "r", encoding="utf-8") as handle:
                written_back = handle.read()
        except OSError:
            written_back = text
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return (
        stdout.decode("utf-8", errors="replace").strip(),
        stderr.decode("utf-8", errors="replace").strip()[:200],
        written_back,
        process.returncode,
    )


async def _run_script(script_path, text: str, extra_args: List[str]) -> Dict[str, Any]:
    """跑报告型脚本（check-ai-patterns / check-degeneration），解析 --json 输出"""
    stdout, stderr, _, returncode = await _run_node(script_path, text, extra_args)
    # 退出码 1 表示「发现 finding」，属正常结果，不是失败
    if returncode not in (0, 1):
        raise DeslopCheckUnavailable(f"检测脚本异常退出（code={returncode}）: {stderr}")
    if not stdout:
        return {"findings": []}
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise DeslopCheckUnavailable(f"检测脚本输出无法解析: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("findings"), list):
        raise DeslopCheckUnavailable("检测脚本输出结构异常")
    return data


async def normalize_punctuation(text: str) -> Dict[str, Any]:
    """跑上游标点整理脚本（skill 的 Phase 4）

    把白名单以外的省略号、破折号、双连字符换成中文标点，并删掉独立的 markdown 分隔线。
    这是确定性文本转换，不调模型、不花 token，所以放在复扫之后、交付之前自动执行。
    """
    if not text or not text.strip():
        return {"available": True, "normalized": text, "changed": False, "count": 0, "error": None}
    if not (_node_binary() and NORMALIZE_SCRIPT.is_file()):
        return {
            "available": False,
            "normalized": text,
            "changed": False,
            "count": 0,
            "error": "运行环境缺少 Node 或标点脚本，未整理标点",
        }

    try:
        stdout, stderr, written_back, returncode = await _run_node(NORMALIZE_SCRIPT, text, [])
    except DeslopCheckUnavailable as exc:
        logger.warning(f"标点整理失败: {exc}")
        return {"available": False, "normalized": text, "changed": False, "count": 0, "error": str(exc)}

    # 该脚本只以 2 表示命令或读取错误
    if returncode == 2:
        return {"available": False, "normalized": text, "changed": False, "count": 0,
                "error": f"标点脚本异常退出: {stderr or stdout}"}

    count = _count_normalize_issues(stdout)
    return {
        "available": True,
        "normalized": written_back,
        "changed": written_back != text,
        "count": count,
        "error": None,
    }


def _count_normalize_issues(stdout: str) -> int:
    """从 `file: normalized (7 issues)` 这类输出里取改动条数，取不到就按 0"""
    match = re.search(r"\((\d+) issue", stdout)
    return int(match.group(1)) if match else 0


def _merge(*reports: Dict[str, Any]) -> CheckReport:
    merged = CheckReport()
    seen: set = set()
    for report in reports:
        for finding in report.get("findings", []):
            if not isinstance(finding, dict):
                continue
            # 临时文件名是随机的，去掉 file 字段后再比对，避免同一问题重复计数
            key = (
                finding.get("line"), finding.get("column"),
                finding.get("type"), finding.get("severity"),
                finding.get("excerpt"),
            )
            if key in seen:
                continue
            seen.add(key)
            finding.pop("file", None)
            merged.findings.append(finding)
            if finding.get("severity") == "blocking":
                merged.blocking += 1
            else:
                merged.advisory += 1
    return merged


async def check_text(text: str) -> CheckReport:
    """对一段正文跑两个上游检查器，返回合并报告

    Node 不可用时返回 available=False 的空报告，让调用方继续走纯模型改写。
    """
    if not text or not text.strip():
        return CheckReport()
    if not scripts_available():
        logger.info("去味检测不可用：缺少 Node 或脚本，降级为纯模型改写")
        return CheckReport(available=False, error="运行环境缺少 Node 或检测脚本，未执行机器检测")

    try:
        patterns, degeneration = await asyncio.gather(
            _run_script(PATTERNS_SCRIPT, text, ["--json"]),
            _run_script(DEGENERATION_SCRIPT, text, ["--json"]),
        )
    except DeslopCheckUnavailable as exc:
        logger.warning(f"去味检测失败: {exc}")
        return CheckReport(available=False, error=str(exc))

    return _merge(patterns, degeneration)


def format_findings_for_prompt(report: CheckReport) -> str:
    """把检测结果转成可注入提示词的中文清单"""
    if not report.available or not report.findings:
        return ""
    lines: List[str] = []
    for finding in report.findings[:40]:
        severity = "必须改" if finding.get("severity") == "blocking" else "建议改"
        location = f"第 {finding.get('line')} 行 {finding.get('column')} 列"
        excerpt = (finding.get("excerpt") or "").strip()
        message = (finding.get("message") or "").strip()
        suffix = f"：{excerpt}" if excerpt else ""
        lines.append(f"- [{severity}] {location} {message}{suffix}")
    if len(report.findings) > 40:
        lines.append(f"- （另有 {len(report.findings) - 40} 处同类问题未列出）")
    return "\n".join(lines)
