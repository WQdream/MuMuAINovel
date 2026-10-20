import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Dropdown, Space, Spin, theme } from 'antd';
import {
  BookOutlined,
  BulbOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  MoreOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { Project } from '../types';

interface BookshelfPageProps {
  isMobile: boolean;
  loading: boolean;
  projects: Project[];
  showApiTip: boolean;
  setShowApiTip: (show: boolean) => void;
  exportableProjectsCount: number;
  onOpenImportModal: () => void;
  onOpenExportModal: () => void;
  onGoSettings: () => void;
  onStartWizard: () => void;
  onOpenInspiration: () => void;
  onEnterProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onGenerateCover: (project: Project, overwrite?: boolean) => void | Promise<void>;
  onDownloadCover: (project: Project) => void;
  formatWordCount: (count: number) => string;
  getProgress: (current: number, target: number) => number;
  getProgressColor: (progress: number) => string;
  getDisplayStatus: (status: string, progress: number) => string;
  getStatusTag: (status: string) => ReactNode;
  formatDate: (dateString: string) => string;
}

export default function BookshelfPage({
  isMobile,
  loading,
  projects,
  showApiTip,
  setShowApiTip,
  exportableProjectsCount,
  onOpenImportModal,
  onOpenExportModal,
  onGoSettings,
  onStartWizard,
  onOpenInspiration,
  onEnterProject,
  onDeleteProject,
  onGenerateCover,
  onDownloadCover,
  formatWordCount,
  getProgress,
  getProgressColor,
  getDisplayStatus,
  getStatusTag,
  formatDate,
}: BookshelfPageProps) {
  const { token } = theme.useToken();
  const [coverBusyIds, setCoverBusyIds] = useState<Record<string, boolean>>({});

  const alphaColor = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

  const totalWords = projects.reduce((sum, p) => sum + (p.current_words || 0), 0);
  const completedCount = projects.filter(
    (p) => getProgress(p.current_words || 0, p.target_words || 0) >= 100
  ).length;
  const writingCount = projects.length - completedCount;

  const coverPalettes = [
    { bg: alphaColor(token.colorPrimary, 0.14), fg: token.colorPrimary },
    { bg: alphaColor(token.colorSuccess, 0.14), fg: token.colorSuccess },
    { bg: alphaColor(token.colorWarning, 0.16), fg: token.colorWarning },
    { bg: alphaColor(token.colorInfo, 0.14), fg: token.colorInfo },
  ];

  const handleGenerateCover = async (project: Project, overwrite: boolean) => {
    if (coverBusyIds[project.id]) return;
    setCoverBusyIds((prev) => ({ ...prev, [project.id]: true }));
    try {
      await onGenerateCover(project, overwrite);
    } finally {
      setCoverBusyIds((prev) => ({ ...prev, [project.id]: false }));
    }
  };

  const stats = [
    { label: '作品', value: `${projects.length}` },
    { label: '创作中', value: `${writingCount}` },
    { label: '已完结', value: `${completedCount}` },
    { label: '累计字数', value: `${formatWordCount(totalWords)}` },
  ];

  const renderEmptyState = () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: isMobile ? '52vh' : 'calc(100vh - 320px)',
        padding: isMobile ? '24px 0 40px' : '24px 0 48px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          textAlign: 'center',
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 16,
          padding: isMobile ? '32px 24px' : '40px 44px',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            margin: '0 auto 18px',
            borderRadius: 16,
            background: alphaColor(token.colorPrimary, 0.12),
            color: token.colorPrimary,
            display: 'grid',
            placeItems: 'center',
            fontSize: 24,
          }}
        >
          <BookOutlined />
        </div>

        <div style={{ fontSize: 16, fontWeight: 600, color: token.colorText }}>书架还是空的</div>
        <div
          style={{
            fontSize: 13,
            color: token.colorTextSecondary,
            lineHeight: 1.7,
            marginTop: 8,
          }}
        >
          从一个想法开始，或导入你已经在写的故事。
        </div>

        <Space size={10} style={{ marginTop: 24, justifyContent: 'center', width: '100%' }}>
          <Button type="primary" icon={<RocketOutlined />} onClick={onStartWizard} size={isMobile ? 'middle' : 'large'}>
            快速开始
          </Button>
          <Button icon={<BulbOutlined />} onClick={onOpenInspiration} size={isMobile ? 'middle' : 'large'}>
            灵感模式
          </Button>
        </Space>

        <div style={{ marginTop: 16, fontSize: 12, color: token.colorTextTertiary }}>
          已有成稿？
          <Button type="link" size="small" style={{ padding: '0 4px', fontSize: 12 }} onClick={onOpenImportModal}>
            导入项目
          </Button>
        </div>
      </div>
    </div>
  );

  const renderNewCard = () => (
    <button
      type="button"
      onClick={onStartWizard}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        height: '100%',
        minHeight: isMobile ? 180 : 220,
        borderRadius: 12,
        border: `1px dashed ${token.colorBorder}`,
        background: 'transparent',
        color: token.colorTextTertiary,
        cursor: 'pointer',
        transition: 'border-color 0.2s ease, color 0.2s ease, background 0.2s ease',
        padding: 16,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = token.colorPrimary;
        e.currentTarget.style.color = token.colorPrimary;
        e.currentTarget.style.background = alphaColor(token.colorPrimary, 0.04);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = token.colorBorder;
        e.currentTarget.style.color = token.colorTextTertiary;
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: `1px solid currentColor`,
          display: 'grid',
          placeItems: 'center',
          fontSize: 15,
        }}
      >
        <PlusOutlined />
      </div>
      <span style={{ fontSize: 13 }}>新建作品</span>
    </button>
  );

  const renderProjectCard = (project: Project, index: number) => {
    const progress = getProgress(project.current_words || 0, project.target_words || 0);
    const progressColor = progress > 0 ? getProgressColor(progress) : token.colorBorder;
    const displayStatus = getDisplayStatus(project.status, progress);
    const coverReady = project.cover_status === 'ready' && !!project.cover_image_url;
    const coverBusy = coverBusyIds[project.id] || project.cover_status === 'generating';
    const coverFailed = project.cover_status === 'failed' && !coverBusy;
    const wizardIncomplete = project.wizard_status === 'incomplete';
    const palette = coverPalettes[index % coverPalettes.length];
    const tags = project.genre
      ? project.genre.split(/[,、，]/).map((t) => t.trim()).filter(Boolean)
      : [];
    const initial = project.title?.trim().charAt(0) || '书';

    const menuItems = [
      {
        key: 'cover',
        icon: coverReady ? <ReloadOutlined /> : <PictureOutlined />,
        label: coverReady ? '重新生成封面' : '生成封面',
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
      <div
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
          borderRadius: 12,
          overflow: 'hidden',
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          cursor: 'pointer',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-3px)';
          e.currentTarget.style.boxShadow = `0 12px 24px ${alphaColor(token.colorText, 0.1)}`;
          e.currentTarget.style.borderColor = alphaColor(token.colorPrimary, 0.4);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
          e.currentTarget.style.borderColor = token.colorBorderSecondary;
        }}
      >
        <div
          style={{
            position: 'relative',
            aspectRatio: '3 / 4',
            background: palette.bg,
            overflow: 'hidden',
          }}
        >
          {coverReady ? (
            <img
              src={project.cover_image_url || ''}
              alt={project.title}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'grid',
                placeItems: 'center',
                color: palette.fg,
                fontFamily: 'Georgia, "Times New Roman", "Noto Serif SC", serif',
                fontSize: isMobile ? 40 : 52,
                fontWeight: 700,
                opacity: 0.9,
              }}
            >
              {coverBusy ? <LoadingOutlined spin style={{ fontSize: 28 }} /> : initial}
            </div>
          )}

          <div style={{ position: 'absolute', top: 8, left: 8 }}>
            {getStatusTag(displayStatus)}
          </div>

          <div
            style={{ position: 'absolute', top: 6, right: 6 }}
            onClick={(e) => e.stopPropagation()}
          >
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
                size="small"
                shape="circle"
                icon={<MoreOutlined />}
                style={{
                  background: alphaColor(token.colorBgContainer, 0.88),
                  borderColor: token.colorBorderSecondary,
                  color: token.colorTextSecondary,
                  backdropFilter: 'blur(6px)',
                }}
              />
            </Dropdown>
          </div>

          {wizardIncomplete && (
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: token.colorTextSecondary,
                background: alphaColor(token.colorBgContainer, 0.92),
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 999,
                padding: '1px 8px',
              }}
            >
              <ClockCircleOutlined style={{ fontSize: 10 }} />
              向导未完成
            </div>
          )}

          {coverFailed && !wizardIncomplete && (
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 11,
                color: token.colorError,
                background: alphaColor(token.colorBgContainer, 0.92),
                border: `1px solid ${alphaColor(token.colorError, 0.3)}`,
                borderRadius: 999,
                padding: '1px 8px',
              }}
            >
              封面生成失败
            </div>
          )}
        </div>

        <div style={{ padding: isMobile ? '10px 10px 12px' : '11px 12px 13px' }}>
          <div
            style={{
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
          </div>

          <div
            style={{
              marginTop: 3,
              fontSize: 11,
              color: token.colorTextTertiary,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {tags.length > 0 ? tags.slice(0, 2).join(' · ') : '未分类'} · {formatDate(project.updated_at)}
          </div>

          <div
            style={{
              marginTop: 10,
              height: 4,
              borderRadius: 999,
              background: alphaColor(token.colorText, 0.08),
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                borderRadius: 999,
                background: progressColor,
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          <div
            style={{
              marginTop: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11,
              color: token.colorTextSecondary,
            }}
          >
            <span>
              {formatWordCount(project.current_words || 0)} / {formatWordCount(project.target_words || 0)}
            </span>
            <span style={{ color: progressColor, fontWeight: 600 }}>{progress}%</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {projects.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: isMobile ? 14 : 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 14 : 22, flexWrap: 'wrap' }}>
            {stats.map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{item.label}</span>
                <span style={{ fontSize: isMobile ? 17 : 19, fontWeight: 600, color: token.colorText }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          <Space size={8} wrap>
            <Button size={isMobile ? 'small' : 'middle'} icon={<UploadOutlined />} onClick={onOpenImportModal}>
              导入
            </Button>
            <Button
              size={isMobile ? 'small' : 'middle'}
              icon={<DownloadOutlined />}
              disabled={exportableProjectsCount === 0}
              onClick={onOpenExportModal}
            >
              导出
            </Button>
            <Button size={isMobile ? 'small' : 'middle'} type="primary" icon={<PlusOutlined />} onClick={onStartWizard}>
              新建作品
            </Button>
          </Space>
        </div>
      )}

      {showApiTip && projects.length === 0 && (
        <Alert
          message="还没有配置 AI 接口"
          description={
            <div
              style={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                alignItems: isMobile ? 'flex-start' : 'center',
                gap: isMobile ? 10 : 16,
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: isMobile ? 12 : 13 }}>
                创作前需要先填写模型供应商、API Key 与模型名称。
              </span>
              <Button size="small" type="primary" onClick={onGoSettings} style={{ flexShrink: 0 }}>
                去配置
              </Button>
            </div>
          }
          type="info"
          showIcon
          icon={<InfoCircleOutlined style={{ color: token.colorTextSecondary }} />}
          closable
          onClose={() => setShowApiTip(false)}
          style={{
            marginBottom: 16,
            borderRadius: 10,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        />
      )}

      <Spin spinning={loading}>
        {projects.length === 0 ? (
          renderEmptyState()
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: isMobile ? 12 : 16,
              paddingBottom: 24,
            }}
          >
            {renderNewCard()}
            {projects.map((project, index) => renderProjectCard(project, index))}
          </div>
        )}
      </Spin>
    </div>
  );
}
