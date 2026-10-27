#!/usr/bin/env bash
# 从上游 oh-story-claudecode 同步小说写作 Skill。
#
#   ./backend/scripts/update_story_skills.sh            # 同步到上游最新 tag
#   ./backend/scripts/update_story_skills.sh v0.9.1     # 同步到指定 tag
#
# 只覆盖 .upstream.json 里登记的 skill 目录，其余目录（含自建 skill）不动。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILLS_DIR="$REPO_ROOT/backend/app/skills"
META="$SKILLS_DIR/.upstream.json"
UPSTREAM_URL="https://github.com/zenstory-ai/oh-story-claudecode.git"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

[ -f "$META" ] || { echo "缺少 $META，无法确定要同步哪些 skill" >&2; exit 1; }

# 读取登记信息（不依赖 jq）
read -r CURRENT_TAG CURRENT_COMMIT < <(
  python3 -c "
import json;d=json.load(open('$META'))
print(d['tag'], d['commit'])
"
)

SKILLS=($(python3 -c "
import json;d=json.load(open('$META'))
print(' '.join(d['skills']))
"))

echo "上游: $UPSTREAM_URL"
echo "当前基线: $CURRENT_TAG ($CURRENT_COMMIT)"

git clone --quiet --no-checkout "$UPSTREAM_URL" "$TMP_DIR/upstream"
cd "$TMP_DIR/upstream"
git fetch --quiet --tags

TARGET_REF="${1:-}"
if [ -z "$TARGET_REF" ]; then
  TARGET_REF="$(git tag --sort=-v:refname | head -1)"
fi

if [ "$TARGET_REF" = "$CURRENT_TAG" ]; then
  echo "已是最新: $TARGET_REF"
  exit 0
fi

echo "目标版本: $TARGET_REF"
git checkout --quiet "$TARGET_REF"
NEW_COMMIT="$(git rev-parse HEAD)"
RELEASED_AT="$(git log -1 --format=%ad --date=short)"

MISSING=()
for skill in "${SKILLS[@]}"; do
  [ -d "skills/$skill" ] || MISSING+=("$skill")
done
if [ ${#MISSING[@]} -gt 0 ]; then
  printf '上游该版本不含以下已登记 skill，先更新 %s：\n  %s\n' "$META" "${MISSING[*]}" >&2
  exit 1
fi

for skill in "${SKILLS[@]}"; do
  rm -rf "$SKILLS_DIR/$skill"
  # -L：上游用跨 skill 的相对符号链接共享参考文件。Web 部署与 Windows、
  # 或 core.symlinks=false 的 clone 会让链接退化成「内容为路径字符串」的文件，
  # 模型读到的是 ../../xxx 一行文本而不是知识，且会静默失效。因此统一解引用为真实副本。
  cp -RL "skills/$skill" "$SKILLS_DIR/$skill"
  if [ -n "$(find "$SKILLS_DIR/$skill" -type l)" ]; then
    echo "⚠️  $skill 仍残留符号链接，检查 cp -RL" >&2
    exit 1
  fi
  printf '  已更新 %s\n' "$skill"
done

cp LICENSE "$SKILLS_DIR/LICENSE.oh-story.tmp"
python3 - "$META" "$SKILLS_DIR/LICENSE.oh-story" "$TARGET_REF" "$NEW_COMMIT" "$RELEASED_AT" <<'PY'
import datetime, json, sys

meta_path, lic_path, tag, commit, released = sys.argv[1:6]

with open(meta_path, encoding="utf-8") as fh:
    meta = json.load(fh)
meta.update({
    "tag": tag,
    "commit": commit,
    "released_at": released,
    "synced_at": datetime.date.today().isoformat(),
})
with open(meta_path, "w", encoding="utf-8") as fh:
    json.dump(meta, fh, ensure_ascii=False, indent=2)
    fh.write("\n")

# 保留我们附加的中文说明，替换上游许可正文
header = []
with open(lic_path, encoding="utf-8") as fh:
    for line in fh:
        if line.startswith("MIT License"):
            break
        header.append(line)
header.append(f"同步版本：{tag}（见同目录 .upstream.json）\n\n")
with open(lic_path + ".tmp", encoding="utf-8") as fh:
    body = fh.read()
with open(lic_path, "w", encoding="utf-8") as fh:
    fh.write("".join(header) + body)
PY
mv "$SKILLS_DIR/LICENSE.oh-story.tmp" "$SKILLS_DIR/LICENSE.oh-story"

echo
echo "$CURRENT_TAG -> $TARGET_REF 同步完成"
echo "下一步：确认提示词体积，再提交"
echo "  python3 backend/scripts/check_skill_prompt_size.py"
echo "  git diff --stat backend/app/skills"
