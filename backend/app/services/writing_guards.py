"""创作阶段的「少产生 AI 味」防线。

去味页是在草稿已写完之后改稿；这里做的是另一件事：把 story-deslop
（references/expression.md、banned-words.md）里最容易被脚本判为 blocking 的写作习惯，
压缩成一段固定注入的硬性约束，让模型第一遍就少踩。零额外 token 调用，
目的是降低事后去味的复改轮数，不替代去味流程。
"""
from __future__ import annotations

from typing import Optional

from app.logger import get_logger

logger = get_logger(__name__)

# 只保留「跨场景机械复现」这类在语境里几乎总能改好的模式；
# 准确直写、有功能的排比与心理描写不在此列，刻意不设字数/词频指标，
# 避免模型为达标而把章节写成另一种模板。
WRITING_GUARD_TEXT = """【避免 AI 腔（硬性，与剧情约束同级）】

1. 不写电报体：不要把位置、原因、动作拆成一串各说一事的短句；先定这段在写哪次行动，再按主次合并句子，保住因果与揭露顺序。
2. 不用否定翻转铺垫：少写「不是A，而是B」「没有X，没有Y，只有Z」。仅在纠错、辩解、排除猜测时保留对比。
3. 不堆万能状语与套式声线：「带着一丝…」「声音不大，却…」「语气毫无波澜」这类任何人都能用的标签，改成可辨的说话内容或具体信息。
4. 不复用反应模板：「眼中闪过…」「嘴角勾起」「心头一震」「深吸一口气」「指节泛白」同一套路跨场景重复出现即改；只保留有作用的身体细节（影响动作、条件或后果）。
5. 不做抽象收束与预告：段尾、章尾不写「意义深远」「从这一刻开始」「他不知道的是，更大的风暴即将来临」「人生就是这样」，也不要替读者点题、盖章或翻开新的一页。
6. 不解释已成立的事：删掉「这意味着」「真正重要的是」「他终于明白」「正是因为」这类结论链；读者已经得到的意思不要再说一遍。
7. 不用公文腔与论述腔：叙述里避免「不难看出」「事实上」「综上所述」「与此同时」「基于当前情况推进后续事项」；职业对话、公告、条文按自身语域写。
8. 比喻要有信息：「如潮水般」「宛如疾风骤雨」「命运的齿轮」只抬高语气就删；能带来角色特有感受、空间关系或新认识的比喻保留，不换一批新比喻。
9. 情绪可直写：一句准确的「他很紧张」可以留，不机械套 Show/Tell；但上下文已表达同一情绪时，不要再补一句命名。
10. 台词要有分别：不要让所有人都用同样完整的解释、同样漂亮的反问；按身份与场合区分声口，不靠加俚语、口误或脏话装自然。

以上只约束表达，不改变事件、动机、结果、伏笔与揭露顺序。"""


def guard_for_generation(include_skill: bool) -> str:
    """返回注入创作提示词的防线文本

    include_skill 为 True 时，说明本次已把完整 Skill 工作流放进 system prompt，
    那边已有同样的表达约束，这里只保留最短的一条提醒，避免两份长指令互相抢注意力。
    """
    if include_skill:
        return (
            "\n\n【表达底线】不写电报体碎句、不用「不是A而是B」铺垫、"
            "不复用反应模板、段尾不做抽象总结与预告；只改表达，不动剧情。"
        )
    return "\n\n" + WRITING_GUARD_TEXT


def build_creation_system_prompt(
    skill_key: Optional[str],
    style_content: str,
) -> tuple[Optional[str], bool]:
    """组装章节生成的系统提示词：Skill 工作流 + 写作风格 + 表达防线

    四条生成路径（流式、后台、遗留后台、批量）共用同一份逻辑，避免各自的
    注入文案漂移。Skill 只注入工作流正文，不带上游为 agent 宿主准备的内联参考
    知识库；超出预算的 Skill 会退化成「章节创作要点」那套精简清单。

    Returns:
        (system_prompt 或 None, 是否成功注入了 Skill)
    """
    from app.services.skill_loader import (
        creation_prompt_content,
        get_all_skills_cached,
        is_creation_capable,
    )

    system_prompt: Optional[str] = None
    skill_injected = False

    if skill_key:
        try:
            skills = get_all_skills_cached()
            skill = next((s for s in skills if s["template_key"] == skill_key), None)
            if not skill:
                logger.warning(f"⚠️ 未找到 Skill: {skill_key}")
            elif not is_creation_capable(skill.get("name", ""), skill.get("description", "")):
                # 兼容旧任务与旧链接：改稿/分析类 Skill 不注入创作提示词
                logger.warning(
                    f"⚠️ Skill '{skill['template_name']}' 是改稿/分析流程，"
                    "不用于指导创作，已改用章节创作要点"
                )
            else:
                content = creation_prompt_content(skill)
                system_prompt = (
                    f"【⚡ Skill 工作流：{skill['template_name']}】\n\n{content}\n\n"
                    "⚠️ 请严格遵循上述 Skill 工作流指令进行创作！"
                )
                skill_injected = True
                logger.info(
                    f"⚡ 已将 Skill '{skill['template_name']}' 注入系统提示词（{len(content)}字符）"
                )
        except Exception as skill_err:
            logger.warning(f"⚠️ 加载 Skill 失败: {skill_err}")

    if style_content:
        if system_prompt:
            system_prompt += f"\n\n【🎨 写作风格要求 - 补充】\n\n{style_content}"
        else:
            system_prompt = (
                f"【🎨 写作风格要求 - 最高优先级】\n\n{style_content}\n\n"
                "⚠️ 请严格遵循上述写作风格要求进行创作，这是最重要的指令！\n"
                "确保在整个章节创作过程中始终保持风格的一致性。"
            )
            logger.info(f"✅ 已将写作风格注入系统提示词（{len(style_content)}字符）")

    return system_prompt, skill_injected
