import React, { useMemo, useEffect, useRef } from 'react';
import { Empty, theme } from 'antd';
import {
  DownOutlined,
  FireOutlined,
  StarOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { MemoryAnnotation } from './AnnotatedText';

interface MemorySidebarProps {
  annotations: MemoryAnnotation[];
  activeAnnotationId?: string;
  onAnnotationClick?: (annotation: MemoryAnnotation) => void;
  scrollToAnnotation?: string;
}

const TYPE_CONFIG = {
  hook: { label: '钩子', icon: <FireOutlined /> },
  foreshadow: { label: '伏笔', icon: <StarOutlined /> },
  plot_point: { label: '情节点', icon: <ThunderboltOutlined /> },
  character_event: { label: '角色事件', icon: <UserOutlined /> },
};

const TYPE_ORDER = ['hook', 'foreshadow', 'plot_point', 'character_event'] as const;

/**
 * 记忆侧边栏组件
 * 展示章节的所有记忆标注
 */
const MemorySidebar: React.FC<MemorySidebarProps> = ({
  annotations,
  activeAnnotationId,
  onAnnotationClick,
  scrollToAnnotation,
}) => {
  const { token } = theme.useToken();
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const typeColors: Record<keyof typeof TYPE_CONFIG, string> = {
    hook: token.colorError,
    foreshadow: token.colorInfo,
    plot_point: token.colorSuccess,
    character_event: token.colorWarning,
  };

  useEffect(() => {
    if (scrollToAnnotation && cardRefs.current[scrollToAnnotation]) {
      cardRefs.current[scrollToAnnotation]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [scrollToAnnotation]);

  const groupedAnnotations = useMemo(() => {
    const groups: Record<string, MemoryAnnotation[]> = {
      hook: [],
      foreshadow: [],
      plot_point: [],
      character_event: [],
    };

    annotations.forEach((annotation) => {
      if (groups[annotation.type]) groups[annotation.type].push(annotation);
    });

    Object.keys(groups).forEach((type) => {
      groups[type].sort((a, b) => b.importance - a.importance);
    });

    return groups;
  }, [annotations]);

  const stats = useMemo(
    () => ({
      total: annotations.length,
      hooks: groupedAnnotations.hook.length,
      foreshadows: groupedAnnotations.foreshadow.length,
      plotPoints: groupedAnnotations.plot_point.length,
      characterEvents: groupedAnnotations.character_event.length,
    }),
    [annotations, groupedAnnotations]
  );

  const statItems = [
    { key: 'hook', label: '钩子', value: stats.hooks },
    { key: 'foreshadow', label: '伏笔', value: stats.foreshadows },
    { key: 'plot_point', label: '情节点', value: stats.plotPoints },
    { key: 'character_event', label: '角色事件', value: stats.characterEvents },
  ].filter((item) => item.value > 0);

  const renderMemoryCard = (annotation: MemoryAnnotation) => {
    const config = TYPE_CONFIG[annotation.type];
    const color = typeColors[annotation.type];
    const isActive = activeAnnotationId === annotation.id;

    return (
      <div
        key={annotation.id}
        ref={(el) => {
          cardRefs.current[annotation.id] = el;
        }}
        onClick={() => onAnnotationClick?.(annotation)}
        style={{
          marginBottom: 8,
          padding: '11px 12px',
          borderRadius: 10,
          border: `1px solid ${isActive ? color : token.colorBorderSecondary}`,
          background: isActive ? `color-mix(in srgb, ${color} 6%, ${token.colorBgContainer})` : token.colorBgContainer,
          cursor: 'pointer',
          transition: 'border-color 0.15s ease, background 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ color, fontSize: 12, display: 'inline-flex' }}>{config.icon}</span>
          <span style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            color: token.colorText,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {annotation.title}
          </span>
          <span style={{
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 600,
            color,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {(annotation.importance * 10).toFixed(1)}
          </span>
        </div>

        <div style={{
          fontSize: 12,
          lineHeight: 1.65,
          color: token.colorTextSecondary,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical' as const,
          overflow: 'hidden',
        }}>
          {annotation.content}
        </div>

        {(annotation.tags?.length > 0 ||
          annotation.metadata.strength ||
          annotation.metadata.foreshadowType) && (
          <div style={{
            marginTop: 8,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 5,
            fontSize: 10.5,
            color: token.colorTextTertiary,
          }}>
            {annotation.tags?.map((tag, index) => (
              <span
                key={index}
                style={{
                  padding: '0 6px',
                  borderRadius: 4,
                  background: token.colorFillTertiary,
                  color: token.colorTextTertiary,
                  lineHeight: '17px',
                }}
              >
                {tag}
              </span>
            ))}
            {annotation.metadata.strength && (
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                强度 {annotation.metadata.strength}/10
              </span>
            )}
            {annotation.metadata.foreshadowType && (
              <span style={{ color: annotation.metadata.foreshadowType === 'planted' ? token.colorInfo : token.colorSuccess }}>
                {annotation.metadata.foreshadowType === 'planted' ? '已埋下' : '已回收'}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  if (annotations.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Empty description="暂无分析数据" />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '14px 16px 20px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(statItems.length, 2)}, minmax(0, 1fr))`,
        gap: 6,
        marginBottom: 14,
      }}>
        {statItems.map((item) => (
          <div
            key={item.key}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: token.colorFillQuaternary,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{item.label}</div>
            <div style={{
              marginTop: 1,
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.3,
              color: typeColors[item.key as keyof typeof TYPE_CONFIG],
              fontVariantNumeric: 'tabular-nums',
            }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {TYPE_ORDER.map((type) => {
          const items = groupedAnnotations[type];
          if (items.length === 0) return null;
          const config = TYPE_CONFIG[type];

          return (
            <div key={type}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 7,
                fontSize: 11.5,
                fontWeight: 600,
                color: token.colorTextTertiary,
                letterSpacing: '0.02em',
              }}>
                <span style={{ color: typeColors[type], display: 'inline-flex' }}>{config.icon}</span>
                {config.label}
                <span style={{ fontWeight: 400 }}>{items.length}</span>
                <DownOutlined style={{ marginLeft: 'auto', fontSize: 9, opacity: 0.5 }} />
              </div>
              {items.map((annotation) => renderMemoryCard(annotation))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MemorySidebar;
