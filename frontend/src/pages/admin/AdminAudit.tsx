import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, Input, Select, Space, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HistoryOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { adminApi, adminReviewApi } from '../../services/api';
import type { AdminAccessLogItem, User } from '../../types';

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export default function AdminAudit() {
  const [logs, setLogs] = useState<AdminAccessLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [adminFilter, setAdminFilter] = useState<string | undefined>();
  const [targetFilter, setTargetFilter] = useState<string | undefined>();
  const [projectFilter, setProjectFilter] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      const result = await adminApi.getUsers();
      setUsers(result.users || []);
    } catch (error) {
      console.error('加载用户列表失败:', error);
    }
  }, []);

  const loadLogs = useCallback(
    async (
      nextPage: number,
      nextPageSize: number,
      filters: { adminId?: string; targetUserId?: string; projectKeyword?: string },
    ) => {
      setLoading(true);
      try {
        const result = await adminReviewApi.listAuditLogs({
          page: nextPage,
          limit: nextPageSize,
          admin_id: filters.adminId,
          target_user_id: filters.targetUserId,
          project_q: filters.projectKeyword?.trim() || undefined,
        });
        setLogs(result.items || []);
        setTotal(result.total || 0);
      } catch (error) {
        console.error('加载审计日志失败:', error);
        message.error('加载审计日志失败');
        setLogs([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadUsers();
    void loadLogs(1, 20, {});
  }, [loadUsers, loadLogs]);

  // 项目关键词防抖，避免逐字触发请求；首屏由上面的 effect 负责
  const firstProjectSearch = useRef(true);
  useEffect(() => {
    if (firstProjectSearch.current) {
      firstProjectSearch.current = false;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setPage(1);
      void loadLogs(1, pageSize, {
        adminId: adminFilter,
        targetUserId: targetFilter,
        projectKeyword: projectFilter,
      });
    }, 320);
    return () => window.clearTimeout(timer);
    // 只在关键词变化时触发；其他筛选条件由各自的 onChange 立即请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter]);

  const reload = (nextPage = page, nextPageSize = pageSize) => {
    void loadLogs(nextPage, nextPageSize, {
      adminId: adminFilter,
      targetUserId: targetFilter,
      projectKeyword: projectFilter,
    });
  };

  const userOptions = users.map((user) => ({
    value: user.user_id,
    label: user.display_name || user.username,
  }));

  const columns: ColumnsType<AdminAccessLogItem> = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (value?: string) => (
        <span className="adm-cell-muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(value)}</span>
      ),
    },
    {
      title: '管理员',
      dataIndex: 'admin_name',
      key: 'admin_name',
      width: 150,
      render: (value: string | null, record) => (
        <span className="adm-cell-strong">{value || record.admin_id}</span>
      ),
    },
    {
      title: '查阅对象',
      dataIndex: 'target_username',
      key: 'target_username',
      width: 150,
      render: (value: string | null, record) => value || record.target_user_id,
    },
    {
      title: '项目',
      dataIndex: 'project_title',
      key: 'project_title',
      render: (value: string | null, record) => (
        <div className="adm-cell-stack">
          <span className="adm-cell-strong">{value || '（项目已删除）'}</span>
          <span className="adm-cell-mono">{record.project_id}</span>
        </div>
      ),
    },
    {
      title: '动作',
      dataIndex: 'action',
      key: 'action',
      width: 110,
      render: (value: string) => (
        <span className="adm-tag">
          {value === 'view_project' ? '查阅项目' : value}
        </span>
      ),
    },
    {
      title: '来源 IP',
      dataIndex: 'ip',
      key: 'ip',
      width: 140,
      render: (value?: string | null) => <span className="adm-cell-muted">{value || '-'}</span>,
    },
  ];

  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div className="adm-page-head-main">
          <h2 className="adm-page-title">访问审计</h2>
          <p className="adm-page-desc">
            记录管理员查阅用户作品的项目级动作，便于事后追溯。同一管理员 60 秒内重复打开同一项目只记一条。
          </p>
        </div>
        <div className="adm-page-actions">
        <Button size="small" icon={<ReloadOutlined />} onClick={() => reload()}>
          刷新
        </Button>
        </div>
      </header>

      <div className="adm-panel">
        <div className="adm-toolbar">
          <Space wrap size={8}>
            <Select
              allowClear
              className="adm-filter"
              placeholder="按管理员筛选"
              value={adminFilter}
              onChange={(value) => {
                setAdminFilter(value);
                setPage(1);
                void loadLogs(1, pageSize, {
                  adminId: value,
                  targetUserId: targetFilter,
                  projectKeyword: projectFilter,
                });
              }}
              options={userOptions}
            />
            <Select
              allowClear
              className="adm-filter"
              placeholder="按查阅对象筛选"
              value={targetFilter}
              onChange={(value) => {
                setTargetFilter(value);
                setPage(1);
                void loadLogs(1, pageSize, {
                  adminId: adminFilter,
                  targetUserId: value,
                  projectKeyword: projectFilter,
                });
              }}
              options={userOptions}
            />
            <Input
              allowClear
              className="adm-filter adm-filter--search"
              placeholder="按项目标题或 ID 搜索"
              prefix={<SearchOutlined className="adm-search-icon" />}
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            />
          </Space>
          <span className="adm-count">共 {total} 条记录</span>
        </div>

        <Table<AdminAccessLogItem>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={logs}
          className="adm-table"
          locale={{
            emptyText: (
              <Empty
                image={<HistoryOutlined className="adm-empty-icon" />}
                imageStyle={{ height: 44 }}
                description="还没有审阅记录"
              />
            ),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            // 总数已在工具条展示，这里不再重复
            showTotal: undefined,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
              reload(nextPage, nextSize);
            },
          }}
        />
      </div>
    </div>
  );
}
