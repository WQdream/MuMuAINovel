# Skill 开发指南：如何添加或修改 Skill

## 一、Skill 系统架构概览

```
backend/app/skills/          ← 所有 Skill 存放目录
├── story-short-write/       ← 每个 Skill 一个目录
│   ├── SKILL.md            ← 必须存在：YAML元数据 + 工作流指令
│   ├── references/         ← 可选：参考知识库（.md 文件，可分子目录）
│   └── scripts/            ← 上游自带的 Node 脚本；AI 去味会由后端代跑（见 4.4），其他 Skill 仍按 4.3 降级
├── story-long-write/
│   ├── SKILL.md
│   └── references/...
├── .upstream.json           ← 上游同步基线（来源仓库、tag、commit、纳入的 skill 列表）
└── LICENSE.oh-story         ← 上游 MIT 许可（story-* 提示词文件来自该项目）

backend/app/services/skill_loader.py   ← Skill 加载器（自动扫描 skills/ 目录）
backend/app/api/skills.py              ← API 端点（/api/skills/list）
backend/app/services/prompt_service.py ← 将 Skill 注入系统提示词
```

**核心机制**：首次使用时，`skill_loader.py` 扫描 `skills/` 目录，读取每个子目录的 `SKILL.md`，
解析 YAML 元数据和工作流指令，再按引用关系把 `references/` 分级注入（必读全文内联、其余进索引），
结果缓存在内存中提供给 AI。

**上游来源**：`story-*` 系列 Skill 来自 [oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode)（MIT），
当前基线记录在 `.upstream.json`，同步方式见文末「七、同步上游 Skill」。

---

## 二、添加新 Skill（3 步）

### 步骤 1：创建 Skill 目录

在 `backend/app/skills/` 下创建新目录，目录名建议用小写英文+短横线：

```bash
mkdir -p backend/app/skills/my-new-skill/references
```

### 步骤 2：创建 SKILL.md（必须）

在目录下创建 `SKILL.md`，格式固定为 **YAML frontmatter + Markdown 正文**：

```markdown
---
name: my-new-skill
description: |
  一句话描述这个 Skill 的功能。这是显示在 UI 上的名称。
  触发方式：/my-new-skill、「帮我做xxx」
---

# my-new-skill：Skill 显示标题

你是 xxx 专家。你的任务是帮用户完成 xxx。

## 核心原则

- 原则1...
- 原则2...

## 工作流程

### Phase 1：需求确认
...

### Phase 2：执行
...

### Phase 3：输出
...

## 输出格式
...
```

**YAML frontmatter 字段说明**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | Skill 内部标识名，与目录名保持一致 |
| `description` | ✅ | Skill 描述。**第一句**（第一个句号前）会作为 UI 下拉框显示名称 |
| `triggers` | ❌ | 触发词列表；缺省时从 description 的「」和 `/xxx` 自动提取 |
| `display_name` | ❌ | UI 显示名；缺省时按 description 第一句推断 |
| `category` | ❌ | UI 分类；缺省时按 name 关键词自动归类（见下表） |
| `version` | ❌ | 上游版本号，随 `/api/skills/list` 透出到前端 |
| `metadata` | ❌ | 上游透传字段（如 `openclaw.source` 来源署名），管理后台保存时不会丢 |

**自动分类逻辑**（在 `skill_loader.py` 中）：

| name 包含 | UI 分类显示 |
|-----------|-------------|
| `long` | Skill·长篇 |
| `short` | Skill·短篇 |
| `deslop` | Skill·润色 |
| `browser` | Skill·工具 |
| 其他 | Skill |

### 步骤 3：添加参考资料（可选）

在 `references/` 目录下放入 `.md` 文件，加载器按「是否被 SKILL.md 引用」分级注入，不是无脑全量拼接：

```
references/
├── technique-a.md      ← 正文写了 references/technique-a.md → 全文内联
├── technique-b.md      ← 正文写了 references/technique-b.md → 全文内联
├── tiny-note.md        ← 未被引用但小于 1500 字符 → 仍内联（走索引不划算）
└── big-topic.md        ← 未被引用且较大 → 只进「参考资料索引」，正文附带一行摘要
```

| 规则 | 常量（`skill_loader.py`） | 默认 |
|------|--------------------------|------|
| 单个 Skill 内联参考的字符上限 | `INLINE_REF_LIMIT` | 120,000 |
| 未引用小文件直接内联的门槛 | `INDEX_REF_MIN_CHARS` | 1,500 |

被 SKILL.md 明确引用的文件永远优先内联，超上限才会落到索引。子目录里的分卡（如
`genre-prose-cards/都市脑洞.md`）一次写作只用得上其中一张，因此只有被明确引用时才内联。

**写完记得自查提示词体积**（改动 references 后尤其重要）：

```bash
python3 backend/scripts/check_skill_prompt_size.py
```

**完成！** 重启服务后新 Skill 自动出现在 UI 下拉框中，无需改任何代码。

---

## 三、修改现有 Skill

### 修改工作流指令

直接编辑对应 Skill 目录下的 `SKILL.md` 文件中 `---` 下方的 Markdown 部分。

### 修改元数据（名称、描述）

编辑 `SKILL.md` 文件开头的 YAML frontmatter：

```yaml
---
name: story-short-write          ← 修改内部标识
description: |                   ← 修改描述（第一句是 UI 显示名）
  新的一句话描述。后续详细说明...
---
```

### 增删参考资料

在 `references/` 目录下增删 `.md` 文件即可，重启后自动生效。

### 修改自动分类

编辑 `backend/app/services/skill_loader.py` 中的分类逻辑（约第158-167行）：

```python
# 确定 Skill 子分类
sub_category = "Skill"
if "long" in name:
    sub_category = "Skill·长篇"
elif "short" in name:
    sub_category = "Skill·短篇"
# 👇 在这里添加新的分类规则
elif "my-keyword" in name:
    sub_category = "Skill·新分类"
```

---

## 四、Skill 在系统中的流转路径

了解 Skill 如何被使用，方便排查问题：

### 4.1 SkillChat 页面（独立对话）

```
用户在 SkillChat 选择 Skill
  → 前端调用 /api/skills/list 获取列表
  → 前端调用 /api/skills/chat 发送消息（SSE 流式）
  → 后端 skill_loader 加载 SKILL.md + references
  → 注入到 system prompt → 调用 AI → 返回结果
```

### 4.2 章节生成（单章 / 批量）

```
用户选择 Skill 下拉框
  → 前端将 skill_key 传给后端
  → 后端 get_all_skills_cached() 按 template_key 命中该 Skill
  → 注入到章节生成的 system prompt 中
  → AI 在 Skill 指导下生成章节内容
```

关键代码位置：
- **提示词组装**：`backend/app/services/skill_loader.py` 的 `load_skills()`，结果缓存在 `_skills_cache`
- **章节注入点**：`backend/app/api/chapters.py` 三处（流式单章、后台单章、批量生成），
  均以 `skill["content"]` 拼进 `system_prompt_with_style`
- **模板列表透出**：`backend/app/services/prompt_service.py` 的 `get_all_system_templates()`

### 4.3 宿主环境说明（Web 后端，非编程 Agent）

上游 Skill 假定跑在 Claude Code / Codex 这类有 shell、文件系统和 subagent 的编程 Agent 里。
本项目是 Web 后端，模型拿不到这些能力，所以 `load_skills()` 会在提示词尾部自动追加一段
「当前运行环境」说明，要求模型不要尝试读写文件或执行脚本、把门禁自检降级为语义检查并如实标注、
不要虚构未附带参考资料的内容。判定条件见 `HOST_ENV_MARKERS`：只有正文出现 `references/`、
`scripts/`、`spawn`、`subagent` 等字样时才注入，自建 Skill 若不涉及这些假设则不受影响。

改这段文案在 `backend/app/services/skill_loader.py` 的 `_host_env_notes()`。

### 4.4 AI 去味：后端代跑上游脚本（`/api/polish`）

`backend/app/services/deslop_check_service.py` 用 `asyncio.create_subprocess_exec` 执行
`story-deslop/scripts/` 里的确定性脚本，把结果喂回模型或界面。**这是「后端跑、模型不跑」**：
模型侧的提示词仍按 4.3 声明它没有 shell，避免它假装自己执行过脚本。

| 脚本 | 作用 | 后端入口 |
|---|---|---|
| `check-ai-patterns.js --json` | 句式与套词命中（blocking / advisory） | `check_text()` |
| `check-degeneration.js --json` | 逐字复读、打转、截断、占位符 | `check_text()` |
| `normalize-punctuation.js` | 省略号/破折号/分隔线的机械整理 | `normalize_punctuation()` |

- 干净度 `score = 100 - (blocking × 12 + min(advisory, 20) × 2)`，是本地风格门禁，**不是 AIGC 检测概率**。
- 文本经临时文件传入，脚本只读写该临时文件，不触碰用户目录；`.deslop-whitelist` 需要书目录，Web 宿主下不加载。
- 没有 Node 时 `available=False`，去味降级为纯模型改写并在响应里如实标注；`Dockerfile` 的运行时镜像已装 `nodejs`。
- 闭环：`改前检测 → 按 story-deslop Skill 改写 → 复扫 → 仍有 blocking 且开了自动复改则复改（上限 3 轮）→ blocking 清零后整理标点 → 复扫`。

前端入口在项目内「AI 去味」页（`frontend/src/pages/Polish.tsx`），支持粘贴改写、从章节载入、对照、写回与批量。

---

## 五、完整示例：添加一个「节奏检查」Skill

```bash
# 1. 创建目录
mkdir -p backend/app/skills/story-pacing-check/references

# 2. 创建 SKILL.md
cat > backend/app/skills/story-pacing-check/SKILL.md << 'EOF'
---
name: story-pacing-check
description: |
  节奏诊断。分析已有章节的叙事节奏，指出拖沓/仓促之处并给出修改建议。
  触发方式：/story-pacing-check、「检查节奏」「节奏有问题」
---

# story-pacing-check：叙事节奏诊断

你是一位叙事节奏分析专家。你的任务是帮用户分析章节的节奏问题。

## 分析维度

### 1. 信息密度
- 每段是否有新信息推进？
- 是否存在重复表达？

### 2. 情绪曲线
- 情绪是否有起伏？
- 高潮前是否有足够铺垫？

### 3. 场景切换
- 场景转换是否自然？
- 时间线是否清晰？

## 输出格式

给出：问题位置 → 原因分析 → 修改建议
EOF

# 3. 重启服务即可！
```

---

## 六、注意事项

1. **SKILL.md 编码**：必须是 UTF-8
2. **YAML 格式**：`description: |` 后的内容需要缩进
3. **命名规则**：目录名和 `name` 字段用小写+短横线（如 `my-skill-name`）
4. **缓存**：Skill 有内存缓存，修改后需重启服务。也可调用 `refresh_skills_cache()` 热刷新
5. **参考文件大小**：被 SKILL.md 引用的参考文件会全文内联进 prompt，未引用的大文件只进索引。
   调整 references 后跑一次 `python3 backend/scripts/check_skill_prompt_size.py` 确认体积
6. **管理后台保存语义**：`/api/skills/update` 对 `references` 是**全量替换**——前端提交的
   JSON 里没有的参考文件会被删除。只在明确要精简知识库时使用
7. **不需要改代码**：添加标准 Skill（只有 SKILL.md + references）无需修改任何 Python/TypeScript 代码

---

## 七、同步上游 Skill

`story-*` 系列来自 [oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode)（MIT）。
更新会连带替换 `references/` 与 `scripts/`，因此用脚本执行，不要手工 `cp`：

```bash
./backend/scripts/update_story_skills.sh            # 同步到上游最新 tag
./backend/scripts/update_story_skills.sh v0.9.1     # 或指定 tag
```

脚本只覆盖 `.upstream.json` 的 `skills` 列表里登记的目录，你在同目录自建的其他 Skill 不受影响。
跑完它会更新 `.upstream.json`（tag / commit / 同步日期）和 `LICENSE.oh-story`，然后：

```bash
python3 backend/scripts/check_skill_prompt_size.py   # 确认提示词体积没失控
git diff --stat backend/app/skills                   # 看改了什么
```

**上游破坏性变更检查**：上游若新增 skill 或把参考文件改名，`.upstream.json` 的 `skills` 列表需要手工
调整；脚本发现登记目录在上游不存在时会直接报错并列出缺失项，不会静默跳过。

**本项目与上游的差异**（更新后仍需保留的适配）：
- 上游 SKILL.md 里的 `node scripts/*.js` 自检在 Web 环境不可用，由 `_host_env_notes()` 统一声明降级，
  不要把它当成必须执行的步骤写进自定义 Skill
- 上游依赖 `/story-setup` 部署 subagent 角色，本应用没有 subagent，涉及「交给 narrative-writer」的
  流程一律由当前模型直接完成
- 上游读写本地项目文件（`正文/`、`追踪/`），本应用的正文与设定存在数据库，靠上下文注入
