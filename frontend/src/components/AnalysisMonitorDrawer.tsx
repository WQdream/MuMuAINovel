import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, Drawer, Empty, Progress, Space, Tag, Tooltip, Typography, theme } from 'antd';
import {
  CheckCircleOutlined,
  ClearOutlined,
  CloseCircleOutlined,
  DownOutlined,
  LoadingOutlined,
  PauseOutlined,
  ReloadOutlined,
  RightOutlined,
  SyncOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { chapterApi } from '../services/api';
import type { AnalysisMonitorTask } from '../types';

const { Text } = Typography;

const REFRESH_INTERVAL = 2500;

interface AnalysisMonitorDrawerProps {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
}

const statusMeta: Record<
  AnalysisMonitorTask['status'],
  { label: string; color: string; icon: ReactNode }
> = {
  running: { label: '分析中', color: 'processing', icon: <LoadingOutlined /> },
  completed: { label: '已完成', color: 'success', icon: <CheckCircleOutlined /> },
  failed: { label: '失败', color: 'error', icon: <CloseCircleOutlined /> },
};

function formatElapsed(task: AnalysisMonitorTask) {
  const events = task.events;
  if (events.length < 2) return null;
  const parse = (value: string) => {
    const [h, m, s] = value.split(':').map(Number);
    return h * 3600 + m * 60 + s;
  };
  const diff = parse(events[events.length - 1].ts) - parse(events[0].ts);
  if (!Number.isFinite(diff) || diff < 0) return null;
  if (diff < 60) return `${diff}s`;
  return `${Math.floor(diff / 60)}m${diff % 60}s`;
}

export function AnalysisMonitorDrawer({ open, projectId, onClose }: AnalysisMonitorDrawerProps) {
  const { token } = theme.useToken();
  const [tasks, setTasks] = useState<AnalysisMonitorTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const requestIdRef = useRef(0);
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  // 进行中的任务：事件列表自动跟随最新一条
  const eventListRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    tasks.forEach((task) => {
      if (task.status !== 'running' || !expanded[task.task_id]) return;
      const node = eventListRefs.current[task.task_id];
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, [tasks, expanded]);

  const load = useCallback(async (silent = false) => {
    if (!projectId) return;
    const requestId = ++requestIdRef.current;
    if (!silent) setLoading(true);
    try {
      const result = await chapterApi.getAnalysisMonitor(projectId);
      if (requestId !== requestIdRef.current) return;
      const items = result.items || [];
      setTasks(items);
      setLastUpdated(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      // 新任务默认展开最后一个进行中的任务
      setExpanded((prev) => {
        const next = { ...prev };
        items.forEach((task, index) => {
          if (task.status === 'running' && next[task.task_id] === undefined) {
            next[task.task_id] = index === 0;
          }
        });
        return next;
      });
    } catch (error) {
      console.error('加载分析监控失败:', error);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [projectId]);

  // 打开时立即拉取一次
  useEffect(() => {
    if (!open || !projectId) return;
    void load();
  }, [open, projectId, load]);

  // 仅在抽屉打开且开启自动刷新时轮询
  useEffect(() => {
    if (!open || !projectId || !autoRefresh) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load(true);
    }, REFRESH_INTERVAL);
    return () => window.clearInterval(timer);
  }, [open, projectId, autoRefresh, load]);

  const runningCount = useMemo(
    () => tasks.filter((task) => task.status === 'running').length,
    [tasks],
  );

  const handleClear = async () => {
    if (!projectId) return;
    try {
      await chapterApi.clearAnalysisMonitor(projectId);
      setTasks([]);
      setExpanded({});
    } catch (error) {
      console.error('清空分析监控失败:', error);
    }
  };

  const toggle = (taskId: string) => {
    setExpanded((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(520px, 100vw)"
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      title={
        <Space size={8} align="center">
          <span style={{ fontWeight: 600 }}>分析监控</span>
          {runningCount > 0 ? (
            <Badge status="processing" text={<Text style={{ fontSize: 12 }}>{runningCount} 个任务进行中</Text>} />
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {tasks.length > 0 ? `${tasks.length} 个任务记录` : '暂无任务'}
            </Text>
          )}
        </Space>
      }
      extra={
        <Space size={4}>
          <Tooltip title="立即刷新">
            <Button size="small" type="text" icon={<ReloadOutlined spin={loading} />} onClick={() => load()} />
          </Tooltip>
          <Tooltip title="清空监控记录（不影响分析结果）">
            <Button
              size="small"
              type="text"
              icon={<ClearOutlined />}
              onClick={handleClear}
              disabled={tasks.length === 0}
            />
          </Tooltip>
        </Space>
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '8px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          fontSize: 12,
          color: token.colorTextTertiary,
        }}
      >
        <Button
          size="small"
          type="text"
          onClick={() => setAutoRefresh((prev) => !prev)}
          style={{
            height: 22,
            paddingInline: 8,
            fontSize: 12,
            color: autoRefresh ? token.colorPrimary : token.colorTextTertiary,
            background: autoRefresh ? token.colorPrimaryBg : 'transparent',
          }}
        >
          {autoRefresh ? (
            <SyncOutlined spin style={{ marginRight: 5 }} />
          ) : (
            <PauseOutlined style={{ marginRight: 5 }} />
          )}
          自动刷新
        </Button>
        <span style={{ color: token.colorTextQuaternary }}>·</span>
        <span>上下文 → AI → JSON → 入库</span>
        {lastUpdated ? (
          <>
            <span style={{ color: token.colorTextQuaternary }}>·</span>
            <span>更新于 {lastUpdated}</span>
          </>
        ) : null}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: token.colorFillQuaternary }}>
        {tasks.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                还没有分析记录
                <br />
                触发「一键分析未分析章节」或单章分析后，这里会实时显示过程
              </div>
            }
          />
        ) : (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {tasks.map((task) => {
              const meta = statusMeta[task.status] || statusMeta.running;
              const isOpen = !!expanded[task.task_id];
              const lastEvent = task.events[task.events.length - 1];
              const elapsed = formatElapsed(task);
              const progress = lastEvent?.progress ?? (task.status === 'completed' ? 100 : undefined);
              return (
                <div
                  key={task.task_id}
                  style={{
                    background: token.colorBgContainer,
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${
                      task.status === 'running' ? token.colorPrimaryBorder : token.colorBorderSecondary
                    }`,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    onClick={() => toggle(task.task_id)}
                    style={{ padding: '10px 12px', cursor: 'pointer', userSelect: 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isOpen ? (
                        <DownOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
                      ) : (
                        <RightOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
                      )}
                      <Text strong style={{ fontSize: 13 }}>
                        {task.chapter_number != null ? `第${task.chapter_number}章` : '未知章节'}
                        {task.chapter_title ? `《${task.chapter_title}》` : ''}
                      </Text>
                      <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                        {meta.label}
                      </Tag>
                      {elapsed && (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          耗时 {elapsed}
                        </Text>
                      )}
                    </div>
                    {!isOpen && lastEvent && (
                      task.status === 'failed' ? (
                        <div
                          style={{
                            marginTop: 8,
                            marginLeft: 18,
                            padding: '8px 10px',
                            fontSize: 12,
                            lineHeight: 1.6,
                            color: token.colorErrorText,
                            background: token.colorErrorBg,
                            border: `1px solid ${token.colorErrorBorder}`,
                            borderLeft: `3px solid ${token.colorError}`,
                            borderRadius: token.borderRadiusSM,
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {lastEvent.message || '分析失败，未记录具体原因'}
                        </div>
                      ) : (
                        <div
                          style={{
                            marginTop: 6,
                            paddingLeft: 18,
                            fontSize: 12,
                            color:
                              lastEvent.level === 'error'
                                ? token.colorError
                                : lastEvent.level === 'warn'
                                  ? token.colorWarning
                                  : token.colorTextSecondary,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {lastEvent.message}
                        </div>
                      )
                    )}
                    {progress != null && task.status !== 'completed' && (
                      <Progress
                        percent={Math.min(100, Math.max(0, progress))}
                        size="small"
                        showInfo={false}
                        status={
                          task.status === 'failed'
                            ? 'exception'
                            : 'active'
                        }
                        style={{ marginTop: 6, marginBottom: 0 }}
                      />
                    )}
                  </div>

                  {isOpen && (
                    <div
                      ref={(node) => {
                        eventListRefs.current[task.task_id] = node;
                      }}
                      style={{
                        borderTop: `1px solid ${token.colorBorderSecondary}`,
                        padding: '10px 12px',
                        maxHeight: 340,
                        overflowY: 'auto',
                        background: token.colorFillQuaternary,
                      }}
                    >
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {task.events.map((event, index) => (
                          <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <Text
                              style={{
                                fontSize: 11,
                                color: token.colorTextQuaternary,
                                fontVariantNumeric: 'tabular-nums',
                                flexShrink: 0,
                                paddingTop: 2,
                              }}
                            >
                              {event.ts}
                            </Text>
                            {event.level === 'info' ? (
                              <span
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: '50%',
                                  background: token.colorTextQuaternary,
                                  flexShrink: 0,
                                  marginTop: 9,
                                }}
                              />
                            ) : (
                              <span
                                style={{
                                  color:
                                    event.level === 'error' ? token.colorError : token.colorWarning,
                                  fontSize: 12,
                                  lineHeight: '18px',
                                  flexShrink: 0,
                                }}
                              >
                                {event.level === 'error' ? <CloseCircleOutlined /> : <WarningOutlined />}
                              </span>
                            )}
                            <Text
                              style={{
                                fontSize: 12,
                                wordBreak: 'break-word',
                                color:
                                  event.level === 'error'
                                    ? token.colorError
                                    : event.level === 'warn'
                                      ? token.colorWarning
                                      : token.colorText,
                              }}
                            >
                              {event.message}
                            </Text>
                          </div>
                        ))}
                      </Space>
                    </div>
                  )}
                </div>
              );
            })}
          </Space>
        )}
      </div>
    </Drawer>
  );
}

export default AnalysisMonitorDrawer;
