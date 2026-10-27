import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Input,
  Pagination,
  Spin,
  Table,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined,
  BookOutlined,
  EyeOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { adminApi, adminReviewApi } from '../../services/api';
import type {
  AdminChapterDetail,
  AdminChapterSummary,
  AdminProjectDetail,
  AdminProjectSummary,
  User,
} from '../../types';
import './AdminReview.css';

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

const formatWords = (value?: number | null) => (value ?? 0).toLocaleString('zh-CN');

const projectStatusText: Record<string, string> = {
  planning: '规划中',
  writing: '创作中',
  revising: '修订中',
  completed: '已完成',
};

export default function AdminReview() {
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userKeyword, setUserKeyword] = useState('');
  const [activeUser, setActiveUser] = useState<User | null>(null);

  const [projects, setProjects] = useState<AdminProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectKeyword, setProjectKeyword] = useState('');
  const [projectPage, setProjectPage] = useState(1);
  const [projectTotal, setProjectTotal] = useState(0);
  const projectPageSize = 10;

  const [activeProject, setActiveProject] = useState<AdminProjectDetail | null>(null);
  const [chapters, setChapters] = useState<AdminChapterSummary[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [activeChapter, setActiveChapter] = useState<AdminChapterDetail | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const result = await adminApi.getUsers();
      setUsers(result.users || []);
    } catch (error) {
      console.error('加载用户列表失败:', error);
      message.error('加载用户列表失败');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const loadProjects = useCallback(
    async (userId: string, page: number, keyword: string) => {
      setProjectsLoading(true);
      try {
        const result = await adminReviewApi.listUserProjects(userId, {
          page,
          limit: projectPageSize,
          q: keyword.trim() || undefined,
        });
        setProjects(result.items || []);
        setProjectTotal(result.total || 0);
      } catch (error) {
        console.error('加载用户项目失败:', error);
        message.error('加载用户项目失败');
        setProjects([]);
        setProjectTotal(0);
      } finally {
        setProjectsLoading(false);
      }
    },
    [],
  );

  const openUser = (user: User) => {
    setActiveUser(user);
    setProjectKeyword('');
    setProjectPage(1);
    setActiveProject(null);
    setChapters([]);
    setActiveChapter(null);
  };

  // 项目搜索防抖：只在关键词稳定后请求一次，避免逐字触发请求
  useEffect(() => {
    if (!activeUser) return undefined;
    const timer = window.setTimeout(() => {
      setProjectPage(1);
      void loadProjects(activeUser.user_id, 1, projectKeyword);
    }, projectKeyword.trim() ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [activeUser, projectKeyword, loadProjects]);

  const openProject = async (project: AdminProjectSummary) => {
    setChaptersLoading(true);
    setActiveChapter(null);
    try {
      // 详情接口会在返回前写入项目级审计记录
      const [detail, chapterList] = await Promise.all([
        adminReviewApi.getProjectDetail(project.id),
        adminReviewApi.listProjectChapters(project.id),
      ]);
      setActiveProject(detail);
      setChapters(chapterList.items || []);
      if (chapterList.items?.length) {
        const first = chapterList.items[0];
        await openChapter(first);
      }
    } catch (error) {
      console.error('加载项目详情失败:', error);
      message.error('加载项目详情失败');
    } finally {
      setChaptersLoading(false);
    }
  };

  const openChapter = async (chapter: AdminChapterSummary) => {
    setChapterLoading(true);
    try {
      const detail = await adminReviewApi.getChapterDetail(chapter.id);
      setActiveChapter(detail);
    } catch (error) {
      console.error('加载章节正文失败:', error);
      message.error('加载章节正文失败');
    } finally {
      setChapterLoading(false);
    }
  };

  const backToUsers = () => {
    setActiveUser(null);
    setActiveProject(null);
    setChapters([]);
    setActiveChapter(null);
  };

  const backToProjects = () => {
    setActiveProject(null);
    setChapters([]);
    setActiveChapter(null);
  };

  const filteredUsers = useMemo(() => {
    const keyword = userKeyword.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter((user) =>
      [user.username, user.display_name, user.user_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [userKeyword, users]);

  const userColumns: ColumnsType<User> = [
    {
      title: '用户',
      dataIndex: 'username',
      key: 'username',
      render: (username: string, record) => (
        <div className="adm-cell-inline">
          <UserOutlined className="adm-cell-muted" />
          <span className="adm-cell-strong">{record.display_name || username}</span>
          {record.is_admin && <span className="adm-tag adm-tag--warn">管理员</span>}
        </div>
      ),
    },
    {
      title: '账号',
      dataIndex: 'username',
      key: 'account',
      width: 160,
      render: (value: string) => <span className="adm-cell-muted">{value}</span>,
    },
    {
      title: '最近登录',
      dataIndex: 'last_login',
      key: 'last_login',
      width: 170,
      render: (value?: string) => (
        <span className="adm-cell-muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(value)}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      align: 'right',
      render: (_, record) => (
        <Button
          type="text"
          size="small"
          icon={<BookOutlined />}
          onClick={() => openUser(record)}
        >
          查看作品
        </Button>
      ),
    },
  ];

  const projectColumns: ColumnsType<AdminProjectSummary> = [
    {
      title: '项目',
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record) => (
        <div className="adm-cell-stack">
          <span className="adm-cell-strong">{title}</span>
          <span className="adm-cell-sub">
            {record.genre || '未分类'} · {record.chapter_count} 章 · {formatWords(record.current_words)} 字
          </span>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value: string) => (
        <span className={`adm-tag${value === 'completed' ? ' adm-tag--ok' : ''}`}>
          {projectStatusText[value] || value || '未知'}
        </span>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 170,
      render: (value?: string) => (
        <span className="adm-cell-muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(value)}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      align: 'right',
      render: (_, record) => (
        <Button
          type="text"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => void openProject(record)}
        >
          审阅
        </Button>
      ),
    },
  ];

  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div className="adm-page-head-main">
          <div className="adm-crumb">
            <button type="button" className="adm-crumb-link" onClick={backToUsers}>
              用户
            </button>
            {activeUser && (
              <>
                <span className="adm-crumb-sep">/</span>
                <button
                  type="button"
                  className="adm-crumb-link"
                  onClick={backToProjects}
                >
                  {activeUser.display_name || activeUser.username}
                </button>
              </>
            )}
            {activeProject && (
              <>
                <span className="adm-crumb-sep">/</span>
                <span className="adm-crumb-current">{activeProject.title}</span>
              </>
            )}
          </div>
          <h2 className="adm-page-title">
            {activeProject
              ? activeProject.title
              : activeUser
                ? `${activeUser.display_name || activeUser.username} 的作品`
                : '内容审阅'}
          </h2>
          <p className="adm-page-desc">
            {activeProject
              ? `作者 ${activeProject.owner.display_name || activeProject.owner.username || activeProject.owner.user_id} · ${activeProject.chapter_count} 章 · ${formatWords(activeProject.current_words)} 字`
              : '只读浏览用户的项目与章节正文；本次查阅会以项目为单位记入访问审计。'}
          </p>
        </div>
        {activeProject && (
          <div className="adm-page-actions">
            <span className="adm-tag adm-tag--ok">
              <SafetyCertificateOutlined />
              已记录审计
            </span>
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={backToProjects}>
              返回项目列表
            </Button>
          </div>
        )}
        {!activeProject && activeUser && (
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={backToUsers}>
            返回用户列表
          </Button>
        )}
      </header>

      {!activeUser && (
        <div className="adm-panel">
          <div className="adm-toolbar">
            <Input
              allowClear
              placeholder="搜索用户名称或账号"
              className="adm-search"
              prefix={<SearchOutlined className="adm-search-icon" />}
              value={userKeyword}
              onChange={(event) => setUserKeyword(event.target.value)}
            />
            <span className="adm-count">共 {filteredUsers.length} 位用户</span>
          </div>
          <Table<User>
            rowKey="user_id"
            size="middle"
            loading={usersLoading}
            columns={userColumns}
            dataSource={filteredUsers}
            pagination={{ pageSize: 12, showSizeChanger: false }}
            className="adm-table"
          />
        </div>
      )}

      {activeUser && !activeProject && (
        <div className="adm-panel">
          <div className="adm-toolbar">
            <Input
              allowClear
              placeholder="搜索项目标题"
              className="adm-search"
              prefix={<SearchOutlined className="adm-search-icon" />}
              value={projectKeyword}
              onChange={(event) => setProjectKeyword(event.target.value)}
            />
            <span className="adm-count">共 {projectTotal} 个项目</span>
          </div>
          <Table<AdminProjectSummary>
            rowKey="id"
            size="middle"
            loading={projectsLoading}
            columns={projectColumns}
            dataSource={projects}
            pagination={false}
            className="adm-table"
            locale={{
              emptyText: (
                <Empty
                  imageStyle={{ height: 48 }}
                  description="该用户还没有创建项目"
                />
              ),
            }}
          />
          {projectTotal > projectPageSize && (
            <div className="adm-pager">
              <Pagination
                size="small"
                current={projectPage}
                pageSize={projectPageSize}
                total={projectTotal}
                showSizeChanger={false}
                onChange={(page) => {
                  setProjectPage(page);
                  void loadProjects(activeUser.user_id, page, projectKeyword);
                }}
              />
            </div>
          )}
        </div>
      )}

      {activeProject && (
        <div className="adm-review-reader">
          <aside className="adm-review-chapters">
            <div className="adm-review-chapters-head">
              <span>章节</span>
              <span className="adm-count">{chapters.length}</span>
            </div>
            {chaptersLoading ? (
              <div className="adm-review-chapters-loading">
                <Spin size="small" />
              </div>
            ) : chapters.length === 0 ? (
              <div className="adm-review-chapters-empty">暂无章节</div>
            ) : (
              <div className="adm-review-chapter-list">
                {chapters.map((chapter) => (
                  <button
                    key={chapter.id}
                    type="button"
                    className={`adm-review-chapter-item${
                      activeChapter?.id === chapter.id ? ' is-active' : ''
                    }`}
                    onClick={() => void openChapter(chapter)}
                  >
                    <span className="adm-review-chapter-no">
                      第 {chapter.chapter_number} 章
                    </span>
                    <span className="adm-review-chapter-title">{chapter.title}</span>
                    <span className="adm-review-chapter-meta">
                      {formatWords(chapter.word_count)} 字
                    </span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="adm-review-body">
            {chapterLoading ? (
              <div className="adm-review-body-center">
                <Spin />
              </div>
            ) : activeChapter ? (
              <>
                <header className="adm-review-chapter-head">
                  <span className="adm-review-chapter-headno">
                    第 {activeChapter.chapter_number} 章
                  </span>
                  <h3 className="adm-review-chapter-headtitle">{activeChapter.title}</h3>
                  <div className="adm-review-chapter-headmeta">
                    <span>{formatWords(activeChapter.word_count)} 字</span>
                    <span className="adm-review-dot" />
                    <span>更新于 {formatDate(activeChapter.updated_at)}</span>
                    <span className="adm-review-dot" />
                    <span>只读</span>
                  </div>
                </header>
                <article className="adm-review-text">
                  {activeChapter.content?.trim()
                    ? activeChapter.content
                    : '本章暂无正文内容。'}
                </article>
              </>
            ) : (
              <div className="adm-review-body-center">
                <Empty
                  image={<FileTextOutlined className="adm-empty-icon" />}
                  imageStyle={{ height: 42 }}
                  description="从左侧选择一章查看正文"
                />
              </div>
            )}
          </section>
        </div>
      )}

      {activeUser && (
        <Alert
          type="info"
          showIcon
        className="adm-note"
          message="审阅范围说明"
          description="仅可查看项目信息、章节标题与正文；大纲、角色、关系、伏笔与分析结果不对管理员开放，且本页不提供任何修改操作。"
        />
      )}
    </div>
  );
}
