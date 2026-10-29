import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import {
  Input,
  Select,
  Button,
  Space,
  Empty,
  Spin,
  Modal,
  Drawer,
  Form,
  message,
  Tooltip,
  Badge,
  Tabs,
  Pagination,
  Alert,
  theme,
} from 'antd';
import type { AxiosError } from 'axios';
import {
  SearchOutlined,
  DownloadOutlined,
  HeartOutlined,
  HeartFilled,
  CloudUploadOutlined,
  UserOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  DeleteOutlined,
  CloudOutlined,
  DisconnectOutlined,
  SettingOutlined,
  PlusOutlined,
  CloseOutlined,
  InfoCircleOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { promptWorkshopApi, authApi } from '../services/api';
import type {
  PromptWorkshopItem,
  PromptSubmission,
  PromptSubmissionCreate,
  User,
} from '../types';
import { PROMPT_CATEGORIES } from '../types';
import './PromptWorkshop.css';

const { TextArea } = Input;

export default function PromptWorkshop() {
  const [items, setItems] = useState<PromptWorkshopItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(12);
  
  // 筛选条件
  const [category, setCategory] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'popular' | 'downloads'>('newest');
  
  // 服务状态
  const [serviceStatus, setServiceStatus] = useState<{
    mode: string;
    instance_id: string;
    cloud_connected?: boolean;
  } | null>(null);
  
  // 提交相关
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitForm] = Form.useForm();
  
  // 我的提交
  const [mySubmissions, setMySubmissions] = useState<PromptSubmission[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  
  // 详情弹窗
  const [detailItem, setDetailItem] = useState<PromptWorkshopItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  
  // 导入状态
  const [importingId, setImportingId] = useState<string | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<{
    item: PromptWorkshopItem;
    existingName: string;
  } | null>(null);
  const [duplicateActionLoading, setDuplicateActionLoading] = useState(false);
  
  // 当前用户
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // 管理员审核相关
  const [adminSubmissions, setAdminSubmissions] = useState<PromptSubmission[]>([]);
  const [adminSubmissionsLoading, setAdminSubmissionsLoading] = useState(false);
  const [adminPendingCount, setAdminPendingCount] = useState(0);
  const [adminStats, setAdminStats] = useState<{
    total_items: number;
    total_official: number;
    total_pending: number;
    total_downloads: number;
    total_likes: number;
  } | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewingSubmission, setReviewingSubmission] = useState<PromptSubmission | null>(null);
  const [reviewForm] = Form.useForm();
  const [reviewLoading, setReviewLoading] = useState(false);
  const [addOfficialModalOpen, setAddOfficialModalOpen] = useState(false);
  const [addOfficialForm] = Form.useForm();
  const [addOfficialLoading, setAddOfficialLoading] = useState(false);
  
  // 已发布提示词管理
  const [publishedItems, setPublishedItems] = useState<PromptWorkshopItem[]>([]);
  const [publishedLoading, setPublishedLoading] = useState(false);
  const [editingItem, setEditingItem] = useState<PromptWorkshopItem | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [editLoading, setEditLoading] = useState(false);
  
  // 当前活动的 Tab
  const [activeTab, setActiveTab] = useState<string>('browse');
  
  const isMobile = window.innerWidth <= 768;
  const { token } = theme.useToken();
  const themeVars = {
    '--pw-text': token.colorText,
    '--pw-secondary': token.colorTextSecondary,
    '--pw-tertiary': token.colorTextTertiary,
    '--pw-border': token.colorBorderSecondary,
    '--pw-fill': token.colorFillQuaternary,
    '--pw-card-bg': token.colorBgContainer,
  } as CSSProperties;
  
  // 判断是否为服务端管理员
  const isServerAdmin = serviceStatus?.mode === 'server' && currentUser?.is_admin;

  // 加载服务状态和用户信息
  useEffect(() => {
    const init = async () => {
      try {
        const [status, user] = await Promise.all([
          promptWorkshopApi.getStatus(),
          authApi.getCurrentUser().catch(() => null),
        ]);
        setServiceStatus(status);
        setCurrentUser(user);
      } catch (error) {
        console.error('Failed to initialize:', error);
      }
    };
    init();
  }, []);

  // 加载工坊列表
  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const response = await promptWorkshopApi.getItems({
        category: category || undefined,
        search: searchKeyword || undefined,
        sort: sortBy,
        page: currentPage,
        limit: pageSize,
      });
      setItems(response.data?.items || []);
      setTotal(response.data?.total || 0);
    } catch (error) {
      console.error('Failed to load workshop items:', error);
      message.error('加载灵感模板失败');
    } finally {
      setLoading(false);
    }
  }, [category, searchKeyword, sortBy, currentPage, pageSize]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // 加载我的提交
  const loadMySubmissions = async () => {
    setSubmissionsLoading(true);
    try {
      const response = await promptWorkshopApi.getMySubmissions();
      setMySubmissions(response.data?.items || []);
    } catch (error) {
      console.error('Failed to load submissions:', error);
    } finally {
      setSubmissionsLoading(false);
    }
  };

  // 导入到本地（已存在相同提示词时交给用户选择）
  const runImport = async (
    item: PromptWorkshopItem,
    duplicateAction?: 'overwrite' | 'copy'
  ) => {
    setImportingId(item.id);
    try {
      const response = await promptWorkshopApi.importItem(item.id, {
        duplicateAction,
        skipErrorToast: true,
      });
      message.success(
        response.overwritten
          ? `已用「${item.name}」覆盖现有写作风格`
          : `已导入「${item.name}」到本地写作风格`
      );
      setDuplicateConflict(null);
      // 刷新列表更新下载计数
      loadItems();
      return true;
    } catch (error) {
      const detail = (error as AxiosError<{ detail?: { code?: string; message?: string; existing_style?: { name?: string } } }>)
        .response?.data?.detail;
      if (detail?.code === 'STYLE_ALREADY_EXISTS') {
        setDuplicateConflict({
          item,
          existingName: detail.existing_style?.name || item.name,
        });
        return false;
      }
      console.error('Failed to import item:', error);
      message.error('导入失败');
      return false;
    } finally {
      setImportingId(null);
    }
  };

  const handleImport = async (item: PromptWorkshopItem) => {
    await runImport(item);
  };

  const handleDuplicateAction = async (action: 'overwrite' | 'copy') => {
    if (!duplicateConflict) return;
    setDuplicateActionLoading(true);
    try {
      await runImport(duplicateConflict.item, action);
    } finally {
      setDuplicateActionLoading(false);
    }
  };

  // 点赞
  const handleLike = async (item: PromptWorkshopItem) => {
    try {
      const response = await promptWorkshopApi.toggleLike(item.id);
      // 更新本地状态
      setItems(prev => prev.map(i => 
        i.id === item.id 
          ? { ...i, is_liked: response.liked, like_count: response.like_count }
          : i
      ));
    } catch (error) {
      console.error('Failed to toggle like:', error);
      message.error('操作失败');
    }
  };

  // 提交新提示词
  const handleSubmit = async (values: PromptSubmissionCreate) => {
    setSubmitLoading(true);
    try {
      await promptWorkshopApi.submit({
        ...values,
        tags: values.tags ? (values.tags as unknown as string).split(',').map((t: string) => t.trim()).filter(Boolean) : [],
      });
      message.success('提交成功，等待管理员审核');
      setIsSubmitModalOpen(false);
      submitForm.resetFields();
      loadMySubmissions();
      // 如果是服务端管理员，刷新待审核列表
      if (isServerAdmin) {
        loadAdminSubmissions();
      }
    } catch (error) {
      console.error('Failed to submit:', error);
      message.error('提交失败');
    } finally {
      setSubmitLoading(false);
    }
  };

  // 撤回提交（pending状态）
  const handleWithdraw = async (submissionId: string) => {
    try {
      await promptWorkshopApi.withdrawSubmission(submissionId);
      message.success('已撤回');
      loadMySubmissions();
      // 如果是服务端管理员，刷新待审核列表
      if (isServerAdmin) {
        loadAdminSubmissions();
      }
    } catch (error) {
      console.error('Failed to withdraw:', error);
      message.error('撤回失败');
    }
  };

  // 删除提交记录（已审核状态）
  const handleDeleteSubmission = async (submission: PromptSubmission) => {
    Modal.confirm({
      title: '删除提交记录',
      content: `确定要删除「${submission.name}」的提交记录吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        try {
          await promptWorkshopApi.deleteSubmission(submission.id);
          message.success('删除成功');
          loadMySubmissions();
          // 如果是服务端管理员，刷新相关列表
          if (isServerAdmin) {
            loadAdminSubmissions();
          }
        } catch (error) {
          console.error('Failed to delete submission:', error);
          message.error('删除失败');
        }
      },
    });
  };

  // 查看详情
  const handleViewDetail = async (item: PromptWorkshopItem) => {
    try {
      const response = await promptWorkshopApi.getItem(item.id);
      setDetailItem(response.data);
      setIsDetailModalOpen(true);
    } catch (error) {
      console.error('Failed to load detail:', error);
      message.error('加载详情失败');
    }
  };

  // 分类仅用一个小圆点区分，避免彩色标签堆叠。
  const getCategoryDot = (cat: string) => {
    const colors: Record<string, string> = {
      general: '#8C8C84',
      fantasy: '#8B7CF6',
      martial: '#D08A3E',
      romance: '#DD7C9B',
      scifi: '#3FA0B5',
      horror: '#C25B57',
      history: '#B08D57',
      urban: '#4E9A6A',
      game: '#B266C4',
      other: '#8C8C84',
    };
    return colors[cat] || colors.other;
  };

  // 获取分类名称
  const getCategoryName = (cat: string) => {
    return PROMPT_CATEGORIES[cat] || cat;
  };
  
  // 获取分类选项列表
  const categoryOptions = Object.entries(PROMPT_CATEGORIES).map(([value, label]) => ({
    value,
    label,
  }));

  // 提交状态：小圆点 + 文案，与其他页保持同一套视觉。
  const getStatusTag = (status: string) => {
    const config: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
      pending: { color: token.colorWarning, icon: <ClockCircleOutlined />, text: '待审核' },
      approved: { color: token.colorSuccess, icon: <CheckCircleOutlined />, text: '已通过' },
      rejected: { color: token.colorError, icon: <CloseCircleOutlined />, text: '已拒绝' },
    };
    const cfg = config[status] || config.pending;
    return (
      <span className="pw-status" style={{ color: cfg.color }}>
        {cfg.icon}
        {cfg.text}
      </span>
    );
  };

  // 渲染筛选区域（固定在顶部）
  const renderFilterBar = () => (
    <div className="pw-filter-wrap">
      {/* 服务状态 */}
      {serviceStatus && !serviceStatus.cloud_connected && serviceStatus.mode === 'client' && (
        <Alert
          type="warning"
          message="云端服务未连接"
          description="无法访问灵感模板库，请检查网络连接或稍后重试"
          icon={<DisconnectOutlined />}
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      <div className="pw-filter">
        <Input
          className="pw-search"
          placeholder="搜索提示词"
          prefix={<SearchOutlined />}
          value={searchKeyword}
          onChange={e => setSearchKeyword(e.target.value)}
          onPressEnter={() => { setCurrentPage(1); loadItems(); }}
          style={{ width: isMobile ? '100%' : 240 }}
          allowClear
        />
        <div className="pw-filter-group">
          <Select
            placeholder="全部分类"
            value={category || undefined}
            onChange={v => { setCategory(v || ''); setCurrentPage(1); }}
            style={{ width: isMobile ? '100%' : 140 }}
            allowClear
          >
            {categoryOptions.map(cat => (
              <Select.Option key={cat.value} value={cat.value}>{cat.label}</Select.Option>
            ))}
          </Select>
          <Select
            value={sortBy}
            onChange={v => { setSortBy(v); setCurrentPage(1); }}
            style={{ width: isMobile ? '100%' : 124 }}
          >
            <Select.Option value="newest">最新发布</Select.Option>
            <Select.Option value="popular">最受欢迎</Select.Option>
            <Select.Option value="downloads">下载最多</Select.Option>
          </Select>
          <Tooltip title="刷新列表">
            <Button
              icon={<SyncOutlined />}
              aria-label="刷新列表"
              onClick={() => { setCurrentPage(1); loadItems(); }}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );

  // 渲染工坊列表（只有卡片部分，用于滚动区域）
  const renderWorkshopList = () => (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="pw-scroll">
        <Spin spinning={loading}>
          {items.length === 0 ? (
            <div className="pw-empty">
              <Empty description="暂无提示词" />
            </div>
          ) : (
            <div className="pw-grid">
              {items.map(item => (
                <article
                  className={`pw-card${item.is_official ? ' pw-card--official' : ''}`}
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看 ${item.name} 详情`}
                  onClick={() => handleViewDetail(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleViewDetail(item);
                    }
                  }}
                >
                  <div className="pw-card-head">
                    <span className="pw-card-name" title={item.name}>{item.name}</span>
                    {item.is_official && <span className="pw-official">官方</span>}
                  </div>

                  <div className="pw-card-meta">
                    <span
                      className="pw-dot"
                      style={{ background: getCategoryDot(item.category) }}
                    />
                    {getCategoryName(item.category)}
                    {item.tags && item.tags.length > 0 && (
                      <span className="pw-card-tags">
                        {item.tags.slice(0, 2).map(tag => (
                          <span key={tag}>· {tag}</span>
                        ))}
                        {item.tags.length > 2 && <span>· +{item.tags.length - 2}</span>}
                      </span>
                    )}
                  </div>

                  <p className={`pw-card-desc${item.description ? '' : ' pw-card-desc--empty'}`}>
                    {item.description || '暂无简介'}
                  </p>

                  <p className="pw-card-prompt">{item.prompt_content}</p>

                  <div
                    className="pw-card-foot"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="pw-card-author">
                      <UserOutlined />
                      {item.author_name || '匿名'}
                    </span>
                    <div className="pw-card-actions">
                      <button
                        type="button"
                        className={`pw-action${item.is_liked ? ' pw-action--liked' : ''}`}
                        onClick={() => handleLike(item)}
                        aria-label={item.is_liked ? '取消点赞' : '点赞'}
                      >
                        {item.is_liked ? <HeartFilled /> : <HeartOutlined />}
                        {item.like_count || 0}
                      </button>
                      <Tooltip title="导入到我的写作风格">
                        <Button
                          size="small"
                          type="text"
                          className="pw-import"
                          icon={<DownloadOutlined />}
                          loading={importingId === item.id}
                          onClick={() => handleImport(item)}
                        >
                          {item.download_count || 0}
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Spin>
      </div>

      {total > 0 && (
        <div
          className="pw-pagination"
          style={{
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
          }}
        >
          <Pagination
            current={currentPage}
            total={total}
            pageSize={pageSize}
            onChange={page => setCurrentPage(page)}
            showSizeChanger={false}
            showTotal={t => `共 ${t} 个提示词`}
          />
        </div>
      )}
    </div>
  );

  // 渲染我的提交
  const renderMySubmissions = () => (
    <div className="pw-section">
      <div className="pw-section-head">
        <span className="pw-section-hint">提交后需管理员审核，通过后才会出现在工坊。</span>
        <Button type="text" size="small" icon={<SyncOutlined />} onClick={loadMySubmissions}>
          刷新
        </Button>
      </div>

      <Spin spinning={submissionsLoading}>
        {mySubmissions.length === 0 ? (
          <div className="pw-empty">
            <Empty description="暂无提交记录" />
          </div>
        ) : (
          <div className="pw-list">
            {mySubmissions.map(sub => (
              <article className="pw-row" key={sub.id}>
                <div className="pw-row-main">
                  <div className="pw-row-title">
                    <span className="pw-card-name">{sub.name}</span>
                    {getStatusTag(sub.status)}
                    <span className="pw-row-cat">
                      <span
                        className="pw-dot"
                        style={{ background: getCategoryDot(sub.category) }}
                      />
                      {getCategoryName(sub.category)}
                    </span>
                  </div>
                  <p className="pw-row-desc">
                    {sub.description || sub.prompt_content || '暂无简介'}
                  </p>
                  {sub.status === 'rejected' && sub.review_note && (
                    <p className="pw-row-note">审核意见：{sub.review_note}</p>
                  )}
                </div>
                <div className="pw-row-side">
                  <span className="pw-row-date">
                    {sub.created_at ? new Date(sub.created_at).toLocaleDateString() : '-'}
                  </span>
                  {sub.status === 'pending' ? (
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleWithdraw(sub.id)}
                    >
                      撤回
                    </Button>
                  ) : (
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteSubmission(sub)}
                    >
                      删除
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Spin>
    </div>
  );

  // 加载管理员待审核列表
  const loadAdminSubmissions = async () => {
    if (!isServerAdmin) return;
    
    setAdminSubmissionsLoading(true);
    try {
      const [subsResponse, statsResponse] = await Promise.all([
        promptWorkshopApi.adminGetSubmissions({ status: 'pending', limit: 50 }),
        promptWorkshopApi.adminGetStats(),
      ]);
      setAdminSubmissions(subsResponse.data?.items || []);
      setAdminPendingCount(subsResponse.data?.pending_count || 0);
      setAdminStats(statsResponse.data || null);
    } catch (error) {
      console.error('Failed to load admin submissions:', error);
    } finally {
      setAdminSubmissionsLoading(false);
    }
  };

  // 加载已发布的提示词列表（管理员用）
  const loadPublishedItems = async () => {
    if (!isServerAdmin) return;
    
    setPublishedLoading(true);
    try {
      const response = await promptWorkshopApi.getItems({ limit: 100 });
      setPublishedItems(response.data?.items || []);
    } catch (error) {
      console.error('Failed to load published items:', error);
    } finally {
      setPublishedLoading(false);
    }
  };

  // 删除已发布的提示词
  const handleDeleteItem = async (item: PromptWorkshopItem) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除「${item.name}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        try {
          await promptWorkshopApi.adminDeleteItem(item.id);
          message.success('删除成功');
          loadPublishedItems();
          loadAdminSubmissions();
          loadItems();
        } catch (error) {
          console.error('Failed to delete item:', error);
          message.error('删除失败');
        }
      },
    });
  };

  // 编辑已发布的提示词
  const handleEditItem = async (values: { name: string; category: string; description?: string; prompt_content: string; tags?: string }) => {
    if (!editingItem) return;
    
    setEditLoading(true);
    try {
      await promptWorkshopApi.adminUpdateItem(editingItem.id, {
        ...values,
        tags: values.tags ? values.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      });
      message.success('修改成功');
      setEditModalOpen(false);
      setEditingItem(null);
      editForm.resetFields();
      loadPublishedItems();
      loadItems();
    } catch (error) {
      console.error('Failed to update item:', error);
      message.error('修改失败');
    } finally {
      setEditLoading(false);
    }
  };

  // 打开编辑弹窗
  const openEditModal = (item: PromptWorkshopItem) => {
    setEditingItem(item);
    editForm.setFieldsValue({
      name: item.name,
      category: item.category,
      description: item.description,
      prompt_content: item.prompt_content,
      tags: item.tags?.join(', '),
    });
    setEditModalOpen(true);
  };

  // 审核提交
  const openReview = (sub: PromptSubmission) => {
    setReviewingSubmission(sub);
    reviewForm.setFieldsValue({
      category: sub.category,
      tags: sub.tags?.join(', '),
    });
    setReviewModalOpen(true);
  };

  const handleReview = async (action: 'approve' | 'reject') => {
    if (!reviewingSubmission) return;
    
    setReviewLoading(true);
    try {
      const values = reviewForm.getFieldsValue();
      await promptWorkshopApi.adminReviewSubmission(reviewingSubmission.id, {
        action,
        review_note: values.review_note,
        category: values.category,
        tags: values.tags ? values.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : undefined,
      });
      message.success(action === 'approve' ? '已通过审核' : '已拒绝');
      setReviewModalOpen(false);
      setReviewingSubmission(null);
      reviewForm.resetFields();
      // 刷新所有相关数据
      loadAdminSubmissions();
      loadItems();
      loadPublishedItems();  // 通过时会新增到已发布列表
    } catch (error) {
      console.error('Failed to review:', error);
      message.error('审核失败');
    } finally {
      setReviewLoading(false);
    }
  };

  // 添加官方提示词
  const handleAddOfficial = async (values: { name: string; category: string; description?: string; prompt_content: string; tags?: string }) => {
    setAddOfficialLoading(true);
    try {
      await promptWorkshopApi.adminCreateItem({
        ...values,
        tags: values.tags ? values.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      });
      message.success('添加成功');
      setAddOfficialModalOpen(false);
      addOfficialForm.resetFields();
      loadItems();
      loadAdminSubmissions();
      loadPublishedItems();
    } catch (error) {
      console.error('Failed to add official item:', error);
      message.error('添加失败');
    } finally {
      setAddOfficialLoading(false);
    }
  };

  // 渲染管理员面板
  const renderAdminPanel = () => (
    <div className="pw-section">
      {/* 统计数据 */}
      {adminStats && (
        <div className="pw-overview">
          <div className="pw-overview-stats">
            {[
              { label: '总提示词', value: adminStats.total_items },
              { label: '官方', value: adminStats.total_official },
              { label: '待审核', value: adminStats.total_pending, warn: true },
              { label: '下载', value: adminStats.total_downloads },
              { label: '点赞', value: adminStats.total_likes },
            ].map(stat => (
              <div
                key={stat.label}
                className="pw-overview-stat"
              >
                <span className="pw-overview-label">{stat.label}</span>
                <span
                  className="pw-overview-value"
                  style={{ color: stat.warn ? token.colorWarning : token.colorText }}
                >
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAddOfficialModalOpen(true)}
          >
            添加官方提示词
          </Button>
        </div>
      )}

      <div className="pw-admin-columns">
        {/* 待审核列表 */}
        <section className="pw-panel">
          <div className="pw-panel-head">
            <span className="pw-panel-title">
              待审核
              <span className={`pw-count${adminPendingCount > 0 ? ' pw-count--warn' : ''}`}>
                {adminPendingCount}
              </span>
            </span>
            <Tooltip title="刷新待审核列表">
              <Button
                type="text"
                size="small"
                icon={<SyncOutlined />}
                aria-label="刷新待审核列表"
                onClick={loadAdminSubmissions}
              />
            </Tooltip>
          </div>

          <div className="pw-panel-body">
            <Spin spinning={adminSubmissionsLoading}>
              {adminSubmissions.length === 0 ? (
                <div className="pw-panel-empty">
                  <InboxOutlined className="pw-panel-empty-icon" />
                  <span>暂无待审核投稿</span>
                </div>
              ) : (
                <div className="pw-panel-list">
                  {adminSubmissions.map(sub => (
                    <article
                      className="pw-panel-item pw-panel-item--clickable"
                      key={sub.id}
                      onClick={() => openReview(sub)}
                    >
                      <div className="pw-panel-item-main">
                        <div className="pw-panel-item-title">
                          <span className="pw-card-name">{sub.name}</span>
                          <span className="pw-row-cat">
                            <span
                              className="pw-dot"
                              style={{ background: getCategoryDot(sub.category) }}
                            />
                            {getCategoryName(sub.category)}
                          </span>
                        </div>
                        <p className="pw-panel-item-desc">{sub.description || sub.prompt_content || '暂无简介'}</p>
                        <p className="pw-panel-item-meta">
                          <span>{sub.submitter_name || '未知投稿者'}</span>
                          <span>{sub.created_at ? new Date(sub.created_at).toLocaleDateString() : '-'}</span>
                        </p>
                      </div>
                      <Button
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          openReview(sub);
                        }}
                      >
                        审核
                      </Button>
                    </article>
                  ))}
                </div>
              )}
            </Spin>
          </div>
        </section>

        {/* 已发布提示词管理 */}
        <section className="pw-panel">
          <div className="pw-panel-head">
            <span className="pw-panel-title">
              已发布
              <span className="pw-count">{publishedItems.length}</span>
            </span>
            <Tooltip title="刷新已发布列表">
              <Button
                type="text"
                size="small"
                icon={<SyncOutlined />}
                aria-label="刷新已发布列表"
                onClick={loadPublishedItems}
              />
            </Tooltip>
          </div>

          <div className="pw-panel-body">
            <Spin spinning={publishedLoading}>
              {publishedItems.length === 0 ? (
                <div className="pw-panel-empty">
                  <InboxOutlined className="pw-panel-empty-icon" />
                  <span>还没有发布任何提示词</span>
                </div>
              ) : (
                <div className="pw-panel-list">
                  {publishedItems.map(item => (
                    <article className="pw-panel-item" key={item.id}>
                      <div className="pw-panel-item-main">
                        <div className="pw-panel-item-title">
                          <span className="pw-card-name">{item.name}</span>
                          {item.is_official && <span className="pw-official">官方</span>}
                          <span className="pw-row-cat">
                            <span
                              className="pw-dot"
                              style={{ background: getCategoryDot(item.category) }}
                            />
                            {getCategoryName(item.category)}
                          </span>
                        </div>
                        <p className="pw-panel-item-desc">{item.description || item.prompt_content}</p>
                        <p className="pw-panel-item-meta">
                          <span><HeartOutlined /> {item.like_count || 0}</span>
                          <span><DownloadOutlined /> {item.download_count || 0}</span>
                          {!item.is_official && (
                            <span>{item.author_name || '匿名'}</span>
                          )}
                        </p>
                      </div>
                      <div className="pw-panel-item-actions">
                        <Tooltip title="编辑">
                          <Button
                            type="text"
                            size="small"
                            aria-label="编辑提示词"
                            icon={<SettingOutlined />}
                            onClick={() => openEditModal(item)}
                          />
                        </Tooltip>
                        <Tooltip title="删除">
                          <Button
                            type="text"
                            size="small"
                            aria-label="删除提示词"
                            icon={<DeleteOutlined />}
                            onClick={() => handleDeleteItem(item)}
                          />
                        </Tooltip>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Spin>
          </div>
        </section>
      </div>
    </div>
  );

  return (
    <div
      className="prompt-workshop-page"
      style={themeVars}
    >
      {/* 固定区域：标题 + Tabs切换栏 + 筛选栏 */}
      <div className="pw-fixed">
        {/* 标题和操作区 */}
        <div className="pw-header">
          <div className="pw-header-main">
            <CloudOutlined style={{ fontSize: 20, color: token.colorTextSecondary, marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <h2 className="pw-title">灵感模板</h2>
              <p className="pw-subtitle">
                浏览社区分享的提示词，一键导入为你的写作风格。
              </p>
            </div>
          </div>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={() => setIsSubmitModalOpen(true)}
          >
            分享提示词
          </Button>
        </div>

        {/* Tabs 切换栏（不含内容） */}
        <div className="pw-tabs-row">
          <Tabs
            className="pw-tabs"
            activeKey={activeTab}
            onChange={key => {
              setActiveTab(key);
              if (key === 'submissions') loadMySubmissions();
              if (key === 'admin') {
                loadAdminSubmissions();
                loadPublishedItems();
              }
            }}
            items={[
              { key: 'browse', label: '浏览工坊' },
              {
                key: 'submissions',
                label: (
                  <Badge count={mySubmissions.filter(s => s.status === 'pending').length} size="small" offset={[8, -2]}>
                    我的提交
                  </Badge>
                ),
              },
              ...(isServerAdmin ? [{
                key: 'admin',
                label: (
                  <Badge count={adminPendingCount} size="small" offset={[8, -2]}>
                    <span>管理审核</span>
                  </Badge>
                ),
              }] : []),
            ]}
          />
          {serviceStatus?.mode === 'server' && (
            <span className="pw-server-mode">
              <span className="pw-server-dot" />
              服务端模式
            </span>
          )}
        </div>

        {/* 筛选栏（仅在浏览工坊时显示） */}
        {activeTab === 'browse' && renderFilterBar()}
      </div>

      {/* 内容区域：浏览工坊内部固定分页，其他 Tab 保持自身滚动 */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {activeTab === 'browse' && renderWorkshopList()}
        {activeTab === 'submissions' && (
          <div style={{ height: '100%', overflowY: 'auto' }}>{renderMySubmissions()}</div>
        )}
        {activeTab === 'admin' && (
          <div style={{ height: '100%', overflowY: 'auto' }}>{renderAdminPanel()}</div>
        )}
      </div>

      {/* 分享抽屉 */}
      <Drawer
        title={null}
        open={isSubmitModalOpen}
        onClose={() => {
          setIsSubmitModalOpen(false);
          submitForm.resetFields();
        }}
        closable={false}
        width={isMobile ? '100%' : 560}
        className="pw-drawer"
        style={themeVars}
        styles={{ body: { padding: 0 } }}
        footer={(
          <div className="pw-drawer-foot">
            <Button onClick={() => {
              setIsSubmitModalOpen(false);
              submitForm.resetFields();
            }}>
              取消
            </Button>
            <Button type="primary" loading={submitLoading} onClick={() => submitForm.submit()}>
              提交审核
            </Button>
          </div>
        )}
      >
        <div className="pw-drawer-head">
          <div className="pw-drawer-head-main">
            <span className="pw-drawer-title">分享提示词</span>
            <span className="pw-drawer-subtitle">提交后由管理员审核，通过后展示在工坊。</span>
          </div>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            aria-label="关闭分享"
            onClick={() => {
              setIsSubmitModalOpen(false);
              submitForm.resetFields();
            }}
            style={{ flexShrink: 0, color: token.colorTextTertiary }}
          />
        </div>

        <div className="pw-drawer-note">
          <InfoCircleOutlined style={{ color: token.colorTextTertiary, marginTop: 3 }} />
          <span>请确保内容原创且不含敏感信息，审核通过后作者署名会公开显示。</span>
        </div>

        <Form
          form={submitForm}
          layout="vertical"
          onFinish={handleSubmit}
          className="pw-form"
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="给提示词起个名字" maxLength={50} showCount />
          </Form.Item>

          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select placeholder="选择分类">
              {categoryOptions.map(cat => (
                <Select.Option key={cat.value} value={cat.value}>{cat.label}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="description" label="描述">
            <TextArea
              rows={2}
              placeholder="一句话说明用途，例如：适合节奏紧凑的都市悬疑对话"
              maxLength={200}
              showCount
            />
          </Form.Item>

          <Form.Item
            name="prompt_content"
            label="提示词内容"
            rules={[{ required: true, message: '请输入提示词内容' }]}
          >
            <TextArea
              className="pw-prompt-input"
              rows={12}
              placeholder="粘贴完整的提示词内容..."
            />
          </Form.Item>

          <Form.Item
            name="author_display_name"
            label="作者署名"
            rules={[{ required: true, message: '请输入作者署名' }]}
            extra="审核通过后公开展示"
          >
            <Input placeholder="你的笔名" maxLength={50} />
          </Form.Item>

          <Form.Item name="tags" label="标签">
            <Input placeholder="逗号分隔，如：武侠, 对话, 细腻" />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 详情抽屉 */}
      <Drawer
        title={null}
        open={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setDetailItem(null);
        }}
        closable={false}
        width={isMobile ? '100%' : 560}
        className="pw-drawer pw-detail-drawer"
        style={themeVars}
        styles={{ body: { padding: 0 } }}
        footer={detailItem ? (
          <div className="pw-drawer-foot">
            <Button
              className="pw-detail-like"
              icon={detailItem.is_liked ? <HeartFilled /> : <HeartOutlined />}
              onClick={() => {
                handleLike(detailItem);
                setDetailItem(prev => prev ? {
                  ...prev,
                  is_liked: !prev.is_liked,
                  like_count: (prev.like_count || 0) + (prev.is_liked ? -1 : 1),
                } : prev);
              }}
            >
              {detailItem.like_count || 0}
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={importingId === detailItem.id}
              onClick={() => handleImport(detailItem)}
            >
              导入到本地
            </Button>
          </div>
        ) : null}
      >
        {detailItem && (
          <div className="pw-detail">
            <div className="pw-detail-head">
              <div className="pw-detail-head-main">
                <div className="pw-detail-title-row">
                  <span className="pw-detail-title">{detailItem.name}</span>
                  {detailItem.is_official && <span className="pw-official">官方</span>}
                </div>
                <div className="pw-detail-meta">
                  <span
                    className="pw-dot"
                    style={{ background: getCategoryDot(detailItem.category) }}
                  />
                  {getCategoryName(detailItem.category)}
                  <span className="pw-detail-divider">·</span>
                  <UserOutlined />
                  {detailItem.author_name || '匿名'}
                  <span className="pw-detail-divider">·</span>
                  <DownloadOutlined />
                  {detailItem.download_count || 0}
                </div>
              </div>
              <Button
                type="text"
                size="small"
                aria-label="关闭详情"
                icon={<CloseOutlined />}
                onClick={() => {
                  setIsDetailModalOpen(false);
                  setDetailItem(null);
                }}
                style={{ flexShrink: 0, color: token.colorTextTertiary }}
              />
            </div>

            <div className="pw-detail-body">
              {detailItem.description && (
                <p className="pw-detail-desc">{detailItem.description}</p>
              )}

              {detailItem.tags && detailItem.tags.length > 0 && (
                <div className="pw-detail-tags">
                  {detailItem.tags.map(tag => (
                    <span key={tag} className="pw-chip">{tag}</span>
                  ))}
                </div>
              )}

              <section>
                <div className="pw-detail-label">提示词内容</div>
                <div className="pw-detail-prompt">{detailItem.prompt_content}</div>
              </section>
            </div>
          </div>
        )}
      </Drawer>
      {/* 审核抽屉 */}
      <Drawer
        title={null}
        open={reviewModalOpen}
        onClose={() => {
          setReviewModalOpen(false);
          setReviewingSubmission(null);
          reviewForm.resetFields();
        }}
        closable={false}
        width={isMobile ? '100%' : 620}
        className="pw-drawer pw-review-drawer"
        style={themeVars}
        styles={{ body: { padding: 0 } }}
        footer={(
          <div className="pw-drawer-foot pw-review-foot">
            <Button
              onClick={() => {
                setReviewModalOpen(false);
                setReviewingSubmission(null);
                reviewForm.resetFields();
              }}
            >
              取消
            </Button>
            <div className="pw-review-foot-right">
              <Button danger loading={reviewLoading} onClick={() => handleReview('reject')}>
                拒绝
              </Button>
              <Button type="primary" loading={reviewLoading} onClick={() => handleReview('approve')}>
                通过
              </Button>
            </div>
          </div>
        )}
      >
        <div className="pw-drawer-head pw-review-head">
          <div className="pw-drawer-head-main">
            <span className="pw-drawer-title">{reviewingSubmission?.name || '审核投稿'}</span>
            <span className="pw-drawer-subtitle">
              {reviewingSubmission?.submitter_name || '未知投稿者'}
              {reviewingSubmission?.created_at
                ? ` · ${new Date(reviewingSubmission.created_at).toLocaleDateString()}`
                : ''}
            </span>
          </div>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            aria-label="关闭审核"
            onClick={() => {
              setReviewModalOpen(false);
              setReviewingSubmission(null);
              reviewForm.resetFields();
            }}
            style={{ flexShrink: 0, color: token.colorTextTertiary }}
          />
        </div>

        {reviewingSubmission && (
          <>
            <div className="pw-review-meta">
              <span className="pw-row-cat">
                <span
                  className="pw-dot"
                  style={{ background: getCategoryDot(reviewingSubmission.category) }}
                />
                {getCategoryName(reviewingSubmission.category)}
              </span>
              {reviewingSubmission.tags?.length ? (
                <span className="pw-review-tags">
                  {reviewingSubmission.tags.map(tag => (
                    <span className="pw-chip" key={tag}>{tag}</span>
                  ))}
                </span>
              ) : null}
            </div>

            {reviewingSubmission.description && (
              <p className="pw-review-desc">{reviewingSubmission.description}</p>
            )}

            <div className="pw-review-block">
              <div className="pw-review-label">提示词内容</div>
              <div className="pw-review-prompt">{reviewingSubmission.prompt_content}</div>
            </div>

            <Form form={reviewForm} layout="vertical" className="pw-form pw-form--flush">
              <div className="pw-review-form-row">
                <Form.Item name="category" label="分类">
                  <Select>
                    {categoryOptions.map(cat => (
                      <Select.Option key={cat.value} value={cat.value}>{cat.label}</Select.Option>
                    ))}
                  </Select>
                </Form.Item>

                <Form.Item name="tags" label="标签" extra="逗号分隔">
                  <Input placeholder="武侠, 对话, 细腻" />
                </Form.Item>
              </div>

              <Form.Item name="review_note" label="审核备注" extra="拒绝时建议填写原因，会展示给投稿者">
                <TextArea rows={2} placeholder="例如：内容与现有提示词重复" />
              </Form.Item>
            </Form>
          </>
        )}
      </Drawer>

      {/* 添加官方提示词抽屉 */}
      <Drawer
        title={null}
        open={addOfficialModalOpen}
        onClose={() => {
          setAddOfficialModalOpen(false);
          addOfficialForm.resetFields();
        }}
        closable={false}
        width={isMobile ? '100%' : 560}
        className="pw-drawer"
        style={themeVars}
        styles={{ body: { padding: 0 } }}
        footer={(
          <div className="pw-drawer-foot">
            <Button onClick={() => {
              setAddOfficialModalOpen(false);
              addOfficialForm.resetFields();
            }}>
              取消
            </Button>
            <Button type="primary" loading={addOfficialLoading} onClick={() => addOfficialForm.submit()}>
              添加
            </Button>
          </div>
        )}
      >
        <div className="pw-drawer-head">
          <div className="pw-drawer-head-main">
            <span className="pw-drawer-title">添加官方提示词</span>
            <span className="pw-drawer-subtitle">官方条目直接发布到工坊，所有用户可见。</span>
          </div>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            aria-label="关闭添加"
            onClick={() => {
              setAddOfficialModalOpen(false);
              addOfficialForm.resetFields();
            }}
            style={{ flexShrink: 0, color: token.colorTextTertiary }}
          />
        </div>

        <div className="pw-drawer-note">
          <InfoCircleOutlined style={{ color: token.colorTextTertiary, marginTop: 3 }} />
          <span>官方提示词无需审核，保存后立即出现在工坊列表并标记为「官方」。</span>
        </div>

        <Form
          form={addOfficialForm}
          layout="vertical"
          onFinish={handleAddOfficial}
          className="pw-form"
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="给提示词起个名字" maxLength={50} showCount />
          </Form.Item>

          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select placeholder="选择分类">
              {categoryOptions.map(cat => (
                <Select.Option key={cat.value} value={cat.value}>{cat.label}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="description" label="描述">
            <TextArea
              rows={2}
              placeholder="一句话说明用途，例如：适合节奏紧凑的都市悬疑对话"
              maxLength={200}
              showCount
            />
          </Form.Item>

          <Form.Item
            name="prompt_content"
            label="提示词内容"
            rules={[{ required: true, message: '请输入提示词内容' }]}
          >
            <TextArea
              className="pw-prompt-input"
              rows={12}
              placeholder="粘贴完整的提示词内容..."
            />
          </Form.Item>

          <Form.Item name="tags" label="标签" extra="逗号分隔，用于筛选与检索">
            <Input placeholder="如：武侠, 对话, 细腻" />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 重复导入处理 */}
      <Modal
        open={Boolean(duplicateConflict)}
        onCancel={() => {
          if (duplicateActionLoading) return;
          setDuplicateConflict(null);
        }}
        footer={null}
        width={420}
        centered
        title="写作风格中已有相同提示词"
      >
        <p className="pw-duplicate-desc">
          {duplicateConflict && duplicateConflict.existingName === duplicateConflict.item.name
            ? `「${duplicateConflict.item.name}」已经在你的写作风格中，内容完全一致，无需重复导入。`
            : `写作风格「${duplicateConflict?.existingName}」与「${duplicateConflict?.item.name}」的提示词内容完全一致，无需重复导入。`}
        </p>
        <p className="pw-duplicate-hint">你仍可以覆盖现有风格，或另建一份副本。</p>
        <div className="pw-duplicate-actions">
          <Button onClick={() => setDuplicateConflict(null)} disabled={duplicateActionLoading}>
            保留现有
          </Button>
          <Button
            loading={duplicateActionLoading}
            onClick={() => handleDuplicateAction('copy')}
          >
            另建副本
          </Button>
          <Button
            type="primary"
            danger
            loading={duplicateActionLoading}
            onClick={() => handleDuplicateAction('overwrite')}
          >
            覆盖现有
          </Button>
        </div>
      </Modal>

      {/* 编辑提示词弹窗 */}
      <Modal
        title={`编辑: ${editingItem?.name}`}
        open={editModalOpen}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingItem(null);
          editForm.resetFields();
        }}
        footer={null}
        width={600}
        centered
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={handleEditItem}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="提示词名称" maxLength={50} />
          </Form.Item>
          
          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select placeholder="选择分类">
              {categoryOptions.map(cat => (
                <Select.Option key={cat.value} value={cat.value}>{cat.label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="简要描述" maxLength={200} />
          </Form.Item>
          
          <Form.Item
            name="prompt_content"
            label="提示词内容"
            rules={[{ required: true, message: '请输入提示词内容' }]}
          >
            <TextArea rows={8} placeholder="输入完整的提示词内容..." />
          </Form.Item>
          
          <Form.Item name="tags" label="标签">
            <Input placeholder="逗号分隔，如: 武侠,对话,细腻" />
          </Form.Item>
          
          <Form.Item>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => {
                setEditModalOpen(false);
                setEditingItem(null);
                editForm.resetFields();
              }}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={editLoading}>
                保存修改
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
