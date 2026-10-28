"""AI去味相关的Pydantic模型"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional


class PolishRequest(BaseModel):
    """AI去味请求模型"""
    original_text: str = Field(..., description="原始文本（AI生成的文本）")
    project_id: Optional[str] = Field(None, description="项目ID（可选，用于记录历史）")
    provider: Optional[str] = Field(None, description="AI提供商")
    model: Optional[str] = Field(None, description="AI模型")
    temperature: Optional[float] = Field(0.8, description="温度参数，建议0.7-0.9")
    refine_until_clean: bool = Field(
        True,
        description="改写后仍有「必须改」项时，是否自动复改（最多两轮）",
    )


class PolishResponse(BaseModel):
    """AI去味响应模型"""

    original_text: str = Field(..., description="原始文本")
    polished_text: str = Field(..., description="去味后的文本")
    word_count_before: int = Field(..., description="处理前字数")
    word_count_after: int = Field(..., description="处理后字数")
    score_before: int = Field(-1, description="改写前风格干净度（0-100，-1 表示未检测）")
    score_after: int = Field(-1, description="改写后风格干净度（0-100，-1 表示未检测）")
    blocking_before: int = Field(0, description="改写前「必须改」数量")
    blocking_after: int = Field(0, description="改写后「必须改」数量")
    findings: list = Field(default_factory=list, description="改写后仍存在的问题明细")
    rounds: int = Field(1, description="实际执行的改写轮数")
    checker_available: bool = Field(True, description="运行环境是否具备确定性检测（Node + 上游脚本）")
    check_error: Optional[str] = Field(None, description="检测不可用时的原因说明")
    punctuation_fixed: int = Field(0, description="收尾确定性整理掉的标点处数（未跑或无改动为 0）")
    output_notes: list[str] = Field(
        default_factory=list,
        description="输出整理的说明（例如已剥离模型附带的扫描报告）",
    )
    analysis: str = Field(
        "",
        description="模型给出的三层扫描/改稿报告；仅用于工作台分析标签，不写回正文",
    )


class PolishCheckRequest(BaseModel):
    """仅检测请求模型"""
    text: str = Field(..., description="待检测文本")


class PolishAnalyzeRequest(BaseModel):
    """只分析不改写请求模型"""

    text: str = Field(..., description="待分析的正文")
    project_id: Optional[str] = Field(None, description="项目ID（可选，用于后续扩展历史记录）")
    provider: Optional[str] = Field(None, description="AI提供商")
    model: Optional[str] = Field(None, description="AI模型")
    temperature: Optional[float] = Field(0.3, description="分析温度，建议低于改写")


class PolishAnalyzeResponse(BaseModel):
    """只分析不改写响应模型"""

    analysis: str = Field(..., description="模型给出的三层诊断报告，不会写回正文")
    score: int = Field(-1, description="确定性脚本给出的干净度（0-100，-1 表示未检测）")
    blocking: int = Field(0, description="必须改数量")
    advisory: int = Field(0, description="建议改数量")
    findings: list = Field(default_factory=list, description="确定性脚本命中明细")
    checker_available: bool = Field(True, description="运行环境是否具备确定性检测")
    check_error: Optional[str] = Field(None, description="检测不可用时的原因")


class PolishBatchRequest(BaseModel):
    """批量去味请求模型"""
    texts: list[str] = Field(default_factory=list, description="待处理文本列表")
    project_id: Optional[str] = Field(None, description="项目ID（可选）")
    provider: Optional[str] = Field(None, description="AI提供商")
    model: Optional[str] = Field(None, description="AI模型")
    temperature: Optional[float] = Field(0.8, description="温度参数")
    refine_until_clean: bool = Field(True, description="仍有「必须改」项时是否自动复改")
