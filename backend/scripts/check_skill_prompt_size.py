"""检查各 Skill 注入系统提示词的实际体积，防止 references 全量拼接把提示词撑爆。

用法：
    python3 backend/scripts/check_skill_prompt_size.py

退出码：任一 Skill 超过 --limit 时返回 1，可用于 CI 或本地自查。
"""
import argparse
import logging
import os
import sys
import types

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

logging.basicConfig(level=logging.WARNING)

from app.services.skill_loader import (  # noqa: E402
    INLINE_REF_LIMIT,
    SKILLS_DIR,
    load_skills,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=120_000,
                        help="单个 Skill 提示词的字符上限（默认 120000）")
    args = parser.parse_args()

    skills = load_skills()
    if not skills:
        print(f"未加载到任何 Skill，检查目录：{SKILLS_DIR}")
        return 1

    print(f"Skill 目录: {SKILLS_DIR}")
    print(f"{'skill':22}{'版本':>8}{'提示词字符':>12}{'参考文件':>10}{'内联':>8}")
    over = []
    total = 0
    for skill in sorted(skills, key=lambda s: -len(s["content"])):
        content_len = len(skill["content"])
        total += content_len
        inlined = content_len and skill["content"].count("\n### 参考资料：")
        print(f"{skill['name']:22}{skill.get('version') or '-':>8}"
              f"{content_len:>12,}{len(skill['references']):>10}{inlined:>8}")
        if content_len > args.limit:
            over.append((skill["name"], content_len))

    print(f"\n合计 {total:,} 字符；单 Skill 内联上限 {INLINE_REF_LIMIT:,}，"
          f"本次检查阈值 {args.limit:,}")

    if over:
        for name, size in over:
            print(f"⚠️  {name} 提示词 {size:,} 字符，超过阈值", file=sys.stderr)
        return 1
    print("全部在阈值内")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
