"""Skill 提示词加载器

从 backend/app/skills/ 目录动态加载 oh-story-claudecode 格式的 Skill，
将其转换为 PromptService 兼容的系统默认模板。

每个 Skill 目录结构：
  skills/{skill_name}/
  ├── SKILL.md          # YAML元数据 + 完整工作流指令
  └── references/       # 参考知识库（可选）
      ├── xxx.md
      └── ...
"""

import os
import re
from typing import Any, List, Dict, Optional
import yaml
from app.logger import get_logger

logger = get_logger(__name__)

# Skills 目录路径：backend/app/skills/ （本文件在 backend/app/services/ 下）
SKILLS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills")

# 上游 oh-story 的 SKILL.md 会区分「必读」与「按需查阅」，把参考文件拆成几十个小文件。
# 全量拼接会让单个 Skill 的提示词膨胀到几十万字符，因此按引用关系分级注入：
# 被 SKILL.md 直接引用的参考文件全文内联，其余只进索引由模型自行取用。
INLINE_REF_LIMIT = 120_000       # 单个 Skill 内联参考的字符上限
INDEX_REF_MIN_CHARS = 1_500      # 低于此体积的未引用文件直接内联，不值得为它走索引

# 上游 Skill 假定运行在编程 Agent 里（有 shell、文件系统、subagent）。本项目是 Web 后端，
# 模型拿不到这些能力，必须显式说明降级方式，否则模型会反复尝试执行脚本或读写文件。
# 只在正文出现这些宿主假设时注入，用户自建的简单 Skill 不受影响。
HOST_ENV_MARKERS = ("references/", "scripts/", "spawn", "subagent", "narrative-writer")

# 章节生成（AI 创作）只该用「怎么把这一章写出来」的 Skill。
# 去味、拆文、扫榜三类是改稿或分析流程：它们在创作时没有草稿可改、没有榜单可查，
# 注入进去只会让模型把诊断报告当正文交付。名字匹配不到时按可用处理，
# 用户自建 Skill 不应被这套上游分类误伤。
CREATION_EXCLUDED_SKILL_NAMES = ("deslop", "-analyze", "-scan")

# 创作时注入的 Skill 提示词上限：完整内联参考知识库的工作流可达 9 万字符，
# 对单次章节生成既超预算又抢注意力，超过上限时只保留工作流正文。
CREATION_PROMPT_LIMIT = 30_000


class _SkillYamlDumper(yaml.SafeDumper):
    pass


class _LiteralString(str):
    pass


def _literal_string_representer(dumper: yaml.SafeDumper, data: _LiteralString):
    return dumper.represent_scalar('tag:yaml.org,2002:str', data, style='|')


_SkillYamlDumper.add_representer(_LiteralString, _literal_string_representer)


def _parse_yaml_frontmatter(content: str) -> Dict[str, Any]:
    """解析 SKILL.md 开头的 YAML frontmatter"""
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not match:
        return {}

    yaml_text = match.group(1)

    try:
        metadata = yaml.safe_load(yaml_text) or {}
    except yaml.YAMLError as e:
        logger.warning(f"解析 Skill YAML frontmatter 失败: {e}")
        return {}

    if not isinstance(metadata, dict):
        return {}

    result: Dict[str, Any] = {}
    for key in ("name", "display_name", "category", "description", "triggers", "version"):
        value = metadata.get(key)
        if key == "triggers" and isinstance(value, list):
            result[key] = [str(item).strip() for item in value if str(item).strip()]
        elif value is not None:
            result[key] = str(value).strip()

    return result


def _parse_frontmatter_raw(content: str) -> Dict[str, Any]:
    """读取 frontmatter 的完整原始字典，用于回写时保留未识别字段"""
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not match:
        return {}
    try:
        raw = yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        return {}
    return raw if isinstance(raw, dict) else {}


def _reference_path(refs_dir: str, ref_name: str) -> Optional[str]:
    """把参考文件名解析为 refs_dir 内的安全路径，越界或非法则返回 None"""
    if not ref_name or not isinstance(ref_name, str):
        return None
    name = ref_name.strip().replace("\\", "/").strip("/")
    if not name or ".." in name.split("/"):
        logger.warning(f"忽略非法参考文件名: {ref_name}")
        return None
    target = os.path.normpath(os.path.join(refs_dir, f"{name}.md"))
    if target != os.path.normpath(refs_dir) and not target.startswith(os.path.normpath(refs_dir) + os.sep):
        logger.warning(f"忽略越出 references 目录的参考文件名: {ref_name}")
        return None
    return target


def _template_key(name: str) -> str:
    return f"SKILL_{name.upper().replace('-', '_')}"


def _display_name_from_description(description: str, fallback: str) -> str:
    first_line = description.strip().splitlines()[0].strip() if description.strip() else ""
    if "。" in first_line:
        return first_line.split("。")[0].strip() or fallback
    return first_line or fallback


def _infer_category(name: str) -> str:
    if "long" in name:
        return "Skill·长篇"
    if "short" in name:
        return "Skill·短篇"
    if "deslop" in name:
        return "Skill·润色"
    if "browser" in name:
        return "Skill·工具"
    return "Skill"


def _extract_triggers(name: str, description: str, explicit_triggers: Any = None) -> List[str]:
    """获取触发词，优先使用结构化 triggers，旧文件则从描述中兼容提取。"""
    triggers: List[str] = []

    if isinstance(explicit_triggers, list):
        triggers.extend(str(item).strip() for item in explicit_triggers if str(item).strip())
    elif isinstance(explicit_triggers, str) and explicit_triggers.strip():
        triggers.extend(item.strip() for item in re.split(r'[\n,，、]+', explicit_triggers) if item.strip())

    if not triggers:
        triggers.append(f"/{name}")
        triggers.extend(re.findall(r'「(.+?)」', description))
        triggers.extend(match.group(1) for match in re.finditer(r'(?:^|[\s、，,。；;：:])(/[^\s、，,。；;：:「」]+)', description))

    if f"/{name}" not in triggers:
        triggers.insert(0, f"/{name}")

    return list(dict.fromkeys(triggers))


def is_creation_capable(name: str, description: str = "") -> bool:
    """该 Skill 能否用来指导章节正文创作

    按 name 判定（description 只是补充线索）：改稿、拆文、扫榜类流程在创作阶段
    没有输入可处理，选它们只会污染提示词，甚至让模型把报告写进正文。
    """
    text = f"{name} {description}".lower()
    return not any(marker in text for marker in CREATION_EXCLUDED_SKILL_NAMES)


def creation_prompt_content(skill: Dict[str, Any]) -> str:
    """取用于章节生成注入的 Skill 提示词，必要时剥掉附录与宿主说明

    工作流正文是模型能执行的部分；内联的参考知识库、附录索引和「Web 宿主没有
    shell」的说明在单次生成里读不到也用不上，剥掉可省一个数量级的 input token。
    """
    content = skill.get("content") or ""
    if len(content) <= CREATION_PROMPT_LIMIT:
        return content
    body = skill.get("body") or ""
    return body.strip() or content[:CREATION_PROMPT_LIMIT]


def _format_skill_frontmatter(metadata: Dict[str, Any]) -> str:
    data = {
        "name": metadata.get("name", ""),
        "display_name": metadata.get("display_name", ""),
        "category": metadata.get("category", "Skill"),
        "description": _LiteralString(metadata.get("description", "")),
        "triggers": metadata.get("triggers", []),
    }
    # 回写时保留上游带来的额外字段（version、metadata.openclaw.source 等 MIT 署名信息）
    version = str(metadata.get("version", "")).strip()
    if version:
        data["version"] = version
    extra = metadata.get("metadata")
    if isinstance(extra, dict) and extra:
        data["metadata"] = extra
    yaml_text = yaml.dump(
        data,
        Dumper=_SkillYamlDumper,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    ).strip()
    return f"---\n{yaml_text}\n---"


def _get_skill_body(content: str) -> str:
    """获取 SKILL.md 中 YAML frontmatter 之后的内容（即工作流指令）"""
    match = re.match(r'^---\s*\n.*?\n---\s*\n', content, re.DOTALL)
    if match:
        return content[match.end():].strip()
    return content.strip()


def _iter_reference_files(refs_dir: str) -> List[str]:
    """递归列出 references/ 下所有 .md，返回相对 refs_dir 的路径（不含 .md）"""
    found: List[str] = []
    for root, _dirs, files in os.walk(refs_dir):
        for filename in sorted(files):
            if not filename.endswith('.md'):
                continue
            rel = os.path.relpath(os.path.join(root, filename), refs_dir)
            found.append(rel[:-3].replace(os.sep, "/"))
    return sorted(found)


def _load_references(skill_dir: str) -> Dict[str, str]:
    """读取 references/ 下所有 .md（含子目录），key 为相对路径去后缀"""
    refs_dir = os.path.join(skill_dir, "references")
    references: Dict[str, str] = {}

    if not os.path.isdir(refs_dir):
        return references

    for rel in _iter_reference_files(refs_dir):
        filepath = os.path.join(refs_dir, f"{rel}.md")
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                references[rel] = f.read().strip()
        except Exception as e:
            logger.warning(f"读取参考文件失败: {filepath}, 错误: {e}")

    return references


def _cited_reference_keys(body: str) -> set:
    """从 SKILL.md 正文提取它显式引用的参考文件名"""
    if not body:
        return set()
    cited = set()
    # 上游参考文件名含中文，匹配范围要放宽；无法解析的占位路径会在下游按 key 过滤掉
    for match in re.finditer(r'references/([^\s`“”"\'\(\)\[\]<>，。；：、|]+?)\.md', body):
        cited.add(match.group(1).strip("/"))
    return cited


def _reference_summary(content: str) -> str:
    """取参考文件的首个非标题文本行，作为索引用途说明"""
    for line in content.splitlines():
        text = line.strip().lstrip("#*>-| ").strip()
        if len(text) >= 6:
            return text[:60]
    return ""


def _needs_host_notes(body: str) -> bool:
    """正文是否假设了编程 Agent 宿主（读写文件、跑脚本、派发 subagent）"""
    return any(marker in body for marker in HOST_ENV_MARKERS)


def _host_env_notes(has_index: bool) -> str:
    """说明当前 Web 宿主与上游 Agent 宿主的差异，避免模型空转执行脚本或读文件"""
    ref_rule = (
        "- 上文「参考资料索引」中的文件未附带，你无法自行读取。若某一步确实依赖缺失的参考内容，"
        "向作者说明缺少哪一份，凭已有上文与通用网文经验继续，不要虚构该文件的内容。\n"
        if has_index else
        "- 只使用上文已附带的参考资料，不要假设有其他参考文件存在。\n"
    )
    return f"""

---

## 当前运行环境（Web 创作应用，非编程 Agent）

你现在没有 shell、没有文件系统读写、没有 Node、也没有可派发的 subagent。按以下规则执行本 Skill：

- 正文由作者在对话中提供，或来自应用注入的上下文；不要尝试读写本地文件、创建目录或运行 `node scripts/...`。
- 文中要求「运行脚本 / 门禁自检 / spawn agent」的环节，按上游约定如实降级为人工语义检查，并在报告的技术备注里写明「本次环境无脚本与 subagent，检查为模型自查，未做机器校验」。不要假装脚本已运行或通过。
{ref_rule}- 输出直接给正文或报告本身，不要写入文件，也不要输出创建/删除文件的指令。
"""


def _compose_skill_content(body: str, references: Dict[str, str]) -> str:
    """按引用关系组装提示词：必读全文内联，其余进索引"""
    if not references:
        return body

    cited = _cited_reference_keys(body)
    inline: Dict[str, str] = {}
    indexed: Dict[str, str] = {}
    inline_chars = 0

    # 先放 SKILL.md 明确引用的必读文件，再用体积小的顶层文件补齐，
    # 避免上限被零碎文件占满后把关键参考挤到索引里。
    def try_inline(key: str) -> bool:
        nonlocal inline_chars
        content = references[key]
        size = len(content)
        if inline_chars + size > INLINE_REF_LIMIT:
            return False
        inline[key] = content
        inline_chars += size
        return True

    for key in sorted(k for k in references if k in cited):
        try_inline(key)

    for key in sorted(k for k in references if k not in inline):
        # 顶层小文件直接内联；子目录分卡只在被引用时内联
        if "/" not in key and len(references[key]) < INDEX_REF_MIN_CHARS:
            try_inline(key)

    for key, content in references.items():
        if key not in inline:
            indexed[key] = content

    parts = [body]

    if inline:
        section = ["\n\n---\n\n## 附录：参考资料知识库\n",
                   "（以下内容根据用户需求按需引用，不需要全部使用）\n"]
        for ref_name, ref_content in inline.items():
            section.append(f"\n### 参考资料：{ref_name}\n\n{ref_content}\n")
        parts.append("".join(section))

    if indexed:
        section = ["\n\n---\n\n## 参考资料索引（未随本文附带）\n",
                   "以下参考文件未内联以控制提示词长度。需要时向作者说明缺失，"
                   "或依据上文工作流中标注的加载条件判断；不要凭记忆虚构其内容。\n"]
        for ref_name in sorted(indexed):
            summary = _reference_summary(indexed[ref_name])
            section.append(f"- `references/{ref_name}.md`" + (f"：{summary}" if summary else "") + "\n")
        parts.append("".join(section))

    if _needs_host_notes(body):
        parts.append(_host_env_notes(bool(indexed)))

    return "".join(parts)


def load_skills() -> List[Dict]:
    """
    从 skills 目录加载所有 Skill，返回模板列表。
    格式与 PromptService.get_all_system_templates() 返回的一致。
    
    Returns:
        List[Dict]: Skill 模板列表，每个包含：
            - template_key: 模板键名 (SKILL_{name})
            - template_name: 显示名称
            - category: 分类 ("Skill")
            - description: 描述
            - parameters: 参数列表
            - content: 完整工作流指令内容
            - references: 参考知识库字典
            - triggers: 触发词列表
    """
    skills = []
    
    if not os.path.isdir(SKILLS_DIR):
        logger.warning(f"Skills 目录不存在: {SKILLS_DIR}")
        return skills
    
    for skill_name in sorted(os.listdir(SKILLS_DIR)):
        skill_dir = os.path.join(SKILLS_DIR, skill_name)
        if not os.path.isdir(skill_dir):
            continue
        
        skill_md_path = os.path.join(skill_dir, "SKILL.md")
        if not os.path.isfile(skill_md_path):
            continue
        
        try:
            with open(skill_md_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # 解析 YAML frontmatter
            metadata = _parse_yaml_frontmatter(content)
            
            # 获取工作流指令（去掉 YAML 部分）
            body = _get_skill_body(content)
            
            # 读取参考知识库（含子目录）
            references = _load_references(skill_dir)
            
            name = metadata.get('name', skill_name)
            desc = metadata.get('description', '')
            display_name = metadata.get('display_name') or _display_name_from_description(desc, name)
            category = metadata.get('category') or _infer_category(name)
            triggers = _extract_triggers(name, desc, metadata.get('triggers'))
            
            # 按引用关系分级注入参考知识库，控制提示词长度
            full_content = _compose_skill_content(body, references)
            
            skill_template = {
                "template_key": _template_key(name),
                "name": name,
                "template_name": display_name,
                "display_name": display_name,
                "category": category,
                "description": desc,
                "version": metadata.get('version', ''),
                "parameters": ["user_input"],
                "content": full_content,
                # 工作流正文（不含内联参考与宿主说明）：章节生成注入用得起的那一份
                "body": body,
                "references": references,
                "triggers": triggers,
                "is_skill": True,
            }
            
            skills.append(skill_template)
            logger.info(
                f"加载 Skill: {name} (分类: {category}, 参考: {len(references)} 个, "
                f"提示词: {len(full_content)} 字符)"
            )
            
        except Exception as e:
            logger.error(f"加载 Skill 失败: {skill_name}, 错误: {e}")
    
    return skills


def get_skill_by_trigger(user_input: str) -> Optional[Dict]:
    """
    根据用户输入匹配对应的 Skill
    
    Args:
        user_input: 用户输入的文本
        
    Returns:
        匹配到的 Skill 模板，未匹配返回 None
    """
    # 每条聊天消息都会走到这里，必须用缓存；新版 skill 有 200+ 参考文件，
    # 直接 load_skills() 会重复读盘并重新拼装全部提示词。
    skills = get_all_skills_cached()
    user_input_lower = user_input.lower().strip()
    
    for skill in skills:
        triggers = skill.get('triggers', [])
        for trigger in triggers:
            trigger_lower = trigger.lower()
            # 精确匹配触发词
            if user_input_lower == trigger_lower:
                return skill
            # 用户输入以触发词开头
            if user_input_lower.startswith(trigger_lower):
                return skill
    
    # 自然语言模糊匹配
    keyword_map = {
        "长篇写作": ["SKILL_STORY_LONG_WRITE"],
        "写长篇": ["SKILL_STORY_LONG_WRITE"],
        "帮我开书": ["SKILL_STORY_LONG_WRITE"],
        "写大纲": ["SKILL_STORY_LONG_WRITE"],
        "短篇写作": ["SKILL_STORY_SHORT_WRITE"],
        "写短篇": ["SKILL_STORY_SHORT_WRITE"],
        "写个盐言": ["SKILL_STORY_SHORT_WRITE"],
        "长篇拆文": ["SKILL_STORY_LONG_ANALYZE"],
        "拆书": ["SKILL_STORY_LONG_ANALYZE"],
        "分析黄金三章": ["SKILL_STORY_LONG_ANALYZE"],
        "短篇拆文": ["SKILL_STORY_SHORT_ANALYZE"],
        "分析短篇": ["SKILL_STORY_SHORT_ANALYZE"],
        "长篇扫榜": ["SKILL_STORY_LONG_SCAN"],
        "长篇什么火": ["SKILL_STORY_LONG_SCAN"],
        "起点排行": ["SKILL_STORY_LONG_SCAN"],
        "短篇扫榜": ["SKILL_STORY_SHORT_SCAN"],
        "短篇什么火": ["SKILL_STORY_SHORT_SCAN"],
        "去ai味": ["SKILL_STORY_DESLOP"],
        "去味": ["SKILL_STORY_DESLOP"],
        "太ai了": ["SKILL_STORY_DESLOP"],
        "润色": ["SKILL_STORY_DESLOP"],
    }
    
    for keyword, skill_keys in keyword_map.items():
        if keyword in user_input_lower:
            for skill in skills:
                if skill['template_key'] in skill_keys:
                    return skill
    
    return None


# 预加载缓存
_skills_cache = None

def get_all_skills_cached() -> List[Dict]:
    """获取所有 Skills（带缓存）"""
    global _skills_cache
    if _skills_cache is None:
        _skills_cache = load_skills()
    return _skills_cache

def refresh_skills_cache():
    """刷新 Skills 缓存"""
    global _skills_cache
    _skills_cache = load_skills()
    return _skills_cache


def get_skill_detail(skill_key: str) -> Optional[Dict]:
    """根据 template_key 获取 Skill 完整详情（包括原始 SKILL.md 内容和独立 references）"""
    skills = get_all_skills_cached()
    for s in skills:
        if s["template_key"] == skill_key:
            # 找到对应的目录
            skill_name = skill_key.replace("SKILL_", "").lower().replace("_", "-")
            skill_dir = os.path.join(SKILLS_DIR, skill_name)
            if not os.path.isdir(skill_dir):
                # 尝试从 name 字段获取
                for d in os.listdir(SKILLS_DIR):
                    d_path = os.path.join(SKILLS_DIR, d)
                    if os.path.isdir(d_path):
                        md_path = os.path.join(d_path, "SKILL.md")
                        if os.path.isfile(md_path):
                            try:
                                with open(md_path, 'r', encoding='utf-8') as f:
                                    meta = _parse_yaml_frontmatter(f.read())
                                if f"SKILL_{meta.get('name', '').upper().replace('-', '_')}" == skill_key:
                                    skill_dir = d_path
                                    break
                            except:
                                pass

            # 读取原始 SKILL.md
            skill_md_path = os.path.join(skill_dir, "SKILL.md")
            raw_content = ""
            if os.path.isfile(skill_md_path):
                with open(skill_md_path, 'r', encoding='utf-8') as f:
                    raw_content = f.read()

            # 读取独立的 references（不拼接到 content 中，含子目录）
            standalone_refs = _load_references(skill_dir)

            return {
                **s,
                "raw_content": raw_content,
                "standalone_references": standalone_refs,
                "skill_dir": skill_dir,
            }
    return None


def _validate_skill_metadata(name: str, display_name: str, category: str, description: str, triggers: List[str], body: str):
    if not name.strip():
        raise ValueError("Skill 内部标识不能为空")
    if not re.fullmatch(r'[a-z0-9][a-z0-9\-]*', name.strip()):
        raise ValueError("Skill 内部标识只能包含小写字母、数字和短横线，且必须以字母或数字开头")
    if not display_name.strip():
        raise ValueError("显示名称不能为空")
    if not category.strip():
        raise ValueError("分类不能为空")
    if not description.strip():
        raise ValueError("描述不能为空")
    if not body.strip():
        raise ValueError("工作流指令不能为空")
    if not triggers:
        raise ValueError("至少需要一个触发词")


def create_skill_files(
    name: str,
    description: str,
    body: str,
    references: Optional[Dict[str, str]] = None,
    display_name: Optional[str] = None,
    category: Optional[str] = None,
    triggers: Optional[List[str]] = None,
) -> Dict:
    """创建新的 Skill 文件"""
    import re
    name = name.strip().lower().replace("_", "-").replace(" ", "-")
    display_name = (display_name or _display_name_from_description(description, name)).strip()
    category = (category or _infer_category(name)).strip()
    triggers = _extract_triggers(name, description, triggers)
    _validate_skill_metadata(name, display_name, category, description, triggers, body)

    # 目录名：小写+短横线
    dir_name = name
    dir_name = re.sub(r'[^a-z0-9\-]', '', dir_name)
    if not dir_name:
        dir_name = "new-skill"
    
    skill_dir = os.path.join(SKILLS_DIR, dir_name)
    if os.path.exists(skill_dir):
        raise ValueError(f"Skill 目录已存在: {dir_name}")
    
    os.makedirs(skill_dir, exist_ok=True)
    
    frontmatter = _format_skill_frontmatter({
        "name": name,
        "display_name": display_name,
        "category": category,
        "description": description.strip(),
        "triggers": triggers,
    })
    skill_md_content = f"{frontmatter}\n\n{body.strip()}"
    
    skill_md_path = os.path.join(skill_dir, "SKILL.md")
    with open(skill_md_path, 'w', encoding='utf-8') as f:
        f.write(skill_md_content)
    
    # 创建 references
    if references:
        refs_dir = os.path.join(skill_dir, "references")
        os.makedirs(refs_dir, exist_ok=True)
        for ref_name, ref_content in references.items():
            ref_path = _reference_path(refs_dir, ref_name)
            if not ref_path:
                continue
            os.makedirs(os.path.dirname(ref_path), exist_ok=True)
            with open(ref_path, 'w', encoding='utf-8') as f:
                f.write(ref_content)
    
    # 刷新缓存
    refresh_skills_cache()
    
    # 返回新建的 skill
    skills = get_all_skills_cached()
    for s in skills:
        if s["template_key"] == _template_key(name):
            return s
    return {"template_key": _template_key(name), "template_name": display_name, "category": category}


def update_skill_files(
    skill_key: str,
    description: Optional[str] = None,
    body: Optional[str] = None,
    references: Optional[Dict[str, str]] = None,
    display_name: Optional[str] = None,
    category: Optional[str] = None,
    triggers: Optional[List[str]] = None,
) -> Dict:
    """更新已有 Skill 文件"""
    detail = get_skill_detail(skill_key)
    if not detail:
        raise ValueError(f"未找到 Skill: {skill_key}")
    
    skill_dir = detail.get("skill_dir", "")
    if not skill_dir or not os.path.isdir(skill_dir):
        raise ValueError(f"Skill 目录不存在: {skill_dir}")
    
    skill_md_path = os.path.join(skill_dir, "SKILL.md")
    
    # 读取现有内容
    with open(skill_md_path, 'r', encoding='utf-8') as f:
        raw = f.read()
    
    # 解析现有元数据
    metadata = _parse_yaml_frontmatter(raw)
    name = metadata.get('name', '')
    raw_metadata = _parse_frontmatter_raw(raw)
    
    # 更新 SKILL.md
    final_desc = description if description is not None else metadata.get('description', '')
    final_body = body if body is not None else _get_skill_body(raw)
    final_display_name = display_name if display_name is not None else metadata.get('display_name') or _display_name_from_description(final_desc, name)
    final_category = category if category is not None else metadata.get('category') or _infer_category(name)
    final_triggers = _extract_triggers(name, final_desc, triggers if triggers is not None else metadata.get('triggers'))
    _validate_skill_metadata(name, final_display_name, final_category, final_desc, final_triggers, final_body)

    frontmatter = _format_skill_frontmatter({
        "name": name,
        "display_name": final_display_name.strip(),
        "category": final_category.strip(),
        "description": final_desc.strip(),
        "triggers": final_triggers,
        # 保留上游 frontmatter 字段，避免管理后台保存时抹掉版本号与来源署名
        "version": raw_metadata.get("version", ""),
        "metadata": raw_metadata.get("metadata", {}),
    })
    new_content = f"{frontmatter}\n\n{final_body.strip()}"
    
    with open(skill_md_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    # 更新 references
    if references is not None:
        refs_dir = os.path.join(skill_dir, "references")
        # 删除旧的 reference 文件
        if os.path.isdir(refs_dir):
            for rel in _iter_reference_files(refs_dir):
                try:
                    os.remove(os.path.join(refs_dir, f"{rel}.md"))
                except OSError as e:
                    logger.warning(f"删除旧参考文件失败: {rel}, 错误: {e}")
        else:
            os.makedirs(refs_dir, exist_ok=True)

        # 写入新的 references
        for ref_name, ref_content in references.items():
            if ref_content.strip():  # 只写入非空内容
                ref_path = _reference_path(refs_dir, ref_name)
                if not ref_path:
                    continue
                os.makedirs(os.path.dirname(ref_path), exist_ok=True)
                with open(ref_path, 'w', encoding='utf-8') as f:
                    f.write(ref_content)
    
    # 刷新缓存
    refresh_skills_cache()
    
    # 返回更新后的详情
    return get_skill_detail(skill_key) or {}


def delete_skill_files(skill_key: str) -> bool:
    """删除 Skill 目录"""
    import shutil
    detail = get_skill_detail(skill_key)
    if not detail:
        raise ValueError(f"未找到 Skill: {skill_key}")
    
    skill_dir = detail.get("skill_dir", "")
    if not skill_dir or not os.path.isdir(skill_dir):
        raise ValueError(f"Skill 目录不存在")
    
    shutil.rmtree(skill_dir)
    refresh_skills_cache()
    return True
