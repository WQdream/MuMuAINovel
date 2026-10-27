import { useEffect, useState } from 'react';
import './BookshelfPage.css';
import { Button, Dropdown, Spin, theme } from 'antd';
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
  onRefreshProjects,
  onDownloadCover,
  formatDate,
}: BookshelfPageProps) {
  const { token } = theme.useToken();
  const [coverBusyIds, setCoverBusyIds] = useState<Record<string, boolean>>({});

  const hasGeneratingCover = projects.some((project) => project.cover_status === 'generating');

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
    { bg: '#26333F', deep: '#152029', fg: '#F1E9DB', accent: '#C9AA78' },
    { bg: '#5B392F', deep: '#35201B', fg: '#F7EDDF', accent: '#D8B98C' },
    { bg: '#344433', deep: '#1D291C', fg: '#F0EBDD', accent: '#C5B782' },
    { bg: '#3B3E45', deep: '#23252B', fg: '#F1EFE9', accent: '#C2B296' },
    { bg: '#D8CEBC', deep: '#C3B59F', fg: '#302A23', accent: '#8B6A45' },
  ];

  const getCoverTitleStyle = (title: string) => {
    const length = Array.from(title || '').length;
    const fontSize = length <= 6
      ? 26
      : length <= 12
        ? 22
        : length <= 20
          ? 19
          : length <= 32
            ? 17
            : length <= 48
              ? 15
              : 13;
    return { fontSize, lineClamp: 6 };
  };

  const handleGenerateCover = async (project: Project, overwrite: boolean) => {
    if (coverBusyIds[project.id]) return;
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
      onClick={onStartWizard}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        padding: 0,
        border: 0,
        background: 'transparent',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '2 / 3',
          borderRadius: 8,
          border: `1.5px dashed ${token.colorBorder}`,
          background: alphaColor(token.colorPrimary, 0.025),
          display: 'grid',
          placeItems: 'center',
          transition: 'border-color 0.2s ease, background 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = token.colorPrimary;
          e.currentTarget.style.background = alphaColor(token.colorPrimary, 0.05);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = token.colorBorder;
          e.currentTarget.style.background = alphaColor(token.colorPrimary, 0.025);
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            color: token.colorTextSecondary,
            display: 'grid',
            placeItems: 'center',
            fontSize: 17,
          }}
        >
          <PlusOutlined />
        </div>
      </div>

      <div style={{ padding: isMobile ? '8px 2px 0' : '10px 2px 0' }}>
        <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: token.colorText }}>新建作品</div>
        <div style={{ marginTop: 2, fontSize: 11, color: token.colorTextTertiary }}>从零开始一段新故事</div>
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
        role="button"
        tabIndex={0}
        onClick={() => onEnterProject(project)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onEnterProject(project);
          }
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          cursor: 'pointer',
          transition: 'transform 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-3px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <div
          style={{
            position: 'relative',
            aspectRatio: '2 / 3',
            borderRadius: 8,
            overflow: 'hidden',
            background: palette.bg,
            boxShadow: '0 14px 30px rgba(28, 24, 18, 0.16), 0 3px 8px rgba(28, 24, 18, 0.09)',
          }}
        >
          {hasCoverImage ? (
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              {/* 模糊同图铺底，保证封面完整显示且不出现空白边 */}
              <img
                src={project.cover_image_url || ''}
                alt=""
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: -18,
                  width: 'calc(100% + 36px)',
                  height: 'calc(100% + 36px)',
                  objectFit: 'cover',
                  filter: 'blur(18px) saturate(1.1)',
                  transform: 'scale(1.04)',
                }}
              />
              <div
                aria-hidden="true"
                style={{ position: 'absolute', inset: 0, background: 'rgba(20, 16, 12, 0.18)' }}
              />
              <img
                src={project.cover_image_url || ''}
                alt={project.title}
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </div>
          ) : (
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                overflow: 'hidden',
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
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 9,
                      background:
                        'linear-gradient(90deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.12) 55%, rgba(255,255,255,0.14) 100%)',
                      boxShadow: 'inset -1px 0 0 rgba(0,0,0,0.16)',
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
                        ? '17px 14px 14px 22px'
                        : '19px 16px 15px 24px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        color: alphaColor(palette.fg, 0.66),
                        fontSize: 8.5,
                        fontWeight: 600,
                        letterSpacing: '0.16em',
                        lineHeight: 1.4,
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: 13,
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
                        padding: '10px 0 12px',
                      }}
                    >
                      <span
                        style={{
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: coverTitleStyle.lineClamp,
                          overflow: 'hidden',
                          fontFamily: '"Songti SC", "Noto Serif SC", Georgia, "Times New Roman", serif',
                          fontSize: coverTitleStyle.fontSize,
                          fontWeight: 600,
                          letterSpacing: '0.025em',
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
                        paddingTop: 9,
                        borderTop: `1px solid ${alphaColor(palette.accent, 0.34)}`,
                        color: alphaColor(palette.fg, 0.72),
                        fontSize: 9,
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

          {hasCoverImage && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                background:
                  'linear-gradient(90deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.08) 5%, rgba(255,255,255,0.06) 8%, rgba(255,255,255,0) 16%)',
                boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
              }}
            />
          )}

          {coverBusy && (
            <div
              role="status"
              aria-live="polite"
              aria-label={`正在为《${coverTitle}》生成封面`}
              style={{
                position: 'absolute',
                inset: 0,
                // 占位封面内部有 z-index 层级，这里必须抬到最上层才能盖住文字
                zIndex: 3,
                background:
                  'linear-gradient(180deg, rgba(12, 12, 14, 0.58) 0%, rgba(12, 12, 14, 0.74) 55%, rgba(12, 12, 14, 0.86) 100%)',
                backdropFilter: 'blur(6px) saturate(0.9)',
                WebkitBackdropFilter: 'blur(6px) saturate(0.9)',
              }}
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
              style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                color: token.colorTextSecondary,
                background: alphaColor(token.colorBgContainer, 0.92),
                borderRadius: 999,
                padding: '1px 7px',
              }}
            >
              <ClockCircleOutlined style={{ fontSize: 9 }} />
              向导未完成
            </div>
          )}

          {!coverBusy && coverFailed && !wizardIncomplete && (
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 10,
                color: token.colorError,
                background: alphaColor(token.colorBgContainer, 0.92),
                borderRadius: 999,
                padding: '1px 7px',
              }}
            >
              封面生成失败
            </div>
          )}
        </div>

        <div style={{ padding: isMobile ? '8px 2px 0' : '10px 2px 0', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: isMobile ? 13 : 14,
                fontWeight: 600,
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
              marginTop: 2,
              fontSize: 11,
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
    ? `repeat(auto-fill, minmax(0, ${isEmpty ? 148 : 134}px))`
    : `repeat(auto-fill, ${isEmpty ? 164 : 152}px)`;

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
              <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{item.label}</span>
              <span style={{ fontSize: isMobile ? 16 : 18, fontWeight: 600, color: token.colorText }}>
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
          style={{
            display: 'grid',
            gridTemplateColumns: gridColumns,
            gap: isMobile ? 12 : 18,
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
