import React, { useState, useEffect, useRef } from 'react';
import { Button, Empty, Spin, Alert, Switch, Drawer, message, theme } from 'antd';
import {
  EyeOutlined,
  EyeInvisibleOutlined,
  MenuOutlined,
  LeftOutlined,
  RightOutlined,
  UnorderedListOutlined,
  FundOutlined,
} from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import api from '../services/api';
import AnnotatedText, { type MemoryAnnotation } from '../components/AnnotatedText';
import MemorySidebar from '../components/MemorySidebar';
import { eventBus, EventNames } from '../store/eventBus';

interface ChapterItem {
  id: string;
  chapter_number: number;
  title: string;
  content: string;
  word_count: number;
  status: string;
}

interface AnnotationsData {
  chapter_id: string;
  chapter_number: number;
  title: string;
  word_count: number;
  annotations: MemoryAnnotation[];
  has_analysis: boolean;
  summary: {
    total_annotations: number;
    hooks: number;
    foreshadows: number;
    plot_points: number;
    character_events: number;
  };
}

interface NavigationData {
  current: {
    id: string;
    chapter_number: number;
    title: string;
  };
  previous: {
    id: string;
    chapter_number: number;
    title: string;
  } | null;
  next: {
    id: string;
    chapter_number: number;
    title: string;
  } | null;
}

/**
 * 项目内的章节剧情分析页面
 * 显示章节列表和带标注的章节内容
 */
const ChapterAnalysis: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<ChapterItem | null>(null);
  const [annotationsData, setAnnotationsData] = useState<AnnotationsData | null>(null);
  const [navigation, setNavigation] = useState<NavigationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | undefined>();
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [chapterListVisible, setChapterListVisible] = useState(false);
  const [scrollToContentAnnotation, setScrollToContentAnnotation] = useState<string | undefined>();
  const [scrollToSidebarAnnotation, setScrollToSidebarAnnotation] = useState<string | undefined>();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const { token } = theme.useToken();

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 加载章节列表
  useEffect(() => {
    const loadChapters = async () => {
      if (!projectId) return;
      
      try {
        setLoading(true);
        const response = await api.get(`/chapters/project/${projectId}`);
        // API 拦截器已经解析了 response.data，所以直接使用
        const data = response.data || response;
        const chapterList = data.items || [];
        setChapters(chapterList);
        
        // 自动选择第一个有内容的章节
        const firstChapterWithContent = chapterList.find((ch: ChapterItem) => ch.content && ch.content.trim() !== '');
        if (firstChapterWithContent) {
          loadChapterContent(firstChapterWithContent.id);
        }
      } catch (error) {
        console.error('加载章节列表失败:', error);
        message.error('加载章节列表失败');
      } finally {
        setLoading(false);
      }
    };

    loadChapters();
  }, [projectId]);

  // 加载章节内容和标注
  const loadChapterContent = async (chapterId: string) => {
    try {
      setContentLoading(true);
      
      const [chapterResponse, annotationsResponse, navigationResponse] = await Promise.all([
        api.get(`/chapters/${chapterId}`),
        api.get(`/chapters/${chapterId}/annotations`).catch(() => null),
        api.get(`/chapters/${chapterId}/navigation`).catch(() => null),
      ]);

      // 提取 data 属性
      setSelectedChapter(chapterResponse.data || chapterResponse);
      setAnnotationsData(annotationsResponse ? (annotationsResponse.data || annotationsResponse) : null);
      setNavigation(navigationResponse ? (navigationResponse.data || navigationResponse) : null);
    } catch (error) {
      console.error('加载章节内容失败:', error);
      message.error('加载章节内容失败');
    } finally {
      setContentLoading(false);
    }
  };

  useEffect(() => {
    const handleTaskSettled = (payload?: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const data = payload as { projectId?: string; resources?: string[] };
      if (data.projectId && data.projectId !== projectId) return;
      if (data.resources?.includes('analysis') && selectedChapter?.id) {
        void loadChapterContent(selectedChapter.id);
      }
    };
    eventBus.on(EventNames.BACKGROUND_TASK_SETTLED, handleTaskSettled);
    return () => eventBus.off(EventNames.BACKGROUND_TASK_SETTLED, handleTaskSettled);
  }, [projectId, selectedChapter?.id]);

  const handleChapterSelect = (chapterId: string) => {
    loadChapterContent(chapterId);
    if (isMobile) {
      setChapterListVisible(false);
    }
  };

  const handlePreviousChapter = () => {
    if (navigation?.previous) {
      loadChapterContent(navigation.previous.id);
    }
  };

  const handleNextChapter = () => {
    if (navigation?.next) {
      loadChapterContent(navigation.next.id);
    }
  };

  const handleAnnotationClick = (annotation: MemoryAnnotation, source: 'content' | 'sidebar' = 'content') => {
    setActiveAnnotationId(annotation.id);
    
    if (source === 'content') {
      // 从内容区点击，滚动到侧边栏
      setScrollToSidebarAnnotation(annotation.id);
      // 清除滚动状态
      setTimeout(() => setScrollToSidebarAnnotation(undefined), 100);
      
      if (isMobile) {
        setSidebarVisible(true);
      }
    } else {
      // 从侧边栏点击，滚动到内容区
      setScrollToContentAnnotation(annotation.id);
      // 清除滚动状态
      setTimeout(() => setScrollToContentAnnotation(undefined), 100);
    }
  };

  const hasAnnotations = annotationsData && annotationsData.annotations.length > 0;
  const pageRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(window.innerWidth);

  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(width);
    });
    observer.observe(element);
    setContainerWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [loading]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size="large" tip="加载章节中..." />
      </div>
    );
  }

  const summaryItems = annotationsData
    ? [
        { key: 'hook', label: '钩子', count: annotationsData.summary.hooks, color: token.colorError },
        { key: 'foreshadow', label: '伏笔', count: annotationsData.summary.foreshadows, color: token.colorInfo },
        { key: 'plot_point', label: '情节点', count: annotationsData.summary.plot_points, color: token.colorSuccess },
        { key: 'character_event', label: '角色事件', count: annotationsData.summary.character_events, color: token.colorWarning },
      ].filter((item) => item.count > 0)
    : [];

  const showChapterPanel = !isMobile && containerWidth >= 720;
  const showChapterEntry = isMobile || !showChapterPanel;
  const showSidebarPanel = !isMobile && containerWidth >= 960;
  const showSidebarEntry = !showSidebarPanel && hasAnnotations;

  const panelStyle: React.CSSProperties = {
    background: token.colorBgContainer,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
  };

  const renderChapterList = () => {
    if (chapters.length === 0) {
      return <Empty description="暂无章节" style={{ marginTop: 60 }} />;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px 10px' }}>
        {chapters.map((chapter) => {
          const isActive = selectedChapter?.id === chapter.id;
          const hasContent = Boolean(chapter.content && chapter.content.trim() !== '');
          return (
            <button
              key={chapter.id}
              type="button"
              onClick={() => handleChapterSelect(chapter.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '9px 10px',
                border: 'none',
                borderRadius: 8,
                background: isActive ? token.colorFillSecondary : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? token.colorText : token.colorTextSecondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                第{chapter.chapter_number}章 · {chapter.title}
              </div>
              <div style={{
                marginTop: 3,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                color: token.colorTextTertiary,
                fontVariantNumeric: 'tabular-nums',
              }}>
                <span style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  background: hasContent ? token.colorSuccess : token.colorBorder,
                }} />
                {chapter.word_count || 0} 字
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      ref={pageRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}
    >
      {!isMobile && (
        <div style={{
          flexShrink: 0,
          paddingBottom: 14,
          marginBottom: 16,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <h2 style={{
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}>
            <FundOutlined style={{ fontSize: 18, color: token.colorTextSecondary }} />
            剧情分析
          </h2>
          <div style={{ marginTop: 6, paddingLeft: 26, fontSize: 12.5, color: token.colorTextTertiary }}>
            查看 AI 在正文中标注的钩子、伏笔与情节点
          </div>
        </div>
      )}

      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        gap: isMobile ? 0 : 16,
        flexDirection: isMobile ? 'column' : 'row',
      }}>
        {showChapterPanel && (
          <div style={{ ...panelStyle, width: 236, flexShrink: 0 }}>
            <div style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
              padding: '13px 16px 8px',
              fontSize: 12,
              fontWeight: 600,
              color: token.colorTextTertiary,
              letterSpacing: '0.02em',
            }}>
              章节列表
              <span style={{ fontWeight: 400 }}>{chapters.length}</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {renderChapterList()}
            </div>
          </div>
        )}

        {isMobile && (
          <Drawer
            title="章节列表"
            placement="left"
            onClose={() => setChapterListVisible(false)}
            open={chapterListVisible}
            width="85%"
            styles={{ body: { padding: '8px 0' } }}
          >
            {renderChapterList()}
          </Drawer>
        )}

        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'row',
          gap: showSidebarPanel ? 16 : 0,
          height: '100%',
          overflow: 'hidden',
        }}>
          <div style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
          }}>
          {!selectedChapter ? (
            <div style={{ ...panelStyle, flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Empty description="请从左侧选择一个章节查看" />
            </div>
          ) : (
            <>
              <div style={{ ...panelStyle, flex: '1 1 0%', height: '100%' }}>
                <div style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: isMobile ? '12px 14px' : '14px 20px',
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <div style={{
                      fontSize: isMobile ? 14 : 15,
                      fontWeight: 600,
                      color: token.colorText,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      第{selectedChapter.chapter_number}章 · {selectedChapter.title}
                    </div>
                    <div style={{
                      marginTop: 3,
                      fontSize: 11.5,
                      color: token.colorTextTertiary,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {(selectedChapter.word_count || 0).toLocaleString('zh-CN')} 字
                      {hasAnnotations && annotationsData && (
                        <> · {annotationsData.summary.total_annotations} 个标注</>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                      type="text"
                      size="small"
                      icon={<LeftOutlined />}
                      onClick={handlePreviousChapter}
                      disabled={!navigation?.previous}
                      title={navigation?.previous ? `上一章: ${navigation.previous.title}` : '已是第一章'}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<RightOutlined />}
                      onClick={handleNextChapter}
                      disabled={!navigation?.next}
                      title={navigation?.next ? `下一章: ${navigation.next.title}` : '已是最后一章'}
                    />
                  </div>

                  {hasAnnotations && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <Switch
                        size="small"
                        checked={showAnnotations}
                        onChange={setShowAnnotations}
                        checkedChildren={<EyeOutlined />}
                        unCheckedChildren={<EyeInvisibleOutlined />}
                        style={isMobile ? { height: 20, minHeight: 20, minWidth: 38, lineHeight: '18px' } : undefined}
                      />
                      <span style={{ fontSize: 12, color: token.colorTextSecondary }}>标注</span>
                    </div>
                  )}

                  {showChapterEntry && (
                    <Button
                      size="small"
                      icon={<UnorderedListOutlined />}
                      onClick={() => setChapterListVisible(true)}
                    >
                      章节
                    </Button>
                  )}

                  {showSidebarEntry && (
                    <Button
                      size="small"
                      icon={<MenuOutlined />}
                      onClick={() => setSidebarVisible(true)}
                    >
                      分析
                    </Button>
                  )}
                </div>

                {hasAnnotations && summaryItems.length > 0 && (
                  <div style={{
                    flexShrink: 0,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    padding: isMobile ? '8px 14px' : '9px 20px',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorFillQuaternary,
                  }}>
                    {summaryItems.map((item) => (
                      <span
                        key={item.key}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '1px 9px',
                          borderRadius: 999,
                          background: token.colorBgContainer,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          fontSize: 11.5,
                          color: token.colorTextSecondary,
                          lineHeight: '18px',
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: item.color }} />
                        {item.label}
                        <span style={{ fontWeight: 600, color: token.colorText }}>{item.count}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: isMobile ? '18px 16px 28px' : '30px 40px 44px',
                }}>
                  {contentLoading ? (
                    <div style={{ textAlign: 'center', padding: '60px 0' }}>
                      <Spin />
                    </div>
                  ) : (
                    <div style={{ maxWidth: 640, margin: '0 auto' }}>
                      {!hasAnnotations && (
                        <Alert
                          message="暂无分析数据"
                          description="该章节尚未进行 AI 分析，因此正文中没有可显示的标注。"
                          type="info"
                          showIcon
                          style={{ marginBottom: 24, borderRadius: 10 }}
                        />
                      )}

                      {showAnnotations && hasAnnotations && annotationsData ? (
                        <AnnotatedText
                          content={selectedChapter.content}
                          annotations={annotationsData.annotations}
                          onAnnotationClick={(annotation) => handleAnnotationClick(annotation, 'content')}
                          activeAnnotationId={activeAnnotationId}
                          scrollToAnnotation={scrollToContentAnnotation}
                          style={{
                            lineHeight: isMobile ? 1.9 : 2,
                            fontSize: isMobile ? 14.5 : 15.5,
                            color: token.colorText,
                          }}
                        />
                      ) : (
                        <div style={{
                          lineHeight: isMobile ? 1.9 : 2,
                          fontSize: isMobile ? 14.5 : 15.5,
                          color: token.colorText,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {selectedChapter.content}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          </div>

          {showSidebarPanel && hasAnnotations && annotationsData && (
            <div style={{ ...panelStyle, width: 344, flexShrink: 0, height: '100%' }}>
              <MemorySidebar
                annotations={annotationsData.annotations}
                activeAnnotationId={activeAnnotationId}
                onAnnotationClick={(annotation) => handleAnnotationClick(annotation, 'sidebar')}
                scrollToAnnotation={scrollToSidebarAnnotation}
              />
            </div>
          )}
        </div>
      </div>

      {hasAnnotations && annotationsData && (
        <Drawer
          title="章节分析"
          placement="right"
          onClose={() => setSidebarVisible(false)}
          open={sidebarVisible}
          width={isMobile ? '90%' : '420px'}
          styles={{ body: { padding: 0 } }}
        >
          <MemorySidebar
            annotations={annotationsData.annotations}
            activeAnnotationId={activeAnnotationId}
            onAnnotationClick={(annotation) => {
              handleAnnotationClick(annotation, 'sidebar');
              if (isMobile) setSidebarVisible(false);
            }}
            scrollToAnnotation={scrollToSidebarAnnotation}
          />
        </Drawer>
      )}
    </div>
  );
};

export default ChapterAnalysis;
