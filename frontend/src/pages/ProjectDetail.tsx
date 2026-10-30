import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Outlet, Link, useLocation } from 'react-router-dom';
import { Layout, Menu, Spin, Button, Drawer, Space, theme } from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  TeamOutlined,
  BookOutlined,
  // ToolOutlined,
  GlobalOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ApartmentOutlined,
  BankOutlined,
  EditOutlined,
  FundOutlined,
  TrophyOutlined,
  BulbOutlined,
  CloudOutlined,
  MoonOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  DatabaseOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import { useStore } from '../store';
import { useCharacterSync, useOutlineSync, useChapterSync } from '../store/hooks';
import { projectApi } from '../services/api';
import ThemeSwitch from '../components/ThemeSwitch';
import { useThemeMode } from '../theme/useThemeMode';
import {
  getStoredSidebarCollapsed,
  setStoredSidebarCollapsed,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_WIDTH,
} from '../utils/sidebarState';
import FloatingTaskPanel from '../components/FloatingTaskPanel';
import ProjectAgentPanel from '../components/project-agent/ProjectAgentPanel';
import BrandMark from '../components/BrandMark';
import { eventBus, EventNames } from '../store/eventBus';

const { Header, Sider, Content } = Layout;

// 判断是否为移动端
const isMobile = () => window.innerWidth <= 768;

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => getStoredSidebarCollapsed());
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [mobile, setMobile] = useState(isMobile());
  const [agentDrawerVisible, setAgentDrawerVisible] = useState(false);
  const [agentLayout, setAgentLayout] = useState({ expanded: true, width: 410 });
  const handleAgentLayoutChange = useCallback((expanded: boolean, width: number) => {
    setAgentLayout(current => (
      current.expanded === expanded && current.width === width ? current : { expanded, width }
    ));
  }, []);
  const { token } = theme.useToken();
  const { mode, resolvedMode, setMode } = useThemeMode();
  const cycleThemeMode = () => {
    const nextMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
    setMode(nextMode);
  };
  const collapsedThemeIcon = mode === 'light' ? <BulbOutlined /> : mode === 'dark' ? <MoonOutlined /> : <CloudOutlined />;

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setMobile(isMobile());
      if (!isMobile()) {
        setDrawerVisible(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setStoredSidebarCollapsed(collapsed);
  }, [collapsed]);
  const {
    currentProject,
    setCurrentProject,
    clearProjectData,
    loading,
    setLoading,
    outlines,
    characters,
    chapters,
  } = useStore();

  // 使用同步 hooks
  const { refreshCharacters } = useCharacterSync();
  const { refreshOutlines } = useOutlineSync();
  const { refreshChapters } = useChapterSync();

  useEffect(() => {
    const handleAgentDataChanged = (payload?: unknown) => {
      if (!projectId || !payload || typeof payload !== 'object') return;
      const resources = (payload as { resources?: string[] }).resources || [];
      const refreshes: Promise<unknown>[] = [];
      if (resources.includes('projects')) {
        refreshes.push(projectApi.getProject(projectId).then(setCurrentProject));
      }
      if (resources.includes('outlines')) refreshes.push(refreshOutlines(projectId));
      if (resources.includes('characters')) refreshes.push(refreshCharacters(projectId));
      if (resources.includes('chapters')) refreshes.push(refreshChapters(projectId));
      void Promise.all(refreshes);
    };
    eventBus.on(EventNames.AGENT_DATA_CHANGED, handleAgentDataChanged);
    const handleTaskSettled = (payload?: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const data = payload as { projectId?: string };
      if (data.projectId && data.projectId !== projectId) return;
      handleAgentDataChanged(payload);
    };
    eventBus.on(EventNames.BACKGROUND_TASK_SETTLED, handleTaskSettled);
    return () => {
      eventBus.off(EventNames.AGENT_DATA_CHANGED, handleAgentDataChanged);
      eventBus.off(EventNames.BACKGROUND_TASK_SETTLED, handleTaskSettled);
    };
  }, [projectId, refreshChapters, refreshCharacters, refreshOutlines, setCurrentProject]);

  useEffect(() => {
    const loadProjectData = async (id: string) => {
      try {
        setLoading(true);
        // 加载项目基本信息
        const project = await projectApi.getProject(id);
        setCurrentProject(project);

        // 并行加载其他数据
        await Promise.all([
          refreshOutlines(id),
          refreshCharacters(id),
          refreshChapters(id),
        ]);
      } catch (error) {
        console.error('加载项目数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    if (projectId) {
      loadProjectData(projectId);
    }

    return () => {
      clearProjectData();
    };
  }, [projectId, clearProjectData, setLoading, setCurrentProject, refreshOutlines, refreshCharacters, refreshChapters]);

  // 移除事件监听，避免无限循环
  // Hook 内部已经更新了 store，不需要再次刷新

  const menuItems = [
    {
      type: 'group' as const,
      label: '故事结构',
      children: [
        {
          key: 'world-setting',
          icon: <GlobalOutlined />,
          label: <Link to={`/project/${projectId}/world-setting`}>世界设定</Link>,
        },
        {
          key: 'characters',
          icon: <TeamOutlined />,
          label: <Link to={`/project/${projectId}/characters`}>角色</Link>,
        },
        {
          key: 'organizations',
          icon: <BankOutlined />,
          label: <Link to={`/project/${projectId}/organizations`}>组织</Link>,
        },
        {
          key: 'careers',
          icon: <TrophyOutlined />,
          label: <Link to={`/project/${projectId}/careers`}>职业体系</Link>,
        },
        {
          key: 'relationships',
          icon: <ApartmentOutlined />,
          label: <Link to={`/project/${projectId}/relationships`}>人物关系</Link>,
        },
        {
          key: 'outline',
          icon: <FileTextOutlined />,
          label: <Link to={`/project/${projectId}/outline`}>故事大纲</Link>,
        },
        {
          key: 'chapters',
          icon: <BookOutlined />,
          label: <Link to={`/project/${projectId}/chapters`}>章节写作</Link>,
        },
        {
          key: 'chapter-analysis',
          icon: <FundOutlined />,
          label: <Link to={`/project/${projectId}/chapter-analysis`}>剧情分析</Link>,
        },
        {
          key: 'foreshadows',
          icon: <BulbOutlined />,
          label: <Link to={`/project/${projectId}/foreshadows`}>伏笔</Link>,
        },
        {
          key: 'knowledge-base',
          icon: <DatabaseOutlined />,
          label: <Link to={`/project/${projectId}/knowledge-base`}>知识库</Link>,
        },
      ],
    },
    {
      type: 'group' as const,
      label: '创作辅助',
      children: [
        {
          key: 'writing-styles',
          icon: <EditOutlined />,
          label: <Link to={`/project/${projectId}/writing-styles`}>写作风格</Link>,
        },
        {
          key: 'prompt-workshop',
          icon: <CloudOutlined />,
          label: <Link to={`/project/${projectId}/prompt-workshop`}>灵感模板</Link>,
        },
        {
          key: 'skill-chat',
          icon: <ThunderboltOutlined />,
          label: <Link to={`/project/${projectId}/skill-chat`}>技能工具箱</Link>,
        },
        {
          key: 'polish',
          icon: <ClearOutlined />,
          label: <Link to={`/project/${projectId}/polish`}>去AI味</Link>,
        },
        {
          key: 'skill-manage',
          icon: <SettingOutlined />,
          label: <Link to={`/project/${projectId}/skill-manage`}>技能管理</Link>,
        },
      ],
    },
  ];

  const menuItemsCollapsed = [
    {
      key: 'world-setting',
      icon: <GlobalOutlined />,
      label: <Link to={`/project/${projectId}/world-setting`}>世界设定</Link>,
    },
    {
      key: 'careers',
      icon: <TrophyOutlined />,
      label: <Link to={`/project/${projectId}/careers`}>职业体系</Link>,
    },
    {
      key: 'characters',
      icon: <TeamOutlined />,
      label: <Link to={`/project/${projectId}/characters`}>角色</Link>,
    },
    {
      key: 'relationships',
      icon: <ApartmentOutlined />,
      label: <Link to={`/project/${projectId}/relationships`}>人物关系</Link>,
    },
    {
      key: 'organizations',
      icon: <BankOutlined />,
      label: <Link to={`/project/${projectId}/organizations`}>组织</Link>,
    },
    {
      key: 'outline',
      icon: <FileTextOutlined />,
      label: <Link to={`/project/${projectId}/outline`}>故事大纲</Link>,
    },
    {
      key: 'chapters',
      icon: <BookOutlined />,
      label: <Link to={`/project/${projectId}/chapters`}>章节写作</Link>,
    },
    {
      key: 'chapter-analysis',
      icon: <FundOutlined />,
      label: <Link to={`/project/${projectId}/chapter-analysis`}>剧情分析</Link>,
    },
    {
      key: 'foreshadows',
      icon: <BulbOutlined />,
      label: <Link to={`/project/${projectId}/foreshadows`}>伏笔</Link>,
    },
    {
      key: 'knowledge-base',
      icon: <DatabaseOutlined />,
      label: <Link to={`/project/${projectId}/knowledge-base`}>知识库</Link>,
    },
    {
      key: 'writing-styles',
      icon: <EditOutlined />,
      label: <Link to={`/project/${projectId}/writing-styles`}>写作风格</Link>,
    },
    {
      key: 'prompt-workshop',
      icon: <CloudOutlined />,
      label: <Link to={`/project/${projectId}/prompt-workshop`}>灵感模板</Link>,
    },
    {
      key: 'skill-chat',
      icon: <ThunderboltOutlined />,
      label: <Link to={`/project/${projectId}/skill-chat`}>技能工具箱</Link>,
    },
    {
      key: 'polish',
      icon: <ClearOutlined />,
      label: <Link to={`/project/${projectId}/polish`}>去AI味</Link>,
    },
    {
      key: 'skill-manage',
      icon: <SettingOutlined />,
      label: <Link to={`/project/${projectId}/skill-manage`}>技能管理</Link>,
    },
  ];

  // 根据当前路径动态确定选中的菜单项
  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (path.includes('/world-setting')) return 'world-setting';
    if (path.includes('/knowledge-base')) return 'knowledge-base';
    if (path.includes('/careers')) return 'careers';
    if (path.includes('/relationships')) return 'relationships';
    if (path.includes('/organizations')) return 'organizations';
    if (path.includes('/outline')) return 'outline';
    if (path.includes('/characters')) return 'characters';
    if (path.includes('/chapter-analysis')) return 'chapter-analysis';
    if (path.includes('/foreshadows')) return 'foreshadows';
    if (path.includes('/chapters')) return 'chapters';
    if (path.includes('/writing-styles')) return 'writing-styles';
    if (path.includes('/prompt-workshop')) return 'prompt-workshop';
    if (path.includes('/skill-chat')) return 'skill-chat';
    if (path.includes('/skill-manage')) return 'skill-manage';
    if (path.includes('/polish')) return 'polish';
    return 'outline';
  }, [location.pathname]);

  if (loading || !currentProject) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  // 渲染菜单内容
  const renderMenu = () => (
    <div className="editorial-sider__menu" style={{
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden'
    }}>
      <Menu
        mode="inline"
        inlineCollapsed={collapsed}
        selectedKeys={[selectedKey]}
        style={{
          borderRight: 0,
          paddingTop: '12px'
        }}
        items={collapsed ? menuItemsCollapsed : menuItems}
        onClick={() => mobile && setDrawerVisible(false)}
      />
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh', height: '100vh', overflow: 'hidden' }}>
      <Header style={{
        backgroundColor: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        padding: mobile ? '0 12px' : '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'fixed',
        top: 0,
        left: mobile ? 0 : (collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH),
        right: 0,
        zIndex: 1000,
        height: mobile ? 56 : 70,
        transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden'
      }} className="editorial-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, zIndex: 1, minWidth: 0, flex: 1 }}>
          {mobile && (
            <Button
              type="text"
              icon={<MenuUnfoldOutlined />}
              onClick={() => setDrawerVisible(true)}
              style={{
                fontSize: '18px',
                color: token.colorText,
                width: '36px',
                height: '36px'
              }}
            />
          )}
          <div style={{ minWidth: 0, flex: 1, textAlign: mobile ? 'center' : 'left', paddingLeft: mobile ? 0 : 2, paddingRight: mobile ? 8 : 0 }}>
            {!mobile && <div className="editorial-kicker" style={{ fontSize: 9 }}>Manuscript</div>}
            <h2 style={{
              margin: mobile ? 0 : '4px 0 0',
              color: token.colorText,
              fontFamily: 'var(--font-editorial)',
              fontSize: mobile ? '16px' : '19px',
              fontWeight: 500,
              letterSpacing: '0.08em',
              lineHeight: 1.15,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {currentProject.title}
            </h2>
          </div>
        </div>

        {mobile && (
          <Space size={2} style={{ zIndex: 1 }}>
            <Button
              type="text"
              icon={<BrandMark size={20} showText={false} />}
              onClick={() => setAgentDrawerVisible(true)}
              style={{ color: token.colorTextSecondary, width: 36, height: 36 }}
            />
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/')}
              style={{
                fontSize: '14px',
                color: token.colorTextSecondary,
                height: '36px',
                padding: '0 6px',
              }}
            >
              作品库
            </Button>
          </Space>
        )}

        {!mobile && (
          <div style={{ display: 'flex', alignItems: 'center', zIndex: 1 }}>
            {[
              { label: '大纲', value: outlines.length, unit: '条' },
              { label: '角色', value: characters.length, unit: '个' },
              { label: '章节', value: chapters.length, unit: '章' },
              { label: '已写', value: currentProject.current_words, unit: '字' },
            ].map((item, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 4,
                  padding: index === 0 ? '0 18px 0 0' : index === 3 ? '0 0 0 18px' : '0 18px',
                  borderLeft: index === 0 ? 'none' : `1px solid ${token.colorBorderSecondary}`,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: 10, color: token.colorTextTertiary, letterSpacing: '0.2em' }}>{item.label}</span>
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 400,
                    fontFamily: 'var(--font-display)',
                    color: token.colorText,
                    fontVariantNumeric: 'lining-nums tabular-nums',
                  }}
                >
                  {item.value > 10000 ? (item.value / 10000).toFixed(1) + 'w' : item.value}
                  <span style={{ fontSize: 10, marginLeft: 2, fontWeight: 400, opacity: 0.55 }}>{item.unit}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Header>

      <Layout style={{ marginTop: mobile ? 56 : 70 }}>
        {mobile ? (
          <Drawer
            rootClassName="editorial-navigation editorial-nav-drawer"
            title={
              <BrandMark size={30} textSize={16} color="var(--editorial-nav-text)" />
            }
            placement="left"
            onClose={() => setDrawerVisible(false)}
            open={drawerVisible}
            width={280}
            styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
          >
            {renderMenu()}
            <div className="editorial-sider__footer">
              <div className="editorial-sider-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span>外观</span>
                <span>{resolvedMode === 'dark' ? '夜' : '昼'}</span>
              </div>
              <ThemeSwitch block />
            </div>
          </Drawer>
        ) : (
          <Sider
            className="editorial-sider editorial-navigation"
            collapsible
            collapsed={collapsed}
            onCollapse={setCollapsed}
            trigger={null}
            width={SIDEBAR_WIDTH}
            collapsedWidth={SIDEBAR_COLLAPSED_WIDTH}
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              bottom: 0,
              overflow: 'hidden',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              height: '100vh',
              zIndex: 1000
            }}
          >
            <div style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div className="editorial-sider__brand" style={{
                display: 'flex',
                alignItems: 'center',
                padding: collapsed ? 0 : '0 16px',
                justifyContent: collapsed ? 'center' : 'space-between',
                gap: 8
              }}>
                {collapsed ? (
                  <Button
                    type="text"
                    icon={<MenuUnfoldOutlined />}
                    onClick={() => setCollapsed(false)}
                    style={{
                      color: 'var(--editorial-nav-muted)',
                      width: '100%',
                      height: '100%',
                      padding: 0,
                      borderRadius: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  />
                ) : (
                  <>
                    <BrandMark size={32} textSize={16} color="var(--editorial-nav-text)" />
                    <Button
                      type="text"
                      icon={<MenuFoldOutlined />}
                      onClick={() => setCollapsed(true)}
                      style={{
                        color: 'var(--editorial-nav-muted)',
                        width: 32,
                        height: 32,
                        padding: 0,
                        flexShrink: 0
                      }}
                    />
                  </>
                )}
              </div>
              {renderMenu()}
              <div
                className="editorial-sider__footer"
                style={{ padding: collapsed ? '14px 10px 16px' : undefined }}
              >
                {collapsed ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <Button
                      type="text"
                      icon={collapsedThemeIcon}
                      onClick={cycleThemeMode}
                      title={`主题模式：${mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}（点击切换）`}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 2,
                        background: 'transparent',
                        border: '1px solid var(--editorial-nav-rule)',
                        color: 'var(--editorial-nav-text)',
                        padding: 0,
                      }}
                    />
                    <Button
                      type="text"
                      icon={<ArrowLeftOutlined />}
                      onClick={() => navigate('/')}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 2,
                        background: 'transparent',
                        border: '1px solid var(--editorial-nav-rule)',
                        color: 'var(--editorial-nav-text)',
                        padding: 0,
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="editorial-sider-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>外观</span>
                      <span>{resolvedMode === 'dark' ? '夜' : '昼'}</span>
                    </div>
                    <ThemeSwitch block />
                    <Button
                      type="text"
                      icon={<ArrowLeftOutlined />}
                      onClick={() => navigate('/')}
                      block
                      style={{
                        color: 'var(--editorial-nav-text)',
                        height: 40,
                        justifyContent: 'flex-start',
                        padding: '0 12px'
                      }}
                    >
                      返回作品库
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Sider>
        )}

        <Layout style={{
          marginLeft: mobile ? 0 : (collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH),
          transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
          <Content
            style={{
              background: token.colorBgLayout,
              padding: mobile ? 12 : 24,
              height: mobile ? 'calc(100vh - 56px)' : 'calc(100vh - 70px)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
            className="editorial-canvas"
          >
            <div style={{
              background: 'var(--editorial-card-bg)',
              padding: 0,
              border: '1px solid var(--editorial-rule)',
              borderRadius: 14,
              boxShadow: 'var(--editorial-card-shadow)',
              height: '100%',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'row'
            }}>
              <div style={{
                flex: 1,
                minWidth: 0,
                height: '100%',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                padding: mobile ? 12 : 24,
              }}>
                <Outlet />
              </div>
              {projectId && (
                <ProjectAgentPanel
                  projectId={projectId}
                  mobile={mobile}
                  mobileOpen={agentDrawerVisible}
                  onMobileClose={() => setAgentDrawerVisible(false)}
                  onExpandedChange={handleAgentLayoutChange}
                />
              )}
            </div>
          </Content>
        </Layout>
      </Layout>

      {/* 悬浮任务框 */}
      {projectId && (
        <FloatingTaskPanel
          projectId={projectId}
          rightOffset={mobile ? 23 : (agentLayout.expanded ? agentLayout.width + 35 : 70)}
        />
      )}
    </Layout>
  );
}
