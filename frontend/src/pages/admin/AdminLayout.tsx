import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Avatar, Button, Grid, Layout, Menu, Spin, theme } from 'antd';
import {
  ApiOutlined,
  ControlOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { authApi } from '../../services/api';
import type { User } from '../../types';
import UserMenu from '../../components/UserMenu';
import './AdminLayout.css';

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

const navItems = [
  { key: '/admin/users', icon: <TeamOutlined />, label: '用户管理' },
  { key: '/admin/api-config', icon: <ApiOutlined />, label: 'API 配置' },
  { key: '/admin/review', icon: <FileSearchOutlined />, label: '内容审阅' },
  { key: '/admin/audit', icon: <HistoryOutlined />, label: '访问审计' },
  { key: '/admin/system', icon: <SettingOutlined />, label: '系统设置' },
];

interface AdminLayoutProps {
  children?: ReactNode;
}

/**
 * 管理后台外壳：独立于主应用导航，只对管理员开放。
 * 既可作为路由布局（<Outlet />），也支持直接包裹子页面。
 */
export default function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const { token } = theme.useToken();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // useBreakpoint 首帧返回空对象，用窗口宽度兜底避免布局闪一下
  const isMobile = screens.lg === undefined ? window.innerWidth < 992 : !screens.lg;

  useEffect(() => {
    authApi
      .getCurrentUser()
      .then(setCurrentUser)
      .catch(() => setCurrentUser(null))
      .finally(() => setLoading(false));
  }, []);

  const themeVars = {
    '--adm-text': token.colorText,
    '--adm-secondary': token.colorTextSecondary,
    '--adm-tertiary': token.colorTextTertiary,
    '--adm-border': token.colorBorderSecondary,
    '--adm-bg': token.colorBgLayout,
    '--adm-panel': token.colorBgContainer,
    '--adm-fill': token.colorFillQuaternary,
    // 状态色统一压哑一档，避免和表格里的彩色 Tag 抢注意力
    '--adm-ok': `color-mix(in srgb, ${token.colorSuccess} 62%, ${token.colorText})`,
    '--adm-warn': `color-mix(in srgb, ${token.colorWarning} 58%, ${token.colorText})`,
    '--adm-danger': `color-mix(in srgb, ${token.colorError} 62%, ${token.colorText})`,
    '--adm-accent': token.colorPrimary,
  } as CSSProperties;

  // 子路由可能带尾部斜杠或额外片段，按前缀归一化到导航项
  const selectedKey =
    navItems.find((item) => location.pathname.startsWith(item.key))?.key ??
    '/admin/users';

  if (loading) {
    return (
      <div className="adm-center" style={themeVars}>
        <Spin size="large" />
      </div>
    );
  }

  if (!currentUser?.is_admin) {
    return (
      <div className="adm-center" style={themeVars}>
        <Alert
          type="error"
          showIcon
          message="无权限访问"
          description="管理后台仅对管理员开放。"
          action={
            <Button size="small" onClick={() => navigate('/')}>
              返回书架
            </Button>
          }
        />
      </div>
    );
  }

  const menu = (
    <Menu
      mode={isMobile ? 'horizontal' : 'inline'}
      selectedKeys={[selectedKey]}
      className="adm-menu"
      onClick={({ key }) => navigate(key)}
      items={navItems}
    />
  );

  return (
    <Layout className="adm-layout" style={themeVars}>
      <Header className="adm-header">
        <div className="adm-brand">
          <span className="adm-brand-mark">
            <ControlOutlined />
          </span>
          <div className="adm-brand-copy">
            <span className="adm-brand-title">管理后台</span>
            <span className="adm-brand-sub">仅管理员可见</span>
          </div>
        </div>
        <div className="adm-header-right">
          <Button type="text" size="small" onClick={() => navigate('/')}>
            返回书架
          </Button>
          <UserMenu compact />
        </div>
      </Header>

      <Layout className="adm-body" hasSider={!isMobile}>
        {!isMobile && (
          <Sider width={200} theme="light" className="adm-sider">
            <div className="adm-sider-inner">
              {menu}
              <div className="adm-sider-foot">
                {currentUser && (
                  <div className="adm-account">
                    <Avatar size={26} src={currentUser.avatar_url}>
                      {(currentUser.display_name || currentUser.username).slice(0, 1)}
                    </Avatar>
                    <div className="adm-account-copy">
                      <span className="adm-account-name">
                        {currentUser.display_name || currentUser.username}
                      </span>
                      <span className="adm-account-role">管理员</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Sider>
        )}

        <Content className="adm-content">
          {isMobile && <div className="adm-mobile-nav">{menu}</div>}
          {children ?? <Outlet />}
        </Content>
      </Layout>
    </Layout>
  );
}
