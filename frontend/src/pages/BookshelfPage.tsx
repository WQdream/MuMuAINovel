import { useEffect, useState } from 'react';
import './BookshelfPage.css';
import { Button, Dropdown, Popover, Spin, theme } from 'antd';
import {
  BulbOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  MoreOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { Project } from '../types';

interface BookshelfPageProps {
  isMobile: boolean;
  loading: boolean;
  projects: Project[];
  showApiTip: boolean;
  onDismissApiTip: () => void;
  exportableProjectsCount: number;
  onOpenImportModal: () => void;
  onOpenExportModal: () => void;
  onGoSettings: () => void;
  onStartWizard: () => void;
  onOpenInspiration: () => void;
  onEnterProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onGenerateCover: (project: Project, overwrite?: boolean) => void | Promise<void>;
  onDismissCoverError: (project: Project) => void | Promise<void>;
  onRefreshProjects?: () => void | Promise<unknown>;
  onDownloadCover: (project: Project) => void;
  formatDate: (dateString: string) => string;
}

export default function BookshelfPage({
  isMobile,
  loading,
  projects,
  showApiTip,
  onDismissApiTip,
  exportableProjectsCount,
  onOpenImportModal,
  onOpenExportModal,
  onGoSettings,
  onStartWizard,
  onOpenInspiration,
  onEnterProject,
  onDeleteProject,
  onGenerateCover,
  onDismissCoverError,
  onRefreshProjects,
  onDownloadCover,
  formatDate,
}: BookshelfPageProps) {
  const { token } = theme.useToken();
  const [coverBusyIds, setCoverBusyIds] = useState<Record<string, boolean>>({});
  const [dismissedCoverFailureIds, setDismissedCoverFailureIds] = useState<Set<string>>(() => new Set());
  const [coverFailurePopoverId, setCoverFailurePopoverId] = useState<string | null>(null);

  const hasGeneratingCover = projects.some((project) => project.cover_status === 'generating');

  const isFailureDismissed = (project: Project) =>
    Boolean(project.cover_error_dismissed_at) || dismissedCoverFailureIds.has(project.id);

  const dismissFailure = async (project: Project) => {
    setDismissedCoverFailureIds((prev) => {
      const next = new Set(prev);
      next.add(project.id);
      return next;
    });
    setCoverFailurePopoverId(null);
    try {
      await onDismissCoverError(project);
    } catch {
      setDismissedCoverFailureIds((prev) => {
        if (!prev.has(project.id)) return prev;
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });
    }
  };

  const restoreFailure = (project: Project) => {
    setDismissedCoverFailureIds((prev) => {
      if (!prev.has(project.id)) return prev;
      const next = new Set(prev);
      next.delete(project.id);
      return next;
    });
  };

  // 生成任务在服务端执行，轮询以便刷新页面后仍能自动拿到生成完成的封面
  useEffect(() => {
    if (!hasGeneratingCover || !onRefreshProjects) return;
    const timer = window.setInterval(() => {
      void onRefreshProjects();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [hasGeneratingCover, onRefreshProjects]);

  const alphaColor = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

  const formatWords = (count: number) => {
    if (!count) return '0 字';
    if (count < 10000) return `${count} 字`;
    return `${(count / 10000).toFixed(1).replace(/\.0$/, '')} 万字`;
  };

  const totalWords = projects.reduce((sum, p) => sum + (p.current_words || 0), 0);
  const completedCount = projects.filter(
    (p) => (p.target_words || 0) > 0 && (p.current_words || 0) >= (p.target_words || 0)
  ).length;
  const writingCount = projects.length - completedCount;

  const stats = [
    { label: '作品', value: `${projects.length}` },
    { label: '创作中', value: `${writingCount}` },
    { label: '已完结', value: `${completedCount}` },
    { label: '累计字数', value: formatWords(totalWords) },
  ];

  const coverPalettes = [
    { bg: '#1F2A33', deep: '#121A20', fg: '#EFE6D4', accent: '#C9A96E' },
    { bg: '#3E2724', deep: '#241615', fg: '#F2E7D6', accent: '#CDAA74' },
    { bg: '#26302A', deep: '#151C17', fg: '#ECE6D6', accent: '#BFA572' },
    { bg: '#2A2826', deep: '#171615', fg: '#EFE9DD', accent: '#C9A96E' },
    { bg: '#E6DFD2', deep: '#D3C9B7', fg: '#2A251E', accent: '#8F6E42' },
  ];

  const getCoverTitleStyle = (title: string) => {
    const length = Array.from(title || '').length;
    const fontSize = length <= 6
      ? 20
      : length <= 12
        ? 17
        : length <= 20
          ? 14
          : length <= 32
            ? 13
            : length <= 48
              ? 11
              : 10;
    return { fontSize, lineClamp: 6 };
  };

  const handleGenerateCover = async (project: Project, overwrite: boolean) => {
    if (coverBusyIds[project.id]) return;
    restoreFailure(project);
    setCoverBusyIds((prev) => ({ ...prev, [project.id]: true }));
    try {
      await onGenerateCover(project, overwrite);
    } finally {
      setCoverBusyIds((prev) => ({ ...prev, [project.id]: false }));
    }
  };

  const renderApiTip = () => (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 28,
        padding: '0 3px 0 10px',
        borderRadius: 999,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        fontSize: 12,
        color: token.colorTextSecondary,
        flexShrink: 0,
      }}
    >
      <InfoCircleOutlined style={{ fontSize: 12, color: token.colorTextTertiary }} />
      <span style={{ whiteSpace: 'nowrap' }}>尚未配置 AI 接口</span>
      <Button
        type="link"
        size="small"
        onClick={onGoSettings}
        style={{ padding: '0 2px', height: 20, fontSize: 12, fontWeight: 500 }}
      >
        去配置
      </Button>
      <Button
        type="text"
        size="small"
        icon={<CloseOutlined style={{ fontSize: 10 }} />}
        onClick={onDismissApiTip}
        aria-label="关闭提醒"
        style={{ width: 20, height: 20, minWidth: 20, color: token.colorTextTertiary }}
      />
    </div>
  );

  const renderNewCard = () => (
    <button
      type="button"
      className="book-card book-card--new"
      onClick={onStartWizard}
    >
      <div className="book-object book-object--new">
        <span className="book-backboard book-backboard--new" aria-hidden="true" />
        <span className="book-pages book-pages--right" aria-hidden="true" />
        <span className="book-pages book-pages--bottom" aria-hidden="true" />
        <div className="book-board book-board--new">
          <div className="book-spine book-spine--new" aria-hidden="true" />
          <div className="book-cover book-cover--new">
            <div className="book-emboss" aria-hidden="true">
              <PlusOutlined />
            </div>
          </div>
        </div>
      </div>

      <div className="book-meta">
        <div style={{ fontSize: isMobile ? 12 : 13, fontWeight: 500, fontFamily: 'var(--font-editorial)', letterSpacing: '0.04em', color: token.colorText }}>新建作品</div>
        <div style={{ marginTop: 2, fontSize: 10, color: token.colorTextTertiary }}>从零开始一段新故事</div>
      </div>
    </button>
  );

  const renderProjectCard = (project: Project, index: number) => {
    const coverReady = project.cover_status === 'ready' && !!project.cover_image_url;
    const hasCoverImage = !!project.cover_image_url;
    const coverBusy = coverBusyIds[project.id] || project.cover_status === 'generating';
    const coverFailed = project.cover_status === 'failed' && !coverBusy;
    const wizardIncomplete = project.wizard_status === 'incomplete';
    const palette = coverPalettes[index % coverPalettes.length];
    const coverTitle = project.title || '未命名';
    const coverTitleStyle = getCoverTitleStyle(coverTitle);
    const categoryLabel = (project.genre || project.theme || '未分类').trim();
    const statusLabel = project.status === 'completed'
      ? '已完结'
      : project.status === 'revising'
        ? '修订中'
        : project.status === 'planning'
          ? '筹备中'
          : '创作中';

    const menuItems = [
      {
        key: 'cover',
        icon: coverBusy ? <LoadingOutlined /> : coverReady ? <ReloadOutlined /> : <PictureOutlined />,
        label: coverBusy ? '封面生成中…' : coverReady ? '重新生成封面' : '生成封面',
        disabled: coverBusy,
      },
      {
        key: 'download',
        icon: <DownloadOutlined />,
        label: '下载封面',
        disabled: !coverReady || coverBusy,
      },
      ...(coverFailed ? [{
        key: 'check-config',
        icon: <SettingOutlined />,
        label: '检查配置',
      }] : []),
      { type: 'divider' as const },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: '删除项目',
        danger: true,
      },
    ];

    return (
      <article
        key={project.id}
        className="book-card"
        role="button"
        tabIndex={0}
        onClick={() => onEnterProject(project)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onEnterProject(project);
          }
        }}
      >
        <div className="book-object">
          <span className="book-backboard" aria-hidden="true" />
          <span className="book-pages book-pages--right" aria-hidden="true" />
          <span className="book-pages book-pages--bottom" aria-hidden="true" />
          <div
            className={`book-board ${hasCoverImage ? 'book-board--image' : 'book-board--placeholder'}`}
            style={{ background: palette.bg }}
          >
            <div
              className={`book-spine ${hasCoverImage ? 'book-spine--image' : 'book-spine--placeholder'}`}
              style={hasCoverImage ? undefined : {
                background: `linear-gradient(90deg, ${palette.deep} 0%, ${palette.bg} 58%, ${alphaColor(palette.accent, 0.34)} 76%, ${palette.deep} 100%)`,
              }}
              aria-hidden="true"
            >
              {hasCoverImage && (
                <img
                  className="book-spine__image"
                  src={project.cover_image_url || ''}
                  alt=""
                />
              )}
            </div>
            <div className="book-cover">
          {hasCoverImage ? (
            <div className="book-cover__art">
              {/* 模糊同图铺底，保证封面完整显示且不出现空白边 */}
              <img
                src={project.cover_image_url || ''}
                alt=""
                aria-hidden="true"
                className="book-cover__backdrop"
                style={{
                  inset: -18,
                  width: 'calc(100% + 36px)',
                  height: 'calc(100% + 36px)',
                  filter: 'blur(18px) saturate(1.1)',
                  transform: 'scale(1.04)',
                }}
              />
              <div
                aria-hidden="true"
                className="book-cover__veil"
              />
              <img
                src={project.cover_image_url || ''}
                alt={project.title}
                className="book-cover__image"
              />
            </div>
          ) : (
            <div
              className="book-placeholder"
              style={{
                background: `linear-gradient(145deg, ${palette.bg} 0%, ${palette.deep} 100%)`,
                color: palette.fg,
              }}
            >
              <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0.26,
                      backgroundImage:
                        'repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 4px)',
                    }}
              />
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: -42,
                      right: -38,
                      width: 132,
                      height: 132,
                      borderRadius: '50%',
                      border: `1px solid ${alphaColor(palette.accent, 0.24)}`,
                      boxShadow: `0 0 0 22px ${alphaColor(palette.accent, 0.045)}, 0 0 0 44px ${alphaColor(palette.accent, 0.03)}`,
                    }}
                  />
                  <div
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      height: '100%',
                      padding: isMobile
                        ? '12px 10px 10px 11px'
                        : '13px 11px 11px 12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        color: alphaColor(palette.fg, 0.66),
                        fontSize: 7,
                        fontWeight: 500,
                        letterSpacing: '0.32em',
                        lineHeight: 1.4,
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 1,
                          background: palette.accent,
                          opacity: 0.8,
                        }}
                      />
                      NOVEL
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flex: 1,
                        alignItems: 'center',
                        minHeight: 0,
                        padding: '7px 0 8px',
                      }}
                    >
                      <span
                        style={{
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: coverTitleStyle.lineClamp,
                          overflow: 'hidden',
                          fontFamily: 'var(--font-editorial)',
                          fontSize: coverTitleStyle.fontSize,
                          fontWeight: 500,
                          letterSpacing: '0.06em',
                          color: alphaColor(palette.accent, 0.95),
                          lineHeight: 1.32,
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                          textWrap: 'balance',
                        }}
                        title={coverTitle}
                      >
                        {coverTitle}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'space-between',
                        gap: 8,
                        paddingTop: 6,
                        borderTop: `1px solid ${alphaColor(palette.accent, 0.34)}`,
                        color: alphaColor(palette.fg, 0.72),
                        fontSize: 7,
                        lineHeight: 1.45,
                      }}
                    >
                      <span
                        style={{
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          letterSpacing: '0.06em',
                        }}
                        title={categoryLabel}
                      >
                        {categoryLabel}
                      </span>
                      <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {statusLabel} · {formatWords(project.current_words || 0)}
                      </span>
                    </div>
                  </div>
            </div>
          )}

          {coverBusy && (
            <div
              className="book-loading-overlay"
              role="status"
              aria-live="polite"
              aria-label={`正在为《${coverTitle}》生成封面`}
            >
              <div className="cover-glitch-loader">
                <div className="glitch" data-glitch="封面生成中...">
                  封面生成中...
                </div>
              </div>
            </div>
          )}

          {!coverBusy && wizardIncomplete && (
            <div
              className="book-wizard-badge"
              style={{
                color: token.colorTextSecondary,
                background: alphaColor(token.colorBgContainer, 0.92),
              }}
            >
              <ClockCircleOutlined style={{ fontSize: 9 }} />
              向导未完成
            </div>
          )}

          {!coverBusy && coverFailed && !isFailureDismissed(project) && (
            <div
              className="book-failure-anchor"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Popover
                trigger="click"
                placement="top"
                arrow={false}
                rootClassName="book-failure-popover"
                open={coverFailurePopoverId === project.id}
                onOpenChange={(open) => {
                  setCoverFailurePopoverId(open ? project.id : null);
                }}
                content={(
                  <div
                    className="book-failure-popover__content"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      type="text"
                      size="small"
                      className="book-failure-popover__action"
                      icon={<ReloadOutlined />}
                      onClick={() => {
                        setCoverFailurePopoverId(null);
                        void handleGenerateCover(project, true);
                      }}
                    >
                      重新生成
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      className="book-failure-popover__action"
                      icon={<SettingOutlined />}
                      onClick={() => {
                        setCoverFailurePopoverId(null);
                        onGoSettings();
                      }}
                    >
                      检查配置
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      className="book-failure-popover__action"
                      icon={<CloseOutlined />}
                      onClick={() => void dismissFailure(project)}
                    >
                      不再提示
                    </Button>
                  </div>
                )}
              >
                <button
                  type="button"
                  className="book-failure-seal"
                  aria-label={`《${coverTitle}》封面生成失败，打开处理选项`}
                  aria-expanded={coverFailurePopoverId === project.id}
                >
                  <span
                    aria-hidden="true"
                    className="book-failure-seal__mark"
                  >
                    !
                  </span>
                  封面生成失败
                </button>
              </Popover>
            </div>
          )}
            </div>
          </div>
        </div>

        <div className="book-meta">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: isMobile ? 12 : 13,
                fontWeight: 500,
                fontFamily: 'var(--font-editorial)',
                letterSpacing: '0.04em',
                color: token.colorText,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={project.title}
            >
              {project.title}
            </span>
            <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: menuItems,
                  onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation();
                    if (key === 'cover') void handleGenerateCover(project, true);
                    if (key === 'download') onDownloadCover(project);
                    if (key === 'check-config') onGoSettings();
                    if (key === 'delete') onDeleteProject(project.id);
                  },
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<MoreOutlined />}
                  aria-label="作品操作"
                  style={{
                    width: 22,
                    height: 22,
                    minWidth: 22,
                    flexShrink: 0,
                    color: token.colorTextSecondary,
                  }}
                />
              </Dropdown>
            </div>
          </div>

          <div
            style={{
              marginTop: 3,
              fontSize: 10,
              letterSpacing: '0.04em',
              color: coverBusy ? token.colorPrimary : token.colorTextTertiary,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {coverBusy ? (
              <>
                <LoadingOutlined spin style={{ fontSize: 10 }} />
                <span>封面生成中，请稍候</span>
              </>
            ) : (
              <>{formatDate(project.updated_at)} · {formatWords(project.current_words || 0)}</>
            )}
          </div>
        </div>
      </article>
    );
  };

  const isEmpty = projects.length === 0;
  const gridColumns = isMobile
    ? 'repeat(auto-fill, 110px)'
    : 'repeat(auto-fill, 128px)';

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: isMobile ? 14 : 18,
          minHeight: 28,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 14 : 22, flexWrap: 'wrap' }}>
          {projects.length > 0 && stats.map((item) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 11, letterSpacing: '0.16em', color: token.colorTextTertiary }}>{item.label}</span>
              <span style={{ fontSize: isMobile ? 18 : 22, fontWeight: 400, fontFamily: 'var(--font-display)', color: token.colorText }}>
                {item.value}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {showApiTip && renderApiTip()}
          <Button
            type="text"
            size="small"
            icon={<BulbOutlined />}
            onClick={onOpenInspiration}
            style={{ color: token.colorTextSecondary }}
          >
            灵感
          </Button>
          <Button
            type="text"
            size="small"
            icon={<UploadOutlined />}
            onClick={onOpenImportModal}
            style={{ color: token.colorTextSecondary }}
          >
            导入
          </Button>
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            disabled={exportableProjectsCount === 0}
            onClick={onOpenExportModal}
            style={{ color: token.colorTextSecondary }}
          >
            导出
          </Button>
        </div>
      </div>

      {isEmpty && !loading && (
        <div style={{ marginBottom: 14, fontSize: 12, color: token.colorTextTertiary }}>
          书架还是空的，点「新建作品」开始第一本。
        </div>
      )}

      <Spin spinning={loading}>
        <div
          className="editorial-project-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: gridColumns,
            gap: isMobile ? 15 : 24,
            justifyContent: 'start',
            paddingBottom: 24,
          }}
        >
          {projects.map((project, index) => renderProjectCard(project, index))}
          {renderNewCard()}
        </div>
      </Spin>
    </div>
  );
}
