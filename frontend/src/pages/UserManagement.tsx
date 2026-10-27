import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Switch,
  Space,
  Tag,
  Popconfirm,
  message,
  Card,
  Typography,
  Badge,
  InputNumber,
  Row,
  Col,
  Pagination,
  Dropdown,
  theme,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  KeyOutlined,
  StopOutlined,
  CheckCircleOutlined,
  ArrowLeftOutlined,
  TeamOutlined,
  UserOutlined,
  SearchOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { adminApi } from '../services/api';
import type { User } from '../types';
import UserMenu from '../components/UserMenu';

const { Title, Text } = Typography;

interface UserWithStatus extends User {
  is_active?: boolean;
}

type SortField =
  | 'username'
  | 'display_name'
  | 'is_active'
  | 'is_admin'
  | 'trust_level'
  | 'created_at'
  | 'last_login';

type SortOrder = 'ascend' | 'descend' | null;

interface UserManagementProps {
  /** 嵌入管理后台外壳时使用：不再占满整屏，也不重复提供返回/账号入口。 */
  embedded?: boolean;
}

export default function UserManagement({ embedded = false }: UserManagementProps) {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserWithStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [resetPasswordModalVisible, setResetPasswordModalVisible] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserWithStatus | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [sortField, setSortField] = useState<SortField | null>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('descend');

  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [modal, contextHolder] = Modal.useModal();
  const { token } = theme.useToken();
  const alphaColor = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

  // 过滤用户列表
  const filteredUsers = users.filter(user => {
    if (!searchText) return true;
    const searchLower = searchText.toLowerCase();
    return (
      user.username?.toLowerCase().includes(searchLower) ||
      user.display_name?.toLowerCase().includes(searchLower) ||
      user.user_id?.toLowerCase().includes(searchLower)
    );
  });

  // 排序后的用户列表
  const sortedUsers = useMemo(() => {
    if (!sortField || !sortOrder) {
      return filteredUsers;
    }

    const compareValues = (
      a: string | number | boolean | null | undefined,
      b: string | number | boolean | null | undefined
    ) => {
      // 空值始终置底
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;

      if (typeof a === 'string' && typeof b === 'string') {
        return a.localeCompare(b, 'zh-CN');
      }

      if (typeof a === 'boolean' && typeof b === 'boolean') {
        return Number(a) - Number(b);
      }

      return Number(a) - Number(b);
    };

    const getSortValue = (user: UserWithStatus) => {
      switch (sortField) {
        case 'username':
          return user.username ?? null;
        case 'display_name':
          return user.display_name ?? null;
        case 'is_active':
          return user.is_active !== false;
        case 'is_admin':
          return user.is_admin;
        case 'trust_level':
          return user.trust_level ?? null;
        case 'created_at':
          return user.created_at ? new Date(user.created_at).getTime() : null;
        case 'last_login':
          return user.last_login ? new Date(user.last_login).getTime() : null;
        default:
          return null;
      }
    };

    const sorted = [...filteredUsers].sort((a, b) => {
      const result = compareValues(getSortValue(a), getSortValue(b));
      return sortOrder === 'ascend' ? result : -result;
    });

    return sorted;
  }, [filteredUsers, sortField, sortOrder]);

  // 加载用户列表
  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getUsers();
      setUsers(res.users);
    } catch (error) {
      console.error('加载用户列表失败:', error);
      message.error('加载用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // 添加用户
  interface CreateUserValues {
    username: string;
    display_name: string;
    password?: string;
    avatar_url?: string;
    trust_level?: number;
    is_admin?: boolean;
  }

  const handleCreate = async (values: CreateUserValues) => {
    try {
      const res = await adminApi.createUser(values);
      message.success('用户创建成功');

      // 如果有默认密码，显示给管理员
      if (res.default_password) {
        modal.info({
          title: '用户创建成功',
          content: (
            <div>
              <p>用户名：<Text strong>{values.username}</Text></p>
              <p>初始密码：<Text strong copyable>{res.default_password}</Text></p>
              <p style={{ color: token.colorError, marginTop: 16 }}>
                ⚠️ 请复制密码并告知用户，此密码仅显示一次！
              </p>
            </div>
          ),
          width: 500,
          centered: true,
        });
      }

      setModalVisible(false);
      form.resetFields();
      loadUsers();
    } catch (error) {
      console.error('创建用户失败:', error);
      message.error('创建用户失败');
    }
  };

  // 编辑用户
  const handleEdit = (user: UserWithStatus) => {
    setCurrentUser(user);
    editForm.setFieldsValue({
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      trust_level: user.trust_level,
      is_admin: user.is_admin,
    });
    setEditModalVisible(true);
  };

  interface UpdateUserValues {
    display_name: string;
    avatar_url?: string;
    trust_level?: number;
    is_admin?: boolean;
  }

  const handleUpdate = async (values: UpdateUserValues) => {
    if (!currentUser) return;

    try {
      await adminApi.updateUser(currentUser.user_id, values);
      message.success('用户信息更新成功');
      setEditModalVisible(false);
      editForm.resetFields();
      loadUsers();
    } catch (error) {
      console.error('更新用户失败:', error);
      message.error('更新用户失败');
    }
  };

  // 切换用户状态
  const handleToggleStatus = async (user: UserWithStatus) => {
    const isActive = user.is_active !== false;
    const action = isActive ? '禁用' : '启用';

    try {
      await adminApi.toggleUserStatus(user.user_id, !isActive);
      message.success(`用户已${action}`);
      loadUsers();
    } catch (error) {
      console.error(`${action}用户失败:`, error);
      message.error(`${action}用户失败`);
    }
  };

  // 重置密码
  const handleResetPassword = (user: UserWithStatus) => {
    setCurrentUser(user);
    setNewPassword('');
    setResetPasswordModalVisible(true);
  };

  const handleResetPasswordConfirm = async () => {
    if (!currentUser) return;

    try {
      const res = await adminApi.resetPassword(
        currentUser.user_id,
        newPassword || undefined
      );

      modal.info({
        title: '密码重置成功',
        content: (
          <div>
            <p>用户：<Text strong>{currentUser.username}</Text></p>
            <p>新密码：<Text strong copyable>{res.new_password}</Text></p>
            <p style={{ color: token.colorError, marginTop: 16 }}>
              ⚠️ 请复制密码并告知用户！
            </p>
          </div>
        ),
        width: 500,
        centered: true,
      });

      setResetPasswordModalVisible(false);
      setNewPassword('');
    } catch (error) {
      console.error('重置密码失败:', error);
      message.error('重置密码失败');
    }
  };

  // 删除用户
  const handleDelete = async (user: UserWithStatus) => {
    try {
      await adminApi.deleteUser(user.user_id);
      message.success('用户已删除');
      loadUsers();
    } catch (error) {
      console.error('删除用户失败:', error);
      message.error('删除用户失败');
    }
  };

  const isMobile = window.innerWidth <= 768;

  // 嵌入管理后台时统一使用 .adm-* 类，避免与外壳的暖灰语言冲突
  const renderUser = (text: string) =>
    embedded ? (
      <span className="adm-cell-strong">{text}</span>
    ) : (
      <Space>
        <UserOutlined style={{ color: token.colorPrimary }} />
        <Text strong>{text}</Text>
      </Space>
    );

  const renderDisplayName = (text: string) =>
    embedded ? <span>{text}</span> : text;

  const renderStatus = (isActive: boolean) =>
    embedded ? (
      <span className={`adm-tag ${isActive !== false ? 'adm-tag--ok' : 'adm-tag--danger'}`}>
        <span className="adm-tag-dot" />
        {isActive !== false ? '正常' : '已禁用'}
      </span>
    ) : (
      <Badge
        status={isActive !== false ? 'success' : 'error'}
        text={isActive !== false ? '正常' : '已禁用'}
      />
    );

  const renderRole = (isAdmin: boolean) =>
    embedded ? (
      <span className={`adm-tag${isAdmin ? ' adm-tag--warn' : ''}`}>
        {isAdmin ? '管理员' : '普通用户'}
      </span>
    ) : (
      <Tag color={isAdmin ? 'gold' : 'blue'}>
        {isAdmin ? '👑 管理员' : '普通用户'}
      </Tag>
    );

  const renderTrustLevel = (level: number) =>
    embedded ? (
      <span className={`adm-tag${level >= 5 ? ' adm-tag--ok' : ''}${level === -1 ? ' adm-tag--danger' : ''}`}>
        {level === -1 ? '已禁用' : `Level ${level}`}
      </span>
    ) : (
      <Tag color={level === -1 ? 'default' : level >= 5 ? 'green' : 'blue'}>
        {level === -1 ? '已禁用' : `Level ${level}`}
      </Tag>
    );

  const formatDateTime = (date: string, emptyText = '-') =>
    date ? new Date(date).toLocaleString('zh-CN') : emptyText;

  // 表格列定义
  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: embedded ? 180 : 150,
      sorter: true,
      sortOrder: sortField === 'username' ? sortOrder : null,
      render: renderUser,
    },
    {
      title: '显示名称',
      dataIndex: 'display_name',
      key: 'display_name',
      width: 150,
      sorter: true,
      sortOrder: sortField === 'display_name' ? sortOrder : null,
      render: renderDisplayName,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      sorter: true,
      sortOrder: sortField === 'is_active' ? sortOrder : null,
      render: renderStatus,
    },
    {
      title: '角色',
      dataIndex: 'is_admin',
      key: 'is_admin',
      width: 100,
      sorter: true,
      sortOrder: sortField === 'is_admin' ? sortOrder : null,
      render: renderRole,
    },
    {
      title: '信任等级',
      dataIndex: 'trust_level',
      key: 'trust_level',
      width: 100,
      sorter: true,
      sortOrder: sortField === 'trust_level' ? sortOrder : null,
      render: renderTrustLevel,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: embedded ? 150 : 180,
      sorter: true,
      sortOrder: sortField === 'created_at' ? sortOrder : null,
      render: (date: string) =>
        embedded ? (
          <span className="adm-cell-muted" style={{ whiteSpace: 'nowrap' }}>
            {formatDateTime(date)}
          </span>
        ) : (
          formatDateTime(date)
        ),
    },
    {
      title: '最后登录',
      dataIndex: 'last_login',
      key: 'last_login',
      width: embedded ? 150 : 180,
      sorter: true,
      sortOrder: sortField === 'last_login' ? sortOrder : null,
      render: (date: string) =>
        embedded ? (
          <span className="adm-cell-muted" style={{ whiteSpace: 'nowrap' }}>
            {formatDateTime(date, '从未登录')}
          </span>
        ) : (
          formatDateTime(date, '从未登录')
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: isMobile ? 80 : 300,
      fixed: 'right' as const,
      render: (_: unknown, record: UserWithStatus) => {
        const isActive = record.is_active !== false;

        // 移动端：使用下拉菜单
        if (isMobile) {
          const menuItems = [
            {
              key: 'edit',
              label: '编辑用户',
              icon: <EditOutlined />,
              onClick: () => handleEdit(record),
            },
            {
              key: 'reset',
              label: '重置密码',
              icon: <KeyOutlined />,
              onClick: () => handleResetPassword(record),
            },
            {
              key: 'toggle',
              label: isActive ? '禁用用户' : '启用用户',
              icon: isActive ? <StopOutlined /> : <CheckCircleOutlined />,
              danger: isActive,
              onClick: () => {
                modal.confirm({
                  title: `确定${isActive ? '禁用' : '启用'}该用户吗？`,
                  onOk: () => handleToggleStatus(record),
                  okText: '确定',
                  cancelText: '取消',
                });
              },
            },
            ...(!record.is_admin ? [{
              key: 'delete',
              label: '删除用户',
              icon: <DeleteOutlined />,
              danger: true,
              onClick: () => {
                modal.confirm({
                  title: '确定删除该用户吗？此操作不可恢复！',
                  onOk: () => handleDelete(record),
                  okText: '确定',
                  cancelText: '取消',
                  okButtonProps: { danger: true },
                });
              },
            }] : []),
          ];

          return (
            <Dropdown menu={{ items: menuItems }} trigger={['click']}>
              <Button type="text" icon={<MoreOutlined />} />
            </Dropdown>
          );
        }

        // 桌面端：嵌入管理后台时用克制的文字按钮，独立页保留链接按钮
        if (embedded) {
          return (
            <Space size={4}>
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
                编辑
              </Button>
              <Button type="text" size="small" icon={<KeyOutlined />} onClick={() => handleResetPassword(record)}>
                重置密码
              </Button>
              <Popconfirm
                title={`确定${isActive ? '禁用' : '启用'}该用户吗？`}
                onConfirm={() => handleToggleStatus(record)}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  type="text"
                  size="small"
                  danger={isActive}
                  icon={isActive ? <StopOutlined /> : <CheckCircleOutlined />}
                >
                  {isActive ? '禁用' : '启用'}
                </Button>
              </Popconfirm>
              {!record.is_admin && (
                <Popconfirm
                  title="确定删除该用户吗？此操作不可恢复！"
                  onConfirm={() => handleDelete(record)}
                  okText="确定"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              )}
            </Space>
          );
        }

        return (
          <Space size="small">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            >
              编辑
            </Button>

            <Button
              type="link"
              size="small"
              icon={<KeyOutlined />}
              onClick={() => handleResetPassword(record)}
            >
              重置密码
            </Button>

            <Popconfirm
              title={`确定${isActive ? '禁用' : '启用'}该用户吗？`}
              onConfirm={() => handleToggleStatus(record)}
              okText="确定"
              cancelText="取消"
            >
              <Button
                type="link"
                size="small"
                danger={isActive}
                icon={isActive ? <StopOutlined /> : <CheckCircleOutlined />}
              >
                {isActive ? '禁用' : '启用'}
              </Button>
            </Popconfirm>

            {!record.is_admin && (
              <Popconfirm
                title="确定删除该用户吗？此操作不可恢复！"
                onConfirm={() => handleDelete(record)}
                okText="确定"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                >
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  // 嵌入式（管理后台内）使用与外壳一致的页头 + 面板；独立路由保留原有渐变头。
  const embeddedHeader = (
    <header className="adm-page-head">
      <div className="adm-page-head-main">
        <h2 className="adm-page-title">用户管理</h2>
        <p className="adm-page-desc">
          维护平台账号、角色与信任等级；禁用后该用户无法继续登录。
        </p>
      </div>
      <div className="adm-page-actions">
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => setModalVisible(true)}
        >
          添加用户
        </Button>
      </div>
    </header>
  );

  return (
    <div
      style={
        embedded
          ? { width: '100%', maxWidth: 1180, margin: '0 auto', padding: '22px 24px 56px' }
          : {
              height: '100vh',
              background: `linear-gradient(180deg, ${token.colorBgLayout} 0%, ${alphaColor(token.colorPrimary, 0.08)} 100%)`,
              padding: isMobile ? '20px 16px' : '40px 24px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }
      }
    >
      {contextHolder}
      {embedded && embeddedHeader}
      <div style={{
        maxWidth: embedded ? undefined : 1400,
        margin: '0 auto',
        width: '100%',
        flex: embedded ? undefined : 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* 独立路由下保留原有渐变头；嵌入管理后台时由 embeddedHeader 取代 */}
        {!embedded && (
        <Card
          variant="borderless"
          style={{
            background: `linear-gradient(135deg, ${token.colorPrimary} 0%, ${alphaColor(token.colorPrimary, 0.8)} 50%, ${token.colorPrimaryHover} 100%)`,
            borderRadius: isMobile ? 16 : 24,
            boxShadow: `0 12px 40px ${alphaColor(token.colorPrimary, 0.25)}, 0 4px 12px ${alphaColor(token.colorText, 0.08)}`,
            marginBottom: isMobile ? 20 : 24,
            border: 'none',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {/* 装饰性背景元素 */}
          <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: alphaColor(token.colorWhite, 0.08), pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: -40, left: '30%', width: 120, height: 120, borderRadius: '50%', background: alphaColor(token.colorWhite, 0.05), pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: '50%', right: '15%', width: 80, height: 80, borderRadius: '50%', background: alphaColor(token.colorWhite, 0.06), pointerEvents: 'none' }} />

          <Row align="middle" justify="space-between" gutter={[16, 16]} style={{ position: 'relative', zIndex: 1 }}>
            <Col xs={24} sm={12}>
              <Space direction="vertical" size={4}>
                <Title level={isMobile ? 3 : 2} style={{ margin: 0, color: token.colorWhite, textShadow: `0 2px 4px ${alphaColor(token.colorText, 0.2)}` }}>
                  <TeamOutlined style={{ color: alphaColor(token.colorWhite, 0.9), marginRight: 12 }} />
                  用户管理
                </Title>
                <Text style={{ fontSize: isMobile ? 12 : 14, color: alphaColor(token.colorWhite, 0.85) }}>
                  管理系统用户和权限
                </Text>
              </Space>
            </Col>
            <Col xs={24} sm={12}>
              <Space size={12} style={{ display: 'flex', justifyContent: isMobile ? 'flex-start' : 'flex-end', width: '100%' }}>
                {!embedded && (
                  <Button
                    icon={<ArrowLeftOutlined />}
                    onClick={() => navigate('/')}
                    style={{
                      borderRadius: 12,
                      background: alphaColor(token.colorWhite, 0.15),
                      border: `1px solid ${alphaColor(token.colorWhite, 0.3)}`,
                      boxShadow: `0 2px 8px ${alphaColor(token.colorText, 0.15)}`,
                      color: token.colorWhite,
                      backdropFilter: 'blur(10px)',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = alphaColor(token.colorWhite, 0.25);
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = alphaColor(token.colorWhite, 0.15);
                      e.currentTarget.style.transform = 'none';
                    }}
                  >
                    返回主页
                  </Button>
                )}
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setModalVisible(true)}
                  style={{
                    borderRadius: 12,
                    background: alphaColor(token.colorWarning, 0.95),
                    border: `1px solid ${alphaColor(token.colorWhite, 0.3)}`,
                    boxShadow: `0 4px 16px ${alphaColor(token.colorWarning, 0.4)}`,
                    color: token.colorWhite,
                    fontWeight: 600
                  }}
                >
                  添加用户
                </Button>
                {!embedded && <UserMenu />}
              </Space>
            </Col>
          </Row>
        </Card>
        )}

        {/* 主内容面板：嵌入时用外壳的细边框面板，独立时保留柔和卡片 */}
        <div
          style={{
            flex: embedded ? undefined : 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            ...(embedded
              ? {
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 12,
                  background: token.colorBgContainer,
                  boxShadow: `0 1px 2px ${alphaColor(token.colorText, 0.03)}`,
                }
              : {
                  border: `1px solid ${alphaColor(token.colorWhite, 0.45)}`,
                  borderRadius: isMobile ? 16 : 24,
                  background: alphaColor(token.colorBgContainer, 0.72),
                  backdropFilter: 'blur(20px)',
                  boxShadow: `0 4px 24px ${alphaColor(token.colorText, 0.06)}`,
                }),
          }}
        >
          {/* 工具条：搜索 + 计数 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              padding: embedded ? '12px 14px' : '16px 24px 12px',
              borderBottom: `1px solid ${embedded ? token.colorBorderSecondary : alphaColor(token.colorText, 0.06)}`,
            }}
          >
            <Input
              placeholder="搜索用户名、显示名称或用户ID"
              prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setCurrentPage(1); // 搜索时重置到第一页
              }}
              allowClear
              style={{
                borderRadius: 8,
                width: embedded ? 280 : undefined,
                maxWidth: '100%',
              }}
            />
            <span
              style={{
                color: token.colorTextTertiary,
                fontSize: 11.5,
                whiteSpace: 'nowrap',
              }}
            >
              共 {filteredUsers.length} 位用户{searchText ? '（已过滤）' : ''}
            </span>
          </div>

          {/* 表格区域 */}
          <div
            style={{
              flex: embedded ? undefined : 1,
              overflow: 'auto',
              padding: embedded ? 0 : '16px 24px 0 24px',
            }}
          >
            <Table
              columns={columns}
              dataSource={sortedUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize)}
              rowKey="user_id"
              loading={loading}
              className={embedded ? 'adm-table' : undefined}
              size={embedded ? 'middle' : 'large'}
              scroll={{
                // 嵌入时不再限定 x，让列宽自适应容器，避免操作列被裁切
                x: embedded ? undefined : 1400,
                // 嵌入管理后台时多出 58px 顶栏 + 页头 + 工具条
                y: embedded ? undefined : 'calc(100vh - 410px)',
              }}
              pagination={false}
              onChange={(_pagination, _filters, sorter) => {
                const currentSorter = Array.isArray(sorter) ? sorter[0] : sorter;
                setCurrentPage(1);

                if (currentSorter && currentSorter.field && currentSorter.order) {
                  setSortField(currentSorter.field as SortField);
                  setSortOrder(currentSorter.order as SortOrder);
                } else {
                  setSortField(null);
                  setSortOrder(null);
                }
              }}
            />
          </div>

          {/* 固定分页控件 */}
          <div
            style={{
              padding: embedded ? '8px 6px' : '16px 24px 24px 24px',
              borderTop: embedded ? 'none' : `1px solid ${alphaColor(token.colorText, 0.06)}`,
              background: 'transparent',
              display: 'flex',
              justifyContent: embedded ? 'flex-end' : 'center',
            }}
          >
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              total={filteredUsers.length}
              size={embedded ? 'small' : undefined}
              showSizeChanger
              showTotal={embedded ? undefined : (total) => `共 ${total} 个用户${searchText ? ' (已过滤)' : ''}`}
              pageSizeOptions={[20, 50, 100]}
              onChange={(page, size) => {
                setCurrentPage(page);
                setPageSize(size);
              }}
              onShowSizeChange={(_current, size) => {
                setCurrentPage(1);
                setPageSize(size);
              }}
            />
          </div>
        </div>
      </div>

      {/* 添加用户对话框 */}
      <Modal
        title={<span><PlusOutlined style={{ marginRight: 8 }} />添加用户</span>}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        width={isMobile ? '90%' : 600}
        centered
        okText="创建"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, max: 20, message: '用户名长度3-20位' },
              { pattern: /^[a-zA-Z0-9_]+$/, message: '只能包含字母、数字和下划线' },
            ]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            label="显示名称"
            name="display_name"
            rules={[
              { required: true, message: '请输入显示名称' },
              { min: 2, max: 50, message: '显示名称长度2-50位' },
            ]}
          >
            <Input placeholder="请输入显示名称" />
          </Form.Item>

          <Form.Item
            label="初始密码"
            name="password"
            extra="留空则自动生成 username@666"
            rules={[
              { min: 6, message: '密码长度至少6位' },
            ]}
          >
            <Input.Password placeholder="留空则自动生成" />
          </Form.Item>

          <Form.Item
            label="头像URL"
            name="avatar_url"
          >
            <Input placeholder="请输入头像URL（可选）" />
          </Form.Item>

          <Form.Item
            label="信任等级"
            name="trust_level"
            initialValue={0}
          >
            <InputNumber min={0} max={9} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            label="设为管理员"
            name="is_admin"
            valuePropName="checked"
            initialValue={false}
          >
            <Switch
              size={isMobile ? 'small' : 'default'}
              style={{
                flexShrink: 0,
                height: isMobile ? 16 : 22,
                minHeight: isMobile ? 16 : 22,
                lineHeight: isMobile ? '16px' : '22px'
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑用户对话框 */}
      <Modal
        title={<span><EditOutlined style={{ marginRight: 8 }} />编辑用户</span>}
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          editForm.resetFields();
        }}
        onOk={() => editForm.submit()}
        width={isMobile ? '90%' : 600}
        centered
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={handleUpdate}
        >
          <Form.Item
            label="显示名称"
            name="display_name"
            rules={[
              { required: true, message: '请输入显示名称' },
              { min: 2, max: 50, message: '显示名称长度2-50位' },
            ]}
          >
            <Input placeholder="请输入显示名称" />
          </Form.Item>

          <Form.Item
            label="头像URL"
            name="avatar_url"
          >
            <Input placeholder="请输入头像URL（可选）" />
          </Form.Item>

          <Form.Item
            label="信任等级"
            name="trust_level"
          >
            <InputNumber min={0} max={9} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            label="设为管理员"
            name="is_admin"
            valuePropName="checked"
          >
            <Switch
              size={isMobile ? 'small' : 'default'}
              style={{
                flexShrink: 0,
                height: isMobile ? 16 : 22,
                minHeight: isMobile ? 16 : 22,
                lineHeight: isMobile ? '16px' : '22px'
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码对话框 */}
      <Modal
        title={<span><KeyOutlined style={{ marginRight: 8 }} />重置密码</span>}
        open={resetPasswordModalVisible}
        onCancel={() => {
          setResetPasswordModalVisible(false);
          setNewPassword('');
        }}
        onOk={handleResetPasswordConfirm}
        width={isMobile ? '90%' : 500}
        centered
        okText="确认重置"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <Text>用户：<Text strong>{currentUser?.username}</Text></Text>
        </div>
        <Form layout="vertical">
          <Form.Item
            label="新密码"
            extra="留空则重置为默认密码 username@666"
          >
            <Input.Password
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="留空则使用默认密码"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
