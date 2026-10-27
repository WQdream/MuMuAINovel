import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Table, Button, Tag, Space, Modal, Form, Input, Select,
  InputNumber, Switch, message, Tooltip, Popconfirm,
  Row, Col, Empty, Badge, Alert, Pagination, Dropdown, theme
} from 'antd';
import type { MenuProps } from 'antd';
import {
  PlusOutlined, SyncOutlined, EditOutlined, DeleteOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined,
  BulbOutlined, EyeOutlined, FlagOutlined, WarningOutlined,
  ClockCircleOutlined, MoreOutlined, ReloadOutlined, InfoCircleOutlined,
  CloseOutlined, StarFilled,
} from '@ant-design/icons';
import { foreshadowApi, chapterApi, characterApi } from '../services/api';
import type {
  Foreshadow, ForeshadowCreate, ForeshadowUpdate, ForeshadowStats,
  ForeshadowStatus, ForeshadowCategory, Chapter, Character
} from '../types';
import { eventBus, EventNames } from '../store/eventBus';

const { TextArea } = Input;
const { Option } = Select;

// 状态配置
const STATUS_CONFIG: Record<ForeshadowStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '待埋入', color: 'default', icon: <ClockCircleOutlined /> },
  planted: { label: '已埋入', color: 'green', icon: <BulbOutlined /> },
  resolved: { label: '已回收', color: 'blue', icon: <CheckCircleOutlined /> },
  partially_resolved: { label: '部分回收', color: 'orange', icon: <ExclamationCircleOutlined /> },
  abandoned: { label: '已废弃', color: 'default', icon: <CloseCircleOutlined /> },
};

// 分类配置
const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  identity: { label: '身世', color: 'purple' },
  mystery: { label: '悬念', color: 'magenta' },
  item: { label: '物品', color: 'gold' },
  relationship: { label: '关系', color: 'cyan' },
  event: { label: '事件', color: 'blue' },
  ability: { label: '能力', color: 'green' },
  prophecy: { label: '预言', color: 'volcano' },
};

export default function Foreshadows() {
  const { projectId } = useParams<{ projectId: string }>();
  const [loading, setLoading] = useState(false);
  const [foreshadows, setForeshadows] = useState<Foreshadow[]>([]);
  const [stats, setStats] = useState<ForeshadowStats | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  
  // 筛选条件
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [sourceFilter, setSourceFilter] = useState<string | undefined>(undefined);
  
  // 模态框状态
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [plantModalVisible, setPlantModalVisible] = useState(false);
  const [resolveModalVisible, setResolveModalVisible] = useState(false);
  
  const [currentForeshadow, setCurrentForeshadow] = useState<Foreshadow | null>(null);
  const [form] = Form.useForm();
  const [plantForm] = Form.useForm();
  const [resolveForm] = Form.useForm();
  const [syncing, setSyncing] = useState(false);
  const [syncHintVisible, setSyncHintVisible] = useState(true);
  
  // 表格容器引用，用于计算滚动高度
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState<number>(400);
  const [containerWidth, setContainerWidth] = useState<number>(window.innerWidth);
  const { token } = theme.useToken();

  // 加载伏笔列表
  const loadForeshadows = useCallback(async () => {
    if (!projectId) return;
    
    setLoading(true);
    try {
      const response = await foreshadowApi.getProjectForeshadows(projectId, {
        status: statusFilter,
        category: categoryFilter,
        source_type: sourceFilter,
        page: currentPage,
        limit: pageSize,
      });
      
      setForeshadows(response.items);
      setTotal(response.total);
      if (response.stats) {
        setStats(response.stats);
      }
    } catch (error) {
      console.error('加载伏笔列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter, categoryFilter, sourceFilter, currentPage, pageSize]);

  // 加载章节列表（用于选择）
  const loadChapters = useCallback(async () => {
    if (!projectId) return;
    try {
      const chaptersData = await chapterApi.getChapters(projectId);
      setChapters(chaptersData);
    } catch (error) {
      console.error('加载章节列表失败:', error);
    }
  }, [projectId]);

  // 加载角色列表（用于关联角色）
  const loadCharacters = useCallback(async () => {
    if (!projectId) return;
    try {
      const charactersData = await characterApi.getCharacters(projectId);
      setCharacters(charactersData);
    } catch (error) {
      console.error('加载角色列表失败:', error);
    }
  }, [projectId]);

  // 加载统计
  const loadStats = useCallback(async () => {
    if (!projectId) return;
    try {
      // 获取当前最大章节号（只计算有内容的章节，与表格显示逻辑保持一致）
      const chaptersWithContent = chapters.filter(c => c.content);
      const maxChapter = chaptersWithContent.length > 0
        ? Math.max(...chaptersWithContent.map(c => c.chapter_number))
        : undefined;
      const statsData = await foreshadowApi.getForeshadowStats(projectId, maxChapter);
      setStats(statsData);
    } catch (error) {
      console.error('加载统计失败:', error);
    }
  }, [projectId, chapters]);

  useEffect(() => {
    loadForeshadows();
    loadChapters();
    loadCharacters();
  }, [loadForeshadows, loadChapters, loadCharacters]);

  useEffect(() => {
    const handleTaskSettled = (payload?: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const data = payload as { projectId?: string; resources?: string[] };
      if (data.projectId && data.projectId !== projectId) return;
      if (!data.resources?.includes('foreshadows')) return;
      void loadForeshadows();
      void loadStats();
    };
    eventBus.on(EventNames.BACKGROUND_TASK_SETTLED, handleTaskSettled);
    return () => eventBus.off(EventNames.BACKGROUND_TASK_SETTLED, handleTaskSettled);
  }, [loadForeshadows, loadStats, projectId]);

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
  }, []);

  // 计算表格滚动高度
  useEffect(() => {
    const calculateTableHeight = () => {
      if (tableContainerRef.current) {
        // 获取容器高度，减去表头高度（约55px）
        const containerHeight = tableContainerRef.current.clientHeight;
        setTableScrollY(Math.max(containerHeight - 55, 200));
      }
    };
    
    calculateTableHeight();
    window.addEventListener('resize', calculateTableHeight);
    
    // 延迟再计算一次，确保布局完成
    const timer = setTimeout(calculateTableHeight, 100);
    
    return () => {
      window.removeEventListener('resize', calculateTableHeight);
      clearTimeout(timer);
    };
  }, [stats]); // stats 变化时重新计算（因为统计卡片高度可能变化）

  useEffect(() => {
    if (chapters.length > 0) {
      loadStats();
    }
  }, [chapters, loadStats]);

  // 创建/编辑伏笔
  const handleSave = async (values: ForeshadowCreate | ForeshadowUpdate) => {
    try {
      if (currentForeshadow) {
        await foreshadowApi.updateForeshadow(currentForeshadow.id, values as ForeshadowUpdate);
        message.success('伏笔更新成功');
      } else {
        await foreshadowApi.createForeshadow({
          ...values,
          project_id: projectId!,
        } as ForeshadowCreate);
        message.success('伏笔创建成功');
      }
      setEditModalVisible(false);
      form.resetFields();
      setCurrentForeshadow(null);
      loadForeshadows();
    } catch (error) {
      console.error('保存伏笔失败:', error);
    }
  };

  // 删除伏笔
  const handleDelete = async (id: string) => {
    try {
      await foreshadowApi.deleteForeshadow(id);
      message.success('伏笔删除成功');
      loadForeshadows();
    } catch (error) {
      console.error('删除伏笔失败:', error);
    }
  };

  // 标记埋入
  const handlePlant = async (values: { chapter_id: string; hint_text?: string }) => {
    if (!currentForeshadow) return;
    
    const chapter = chapters.find(c => c.id === values.chapter_id);
    if (!chapter) return;
    
    try {
      await foreshadowApi.plantForeshadow(currentForeshadow.id, {
        chapter_id: values.chapter_id,
        chapter_number: chapter.chapter_number,
        hint_text: values.hint_text,
      });
      message.success('伏笔已标记为埋入');
      setPlantModalVisible(false);
      plantForm.resetFields();
      setCurrentForeshadow(null);
      loadForeshadows();
    } catch (error) {
      console.error('标记埋入失败:', error);
    }
  };

  // 标记回收
  const handleResolve = async (values: { chapter_id: string; resolution_text?: string; is_partial?: boolean }) => {
    if (!currentForeshadow) return;
    
    const chapter = chapters.find(c => c.id === values.chapter_id);
    if (!chapter) return;
    
    try {
      await foreshadowApi.resolveForeshadow(currentForeshadow.id, {
        chapter_id: values.chapter_id,
        chapter_number: chapter.chapter_number,
        resolution_text: values.resolution_text,
        is_partial: values.is_partial,
      });
      message.success('伏笔已标记为回收');
      setResolveModalVisible(false);
      resolveForm.resetFields();
      setCurrentForeshadow(null);
      loadForeshadows();
    } catch (error) {
      console.error('标记回收失败:', error);
    }
  };

  // 标记废弃
  const handleAbandon = async (id: string) => {
    try {
      await foreshadowApi.abandonForeshadow(id);
      message.success('伏笔已标记为废弃');
      loadForeshadows();
    } catch (error) {
      console.error('标记废弃失败:', error);
    }
  };

  // 从分析同步
  const handleSync = async () => {
    if (!projectId) return;
    
    setSyncing(true);
    try {
      const result = await foreshadowApi.syncFromAnalysis(projectId, {
        auto_set_planted: true,
      });
      message.success(`同步完成: 新增${result.synced_count}个伏笔, 跳过${result.skipped_count}个`);
      setSyncModalVisible(false);
      loadForeshadows();
    } catch (error) {
      console.error('同步失败:', error);
    } finally {
      setSyncing(false);
    }
  };

  // 打开编辑模态框
  const openEditModal = (foreshadow?: Foreshadow) => {
    setCurrentForeshadow(foreshadow || null);
    if (foreshadow) {
      // 确保数组类型字段不为null
      form.setFieldsValue({
        ...foreshadow,
        tags: foreshadow.tags || [],
        related_characters: foreshadow.related_characters || [],
      });
    } else {
      form.resetFields();
    }
    setEditModalVisible(true);
  };

  // 打开详情模态框
  const openDetailModal = (foreshadow: Foreshadow) => {
    setCurrentForeshadow(foreshadow);
    setDetailModalVisible(true);
  };

  // 打开埋入模态框
  const openPlantModal = (foreshadow: Foreshadow) => {
    setCurrentForeshadow(foreshadow);
    plantForm.resetFields();
    setPlantModalVisible(true);
  };

  // 打开回收模态框
  const openResolveModal = (foreshadow: Foreshadow) => {
    setCurrentForeshadow(foreshadow);
    resolveForm.resetFields();
    setResolveModalVisible(true);
  };

  // 计算紧急程度
  const getUrgencyBadge = (foreshadow: Foreshadow) => {
    if (foreshadow.status !== 'planted' || !foreshadow.target_resolve_chapter_number) {
      return null;
    }
    
    const chaptersWithContent = chapters.filter(c => c.content);
    const currentMaxChapter = chaptersWithContent.length > 0
      ? Math.max(...chaptersWithContent.map(c => c.chapter_number))
      : 0;
    
    const remaining = foreshadow.target_resolve_chapter_number - currentMaxChapter;
    
    if (remaining < 0) {
      return <Badge status="error" text={`已超期${Math.abs(remaining)}章`} />;
    } else if (remaining <= 3) {
      return <Badge status="warning" text={`还剩${remaining}章`} />;
    }
    return null;
  };

  // 状态排序优先级
  const statusOrder: Record<ForeshadowStatus, number> = {
    planted: 1,      // 已埋入优先（需要关注回收）
    pending: 2,      // 待埋入次之
    partially_resolved: 3,
    resolved: 4,
    abandoned: 5,
  };

  // 表格列定义
  const columns = [
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: containerWidth >= 860 ? 100 : 72,
      sorter: (a: Foreshadow, b: Foreshadow) => statusOrder[a.status] - statusOrder[b.status],
      render: (status: ForeshadowStatus) => {
        const config = STATUS_CONFIG[status];
        const dotColor =
          status === 'planted'
            ? token.colorSuccess
            : status === 'resolved'
              ? token.colorInfo
              : status === 'partially_resolved'
                ? token.colorWarning
                : token.colorTextQuaternary;
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 12.5,
            color: status === 'abandoned' ? token.colorTextQuaternary : token.colorTextSecondary,
            whiteSpace: 'nowrap',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: 3, background: dotColor }} />
            {config.label}
          </span>
        );
      },
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      sorter: (a: Foreshadow, b: Foreshadow) => a.title.localeCompare(b.title, 'zh-CN'),
      render: (title: string, record: Foreshadow) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span
              onClick={() => openDetailModal(record)}
              title={title}
              style={{
                minWidth: 0,
                fontSize: 13.5,
                color: token.colorText,
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </span>
            {record.is_long_term && (
              <Tag
                style={{
                  flexShrink: 0,
                  margin: 0,
                  padding: '0 6px',
                  fontSize: 10.5,
                  lineHeight: '17px',
                  borderRadius: 4,
                  color: token.colorTextSecondary,
                  background: token.colorFillTertiary,
                  border: 'none',
                }}
              >
                长线
              </Tag>
            )}
          </div>
          {getUrgencyBadge(record)}
        </div>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 80,
      sorter: (a: Foreshadow, b: Foreshadow) => {
        const catA = a.category || '';
        const catB = b.category || '';
        return catA.localeCompare(catB, 'zh-CN');
      },
      render: (category?: ForeshadowCategory) => {
        if (!category) return <span style={{ color: token.colorTextQuaternary }}>-</span>;
        const config = CATEGORY_CONFIG[category];
        if (!config) return category;
        return (
          <Tag
            style={{
              margin: 0,
              padding: '0 7px',
              fontSize: 11,
              lineHeight: '18px',
              borderRadius: 5,
              border: 'none',
              background: token.colorFillTertiary,
              color: token.colorTextSecondary,
            }}
          >
            {config.label}
          </Tag>
        );
      },
    },
    {
      title: '埋入',
      dataIndex: 'plant_chapter_number',
      key: 'plant_chapter_number',
      width: containerWidth >= 860 ? 110 : 64,
      sorter: (a: Foreshadow, b: Foreshadow) => {
        const valA = a.plant_chapter_number ?? 999999;
        const valB = b.plant_chapter_number ?? 999999;
        return valA - valB;
      },
      defaultSortOrder: 'ascend' as const,
      render: (num?: number) => num ? `第${num}章` : '-',
    },
    {
      title: '计划回收',
      dataIndex: 'target_resolve_chapter_number',
      key: 'target_resolve_chapter_number',
      width: 104,
      sorter: (a: Foreshadow, b: Foreshadow) => {
        const valA = a.target_resolve_chapter_number ?? 999999;
        const valB = b.target_resolve_chapter_number ?? 999999;
        return valA - valB;
      },
      render: (num?: number) => num ? `第${num}章` : '-',
    },
    {
      title: '重要性',
      dataIndex: 'importance',
      key: 'importance',
      width: containerWidth >= 860 ? 108 : 84,
      sorter: (a: Foreshadow, b: Foreshadow) => a.importance - b.importance,
      render: (importance: number) => {
        const stars = Math.round(importance * 5);
        return (
          <span
            title={`${stars} / 5`}
            style={{
              display: 'inline-flex',
              gap: 1,
              whiteSpace: 'nowrap',
              fontSize: 13,
              lineHeight: 1,
              letterSpacing: 0,
              color: token.colorWarning,
            }}
          >
            {Array.from({ length: 5 }).map((_, index) => (
              <StarFilled
                key={index}
                style={{ color: index < stars ? token.colorWarning : token.colorBorder, fontSize: 12 }}
              />
            ))}
          </span>
        );
      },
    },
    {
      title: '来源',
      dataIndex: 'source_type',
      key: 'source_type',
      width: 80,
      sorter: (a: Foreshadow, b: Foreshadow) => {
        const srcA = a.source_type || '';
        const srcB = b.source_type || '';
        return srcA.localeCompare(srcB);
      },
      render: (source?: string) => (
        <span style={{
          fontSize: 12.5,
          color: source === 'analysis' ? token.colorTextSecondary : token.colorTextTertiary,
          whiteSpace: 'nowrap',
        }}>
          {source === 'analysis' ? '分析' : '手动'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: containerWidth >= 860 ? 168 : 140,
      render: (_: unknown, record: Foreshadow) => (
        <Space size={2}>
          <Tooltip title="查看详情">
            <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openDetailModal(record)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)} />
          </Tooltip>
          {record.status === 'pending' && (
            <Tooltip title="标记埋入">
              <Button type="text" size="small" icon={<FlagOutlined />} onClick={() => openPlantModal(record)} />
            </Tooltip>
          )}
          {record.status === 'planted' && (
            <Tooltip title="标记回收">
              <Button type="text" size="small" icon={<CheckCircleOutlined />} onClick={() => openResolveModal(record)} />
            </Tooltip>
          )}
          {record.status !== 'abandoned' && record.status !== 'resolved' && (
            <Popconfirm
              title="确定要废弃这个伏笔吗？"
              onConfirm={() => handleAbandon(record.id)}
            >
              <Tooltip title="废弃">
                <Button type="text" size="small" danger icon={<CloseCircleOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
          <Popconfirm
            title="确定要删除这个伏笔吗？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const statColumns = containerWidth >= 700 ? 6 : 3;

  const modalFooterStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  };
  const footerButtonStyle: React.CSSProperties = { height: 32, paddingInline: 16, fontSize: 13 };
  const sectionLabelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '18px 0 10px',
    fontSize: 11.5,
    fontWeight: 600,
    color: token.colorTextTertiary,
    letterSpacing: '0.03em',
  };
  const sectionLineStyle: React.CSSProperties = {
    flex: 1,
    height: 1,
    background: token.colorBorderSecondary,
  };
  const showCategoryColumn = containerWidth >= 720;
  const showSourceColumn = containerWidth >= 860;
  const showPlanColumn = containerWidth >= 620;
  const visibleColumns = columns.filter((column) => {
    if (column.key === 'category') return showCategoryColumn;
    if (column.key === 'source_type') return showSourceColumn;
    if (column.key === 'target_resolve_chapter_number') return showPlanColumn;
    return true;
  });

  return (
    <div
      ref={pageRef}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}
    >
      {/* 统计概览 */}
      {stats && (
        <div style={{
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${statColumns}, minmax(0, 1fr))`,
          marginBottom: 14,
          padding: '4px 2px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}>
          {[
            { label: '总计', value: stats.total, color: token.colorText },
            { label: '待埋入', value: stats.pending, color: token.colorTextSecondary },
            { label: '已埋入', value: stats.planted, color: token.colorSuccess },
            { label: '已回收', value: stats.resolved, color: token.colorPrimary },
            { label: '长线伏笔', value: stats.long_term_count, color: token.colorInfo },
            {
              label: '超期未回收',
              value: stats.overdue_count,
              color: stats.overdue_count > 0 ? token.colorError : token.colorTextSecondary,
            },
          ].map((item, index) => (
            <div
              key={item.label}
              style={{
                minWidth: 0,
                padding: '2px 10px 10px',
                borderLeft: index % statColumns === 0 ? 'none' : `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <div style={{ fontSize: 11.5, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}>
                {item.label}
              </div>
              <div style={{
                marginTop: 3,
                fontSize: 21,
                fontWeight: 600,
                lineHeight: 1.25,
                color: item.color,
                fontVariantNumeric: 'tabular-nums',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                {item.value}
                {item.label === '超期未回收' && stats.overdue_count > 0 && (
                  <WarningOutlined style={{ fontSize: 12 }} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 超期提醒 */}
      {stats && stats.overdue_count > 0 && (
        <Alert
          message={`有 ${stats.overdue_count} 个伏笔已超期未回收`}
          description="请尽快在后续章节中回收这些伏笔，或调整计划回收章节"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 自动同步提示 */}
      {syncHintVisible && (
        <div style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 12,
          padding: '7px 10px',
          borderRadius: 8,
          background: token.colorFillQuaternary,
          fontSize: 12,
          color: token.colorTextTertiary,
        }}>
          <InfoCircleOutlined style={{ fontSize: 12 }} />
          <span style={{ flex: 1, minWidth: 0 }}>伏笔会在章节分析完成后自动同步，无需手动操作</span>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={() => setSyncHintVisible(false)}
            style={{ width: 20, height: 20, minHeight: 20, padding: 0, fontSize: 10 }}
            aria-label="关闭提示"
          />
        </div>
      )}

      {/* 工具栏 */}
      <div style={{
        marginBottom: 14,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}>
        <Space wrap size={8}>
          <Select
            placeholder="状态筛选"
            allowClear
            style={{ width: 118 }}
            value={statusFilter}
            onChange={setStatusFilter}
          >
            {Object.entries(STATUS_CONFIG).map(([key, config]) => (
              <Option key={key} value={key}>{config.label}</Option>
            ))}
          </Select>
          <Select
            placeholder="分类筛选"
            allowClear
            style={{ width: 100 }}
            value={categoryFilter}
            onChange={setCategoryFilter}
          >
            {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
              <Option key={key} value={key}>{config.label}</Option>
            ))}
          </Select>
          <Select
            placeholder="来源筛选"
            allowClear
            style={{ width: 100 }}
            value={sourceFilter}
            onChange={setSourceFilter}
          >
            <Option value="analysis">分析</Option>
            <Option value="manual">手动</Option>
          </Select>
        </Space>
        <Space size={8} style={{ marginLeft: 'auto' }}>
          <Tooltip title="刷新列表">
            <Button
              icon={<ReloadOutlined spin={loading} />}
              onClick={loadForeshadows}
            />
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'sync',
                  icon: <SyncOutlined />,
                  label: '手动同步分析伏笔',
                  onClick: () => setSyncModalVisible(true),
                },
              ] as MenuProps['items'],
            }}
            placement="bottomRight"
          >
            <Button icon={<MoreOutlined />}>更多</Button>
          </Dropdown>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openEditModal()}
          >
            添加伏笔
          </Button>
        </Space>
      </div>

      {/* 伏笔列表 - 表格内容可滚动，表头固定 */}
      <div
        ref={tableContainerRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0, // 重要：让 flex 子元素可以收缩
        }}
      >
        <Table
          dataSource={foreshadows}
          columns={visibleColumns}
          rowKey="id"
          loading={loading}
          pagination={false}
          scroll={{ y: tableScrollY }}
          tableLayout={containerWidth >= 860 ? 'fixed' : 'auto'}
          size="middle"
          rowClassName="foreshadow-row"
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0' }}>
                <Empty description="暂无伏笔，点击右上角添加" />
              </div>
            ),
          }}
        />
      </div>

      {/* 分页器 - 固定在底部居中 */}
      <div style={{
        padding: '12px 0',
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        background: token.colorBgContainer,
      }}>
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={total}
          onChange={(page, size) => {
            setCurrentPage(page);
            if (size !== pageSize) {
              setPageSize(size);
            }
          }}
          showSizeChanger
          showTotal={(total) => `共 ${total} 条`}
          showQuickJumper
        />
      </div>

      {/* 创建/编辑模态框 */}
      <Modal
        title={currentForeshadow ? '编辑伏笔' : '添加伏笔'}
        open={editModalVisible}
        centered
        onCancel={() => {
          setEditModalVisible(false);
          setCurrentForeshadow(null);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText={currentForeshadow ? '保存修改' : '创建伏笔'}
        width={720}
        destroyOnClose
        styles={{
          body: { paddingTop: 4, maxHeight: 'min(72vh, 680px)', overflowY: 'auto', overflowX: 'hidden' },
          footer: {
            padding: '12px 24px',
            margin: 0,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          },
        }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          requiredMark={false}
          initialValues={{
            importance: 0.5,
            strength: 5,
            subtlety: 5,
            is_long_term: false,
            auto_remind: true,
            remind_before_chapters: 5,
            include_in_context: true,
          }}
        >
          <div style={{ ...sectionLabelStyle, marginTop: 6 }}>
            基础信息
            <span style={sectionLineStyle} />
          </div>

          <Row gutter={16}>
            <Col xs={24} sm={16}>
              <Form.Item name="title" label="伏笔标题" rules={[{ required: true, message: '请输入标题' }]}>
                <Input placeholder="一句话概括这条伏笔" maxLength={200} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="category" label="分类">
                <Select placeholder="选择分类" allowClear>
                  {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                    <Option key={key} value={key}>{config.label}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="content" label="伏笔内容" rules={[{ required: true, message: '请输入内容' }]}>
            <TextArea rows={3} placeholder="详细描述伏笔埋了什么、后续如何影响剧情" />
          </Form.Item>

          <div style={sectionLabelStyle}>
            章节与人物
            <span style={sectionLineStyle} />
          </div>

          <Row gutter={16}>
            <Col xs={12} sm={6}>
              <Form.Item name="plant_chapter_number" label="计划埋入">
                <InputNumber min={1} placeholder="章节号" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item name="target_resolve_chapter_number" label="计划回收">
                <InputNumber min={1} placeholder="章节号" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="related_characters" label="关联角色">
                <Select
                  mode="multiple"
                  placeholder="选择关联角色"
                  optionFilterProp="children"
                  maxTagCount={2}
                >
                  {characters
                    .filter(char => !char.is_organization)
                    .map(char => (
                      <Option key={char.name} value={char.name}>
                        {char.name} {char.role_type ? `(${char.role_type})` : ''}
                      </Option>
                    ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <div style={sectionLabelStyle}>
            伏笔设计
            <span style={sectionLineStyle} />
          </div>

          <Row gutter={16}>
            <Col xs={12} sm={5}>
              <Form.Item
                name="importance"
                label="重要性"
                extra={<span style={{ fontSize: 11, color: token.colorTextQuaternary }}>0 - 1</span>}
              >
                <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={5}>
              <Form.Item
                name="strength"
                label="强度"
                extra={<span style={{ fontSize: 11, color: token.colorTextQuaternary }}>1 - 10</span>}
              >
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={5}>
              <Form.Item
                name="subtlety"
                label="隐藏度"
                extra={<span style={{ fontSize: 11, color: token.colorTextQuaternary }}>1 - 10</span>}
              >
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={9}>
              <Form.Item name="is_long_term" label="长线伏笔" valuePropName="checked">
                <Switch checkedChildren="是" unCheckedChildren="否" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="hint_text" label="暗示文本">
                <TextArea rows={2} placeholder="正文中用来暗示的描写" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="notes" label="备注">
                <TextArea rows={2} placeholder="仅作者可见的创作备注" />
              </Form.Item>
            </Col>
          </Row>

          <div style={sectionLabelStyle}>
            AI 辅助
            <span style={sectionLineStyle} />
          </div>

          <div style={{
            padding: '12px 16px 2px',
            borderRadius: 10,
            background: token.colorFillQuaternary,
          }}>
            <Row gutter={16}>
              <Col xs={12} sm={8}>
                <Form.Item name="auto_remind" label="自动提醒" valuePropName="checked" style={{ marginBottom: 12 }}>
                  <Switch checkedChildren="开" unCheckedChildren="关" />
                </Form.Item>
              </Col>
              <Col xs={12} sm={8}>
                <Form.Item name="include_in_context" label="写入生成上下文" valuePropName="checked" style={{ marginBottom: 12 }}>
                  <Switch checkedChildren="是" unCheckedChildren="否" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="remind_before_chapters" label="提前几章提醒" style={{ marginBottom: 12 }}>
                  <InputNumber min={1} max={20} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </div>
        </Form>
      </Modal>

      {/* 详情模态框 */}
      <Modal
        open={detailModalVisible}
        centered
        onCancel={() => {
          setDetailModalVisible(false);
          setCurrentForeshadow(null);
        }}
        footer={
          <div style={modalFooterStyle}>
            <Button style={footerButtonStyle} onClick={() => setDetailModalVisible(false)}>
              关闭
            </Button>
            <Button
              type="primary"
              style={footerButtonStyle}
              onClick={() => {
                setDetailModalVisible(false);
                openEditModal(currentForeshadow!);
              }}
            >
              编辑
            </Button>
          </div>
        }
        width={620}
        title={null}
        styles={{
          body: { padding: 0 },
          content: { padding: 0, overflow: 'hidden' },
          footer: {
            padding: '12px 20px',
            margin: 0,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
          },
        }}
        closable={false}
      >
        {currentForeshadow && (() => {
          const statusConfig = STATUS_CONFIG[currentForeshadow.status];
          const urgencyBadge = getUrgencyBadge(currentForeshadow);

          const metaItems = [
            {
              label: '埋入章节',
              value: currentForeshadow.plant_chapter_number
                ? `第 ${currentForeshadow.plant_chapter_number} 章`
                : '未设定',
            },
            {
              label: '计划回收',
              value: currentForeshadow.target_resolve_chapter_number
                ? `第 ${currentForeshadow.target_resolve_chapter_number} 章`
                : '未设定',
            },
            ...(currentForeshadow.actual_resolve_chapter_number
              ? [{ label: '实际回收', value: `第 ${currentForeshadow.actual_resolve_chapter_number} 章` }]
              : []),
            {
              label: '来源',
              value: currentForeshadow.source_type === 'analysis' ? '章节分析提取' : '手动添加',
            },
          ];

          const metricItems = [
            { label: '重要性', value: Math.round(currentForeshadow.importance * 5), max: 5 },
            { label: '强度', value: currentForeshadow.strength, max: 10 },
            { label: '隐藏度', value: currentForeshadow.subtlety, max: 10 },
          ];

          return (
            <div>
              <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 11.5,
                        color: token.colorTextSecondary,
                      }}>
                        <span style={{
                          width: 5,
                          height: 5,
                          borderRadius: 3,
                          background: currentForeshadow.status === 'resolved'
                            ? token.colorInfo
                            : currentForeshadow.status === 'partially_resolved'
                              ? token.colorWarning
                              : currentForeshadow.status === 'planted'
                                ? token.colorSuccess
                                : token.colorTextQuaternary,
                        }} />
                        {statusConfig.label}
                      </span>
                      {currentForeshadow.is_long_term && (
                        <span style={{
                          padding: '0 6px',
                          borderRadius: 4,
                          background: token.colorFillTertiary,
                          color: token.colorTextSecondary,
                          fontSize: 10.5,
                          lineHeight: '17px',
                        }}>
                          长线伏笔
                        </span>
                      )}
                      {currentForeshadow.category && CATEGORY_CONFIG[currentForeshadow.category] && (
                        <span style={{
                          padding: '0 6px',
                          borderRadius: 4,
                          background: token.colorFillTertiary,
                          color: token.colorTextSecondary,
                          fontSize: 10.5,
                          lineHeight: '17px',
                        }}>
                          {CATEGORY_CONFIG[currentForeshadow.category].label}
                        </span>
                      )}
                      {urgencyBadge && <span style={{ fontSize: 11.5 }}>{urgencyBadge}</span>}
                    </div>
                    <h3 style={{
                      margin: 0,
                      fontSize: 17,
                      fontWeight: 600,
                      lineHeight: 1.45,
                      color: token.colorText,
                      wordBreak: 'break-word',
                    }}>
                      {currentForeshadow.title}
                    </h3>
                  </div>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => {
                      setDetailModalVisible(false);
                      setCurrentForeshadow(null);
                    }}
                    aria-label="关闭"
                    style={{ flexShrink: 0, marginTop: -2 }}
                  />
                </div>
              </div>

              <div style={{ padding: '16px 20px 18px', maxHeight: 'min(62vh, 560px)', overflowY: 'auto' }}>
                <div style={{ fontSize: 11.5, color: token.colorTextTertiary, marginBottom: 6 }}>伏笔内容</div>
                <div style={{
                  fontSize: 13.5,
                  lineHeight: 1.8,
                  color: token.colorText,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {currentForeshadow.content || '—'}
                </div>

                {(currentForeshadow.hint_text || currentForeshadow.resolution_text) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
                    {currentForeshadow.hint_text && (
                      <div style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: token.colorFillQuaternary,
                      }}>
                        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 4 }}>暗示文本</div>
                        <div style={{
                          fontSize: 12.5,
                          lineHeight: 1.7,
                          color: token.colorTextSecondary,
                          whiteSpace: 'pre-wrap',
                        }}>
                          {currentForeshadow.hint_text}
                        </div>
                      </div>
                    )}
                    {currentForeshadow.resolution_text && (
                      <div style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: token.colorFillQuaternary,
                      }}>
                        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 4 }}>揭示文本</div>
                        <div style={{
                          fontSize: 12.5,
                          lineHeight: 1.7,
                          color: token.colorTextSecondary,
                          whiteSpace: 'pre-wrap',
                        }}>
                          {currentForeshadow.resolution_text}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div style={{
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: `1px solid ${token.colorBorderSecondary}`,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
                  gap: '12px 14px',
                }}>
                  {metaItems.map((item) => (
                    <div key={item.label} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{item.label}</div>
                      <div style={{
                        marginTop: 2,
                        fontSize: 13,
                        color: token.colorText,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{
                  marginTop: 16,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
                  gap: '12px 14px',
                }}>
                  {metricItems.map((item) => (
                    <div key={item.label} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{item.label}</div>
                      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {item.max === 5 ? (
                          <span style={{ display: 'inline-flex', gap: 1 }}>
                            {Array.from({ length: 5 }).map((_, index) => (
                              <StarFilled
                                key={index}
                                style={{
                                  fontSize: 11,
                                  color: index < item.value ? token.colorWarning : token.colorBorder,
                                }}
                              />
                            ))}
                          </span>
                        ) : (
                          <span style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: token.colorText,
                            fontVariantNumeric: 'tabular-nums',
                          }}>
                            {item.value}
                            <span style={{ fontSize: 11, fontWeight: 400, color: token.colorTextTertiary }}> / 10</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {(currentForeshadow.related_characters?.length ||
                  currentForeshadow.tags?.length ||
                  currentForeshadow.notes) && (
                  <div style={{
                    marginTop: 18,
                    paddingTop: 16,
                    borderTop: `1px solid ${token.colorBorderSecondary}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}>
                    {currentForeshadow.related_characters && currentForeshadow.related_characters.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 5 }}>关联角色</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {currentForeshadow.related_characters.map((name, idx) => (
                            <span
                              key={idx}
                              style={{
                                padding: '1px 8px',
                                borderRadius: 5,
                                background: token.colorFillTertiary,
                                color: token.colorTextSecondary,
                                fontSize: 11.5,
                                lineHeight: '19px',
                              }}
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {currentForeshadow.tags && currentForeshadow.tags.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 5 }}>标签</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {currentForeshadow.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              style={{
                                padding: '1px 8px',
                                borderRadius: 5,
                                background: token.colorFillQuaternary,
                                color: token.colorTextTertiary,
                                fontSize: 11.5,
                                lineHeight: '19px',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {currentForeshadow.notes && (
                      <div>
                        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 4 }}>备注</div>
                        <div style={{
                          fontSize: 12.5,
                          lineHeight: 1.7,
                          color: token.colorTextSecondary,
                          whiteSpace: 'pre-wrap',
                        }}>
                          {currentForeshadow.notes}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* 标记埋入模态框 */}
      <Modal
        title="标记伏笔埋入"
        open={plantModalVisible}
        centered
        onCancel={() => {
          setPlantModalVisible(false);
          setCurrentForeshadow(null);
          plantForm.resetFields();
        }}
        onOk={() => plantForm.submit()}
        okText="确认埋入"
        width={480}
        destroyOnClose
        styles={{
          footer: {
            padding: '12px 24px',
            margin: 0,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          },
        }}
      >
        {currentForeshadow && (
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            margin: '2px 0 16px',
            fontSize: 12,
            color: token.colorTextTertiary,
          }}>
            <span style={{ flexShrink: 0 }}>当前伏笔</span>
            <span style={{
              minWidth: 0,
              fontSize: 13,
              fontWeight: 600,
              color: token.colorText,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {currentForeshadow.title}
            </span>
          </div>
        )}
        <Form form={plantForm} layout="vertical" onFinish={handlePlant} requiredMark={false}>
          <Form.Item
            name="chapter_id"
            label="埋入章节"
            rules={[{ required: true, message: '请选择章节' }]}
            extra="选择这条伏笔实际出现在正文中的章节"
          >
            <Select placeholder="选择章节">
              {chapters.map(chapter => (
                <Option key={chapter.id} value={chapter.id}>
                  第{chapter.chapter_number}章 - {chapter.title}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="hint_text"
            label="暗示文本（可选）"
            extra="记录正文中用来暗示这条伏笔的描写，便于后续回收时对照"
            style={{ marginBottom: 0 }}
          >
            <TextArea rows={3} placeholder="例如：他盯着信封上的邮戳，忽然觉得日期不对" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 标记回收模态框 */}
      <Modal
        title="标记伏笔回收"
        open={resolveModalVisible}
        centered
        onCancel={() => {
          setResolveModalVisible(false);
          setCurrentForeshadow(null);
          resolveForm.resetFields();
        }}
        onOk={() => resolveForm.submit()}
        okText="确认回收"
        width={480}
        destroyOnClose
        styles={{
          footer: {
            padding: '12px 24px',
            margin: 0,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          },
        }}
      >
        <div style={{
          display: 'flex',
          gap: 8,
          margin: '4px 0 16px',
          padding: '10px 12px',
          borderRadius: 8,
          background: token.colorFillQuaternary,
          fontSize: 12,
          lineHeight: 1.65,
          color: token.colorTextTertiary,
        }}>
          <InfoCircleOutlined style={{ marginTop: 2, flexShrink: 0 }} />
          <span>
            回收后，这条伏笔会从「已埋入」变为「已回收」，并记录实际回收章节与揭示内容，供后续创作参考。
          </span>
        </div>

        {currentForeshadow && (
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            margin: '0 0 16px',
            fontSize: 12,
            color: token.colorTextTertiary,
          }}>
            <span style={{ flexShrink: 0 }}>当前伏笔</span>
            <span style={{
              minWidth: 0,
              fontSize: 13,
              fontWeight: 600,
              color: token.colorText,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {currentForeshadow.title}
            </span>
          </div>
        )}

        <Form form={resolveForm} layout="vertical" onFinish={handleResolve} requiredMark={false}>
          <Form.Item
            name="chapter_id"
            label="回收章节"
            rules={[{ required: true, message: '请选择章节' }]}
            extra="选择这条伏笔被揭开或兑现的章节"
          >
            <Select placeholder="选择章节">
              {chapters.map(chapter => (
                <Option key={chapter.id} value={chapter.id}>
                  第{chapter.chapter_number}章 - {chapter.title}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="resolution_text"
            label="揭示文本（可选）"
            extra="写下这条伏笔最终如何被揭晓，便于回看时快速回忆"
          >
            <TextArea rows={3} placeholder="例如：那通电话来自保险公司，中奖信息正是他们泄露的" />
          </Form.Item>
          <Form.Item
            name="is_partial"
            label="部分回收"
            valuePropName="checked"
            extra="开启后状态会标记为「部分回收」，表示这条伏笔还有内容留待后续揭示"
            style={{ marginBottom: 0 }}
          >
            <Switch
              checkedChildren="部分"
              unCheckedChildren="完全"
              style={{ minHeight: 22, minWidth: 44, height: 22 }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 同步模态框 */}
      <Modal
        title="手动同步分析伏笔"
        open={syncModalVisible}
        centered
        onCancel={() => setSyncModalVisible(false)}
        onOk={handleSync}
        confirmLoading={syncing}
        okText="开始同步"
      >
        <Alert
          message="提示"
          description="通常情况下，章节分析完成后伏笔会自动同步到伏笔管理中。此功能用于手动补充同步可能遗漏的伏笔。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <p>此操作将从已完成的章节分析结果中提取伏笔信息，同步到伏笔管理表。</p>
        <ul>
          <li>已存在的伏笔记录不会被覆盖</li>
          <li>新同步的伏笔将自动设置为"已埋入"状态</li>
          <li>同步完成后可在列表中查看和编辑</li>
        </ul>
      </Modal>
    </div>
  );
}
