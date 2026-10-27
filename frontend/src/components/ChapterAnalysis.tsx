import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Modal, Spin, Alert, Tabs, Tag, Empty, Button, Dropdown, theme } from 'antd';
import {
  ThunderboltOutlined,
  BulbOutlined,
  FireOutlined,
  HeartOutlined,
  TeamOutlined,
  TrophyOutlined,
  FundOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  EditOutlined,
  FileTextOutlined,
  DownOutlined
} from '@ant-design/icons';
import type { AnalysisTask, ChapterAnalysisResponse } from '../types';
import ChapterRegenerationModal from './ChapterRegenerationModal';
import ChapterContentComparison from './ChapterContentComparison';

// 判断是否为移动设备
const isMobileDevice = () => window.innerWidth < 768;

interface ChapterAnalysisProps {
  chapterId: string;
  visible: boolean;
  onClose: () => void;
}

export default function ChapterAnalysis({ chapterId, visible, onClose }: ChapterAnalysisProps) {
  const { token } = theme.useToken();
  const [task, setTask] = useState<AnalysisTask | null>(null);
  const [analysis, setAnalysis] = useState<ChapterAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(isMobileDevice());
  const [regenerationModalVisible, setRegenerationModalVisible] = useState(false);
  const [comparisonModalVisible, setComparisonModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [chapterInfo, setChapterInfo] = useState<{ title: string; chapter_number: number; content: string } | null>(null);
  const [newGeneratedContent, setNewGeneratedContent] = useState('');
  const [newContentWordCount, setNewContentWordCount] = useState(0);
  const pollTimerRef = useRef<number | null>(null);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (visible && chapterId) {
      setTask(null);
      setAnalysis(null);
      setChapterInfo(null);
      setError(null);
      void fetchAnalysisStatus(chapterId, generation);
    }

    // 监听窗口大小变化
    const handleResize = () => {
      setIsMobile(isMobileDevice());
    };

    window.addEventListener('resize', handleResize);

    // 清理函数：组件卸载或关闭时清除轮询
    return () => {
      window.removeEventListener('resize', handleResize);
      requestGenerationRef.current += 1;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, chapterId]);

  // 🔧 新增：独立的章节信息加载函数
  const loadChapterInfo = async (
    requestedChapterId = chapterId,
    generation = requestGenerationRef.current,
  ) => {
    try {
      const chapterResponse = await fetch(`/api/chapters/${requestedChapterId}`);
      if (chapterResponse.ok) {
        const chapterData = await chapterResponse.json();
        if (requestGenerationRef.current !== generation) return;
        setChapterInfo({
          title: chapterData.title,
          chapter_number: chapterData.chapter_number,
          content: chapterData.content || ''
        });
        console.log('✅ 已刷新章节内容，字数:', chapterData.content?.length || 0);
      }
    } catch (error) {
      console.error('❌ 加载章节信息失败:', error);
    }
  };

  const fetchAnalysisStatus = async (
    requestedChapterId = chapterId,
    generation = requestGenerationRef.current,
  ) => {
    try {
      setLoading(true);
      setError(null);

      // 🔧 使用独立的章节加载函数
      await loadChapterInfo(requestedChapterId, generation);

      const response = await fetch(`/api/chapters/${requestedChapterId}/analysis/status`);
      if (requestGenerationRef.current !== generation) return;

      if (response.status === 404) {
        setTask(null);
        setError('该章节还未进行分析');
        return;
      }

      if (!response.ok) {
        throw new Error('获取分析状态失败');
      }

      const taskData: AnalysisTask = await response.json();

      // 如果状态为 none（无任务），设置 task 为 null，让前端显示"开始分析"按钮
      if (taskData.status === 'none' || !taskData.has_task) {
        setTask(null);
        setError(null); // 清除错误，这不是错误状态
        return;
      }

      setTask(taskData);

      if (taskData.status === 'completed') {
        await fetchAnalysisResult(requestedChapterId, generation);
      } else if (taskData.status === 'running' || taskData.status === 'pending') {
        startPolling(requestedChapterId, generation);
      }
    } catch (err) {
      if (requestGenerationRef.current === generation) {
        setError((err as Error).message);
      }
    } finally {
      if (requestGenerationRef.current === generation) {
        setLoading(false);
      }
    }
  };

  const fetchAnalysisResult = async (
    requestedChapterId = chapterId,
    generation = requestGenerationRef.current,
  ) => {
    try {
      const response = await fetch(`/api/chapters/${requestedChapterId}/analysis`);
      if (!response.ok) {
        throw new Error('获取分析结果失败');
      }
      const data: ChapterAnalysisResponse = await response.json();
      if (requestGenerationRef.current !== generation) return;
      setAnalysis(data);
    } catch (err) {
      if (requestGenerationRef.current === generation) {
        setError((err as Error).message);
      }
    }
  };

  const startPolling = (requestedChapterId: string, generation: number) => {
    const deadline = Date.now() + 11 * 60 * 1000;

    const poll = async (): Promise<void> => {
      if (requestGenerationRef.current !== generation) return;
      if (Date.now() >= deadline) {
        setError('查询分析状态超时，请关闭后重新打开');
        return;
      }

      try {
        const response = await fetch(`/api/chapters/${requestedChapterId}/analysis/status`);
        if (requestGenerationRef.current !== generation) return;
        if (!response.ok) throw new Error('获取分析状态失败');

        const taskData: AnalysisTask = await response.json();
        setTask(taskData);

        if (taskData.status === 'completed') {
          await fetchAnalysisResult(requestedChapterId, generation);
          await loadChapterInfo(requestedChapterId, generation);
          return;
        } else if (taskData.status === 'failed') {
          setError(taskData.error_message || '分析失败');
          return;
        }
      } catch (err) {
        console.error('轮询错误:', err);
      }

      if (requestGenerationRef.current === generation) {
        pollTimerRef.current = window.setTimeout(() => {
          void poll();
        }, 2000);
      }
    };

    pollTimerRef.current = window.setTimeout(() => {
      void poll();
    }, 2000);
  };

  const triggerAnalysis = async () => {
    try {
      setLoading(true);
      setError(null);

      // 🔧 触发分析前先刷新章节内容，确保分析的是最新内容
      await loadChapterInfo();

      const response = await fetch(`/api/chapters/${chapterId}/analyze`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '触发分析失败');
      }

      // 触发成功后立即关闭Modal，让父组件的状态管理接管
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };


  const renderStatusIcon = () => {
    if (!task) return null;

    switch (task.status) {
      case 'pending':
        return <ClockCircleOutlined style={{ fontSize: 22, color: token.colorWarning }} />;
      case 'running':
        return <Spin size="default" />;
      case 'completed':
        return <CheckCircleOutlined style={{ fontSize: 22, color: token.colorSuccess }} />;
      case 'failed':
        return <CloseCircleOutlined style={{ fontSize: 22, color: token.colorError }} />;
      default:
        return null;
    }
  };

  const renderProgress = () => {
    if (!task || task.status === 'completed') return null;

    return (
      <div style={{
        padding: isMobile ? '32px 12px' : '44px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
      }}>
        {/* 标题和图标 */}
        <div style={{
          textAlign: 'center',
          marginBottom: 26
        }}>
          {renderStatusIcon()}
          <div style={{
            fontSize: 17,
            fontWeight: 600,
            marginTop: 12,
            color: task.status === 'failed' ? token.colorError : token.colorText,
          }}>
            {task.status === 'pending' && '等待分析...'}
            {task.status === 'running' && 'AI正在分析中...'}
            {task.status === 'failed' && '分析失败'}
          </div>
        </div>

        {/* 进度条 */}
        <div style={{
          width: '100%',
          maxWidth: '500px',
          marginBottom: 16
        }}>
          <div style={{
            height: 6,
            background: token.colorFillSecondary,
            borderRadius: 3,
            overflow: 'hidden',
            marginBottom: 10
          }}>
            <div style={{
              height: '100%',
              background: task.status === 'failed'
                ? token.colorError
                : task.progress === 100
                  ? token.colorSuccess
                  : token.colorPrimary,
              width: `${task.progress}%`,
              transition: 'all 0.3s ease',
              borderRadius: 3,
            }} />
          </div>

          {/* 进度百分比 */}
          <div style={{
            textAlign: 'center',
            fontSize: 26,
            fontWeight: 600,
            color: task.status === 'failed' ? token.colorError :
              task.progress === 100 ? token.colorSuccess : token.colorText,
            marginBottom: 4,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {task.progress}%
          </div>
        </div>

        {/* 状态消息 */}
        <div style={{
          textAlign: 'center',
          fontSize: 13,
          color: token.colorTextSecondary,
          minHeight: 24,
          marginBottom: 8
        }}>
          {task.status === 'pending' && '分析任务已创建，正在队列中...'}
          {task.status === 'running' && '正在提取关键信息和记忆片段...'}
        </div>

        {/* 错误信息 */}
        {task.status === 'failed' && task.error_message && (
          <Alert
            message="分析失败"
            description={task.error_message}
            type="error"
            showIcon
            style={{
              marginTop: 16,
              maxWidth: '500px',
              width: '100%'
            }}
          />
        )}

        {/* 提示文字 */}
        {task.status !== 'failed' && (
          <div style={{
            textAlign: 'center',
            fontSize: 12,
            color: token.colorTextTertiary,
            marginTop: 12
          }}>
            分析过程需要一定时间，请耐心等待
          </div>
        )}
      </div>
    );
  };

  // 将分析建议转换为重新生成组件需要的格式
  const convertSuggestionsForRegeneration = () => {
    if (!analysis?.analysis?.suggestions) return [];

    return analysis.analysis.suggestions.map((suggestion, index) => ({
      category: '改进建议',
      content: suggestion,
      priority: index < 3 ? 'high' : 'medium'
    }));
  };

  const renderScoreCard = (label: string, score: number) => (
    <div
      key={label}
      style={{
        padding: isMobile ? '11px 12px' : '13px 15px',
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 8,
        background: 'transparent',
      }}
    >
      <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{label}</div>
      <div style={{
        marginTop: 4,
        display: 'flex',
        alignItems: 'baseline',
        gap: 3,
        fontVariantNumeric: 'tabular-nums',
      }}>
        <span style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.1, color: token.colorText }}>
          {score}
        </span>
        <span style={{ fontSize: 11, color: token.colorTextTertiary }}>/ 10</span>
      </div>
    </div>
  );

  const renderAnalysisReport = (report: string) => {
    const lines = report.split('\n');
    const blocks: Array<{ heading: string | null; lines: string[] }> = [];
    let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };

    lines.forEach((rawLine) => {
      const line = rawLine.trimEnd();
      const headingMatch = line.match(/^【(.+)】\s*(.*)$/);
      if (headingMatch) {
        if (current.heading || current.lines.some((item) => item.trim())) {
          blocks.push(current);
        }
        current = { heading: headingMatch[1], lines: headingMatch[2] ? [headingMatch[2]] : [] };
        return;
      }
      if (line.startsWith('===')) return;
      if (!line.trim() && current.lines.length === 0) return;
      current.lines.push(line);
    });
    if (current.heading || current.lines.some((item) => item.trim())) blocks.push(current);

    const visibleBlocks = blocks.filter((block) => (
      block.heading !== '整体评分' && block.heading !== '改进建议'
    ));

    return (
      <div style={{ display: 'grid', gap: 14 }}>
        {visibleBlocks.map((block, blockIndex) => (
          <div key={`${block.heading || 'body'}-${blockIndex}`}>
            {block.heading && (
              <div style={{
                marginBottom: 5,
                fontSize: 12,
                fontWeight: 600,
                color: token.colorTextSecondary,
              }}>
                {block.heading}
              </div>
            )}
            <div style={{ display: 'grid', gap: 4 }}>
              {block.lines.map((line, lineIndex) => {
                const content = line.replace(/^\s*[•·]\s*/, '').trim();
                if (!content) return null;
                const isListItem = /^\s*([•·]|\d+[.、])/.test(line);
                return (
                  <div
                    key={lineIndex}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: isListItem ? 7 : 0,
                      fontSize: 13,
                      lineHeight: 1.7,
                      color: token.colorTextSecondary,
                    }}
                  >
                    {isListItem && (
                      <span style={{
                        width: 3,
                        height: 3,
                        marginTop: 9,
                        borderRadius: '50%',
                        background: token.colorTextTertiary,
                        flexShrink: 0,
                      }} />
                    )}
                    <span style={{ overflowWrap: 'anywhere' }}>{content}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderSectionTitle = (icon: ReactNode, title: string, extra?: ReactNode) => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      marginBottom: 10,
      fontSize: 13,
      fontWeight: 600,
      color: token.colorText,
    }}>
      <span style={{ color: token.colorTextTertiary, display: 'inline-flex' }}>{icon}</span>
      <span>{title}</span>
      {extra && <span style={{ marginLeft: 'auto', fontWeight: 400 }}>{extra}</span>}
    </div>
  );

  const renderAnalysisResult = () => {
    if (!analysis) return null;

    const { analysis: analysis_data, memories, entity_changes } = analysis;
    const tabPanelStyle = {
      display: 'grid',
      gap: 20,
      paddingTop: 2,
      paddingBottom: 8,
      paddingRight: isMobile ? 0 : 4,
    } as const;
    const sectionStyle = {
      padding: isMobile ? '14px 14px 15px' : '17px 18px 18px',
      border: `1px solid ${token.colorBorderSecondary}`,
      borderRadius: 10,
      background: token.colorBgContainer,
    } as const;
    const listItemStyle = {
      padding: isMobile ? '11px 0' : '12px 0',
      borderBottom: `1px solid ${token.colorBorderSecondary}`,
    } as const;
    const metaTagStyle = { marginInlineEnd: 6, marginBottom: 4 } as const;
    const hasEntityChanges = Boolean(
      entity_changes && (
        (entity_changes.careers?.changes?.length || 0) > 0 ||
        (entity_changes.character_states?.changes?.length || 0) > 0 ||
        (entity_changes.organization_states?.changes?.length || 0) > 0
      )
    );

    const tabItems = [
      {
        key: 'overview',
        label: '概览',
        icon: <TrophyOutlined />,
        children: (
          <div style={tabPanelStyle}>
            {analysis_data.suggestions && analysis_data.suggestions.length > 0 && (
              <div style={{
                ...sectionStyle,
                padding: isMobile ? '12px 14px' : '13px 16px',
                display: 'flex',
                alignItems: isMobile ? 'flex-start' : 'center',
                flexDirection: isMobile ? 'column' : 'row',
                gap: 10,
                background: token.colorFillQuaternary,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                    {analysis_data.suggestions.length} 条改进建议
                  </div>
                  <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.6, color: token.colorTextSecondary }}>
                    可以按建议重写本章，或先查看下方建议再决定。
                  </div>
                </div>
                <Button
                  icon={<EditOutlined />}
                  onClick={() => setRegenerationModalVisible(true)}
                  size="small"
                  style={{ flexShrink: 0 }}
                >
                  按建议重写
                </Button>
              </div>
            )}

            <section style={sectionStyle}>
              {renderSectionTitle(<TrophyOutlined />, '整体评分')}
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
                gap: isMobile ? 8 : 10,
              }}>
                {renderScoreCard('整体质量', analysis_data.overall_quality_score || 0)}
                {renderScoreCard('节奏把控', analysis_data.pacing_score || 0)}
                {renderScoreCard('吸引力', analysis_data.engagement_score || 0)}
                {renderScoreCard('连贯性', analysis_data.coherence_score || 0)}
              </div>
            </section>

            {analysis_data.analysis_report && (
              <section style={sectionStyle}>
                {renderSectionTitle(<FileTextOutlined />, '分析摘要')}
                {renderAnalysisReport(analysis_data.analysis_report)}
              </section>
            )}

            {hasEntityChanges && entity_changes && (
              <section style={sectionStyle}>
                {renderSectionTitle(<ReloadOutlined />, '实体联动更新')}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
                  gap: 8,
                  marginBottom: 14,
                }}>
                  {[
                    { label: '职业更新', value: entity_changes.careers?.updated_count || 0 },
                    {
                      label: '角色 / 关系更新',
                      value:
                        (entity_changes.character_states?.state_updated_count || 0) +
                        (entity_changes.character_states?.relationship_created_count || 0) +
                        (entity_changes.character_states?.relationship_updated_count || 0) +
                        (entity_changes.character_states?.org_updated_count || 0),
                    },
                    { label: '组织状态更新', value: entity_changes.organization_states?.updated_count || 0 },
                  ].map((item) => (
                    <div key={item.label} style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 7,
                      background: token.colorFillQuaternary,
                      fontSize: 12,
                      color: token.colorTextSecondary,
                    }}>
                      <span>{item.label}</span>
                      <strong style={{ fontSize: 15, color: token.colorText }}>{item.value}</strong>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gap: 12 }}>
                  {[
                    { label: '职业变化', changes: entity_changes.careers?.changes || [] },
                    { label: '角色 / 关系变化', changes: entity_changes.character_states?.changes || [] },
                    { label: '组织状态变化', changes: entity_changes.organization_states?.changes || [] },
                  ].filter((item) => item.changes.length > 0).map((item) => (
                    <div key={item.label}>
                      <div style={{ marginBottom: 5, fontSize: 12, fontWeight: 500, color: token.colorTextSecondary }}>
                        {item.label}
                      </div>
                      <div style={{ display: 'grid', gap: 4 }}>
                        {item.changes.map((change, index) => (
                          <div key={index} style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 7,
                            fontSize: 13,
                            lineHeight: 1.65,
                            color: token.colorTextSecondary,
                          }}>
                            <span style={{
                              width: 3,
                              height: 3,
                              marginTop: 8,
                              borderRadius: '50%',
                              background: token.colorTextTertiary,
                              flexShrink: 0,
                            }} />
                            <span style={{ overflowWrap: 'anywhere' }}>{change}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {analysis_data.suggestions && analysis_data.suggestions.length > 0 && (
              <section style={sectionStyle}>
                {renderSectionTitle(<BulbOutlined />, '改进建议')}
                <div style={{ display: 'grid', gap: 0 }}>
                  {analysis_data.suggestions.map((suggestion, index) => (
                    <div key={index} style={{
                      ...listItemStyle,
                      borderBottom: index < analysis_data.suggestions.length - 1
                        ? `1px solid ${token.colorBorderSecondary}`
                        : 'none',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 9,
                    }}>
                      <span style={{
                        flexShrink: 0,
                        minWidth: 18,
                        fontSize: 11,
                        lineHeight: '22px',
                        color: token.colorTextTertiary,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span style={{ fontSize: 13, lineHeight: 1.7, color: token.colorTextSecondary }}>
                        {suggestion}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ),
      },
      {
        key: 'hooks',
        label: `钩子 (${analysis_data.hooks?.length || 0})`,
        icon: <ThunderboltOutlined />,
        children: (
              <div style={tabPanelStyle}>
                <section style={sectionStyle}>
                  {renderSectionTitle(
                    <ThunderboltOutlined />,
                    '叙事钩子',
                    <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                      {analysis_data.hooks?.length || 0} 个
                    </span>,
                  )}
                  {analysis_data.hooks && analysis_data.hooks.length > 0 ? (
                    <div>
                      {analysis_data.hooks.map((hook, index) => (
                        <div key={index} style={{
                          ...listItemStyle,
                          borderBottom: index < analysis_data.hooks.length - 1
                            ? `1px solid ${token.colorBorderSecondary}`
                            : 'none',
                        }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                            <Tag color="blue" style={metaTagStyle}>{hook.type}</Tag>
                            <Tag color="orange" style={metaTagStyle}>{hook.position}</Tag>
                            <Tag style={metaTagStyle}>强度 {hook.strength}/10</Tag>
                          </div>
                          <div style={{ fontSize: 13, lineHeight: 1.7, color: token.colorTextSecondary }}>
                            {hook.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无钩子" />
                  )}
                </section>
              </div>
            )
          },
      {
        key: 'foreshadows',
        label: `伏笔 (${analysis_data.foreshadows?.length || 0})`,
        icon: <FireOutlined />,
        children: (
              <div style={tabPanelStyle}>
                <section style={sectionStyle}>
                  {renderSectionTitle(
                    <FireOutlined />,
                    '伏笔',
                    <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                      {analysis_data.foreshadows?.length || 0} 个
                    </span>,
                  )}
                  {analysis_data.foreshadows && analysis_data.foreshadows.length > 0 ? (
                    <div>
                      {analysis_data.foreshadows.map((foreshadow, index) => (
                        <div key={index} style={{
                          ...listItemStyle,
                          borderBottom: index < analysis_data.foreshadows.length - 1
                            ? `1px solid ${token.colorBorderSecondary}`
                            : 'none',
                        }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                            <Tag
                              color={foreshadow.type === 'planted' ? 'green' : 'purple'}
                              style={metaTagStyle}
                            >
                              {foreshadow.type === 'planted' ? '已埋下' : '已回收'}
                            </Tag>
                            <Tag style={metaTagStyle}>强度 {foreshadow.strength}/10</Tag>
                            <Tag style={metaTagStyle}>隐藏度 {foreshadow.subtlety}/10</Tag>
                            {foreshadow.reference_chapter && (
                              <Tag color="cyan" style={metaTagStyle}>呼应第{foreshadow.reference_chapter}章</Tag>
                            )}
                          </div>
                          <div style={{ fontSize: 13, lineHeight: 1.7, color: token.colorTextSecondary }}>
                            {foreshadow.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无伏笔" />
                  )}
                </section>
              </div>
            )
          },
      {
        key: 'emotion',
        label: '情感曲线',
        icon: <HeartOutlined />,
        children: (
              <div style={tabPanelStyle}>
                <section style={sectionStyle}>
                  {renderSectionTitle(<HeartOutlined />, '情绪与冲突')}
                  {analysis_data.emotional_tone ? (
                    <>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                        gap: 8,
                        marginBottom: 14,
                      }}>
                        <div style={{ padding: '10px 12px', borderRadius: 7, background: token.colorFillQuaternary }}>
                          <div style={{ fontSize: 11, color: token.colorTextTertiary }}>主导情绪</div>
                          <div style={{ marginTop: 3, fontSize: 16, fontWeight: 600, color: token.colorText }}>
                            {analysis_data.emotional_tone}
                          </div>
                        </div>
                        <div style={{ padding: '10px 12px', borderRadius: 7, background: token.colorFillQuaternary }}>
                          <div style={{ fontSize: 11, color: token.colorTextTertiary }}>情感强度</div>
                          <div style={{ marginTop: 3, fontSize: 16, fontWeight: 600, color: token.colorText }}>
                            {(analysis_data.emotional_intensity * 10).toFixed(1)}
                            <span style={{ marginLeft: 3, fontSize: 11, fontWeight: 400, color: token.colorTextTertiary }}>
                              / 10
                            </span>
                          </div>
                        </div>
                      </div>

                      <div style={{
                        display: 'grid',
                        gap: 8,
                        paddingTop: 13,
                        borderTop: `1px solid ${token.colorBorderSecondary}`,
                      }}>
                        {[
                          { label: '剧情阶段', value: analysis_data.plot_stage },
                          { label: '冲突等级', value: `${analysis_data.conflict_level} / 10` },
                        ].map((item) => (
                          <div key={item.label} style={{ display: 'flex', alignItems: 'baseline', gap: 14, fontSize: 13 }}>
                            <span style={{ width: 60, flexShrink: 0, color: token.colorTextTertiary }}>{item.label}</span>
                            <span style={{ color: token.colorText }}>{item.value}</span>
                          </div>
                        ))}
                        {analysis_data.conflict_types && analysis_data.conflict_types.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, fontSize: 13 }}>
                            <span style={{ width: 60, flexShrink: 0, lineHeight: '22px', color: token.colorTextTertiary }}>
                              冲突类型
                            </span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {analysis_data.conflict_types.map((type, idx) => (
                                <Tag key={idx} style={metaTagStyle}>{type}</Tag>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无情感分析" />
                  )}
                </section>
              </div>
            )
          },
      {
        key: 'characters',
        label: `角色 (${analysis_data.character_states?.length || 0})`,
        icon: <TeamOutlined />,
        children: (
              <div style={tabPanelStyle}>
                <section style={sectionStyle}>
                  {renderSectionTitle(
                    <TeamOutlined />,
                    '角色状态',
                    <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                      {analysis_data.character_states?.length || 0} 个
                    </span>,
                  )}
                  {analysis_data.character_states && analysis_data.character_states.length > 0 ? (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {analysis_data.character_states.map((char, index) => (
                        <div key={index} style={{
                          padding: isMobile ? '11px 12px' : '12px 14px',
                          border: `1px solid ${token.colorBorderSecondary}`,
                          borderRadius: 8,
                        }}>
                          <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: token.colorText }}>
                            {char.character_name}
                          </div>
                          <div style={{ display: 'grid', gap: 5, fontSize: 13, lineHeight: 1.65 }}>
                            {[
                              { label: '状态变化', value: `${char.state_before} → ${char.state_after}` },
                              { label: '心理变化', value: char.psychological_change },
                              { label: '关键事件', value: char.key_event },
                            ].map((item) => (
                              <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                <span style={{ width: 56, flexShrink: 0, color: token.colorTextTertiary }}>{item.label}</span>
                                <span style={{ color: token.colorTextSecondary }}>{item.value}</span>
                              </div>
                            ))}
                          </div>
                          {char.relationship_changes && Object.keys(char.relationship_changes).length > 0 && (
                            <div style={{
                              marginTop: 9,
                              paddingTop: 8,
                              borderTop: `1px solid ${token.colorBorderSecondary}`,
                            }}>
                              <div style={{ marginBottom: 5, fontSize: 11, color: token.colorTextTertiary }}>关系变化</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {Object.entries(char.relationship_changes).map(([name, change]) => (
                                  <Tag key={name} style={metaTagStyle}>
                                    与{name}：{change}
                                  </Tag>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无角色分析" />
                  )}
                </section>
              </div>
            )
          },
      {
        key: 'memories',
        label: `记忆 (${memories?.length || 0})`,
        icon: <FireOutlined />,
        children: (
              <div style={tabPanelStyle}>
                <section style={sectionStyle}>
                  {renderSectionTitle(
                    <FileTextOutlined />,
                    '记忆片段',
                    <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                      {memories?.length || 0} 条
                    </span>,
                  )}
                  {memories && memories.length > 0 ? (
                    <div>
                      {memories.map((memory, index) => (
                        <div key={memory.id || index} style={{
                          ...listItemStyle,
                          borderBottom: index < memories.length - 1
                            ? `1px solid ${token.colorBorderSecondary}`
                            : 'none',
                        }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 5 }}>
                            <Tag color="blue" style={metaTagStyle}>{memory.type}</Tag>
                            <Tag style={metaTagStyle}>重要性 {memory.importance.toFixed(1)}</Tag>
                            {memory.is_foreshadow === 1 && <Tag color="green" style={metaTagStyle}>已埋下伏笔</Tag>}
                            {memory.is_foreshadow === 2 && <Tag color="purple" style={metaTagStyle}>已回收伏笔</Tag>}
                            <span style={{ marginLeft: 2, fontSize: 13, fontWeight: 500, color: token.colorText }}>
                              {memory.title}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, lineHeight: 1.7, color: token.colorTextSecondary }}>
                            {memory.content}
                          </div>
                          {memory.tags.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
                              {memory.tags.map((tag, idx) => (
                                <Tag key={idx} style={metaTagStyle}>{tag}</Tag>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记忆片段" />
                  )}
                </section>
              </div>
            )
      },
    ];

    const renderTabContent = () => {
      const current = tabItems.find((item) => item.key === activeTab) || tabItems[0];
      return current.children;
    };

    if (isMobile) {
      return (
        <div>
          <Dropdown
            trigger={['click']}
            menu={{
              items: tabItems.map((item) => ({ key: item.key, icon: item.icon, label: item.label })),
              selectable: true,
              selectedKeys: [activeTab],
              onClick: ({ key }) => setActiveTab(key),
            }}
          >
            <Button block style={{ marginBottom: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                {tabItems.find((item) => item.key === activeTab)?.icon}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>
                  {tabItems.find((item) => item.key === activeTab)?.label || '概览'}
                </span>
                <DownOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
              </span>
            </Button>
          </Dropdown>
          {renderTabContent()}
        </div>
      );
    }

    return (
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
      />
    );
  };

  return (
    <Modal
      title={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <div style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 7,
            background: token.colorFillTertiary,
            color: token.colorTextSecondary,
            fontSize: 14,
          }}>
            <FundOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: token.colorText }}>
              章节分析
            </div>
            <div style={{ fontSize: 11, fontWeight: 400, lineHeight: 1.4, color: token.colorTextTertiary }}>
              节奏、情绪、角色与伏笔
            </div>
          </div>
        </div>
      )}
      open={visible}
      onCancel={onClose}
      width={isMobile ? 'calc(100vw - 24px)' : 860}
      centered
      style={{
        maxWidth: isMobile ? 'calc(100vw - 24px)' : 'calc(100vw - 48px)',
      }}
      styles={{
        header: {
          padding: isMobile ? '13px 16px' : '16px 22px',
          marginBottom: 0,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        },
        body: {
          padding: isMobile ? '10px 14px 16px' : '14px 22px 20px',
          maxHeight: isMobile ? 'calc(100vh - 180px)' : 'calc(100vh - 200px)',
          overflowY: 'auto',
        },
        footer: {
          marginTop: 0,
          padding: isMobile ? '10px 14px' : '12px 22px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        },
      }}
      footer={[
        <Button key="close" onClick={onClose} size={isMobile ? 'small' : 'middle'}>
          关闭
        </Button>,
        !task && !loading && (
          <Button
            key="analyze"
            type="primary"
            icon={<ReloadOutlined />}
            onClick={triggerAnalysis}
            loading={loading}
            size={isMobile ? 'small' : 'middle'}
          >
            开始分析
          </Button>
        ),
        task && (task.status === 'failed') && (
          <Button
            key="reanalyze"
            type="primary"
            icon={<ReloadOutlined />}
            onClick={triggerAnalysis}
            loading={loading}
            danger
            size={isMobile ? 'small' : 'middle'}
          >
            重新分析
          </Button>
        ),
        task && task.status === 'completed' && (
          <Button
            key="reanalyze"
            type="default"
            icon={<ReloadOutlined />}
            onClick={triggerAnalysis}
            loading={loading}
            size={isMobile ? 'small' : 'middle'}
          >
            重新分析
          </Button>
        )
      ].filter(Boolean)}
    >
      {loading && !task && (
        <div style={{ textAlign: 'center', padding: '44px 16px' }}>
          <Spin size="large" />
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: token.colorTextTertiary }}>
            正在读取分析结果…
          </p>
        </div>
      )}

      {error && (
        <Alert
          message="暂时无法读取分析"
          description={error}
          type="error"
          showIcon
          style={{ marginBottom: task ? 16 : 0 }}
        />
      )}

      {task && task.status !== 'completed' && renderProgress()}
      {task && task.status === 'completed' && analysis && renderAnalysisResult()}

      {/* 重新生成Modal */}
      {chapterInfo && (
        <ChapterRegenerationModal
          visible={regenerationModalVisible}
          onCancel={() => setRegenerationModalVisible(false)}
          onSuccess={(newContent: string, wordCount: number) => {
            // 保存新生成的内容
            setNewGeneratedContent(newContent);
            setNewContentWordCount(wordCount);
            // 关闭重新生成对话框
            setRegenerationModalVisible(false);
            // 打开对比界面
            setComparisonModalVisible(true);
          }}
          chapterId={chapterId}
          chapterTitle={chapterInfo.title}
          chapterNumber={chapterInfo.chapter_number}
          suggestions={convertSuggestionsForRegeneration()}
          hasAnalysis={true}
        />
      )}

      {/* 内容对比组件 */}
      {chapterInfo && comparisonModalVisible && (
        <ChapterContentComparison
          visible={comparisonModalVisible}
          onClose={() => setComparisonModalVisible(false)}
          chapterId={chapterId}
          chapterTitle={chapterInfo.title}
          originalContent={chapterInfo.content}
          newContent={newGeneratedContent}
          wordCount={newContentWordCount}
          onApply={async () => {
            // 应用新内容后刷新章节信息和分析
            setChapterInfo(null);
            setAnalysis(null);

            // 重新加载章节内容
            try {
              const chapterResponse = await fetch(`/api/chapters/${chapterId}`);
              if (chapterResponse.ok) {
                const chapterData = await chapterResponse.json();
                setChapterInfo({
                  title: chapterData.title,
                  chapter_number: chapterData.chapter_number,
                  content: chapterData.content || ''
                });
              }
            } catch (error) {
              console.error('重新加载章节失败:', error);
            }

            // 刷新分析状态
            await fetchAnalysisStatus();
          }}
          onDiscard={() => {
            // 放弃新内容，清空状态
            setNewGeneratedContent('');
            setNewContentWordCount(0);
          }}
        />
      )}
    </Modal>
  );
}
