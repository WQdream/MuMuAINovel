import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { adminInviteApi } from '../../services/api';
import type {
  InviteCodeItem,
  InviteCodeSummary,
} from '../../types';
import './AdminInvites.css';

type InviteStatus = 'all' | 'unused' | 'used' | 'disabled';

interface CreateInviteValues {
  count: number;
  note?: string;
}

const emptySummary: InviteCodeSummary = {
  total: 0,
  unused: 0,
  used: 0,
  disabled: 0,
};

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
  });
};

const copyText = async (value: string, successText: string) => {
  try {
    await navigator.clipboard.writeText(value);
    message.success(successText);
  } catch {
    message.error('复制失败，请手动选择文本复制');
  }
};

export default function AdminInvites() {
  const [items, setItems] = useState<InviteCodeItem[]>([]);
  const [summary, setSummary] = useState<InviteCodeSummary>(emptySummary);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<InviteStatus>('all');
  const [keyword, setKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [generatedOpen, setGeneratedOpen] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [form] = Form.useForm<CreateInviteValues>();

  const loadInvites = useCallback(
    async (
      nextPage: number,
      nextPageSize: number,
      nextStatus: InviteStatus,
      nextKeyword: string,
    ) => {
      setLoading(true);
      try {
        const result = await adminInviteApi.list({
          page: nextPage,
          limit: nextPageSize,
          status: nextStatus,
          q: nextKeyword.trim() || undefined,
        });
        setItems(result.items || []);
        setTotal(result.total || 0);
        setSummary(result.summary || emptySummary);
      } catch (error) {
        console.error('加载邀请码失败:', error);
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadInvites(1, 20, 'all', '');
  }, [loadInvites]);

  const firstKeywordSearch = useRef(true);
  useEffect(() => {
    if (firstKeywordSearch.current) {
      firstKeywordSearch.current = false;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setPage(1);
      void loadInvites(1, pageSize, status, keyword);
    }, 320);
    return () => window.clearTimeout(timer);
    // 筛选器变化由各自的事件立即加载，这里只处理输入防抖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const reload = (nextPage = page, nextPageSize = pageSize) => {
    void loadInvites(nextPage, nextPageSize, status, keyword);
  };

  const handleCreate = async (values: CreateInviteValues) => {
    setCreating(true);
    try {
      const created = await adminInviteApi.create({
        count: values.count,
        note: values.note?.trim() || undefined,
      });
      const codes = created.map((item) => item.code);
      setCreateOpen(false);
      form.resetFields();
      setGeneratedCodes(codes);
      setGeneratedOpen(true);
      message.success(`已创建 ${codes.length} 个邀请码`);
      setPage(1);
      await loadInvites(1, pageSize, status, keyword);
    } catch (error) {
      console.error('创建邀请码失败:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleDisabled = async (invite: InviteCodeItem) => {
    setActionId(invite.id);
    try {
      await adminInviteApi.toggleStatus(invite.id, !invite.is_disabled);
      message.success(invite.is_disabled ? '邀请码已启用' : '邀请码已禁用');
      await loadInvites(page, pageSize, status, keyword);
    } catch (error) {
      console.error('更新邀请码状态失败:', error);
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (invite: InviteCodeItem) => {
    setActionId(invite.id);
    try {
      await adminInviteApi.remove(invite.id);
      message.success('邀请码已删除，不能再用于注册');
      const nextPage = items.length === 1 && page > 1 ? page - 1 : page;
      setPage(nextPage);
      await loadInvites(nextPage, pageSize, status, keyword);
    } catch (error) {
      console.error('删除邀请码失败:', error);
    } finally {
      setActionId(null);
    }
  };

  const columns: ColumnsType<InviteCodeItem> = [
    {
      title: '邀请码',
      dataIndex: 'code',
      key: 'code',
      width: 190,
      render: (value: string, record) => (
        <div className="invite-code-cell">
          <span className={`invite-code${record.is_disabled ? ' invite-code--disabled' : ''}`}>
            {value}
          </span>
          <Button
            type="text"
            size="small"
            className="invite-code-copy"
            icon={<CopyOutlined />}
            aria-label={`复制邀请码 ${value}`}
            onClick={() => void copyText(value, '邀请码已复制')}
          />
        </div>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_, record) => {
        if (record.is_disabled) {
          return (
            <span className="adm-tag adm-tag--danger">
              <span className="adm-tag-dot" />
              已禁用
            </span>
          );
        }
        return (
          <span className={`adm-tag${record.is_used ? '' : ' adm-tag--ok'}`}>
            <span className="adm-tag-dot" />
            {record.is_used ? '已使用' : '未使用'}
          </span>
        );
      },
    },
    {
      title: '使用用户',
      dataIndex: 'used_by_username',
      key: 'used_by_username',
      width: 150,
      render: (value: string | null | undefined, record) => (
        value ? (
          <div className="adm-cell-stack">
            <span className="adm-cell-strong">{value}</span>
            <span
              className="adm-cell-mono invite-user-id"
              title={record.used_by_user_id || undefined}
            >
              {record.used_by_user_id}
            </span>
          </div>
        ) : (
          <span className="adm-cell-muted">尚未使用</span>
        )
      ),
    },
    {
      title: '使用时间',
      dataIndex: 'used_at',
      key: 'used_at',
      width: 145,
      responsive: ['lg'],
      render: (value?: string | null) => (
        <span className="adm-cell-muted" style={{ whiteSpace: 'nowrap' }}>
          {formatDate(value)}
        </span>
      ),
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      responsive: ['md'],
      render: (value?: string | null) => value || <span className="adm-cell-muted">-</span>,
    },
    {
      title: '创建信息',
      key: 'created',
      width: 155,
      responsive: ['xl'],
      render: (_, record) => (
        <div className="adm-cell-stack">
          <span className="adm-cell-muted">{record.created_by_username || record.created_by_user_id}</span>
          <span className="adm-cell-sub">{formatDate(record.created_at)}</span>
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 136,
      align: 'right',
      render: (_, record) => (
        <Space size={2} className="invite-row-actions">
          {!record.is_used && (
            <Popconfirm
              title={record.is_disabled ? '启用这个邀请码？' : '禁用这个邀请码？'}
              description={record.is_disabled
                ? '启用后可以继续用于注册。'
                : '禁用后该邀请码将立即无法用于注册。'}
              okText={record.is_disabled ? '启用' : '禁用'}
              cancelText="取消"
              onConfirm={() => void handleToggleDisabled(record)}
            >
              <Button
                type="text"
                size="small"
                danger={!record.is_disabled}
                loading={actionId === record.id}
                icon={record.is_disabled ? <CheckCircleOutlined /> : <StopOutlined />}
              >
                {record.is_disabled ? '启用' : '禁用'}
              </Button>
            </Popconfirm>
          )}
          <Popconfirm
            title="永久删除这个邀请码？"
            description="删除后邀请码立即失效；已注册用户不会受到影响。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleDelete(record)}
          >
            <Button
              type="text"
              size="small"
              danger
              loading={actionId === record.id}
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="adm-page">
      <header className="adm-page-head invite-page-head">
        <div className="adm-page-head-main">
          <h2 className="adm-page-title">邀请码管理</h2>
          <p className="adm-page-desc">
            创建一次性注册邀请码，并追踪核销状态、使用账号与使用时间。每个邀请码注册成功后立即失效。
          </p>
        </div>
        <div className="adm-page-actions">
          <Button size="small" icon={<ReloadOutlined />} onClick={() => reload()}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            创建邀请码
          </Button>
        </div>
      </header>

      <div className="adm-panel">
        <div className="adm-toolbar">
          <Space wrap size={8}>
            <Select<InviteStatus>
              className="adm-filter"
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
                void loadInvites(1, pageSize, value, keyword);
              }}
              options={[
                { value: 'all', label: '全部邀请码' },
                { value: 'unused', label: '仅未使用' },
                { value: 'used', label: '仅已使用' },
                { value: 'disabled', label: '仅已禁用' },
              ]}
            />
            <Input
              allowClear
              className="adm-filter adm-filter--search"
              placeholder="搜索邀请码、备注或使用账号"
              prefix={<SearchOutlined className="adm-search-icon" />}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </Space>
          <div className="invite-compact-stats" aria-label="邀请码统计">
            <span className="invite-stat"><strong>{summary.unused}</strong> 可用</span>
            <span className="invite-stat"><strong>{summary.used}</strong> 已用</span>
            <span className="invite-stat"><strong>{summary.disabled}</strong> 已禁用</span>
            <span className="invite-filter-count">筛选 {total}</span>
          </div>
        </div>

        <Table<InviteCodeItem>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={items}
          className="adm-table"
          tableLayout="fixed"
          locale={{
            emptyText: (
              <Empty
                image={<KeyOutlined className="adm-empty-icon" />}
                imageStyle={{ height: 44 }}
                description="还没有符合条件的邀请码"
              />
            ),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            showTotal: undefined,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
              void loadInvites(nextPage, nextPageSize, status, keyword);
            },
          }}
        />
      </div>

      <Modal
        title="创建邀请码"
        open={createOpen}
        onCancel={() => {
          if (creating) return;
          setCreateOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        centered
      >
        <Form<CreateInviteValues>
          form={form}
          layout="vertical"
          initialValues={{ count: 1 }}
          onFinish={handleCreate}
          style={{ marginTop: 18 }}
        >
          <Form.Item
            name="count"
            label="生成数量"
            rules={[{ required: true, message: '请输入生成数量' }]}
          >
            <InputNumber min={1} max={50} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input
              maxLength={200}
              showCount
              placeholder="选填，例如：十月邀请批次"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`已生成 ${generatedCodes.length} 个邀请码`}
        open={generatedOpen}
        onCancel={() => setGeneratedOpen(false)}
        centered
        width={560}
        footer={[
          <Button
            key="copy-all"
            icon={<CopyOutlined />}
            onClick={() => void copyText(generatedCodes.join('\n'), '全部邀请码已复制')}
          >
            复制全部
          </Button>,
          <Button key="close" type="primary" onClick={() => setGeneratedOpen(false)}>
            完成
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          message="请及时保存"
          description="邀请码可以随时在列表中再次复制，但请仅通过可信渠道发送。"
          style={{ marginBottom: 14 }}
        />
        <div className="invite-generated-list">
          {generatedCodes.map((code) => (
            <div className="invite-generated-item" key={code}>
              <span className="invite-code">{code}</span>
              <Button
                type="text"
                size="small"
                className="invite-generated-copy"
                icon={<CopyOutlined />}
                onClick={() => void copyText(code, '邀请码已复制')}
              >
                复制
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
