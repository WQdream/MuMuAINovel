/**
 * AI 去味工作台
 *
 * 后端链路：确定性检测（上游 story-deslop 的 Node 脚本）→ story-deslop Skill 改写 → 复扫 → 必要时自动复改。
 * 界面分数是「本地风格干净度」，不是 AIGC 检测率，文案如实说明。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import {
  Alert, Button, Checkbox, Empty, Input, Modal, Progress, Segmented,
  Select, Space, Spin, Switch, Tag, Tooltip, theme,
} from 'antd';
import {
  AimOutlined, BarChartOutlined, CheckCircleOutlined, CloseCircleOutlined, DiffOutlined,
  ExclamationCircleOutlined, FieldTimeOutlined, FileSearchOutlined, ReloadOutlined,
  SaveOutlined, ScanOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { chapterApi, polishApi } from '../services/api';
import type { Chapter, PolishFinding, PolishResult } from '../types';
import { useThemeMode } from '../theme/useThemeMode';
import MarkdownRenderer from '../components/MarkdownRenderer';
import './Polish.css';

const { TextArea } = Input;

type ViewMode = 'split' | 'result' | 'original' | 'analysis';
type Tone = 'clean' | 'rough' | 'heavy' | 'untested';

const SEVERITY_META: Record<string, { label: string; color: string }> = {
  blocking: { label: '必须改', color: 'error' },
  advisory: { label: '建议改', color: 'warning' },
};

const TONE_TEXT: Record<Tone, string> = {
  clean: '干净',
  rough: '有痕迹',
  heavy: '痕迹明显',
  untested: '未检测',
};

function scoreTone(score: number): Tone {
  if (score < 0) return 'untested';
  if (score >= 90) return 'clean';
  if (score >= 70) return 'rough';
  return 'heavy';
}

export default function Polish() {
  const { projectId } = useParams<{ projectId: string }>();
  const { token } = theme.useToken();
  const { resolvedMode } = useThemeMode();

  // 深色下主色接近纯黑，改后栏底色提亮一点才看得出层次
  const accentColor = resolvedMode === 'dark' ? '#EDEDE7' : token.colorPrimary;
  const themeVars = {
    '--pl-text': token.colorText,
    '--pl-secondary': token.colorTextSecondary,
    '--pl-tertiary': token.colorTextTertiary,
    '--pl-border': token.colorBorderSecondary,
    '--pl-fill': token.colorFillQuaternary,
    '--pl-card-bg': token.colorBgContainer,
    '--pl-accent': accentColor,
  } as CSSProperties;

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [chapterId, setChapterId] = useState<string | undefined>();

  const [source, setSource] = useState('');
  const [result, setResult] = useState<PolishResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisOnly, setAnalysisOnly] = useState(false);
  const [refine, setRefine] = useState(true);
  const [view, setView] = useState<ViewMode>('split');
  const [error, setError] = useState<string | null>(null);
  const [normalizing, setNormalizing] = useState(false);

  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    if (!projectId) return;
    setLoadingChapters(true);
    chapterApi.getChapters(projectId)
      .then(items => setChapters(items.filter(item => (item.content || '').trim().length > 0)))
      .catch(() => setChapters([]))
      .finally(() => setLoadingChapters(false));
  }, [projectId]);

  const loadChapter = useCallback((id: string) => {
    const chapter = chapters.find(item => item.id === id);
    if (!chapter) return;
    setSource(chapter.content || '');
    setResult(null);
    setView('split');
    setError(null);
    setAnalysisOnly(false);
  }, [chapters]);

  const findings = useMemo<PolishFinding[]>(() => result?.findings ?? [], [result]);
  const blocking = findings.filter(item => item.severity === 'blocking');
  const advisory = findings.filter(item => item.severity !== 'blocking');
  const diffStyles = useMemo(() => ({
    variables: {
      light: {
        diffViewerBackground: token.colorBgContainer,
        diffViewerColor: token.colorText,
        addedBackground: token.colorSuccessBg,
        addedColor: token.colorText,
        removedBackground: token.colorErrorBg,
        removedColor: token.colorText,
        wordAddedBackground: token.colorSuccessBorder,
        wordRemovedBackground: token.colorErrorBorder,
        addedGutterBackground: token.colorSuccessBg,
        removedGutterBackground: token.colorErrorBg,
        gutterBackground: token.colorFillQuaternary,
        gutterBackgroundDark: token.colorFillTertiary,
      },
      dark: {
        diffViewerBackground: token.colorBgContainer,
        diffViewerColor: token.colorText,
        addedBackground: 'rgba(82, 196, 26, 0.16)',
        addedColor: token.colorText,
        removedBackground: 'rgba(255, 77, 79, 0.16)',
        removedColor: token.colorText,
        wordAddedBackground: 'rgba(82, 196, 26, 0.34)',
        wordRemovedBackground: 'rgba(255, 77, 79, 0.34)',
        addedGutterBackground: 'rgba(82, 196, 26, 0.12)',
        removedGutterBackground: 'rgba(255, 77, 79, 0.12)',
        gutterBackground: token.colorFillQuaternary,
        gutterBackgroundDark: token.colorFillSecondary,
      },
    },
    line: {
      padding: '7px 1px',
      fontSize: '13px',
      lineHeight: '1.95',
      whiteSpace: 'pre-wrap' as const,
      wordBreak: 'break-word' as const,
    },
    wordAdded: {
      padding: '0 1px',
      borderRadius: '2px',
      background: resolvedMode === 'dark'
        ? 'rgba(82, 196, 26, 0.45)'
        : token.colorSuccessBg,
      textDecoration: 'underline 1px',
      textUnderlineOffset: '2px',
    },
    wordRemoved: {
      padding: '0 1px',
      borderRadius: '2px',
      background: resolvedMode === 'dark'
        ? 'rgba(255, 77, 79, 0.45)'
        : token.colorErrorBg,
      textDecoration: 'line-through',
      textDecorationThickness: '1px',
    },
    contentText: {
      fontFamily: 'inherit',
    },
    lineNumber: {
      fontFamily: 'inherit',
      fontSize: '11px',
    },
  }), [resolvedMode, token]);

  const runCheck = async () => {
    if (!source.trim()) {
      setError('先粘贴或选择要检测的正文');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const report = await polishApi.polishCheck(source);
      if (!report.available) {
        setError(report.error ?? '当前运行环境缺少 Node，无法执行机器检测');
        return;
      }
      // 已有改写结果时不覆盖改后数字，只刷新原文侧的检测
      setResult(prev => (prev?.polished_text
        ? { ...prev, score_before: report.score, blocking_before: report.blocking }
        : {
            original_text: source,
            polished_text: '',
            word_count_before: source.length,
            word_count_after: 0,
            score_before: report.score,
            score_after: report.score,
            blocking_before: report.blocking,
            blocking_after: report.blocking,
            findings: report.findings,
            rounds: 0,
            checker_available: true,
            check_error: null,
            analysis: prev?.analysis,
          }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '检测失败');
    } finally {
      setChecking(false);
    }
  };

  const runPolish = async () => {
    if (!source.trim()) {
      setError('先粘贴或选择需要精修的正文');
      return;
    }
    setPolishing(true);
    setAnalysisOnly(false);
    setError(null);
    try {
      const res = await polishApi.polishText({
        original_text: source,
        project_id: projectId,
        refine_until_clean: refine,
      });
      setResult(res);
      setAnalysisOnly(false);
      setView('split');
      if (!res.checker_available) setError(res.check_error ?? '运行环境未执行机器检测');
    } catch (e) {
      setError(e instanceof Error ? e.message : '精修失败');
    } finally {
      setPolishing(false);
    }
  };

  const runAnalyze = async () => {
    if (!source.trim()) {
      setError('先粘贴或选择要分析的正文');
      return;
    }
    setAnalyzing(true);
    setAnalysisOnly(false);
    setError(null);
    try {
      const res = await polishApi.polishAnalyze({
        text: source,
        project_id: projectId,
      });
      setResult({
        original_text: source,
        polished_text: '',
        word_count_before: source.length,
        word_count_after: 0,
        score_before: res.score,
        score_after: res.score,
        blocking_before: res.blocking,
        blocking_after: res.blocking,
        findings: res.findings,
        rounds: 0,
        checker_available: res.checker_available,
        check_error: res.check_error,
        analysis: res.analysis,
      });
      setAnalysisOnly(true);
      setView('analysis');
      if (!res.checker_available) setError(res.check_error ?? '运行环境未执行机器检测');
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const runBatch = async () => {
    const targets = chapters.filter(item => batchIds.includes(item.id));
    if (!targets.length) return;
    setPolishing(true);
    setError(null);
    setBatchProgress({ done: 0, total: targets.length });
    let saved = 0;
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const chapter = targets[i];
        try {
          const res = await polishApi.polishText({
            original_text: chapter.content || '',
            project_id: projectId,
            refine_until_clean: refine,
          });
          await chapterApi.updateChapter(chapter.id, { content: res.polished_text });
          saved += 1;
        } catch (e) {
          setError(`第 ${chapter.chapter_number} 章失败：${e instanceof Error ? e.message : '未知错误'}`);
        }
        setBatchProgress({ done: i + 1, total: targets.length });
      }
      setChapters(await chapterApi.getChapters(projectId || ''));
      setBatchIds([]);
      Modal.success({ title: '批量精修完成', content: `已改写并写回 ${saved}/${targets.length} 章` });
    } finally {
      setPolishing(false);
      setBatchProgress({ done: 0, total: 0 });
    }
  };

  const saveToChapter = async () => {
    if (!chapterId || !result?.polished_text) return;
    await chapterApi.updateChapter(chapterId, { content: result.polished_text });
    setChapters(await chapterApi.getChapters(projectId || ''));
    Modal.success({ title: '已写回章节', content: '原文已被替换，可继续人工润色。' });
  };

  // 只洗标点：确定性转换，不调模型，定稿后想去掉 AI 式省略号/破折号时用
  const runNormalize = async () => {
    if (!source.trim()) {
      setError('先粘贴或选择要整理标点的正文');
      return;
    }
    setNormalizing(true);
    setError(null);
    try {
      const res = await polishApi.polishNormalizePunctuation(source);
      if (res.changed) {
        setSource(res.normalized);
        setResult(null);
        setAnalysisOnly(false);
        Modal.success({ title: `已整理 ${res.count} 处标点`, content: '省略号、破折号与分隔线已按上游规则替换，未改动文字。' });
      } else {
        Modal.info({ title: '无需整理', content: '标点层没有命中，或已被前一次整理处理干净。' });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '标点整理失败');
    } finally {
      setNormalizing(false);
    }
  };

  const busy = checking || polishing || analyzing;
  const hasResult = Boolean(result?.polished_text);
  const afterScore = hasResult ? (result?.score_after ?? -1) : -1;

  return (
    <div className="polish-page" style={themeVars}>
      <header className="polish-header">
        <div className="polish-header-main">
          <h2 className="polish-title"><ScanOutlined /> 精修台</h2>
          <p className="polish-subtitle">
            在这里检查 AI 腔、重复句式和标点问题，再按审稿规则完成一轮改写。分数是本地风格门禁的「干净度」，
            不是 AIGC 检测概率；脚本零命中也不等于机器查得出来。
          </p>
        </div>
        <Space size={8} wrap>
          <Tooltip title="改后仍有「必须改」项时自动复改，最多两轮">
            <span className="polish-switch">自动复改 <Switch checked={refine} onChange={setRefine} disabled={busy} /></span>
          </Tooltip>
          <Button icon={<AimOutlined />} onClick={runCheck} loading={checking} disabled={polishing || analyzing || normalizing}>仅检测</Button>
          <Tooltip title="只按上游规则替换省略号、破折号与分隔线，不调用模型">
            <Button icon={<DiffOutlined />} onClick={runNormalize} loading={normalizing} disabled={busy}>
              仅洗标点
            </Button>
          </Tooltip>
          <Tooltip title="按 story-deslop 做表达、用笔、故事三层诊断，只给分析，不改写正文">
            <Button icon={<FileSearchOutlined />} onClick={runAnalyze} loading={analyzing} disabled={checking || polishing || normalizing}>
              只分析
            </Button>
          </Tooltip>
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={runPolish} loading={polishing} disabled={busy}>
            开始精修
          </Button>
        </Space>
      </header>

      {error && (
        <Alert className="polish-alert" type="warning" showIcon closable message={error} onClose={() => setError(null)} />
      )}

      <div className="polish-body">
        <section className="polish-col">
          <div className="polish-col-head">
            <Select
              size="small"
              allowClear
              showSearch
              loading={loadingChapters}
              placeholder="从章节载入"
              style={{ minWidth: 190 }}
              value={chapterId}
              onChange={value => {
                setChapterId(value);
                if (value) loadChapter(value);
              }}
              optionFilterProp="label"
              options={chapters.map(item => ({ value: item.id, label: `第${item.chapter_number}章 ${item.title}` }))}
            />
            <span className="polish-count">{source.length} 字</span>
          </div>
          <TextArea
            className="polish-textarea"
            value={source}
            onChange={e => {
              setSource(e.target.value);
              if (result) {
                setResult(null);
                setView('split');
                setAnalysisOnly(false);
              }
            }}
            placeholder="粘贴待处理正文，或用上方「从章节载入」"
          />
          <div className="polish-col-foot">
            <Checkbox
              indeterminate={batchIds.length > 0 && batchIds.length < chapters.length}
              checked={chapters.length > 0 && batchIds.length === chapters.length}
              onChange={e => setBatchIds(e.target.checked ? chapters.map(item => item.id) : [])}
            >
              批量（{batchIds.length}/{chapters.length}）
            </Checkbox>
            <Button size="small" icon={<FieldTimeOutlined />} disabled={!batchIds.length || busy} onClick={runBatch}>
              批量精修并写回
            </Button>
          </div>
          {polishing && batchProgress.total > 0 && (
            <Progress percent={Math.round((batchProgress.done / batchProgress.total) * 100)} size="small" status="active" />
          )}
        </section>

        <section className="polish-col polish-col--result">
          <div className="polish-col-head">
            <Segmented
              size="small"
              value={view}
              onChange={value => setView(value as ViewMode)}
              options={[
                { label: '对照', value: 'split', icon: <DiffOutlined /> },
                { label: '改后', value: 'result' },
                { label: '原文', value: 'original' },
                { label: '分析', value: 'analysis', icon: <BarChartOutlined /> },
              ]}
            />
            <Button size="small" type="text" icon={<SaveOutlined />} disabled={!chapterId || !hasResult} onClick={saveToChapter}>
              写回本章
            </Button>
          </div>

          <div className="polish-scoreboard">
            <ScoreChip label="改前" score={result?.score_before ?? -1} blocking={result?.blocking_before ?? 0} />
            <span className="polish-arrow">→</span>
            <ScoreChip
              label={hasResult ? '改后' : '当前'}
              score={hasResult ? afterScore : (result?.score_before ?? -1)}
              blocking={hasResult ? (result?.blocking_after ?? 0) : (result?.blocking_before ?? 0)}
            />
            {result && result.rounds > 1 && <Tag color="processing">复改 {result.rounds - 1} 轮</Tag>}
            {!!result?.punctuation_fixed && <Tag color="success">整理标点 {result.punctuation_fixed}</Tag>}
            {!!result?.output_notes?.length && <Tag color="blue">正文与分析已分离</Tag>}
            {!!result?.analysis && <Tag color="cyan">分析可查看</Tag>}
            {analysisOnly && <Tag color="geekblue">仅分析</Tag>}
            {result && !result.checker_available && <Tag>未机器检测</Tag>}
          </div>

          <Spin spinning={polishing || analyzing} tip={analyzing ? '正在做三层诊断…' : '改写中，可能包含多轮复改…'}>
            {view === 'split' ? (
              hasResult ? (
                <div className="polish-diff-viewer">
                  <div className="polish-diff-key">
                    <span className="polish-diff-key__removed">删除</span>
                    <span className="polish-diff-key__added">新增</span>
                    <span>逐字对照，正文按原稿顺序展示</span>
                  </div>
                  <ReactDiffViewer
                    oldValue={source}
                    newValue={result?.polished_text || ''}
                    splitView
                    compareMethod={DiffMethod.CHARS}
                    leftTitle="原文"
                    rightTitle="改后"
                    showDiffOnly={false}
                    hideLineNumbers={false}
                    useDarkTheme={resolvedMode === 'dark'}
                    styles={diffStyles}
                    renderContent={value => <>{value}</>}
                  />
                </div>
              ) : (
                <div className="polish-diff">
                  <div className="polish-diff-half">
                    <span className="polish-diff-label">原文</span>
                    <div className="polish-pane">
                      {source || <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有正文" />}
                    </div>
                  </div>
                  <div className="polish-diff-half">
                    <span className="polish-diff-label">改后</span>
                    <div className="polish-pane polish-pane--result">
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点「开始精修」看结果" />
                    </div>
                  </div>
                </div>
              )
            ) : view === 'analysis' ? (
              <div className="polish-analysis">
                <div className="polish-analysis-head">
                  <span className="polish-analysis-kicker">{analysisOnly ? '诊断报告' : '改稿依据'}</span>
                  <span className="polish-analysis-desc">
                    {analysisOnly
                      ? '本次只分析、不改写；报告不会写回正文'
                      : '模型实际返回的扫描与判断，仅用于查看，不会写回正文'}
                  </span>
                </div>
                {result?.analysis ? (
                  <MarkdownRenderer content={result.analysis} compact />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={hasResult
                      ? '本次模型直接交付了正文，没有附带扫描报告'
                      : analysisOnly
                        ? '点「只分析」后，这里会显示三层诊断报告'
                        : '完成精修后，这里会显示模型的扫描分析'}
                  />
                )}
                <div className="polish-analysis-findings">
                  <span style={{ color: token.colorTextSecondary }}>
                    {analysisOnly ? '脚本检测' : '脚本复扫'}：{blocking.length} 必须改 / {advisory.length} 建议改
                  </span>
                  {!!advisory.length && (
                    <span className="polish-analysis-desc">
                      {analysisOnly ? '原文仍有建议项，可在下方命中明细逐条核对。' : '改后仍有建议项，可在下方命中明细逐条核对。'}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="polish-pane polish-pane--full">
                {view === 'result' ? (result?.polished_text || '尚无改写结果') : (source || '尚无原文')}
              </div>
            )}
          </Spin>
        </section>
      </div>

      <section className="polish-findings">
        <div className="polish-findings-head">
          <span style={{ color: token.colorTextSecondary }}>
            命中明细（{blocking.length} 必须改 / {advisory.length} 建议改）
          </span>
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={runCheck} loading={checking}>
            重新检测
          </Button>
        </div>
        {!findings.length ? (
          <span className="polish-findings-empty">
            <CheckCircleOutlined style={{ color: token.colorSuccess }} /> 脚本层零命中。表达、用笔、故事三层仍需人工判断。
          </span>
        ) : (
          <ul className="polish-findings-list">
            {findings.slice(0, 60).map((item, idx) => {
              const meta = SEVERITY_META[item.severity ?? 'advisory'] ?? SEVERITY_META.advisory;
              return (
                <li key={`${item.line}-${item.column}-${idx}`}>
                  <Tag color={meta.color} icon={item.severity === 'blocking' ? <CloseCircleOutlined /> : <ExclamationCircleOutlined />}>
                    {meta.label}
                  </Tag>
                  <span className="polish-findings-loc">第 {item.line} 行 {item.column} 列</span>
                  <span className="polish-findings-msg">{item.message}</span>
                  {item.excerpt && <code className="polish-findings-quote">{item.excerpt}</code>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function ScoreChip({ label, score, blocking }: { label: string; score: number; blocking: number }) {
  const tone = scoreTone(score);
  return (
    <div className={`polish-chip polish-chip--${tone}`}>
      <span className="polish-chip-label">{label}</span>
      <span className="polish-chip-score">{score < 0 ? '—' : score}</span>
      <span className="polish-chip-note">
        {score < 0 ? TONE_TEXT.untested : `${TONE_TEXT[tone]} · 必须改 ${blocking}`}
      </span>
    </div>
  );
}
