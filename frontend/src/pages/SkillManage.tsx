import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AutoComplete,
  Button,
  Collapse,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Switch,
  Tooltip,
  message,
  theme,
} from 'antd';
import {
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useThemeMode } from '../theme/useThemeMode';
import MarkdownRenderer from '../components/MarkdownRenderer';
import './SkillManage.css';

const { TextArea } = Input;

interface SkillItem {
  template_key: string;
  name: string;
  template_name: string;
  display_name: string;
  category: string;
  description: string;
  triggers: string[];
  version?: string;
  prompt_chars?: number;
}

interface SkillDetail extends SkillItem {
  body: string;
  raw_content: string;
  standalone_references: Record<string, string>;
}

const SKILL_CATEGORY_OPTIONS = [
  { label: '长篇', value: 'Skill·长篇' },
  { label: '短篇', value: 'Skill·短篇' },
  { label: '润色', value: 'Skill·润色' },
  { label: '工具', value: 'Skill·工具' },
  { label: '通用', value: 'Skill' },
];

const CATEGORY_COLORS: Record<string, string> = {
  'Skill·长篇': '#5B7FA6',
  'Skill·短篇': '#6E9160',
  'Skill·润色': '#B08147',
  'Skill·工具': '#7C6F9B',
};

const DEFAULT_CATEGORY_COLOR = '#8C8C84';

const normalizeTriggers = (value?: string[]): string[] => {
  const list = (value || []).map(item => item.trim()).filter(Boolean);
  return list.filter((item, index) => list.indexOf(item) === index);
};

const shortCategory = (category: string) => (
  category.startsWith('Skill·') ? category.slice('Skill·'.length) : category === 'Skill' ? '通用' : category
);

const categoryColor = (category: string) => CATEGORY_COLORS[category] || DEFAULT_CATEGORY_COLOR;

const validateTriggers = (_: unknown, value?: string[]) => (
  normalizeTriggers(value).length > 0
    ? Promise.resolve()
    : Promise.reject(new Error('请至少填写一个触发词'))
);

const validateReferences = (_: unknown, value?: string) => {
  if (!value?.trim()) return Promise.resolve();
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Promise.reject(new Error('请输入 JSON 对象，如 {"文件名": "内容"}'));
    }
    return Promise.resolve();
  } catch {
    return Promise.reject(new Error('JSON 格式有误，请检查括号和引号'));
  }
};

const parseReferences = (value?: string): Record<string, string> | undefined => {
  if (!value?.trim()) return undefined;
  return JSON.parse(value) as Record<string, string>;
};

const readErrorMessage = async (response: Response, fallback: string) => {
  try {
    const data = await response.json();
    return data.detail || fallback;
  } catch {
    return fallback;
  }
};

export default function SkillManage() {
  const { token } = theme.useToken();
  const { resolvedMode } = useThemeMode();
  const accentColor = resolvedMode === 'dark' ? '#EDEDE7' : token.colorPrimary;
  const themeVars = {
    '--sm-text': token.colorText,
    '--sm-secondary': token.colorTextSecondary,
    '--sm-tertiary': token.colorTextTertiary,
    '--sm-border': token.colorBorderSecondary,
    '--sm-fill': token.colorFillQuaternary,
    '--sm-accent': accentColor,
    '--sm-card-bg': token.colorBgContainer,
  } as CSSProperties;

  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [viewDrawerVisible, setViewDrawerVisible] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillDetail | null>(null);
  const [viewingDetail, setViewingDetail] = useState<SkillDetail | null>(null);
  const [viewPreview, setViewPreview] = useState(true);
  const [editorDirty, setEditorDirty] = useState(false);

  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const createBody = Form.useWatch('body', createForm);
  const editBody = Form.useWatch('body', editForm);
  const workflowBody = createModalVisible ? createBody : editBody;
  const workflowEditorRef = useRef<HTMLDivElement | null>(null);
  const workflowPreviewRef = useRef<HTMLDivElement | null>(null);
  const workflowScrollLocks = useRef({ editor: 0, preview: 0 });

  const loadSkills = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/skills/list');
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '加载技能列表失败'));
      }
      const data: SkillItem[] = await response.json();
      setSkills(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载技能列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  useEffect(() => {
    if (!createModalVisible && !editModalVisible) return;

    const editor = workflowEditorRef.current?.querySelector<HTMLTextAreaElement>('textarea');
    const preview = workflowPreviewRef.current?.querySelector<HTMLElement>('.sm-workflow-preview-body');
    if (!editor || !preview) return;

    const syncScroll = (
      source: HTMLElement,
      target: HTMLElement,
      targetKey: 'editor' | 'preview',
    ) => {
      if (!window.matchMedia('(min-width: 561px)').matches) return;
      if (performance.now() < workflowScrollLocks.current[targetKey]) return;

      const sourceRange = source.scrollHeight - source.clientHeight;
      const targetRange = target.scrollHeight - target.clientHeight;
      if (sourceRange <= 0 || targetRange <= 0) return;

      const progress = Math.min(1, Math.max(0, source.scrollTop / sourceRange));
      const nextTop = progress * targetRange;
      if (Math.abs(target.scrollTop - nextTop) < 1) return;

      // Ignore the scroll event caused by this programmatic update.
      workflowScrollLocks.current[targetKey] = performance.now() + 120;
      target.scrollTop = nextTop;
    };

    const handleEditorScroll = () => {
      if (performance.now() < workflowScrollLocks.current.editor) return;
      syncScroll(editor, preview, 'preview');
    };
    const handlePreviewScroll = () => {
      if (performance.now() < workflowScrollLocks.current.preview) return;
      syncScroll(preview, editor, 'editor');
    };

    editor.addEventListener('scroll', handleEditorScroll, { passive: true });
    preview.addEventListener('scroll', handlePreviewScroll, { passive: true });
    return () => {
      editor.removeEventListener('scroll', handleEditorScroll);
      preview.removeEventListener('scroll', handlePreviewScroll);
    };
  }, [createModalVisible, editModalVisible]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    skills.forEach(skill => {
      counts.set(skill.category, (counts.get(skill.category) || 0) + 1);
    });
    const knownOrder = SKILL_CATEGORY_OPTIONS.map(option => option.value);
    return Array.from(counts.entries()).sort(([a], [b]) => {
      const aIndex = knownOrder.indexOf(a);
      const bIndex = knownOrder.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b, 'zh-CN');
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }, [skills]);

  const filteredSkills = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return skills.filter(skill => {
      if (activeCategory !== 'all' && skill.category !== activeCategory) return false;
      if (!keyword) return true;
      const searchable = [
        skill.display_name,
        skill.template_name,
        skill.name,
        skill.template_key,
        skill.category,
        skill.description,
        ...(skill.triggers || []),
      ];
      return searchable.some(value => (value || '').toLowerCase().includes(keyword));
    });
  }, [skills, query, activeCategory]);

  const openCreateModal = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      category: activeCategory === 'all' ? undefined : activeCategory,
      references: '',
    });
    setEditorDirty(false);
    setCreateModalVisible(true);
  };

  const handleEdit = async (skill: SkillItem) => {
    try {
      const response = await fetch(`/api/skills/detail/${skill.template_key}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '获取技能详情失败'));
      }
      const detail: SkillDetail = await response.json();
      setEditingSkill(detail);
      editForm.setFieldsValue({
        display_name: detail.display_name || detail.template_name,
        category: detail.category,
        description: detail.description,
        triggers: detail.triggers || [],
        body: detail.body,
        references: Object.keys(detail.standalone_references || {}).length
          ? JSON.stringify(detail.standalone_references, null, 2)
          : '',
      });
      setEditorDirty(false);
      setEditModalVisible(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取技能详情失败');
    }
  };

  const handleViewRaw = async (skill: SkillItem) => {
    try {
      const response = await fetch(`/api/skills/detail/${skill.template_key}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '获取内容失败'));
      }
      const detail: SkillDetail = await response.json();
      setViewingDetail(detail);
      setViewPreview(true);
      setViewDrawerVisible(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取内容失败');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingSkill) return;
    let values;
    try {
      values = await editForm.validateFields();
    } catch {
      return;
    }

    const triggers = normalizeTriggers(values.triggers);
    const category = (values.category || '').trim();
    if (!category) {
      message.error('请选择或输入分类');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/skills/update/${editingSkill.template_key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: values.display_name.trim(),
          category,
          description: values.description.trim(),
          triggers,
          body: values.body,
          references: parseReferences(values.references),
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '更新失败'));
      }
      message.success('技能更新成功');
      setEditModalVisible(false);
      setEditingSkill(null);
      setEditorDirty(false);
      loadSkills();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    let values;
    try {
      values = await createForm.validateFields();
    } catch {
      return;
    }

    const triggers = normalizeTriggers(values.triggers);
    const category = (values.category || '').trim();
    if (!category) {
      message.error('请选择或输入分类');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/skills/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name.trim(),
          display_name: values.display_name.trim(),
          category,
          description: values.description.trim(),
          triggers,
          body: values.body,
          references: parseReferences(values.references),
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '创建失败'));
      }
      message.success('技能创建成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      setEditorDirty(false);
      loadSkills();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (skillKey: string) => {
    try {
      const response = await fetch(`/api/skills/delete/${skillKey}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '删除失败'));
      }
      message.success('删除成功');
      loadSkills();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const handleCopyRaw = async () => {
    if (!viewingDetail?.raw_content) return;
    try {
      await navigator.clipboard.writeText(viewingDetail.raw_content);
      message.success('已复制 SKILL.md 内容');
    } catch {
      message.error('复制失败，请手动选择内容');
    }
  };

  const closeEditor = (mode: 'create' | 'edit') => {
    if (mode === 'create') {
      setCreateModalVisible(false);
      createForm.resetFields();
    } else {
      setEditModalVisible(false);
      setEditingSkill(null);
    }
    setEditorDirty(false);
  };

  const requestCloseEditor = (mode: 'create' | 'edit') => {
    if (!editorDirty || saving) {
      closeEditor(mode);
      return;
    }
    Modal.confirm({
      title: '放弃未保存的修改？',
      content: '关闭后，本次填写的内容不会被保存。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: () => closeEditor(mode),
    });
  };

  const renderMetaFields = (mode: 'create' | 'edit') => (
    <>
      {mode === 'create' ? (
        <Form.Item
          className="sm-field"
          label="技能标识"
          name="name"
          tooltip="作为目录名和内部标识，创建后不可修改"
          normalize={(value?: string) => (
            (value || '')
              .toLowerCase()
              .replace(/[\s_]+/g, '-')
              .replace(/[^a-z0-9-]/g, '')
              .replace(/-{2,}/g, '-')
          )}
          rules={[
            { required: true, message: '请输入技能标识' },
            {
              pattern: /^[a-z0-9][a-z0-9-]*$/,
              message: '仅支持小写字母、数字和短横线',
            },
          ]}
        >
          <Input placeholder="my-new-skill" autoComplete="off" />
        </Form.Item>
      ) : (
        <Form.Item
          className="sm-field"
          label="技能标识"
          tooltip="来自 SKILL.md 的 name 字段，编辑时不可修改"
        >
          <Input
            value={editingSkill?.name || editingSkill?.template_key || ''}
            disabled
          />
        </Form.Item>
      )}

      <Form.Item
        className="sm-field"
        label="显示名称"
        name="display_name"
        rules={[{ required: true, whitespace: true, message: '请输入显示名称' }]}
      >
        <Input placeholder="例如：长篇网文拆文" maxLength={60} showCount />
      </Form.Item>

      <Form.Item
        className="sm-field"
        label="分类"
        name="category"
        rules={[{ required: true, whitespace: true, message: '请选择或输入分类' }]}
      >
        <AutoComplete
          options={SKILL_CATEGORY_OPTIONS}
          placeholder="选择分类，或直接输入新分类"
          allowClear
          filterOption={(inputValue, option) => (
            (option?.value || '').toLowerCase().includes(inputValue.toLowerCase())
          )}
        />
      </Form.Item>

      <Form.Item
        className="sm-field"
        label="触发词"
        name="triggers"
        rules={[{ validator: validateTriggers }]}
        tooltip="输入后按 Enter 添加，建议保留 /skill-name 形式的快捷触发词"
        extra="支持 /命令、自然语言短语，可添加多个"
      >
        <Select
          mode="tags"
          tokenSeparators={[',', '，', '、', '\n']}
          placeholder="例如：/story-long-analyze"
          notFoundContent={null}
          suffixIcon={null}
          popupMatchSelectWidth={false}
          className="sm-trigger-select"
        />
      </Form.Item>

      <Form.Item
        className="sm-field sm-field--full"
        label="描述"
        name="description"
        rules={[{ required: true, whitespace: true, message: '请输入描述' }]}
        tooltip="会展示在技能列表和工具箱卡片中"
      >
        <TextArea
          rows={2}
          maxLength={200}
          showCount
          placeholder="简要说明技能的用途、适用场景和使用方式..."
        />
      </Form.Item>
    </>
  );

  return (
    <div className="sm-page" style={themeVars}>
      <header className="sm-header">
        <div className="sm-header-main">
          <span className="sm-header-icon">
            <ThunderboltOutlined />
          </span>
          <div>
            <div className="sm-title-row">
              <h2 className="sm-title">技能管理</h2>
              <span className="sm-count">{skills.length}</span>
            </div>
            <p className="sm-subtitle">在线维护技能工作流、触发词与参考资料。</p>
          </div>
        </div>
        <div className="sm-header-actions">
          <Button icon={<ReloadOutlined />} onClick={loadSkills} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            添加技能
          </Button>
        </div>
      </header>

      <div className="sm-toolbar">
        <div className="sm-filters" role="tablist" aria-label="按分类筛选技能">
          <button
            type="button"
            role="tab"
            aria-selected={activeCategory === 'all'}
            className={`sm-filter${activeCategory === 'all' ? ' sm-filter--active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            全部
            <span className="sm-filter-count">{skills.length}</span>
          </button>
          {categories.map(([category, count]) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === category}
              className={`sm-filter${activeCategory === category ? ' sm-filter--active' : ''}`}
              key={category}
              onClick={() => setActiveCategory(category)}
            >
              <span className="sm-dot" style={{ background: categoryColor(category) }} />
              {shortCategory(category)}
              <span className="sm-filter-count">{count}</span>
            </button>
          ))}
        </div>
        <Input
          className="sm-search"
          prefix={<SearchOutlined />}
          placeholder="搜索名称、描述或触发词"
          value={query}
          onChange={event => setQuery(event.target.value)}
          allowClear
        />
      </div>

      <div className="sm-scroll">
        {loading && skills.length === 0 ? (
          <div className="sm-state">
            <Spin />
          </div>
        ) : skills.length === 0 ? (
          <div className="sm-state">
            <Empty description="还没有技能，创建一个开始使用">
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                添加技能
              </Button>
            </Empty>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="sm-state">
            <Empty description="没有匹配的技能">
              <Button
                onClick={() => {
                  setQuery('');
                  setActiveCategory('all');
                }}
              >
                清除筛选
              </Button>
            </Empty>
          </div>
        ) : (
          <div className="sm-list">
            <div className="sm-list-head" aria-hidden="true">
              <span>技能</span>
              <span>分类</span>
              <span>描述</span>
              <span>触发词</span>
              <span className="sm-col-actions">操作</span>
            </div>
            {filteredSkills.map(skill => {
              const displayName = skill.display_name || skill.template_name;
              const triggers = skill.triggers || [];
              return (
                <div className="sm-row" key={skill.template_key}>
                  <div className="sm-cell sm-cell--name">
                    <div className="sm-name" title={displayName}>{displayName}</div>
                    <div
                      className="sm-key"
                      title={
                        skill.version
                          ? `${skill.name}（上游版本 v${skill.version}）`
                          : skill.name || skill.template_key
                      }
                    >
                      {skill.name || skill.template_key}
                      {skill.version ? ` · v${skill.version}` : ''}
                      {skill.prompt_chars ? ` · 提示词 ${(skill.prompt_chars / 1000).toFixed(1)}k 字符` : ''}
                    </div>
                    <div className="sm-inline-desc" title={skill.description}>
                      {skill.description || '暂无描述'}
                    </div>
                  </div>
                  <div className="sm-cell sm-cell--cat">
                    <span className="sm-cat">
                      <span
                        className="sm-dot"
                        style={{ background: categoryColor(skill.category) }}
                      />
                      {shortCategory(skill.category)}
                    </span>
                  </div>
                  <div className="sm-cell sm-cell--desc" title={skill.description}>
                    {skill.description || '暂无描述'}
                  </div>
                  <div className="sm-cell sm-cell--triggers">
                    {triggers.length === 0 ? (
                      <span className="sm-muted">未设置</span>
                    ) : (
                      <>
                        {triggers.slice(0, 2).map(trigger => (
                          <span className="sm-chip" key={trigger} title={trigger}>
                            {trigger}
                          </span>
                        ))}
                        {triggers.length > 2 && (
                          <Tooltip title={triggers.slice(2).join('、')}>
                            <span className="sm-chip sm-chip--more">
                              +{triggers.length - 2}
                            </span>
                          </Tooltip>
                        )}
                      </>
                    )}
                  </div>
                  <div className="sm-cell sm-cell--actions">
                    <Tooltip title="查看 SKILL.md">
                      <Button
                        type="text"
                        className="sm-action"
                        icon={<FileTextOutlined />}
                        aria-label="查看 SKILL.md"
                        onClick={() => handleViewRaw(skill)}
                      />
                    </Tooltip>
                    <Tooltip title="编辑">
                      <Button
                        type="text"
                        className="sm-action"
                        icon={<EditOutlined />}
                        aria-label="编辑技能"
                        onClick={() => handleEdit(skill)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="删除此技能？"
                      description="删除后无法恢复，技能目录会被永久移除。"
                      onConfirm={() => handleDelete(skill.template_key)}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Tooltip title="删除">
                        <Button
                          type="text"
                          danger
                          className="sm-action sm-action--danger"
                          icon={<DeleteOutlined />}
                          aria-label="删除技能"
                        />
                      </Tooltip>
                    </Popconfirm>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Drawer
        className="sm-viewer-drawer"
        open={viewDrawerVisible}
        onClose={() => setViewDrawerVisible(false)}
        placement="right"
        width="min(860px, 100vw)"
        closable={false}
        maskClosable={false}
        destroyOnHidden
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
      >
        <div className="sm-viewer">
          <header className="sm-viewer-head">
            <span className="sm-viewer-icon">
              <FileTextOutlined />
            </span>
            <div className="sm-viewer-head-main">
              <h3 className="sm-viewer-title">
                {viewingDetail?.display_name || viewingDetail?.template_name}
              </h3>
              <p className="sm-viewer-subtitle">
                {viewingDetail?.name || viewingDetail?.template_key}
                <span className="sm-viewer-separator">·</span>
                SKILL.md
              </p>
            </div>
            <Button
              type="text"
              className="sm-viewer-close"
              icon={<CloseOutlined />}
              aria-label="关闭"
              onClick={() => setViewDrawerVisible(false)}
            />
          </header>

          <div className="sm-viewer-controls">
            <span className="sm-viewer-mode">
              <EyeOutlined />
              {viewPreview ? 'Markdown 效果预览' : 'SKILL.md 完整源码'}
            </span>
            <label className="sm-preview-toggle">
              <span>显示效果</span>
              <Switch
                size="small"
                checked={viewPreview}
                onChange={setViewPreview}
                aria-label="切换 Markdown 效果预览"
              />
            </label>
          </div>

          <div className={`sm-viewer-body${viewPreview ? ' sm-viewer-body--preview' : ''}`}>
            {viewPreview ? (
              <article className="sm-markdown-preview">
                <MarkdownRenderer content={viewingDetail?.body} />
              </article>
            ) : (
              <pre className="sm-raw">{viewingDetail?.raw_content}</pre>
            )}
          </div>

          <footer className="sm-viewer-foot">
            <span className="sm-viewer-foot-hint">
              {viewPreview
                ? '预览已隐藏 YAML 元数据，仅展示工作流正文'
                : '当前显示 SKILL.md 的完整原始内容'}
            </span>
            <div className="sm-viewer-foot-actions">
              <Button icon={<CopyOutlined />} onClick={handleCopyRaw}>
                复制源码
              </Button>
              <Button onClick={() => setViewDrawerVisible(false)}>关闭</Button>
            </div>
          </footer>
        </div>
      </Drawer>

      <Drawer
        className="sm-editor-drawer"
        open={createModalVisible || editModalVisible}
        onClose={() => requestCloseEditor(createModalVisible ? 'create' : 'edit')}
        placement="right"
        width="min(1180px, 96vw)"
        closable={false}
        maskClosable={false}
        destroyOnHidden
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
      >
        <div className="sm-editor">
          <header className="sm-editor-head">
            <span className="sm-editor-icon">
              {createModalVisible ? <PlusOutlined /> : <EditOutlined />}
            </span>
            <div className="sm-editor-head-main">
              <h3 className="sm-editor-title">
                {createModalVisible ? '添加新技能' : '编辑技能'}
              </h3>
              <p className="sm-editor-subtitle">
                {createModalVisible ? (
                  '填写基础信息并编写工作流指令，创建后即可在工具箱中使用。'
                ) : (
                  <>
                    {editingSkill?.display_name || editingSkill?.template_name}
                    <span className="sm-editor-key">
                      {editingSkill?.name || editingSkill?.template_key}
                    </span>
                  </>
                )}
              </p>
            </div>
            <Button
              type="text"
              className="sm-editor-close"
              icon={<CloseOutlined />}
              aria-label="关闭"
              onClick={() => requestCloseEditor(createModalVisible ? 'create' : 'edit')}
            />
          </header>

          <Form
            form={createModalVisible ? createForm : editForm}
            layout="vertical"
            className="sm-editor-form"
            onValuesChange={() => setEditorDirty(true)}
          >
            <div className="sm-editor-body">
              <section className="sm-section">
                <div className="sm-section-head">
                  <span className="sm-section-index">01</span>
                  <span className="sm-section-title">基础信息</span>
                  <span className="sm-section-hint">带 * 为必填</span>
                </div>
                <div className="sm-field-grid">
                  {renderMetaFields(createModalVisible ? 'create' : 'edit')}
                </div>
              </section>

              <section className="sm-section sm-section--workflow">
                <div className="sm-section-head">
                  <span className="sm-section-index">02</span>
                  <span className="sm-section-title">工作流指令</span>
                  <span className="sm-section-badge">Markdown</span>
                </div>
                <div className="sm-workflow-split">
                  <div className="sm-workflow-pane sm-workflow-pane--edit" ref={workflowEditorRef}>
                    <Form.Item
                      label="技能指令正文"
                      name="body"
                      rules={[{ required: true, whitespace: true, message: '请输入工作流指令' }]}
                      tooltip="将作为系统提示词，描述角色、原则和执行步骤"
                      className="sm-workflow-item"
                    >
                      <TextArea
                        className="sm-code-input sm-workflow-input"
                        placeholder={
                          createModalVisible
                            ? '# my-new-skill：技能标题\n\n你是 xxx 专家。你的任务是帮用户完成 xxx。\n\n## 核心原则\n\n- 原则 1\n- 原则 2\n\n## 工作流程\n\n### Phase 1：需求确认\n...'
                            : ''
                        }
                        showCount
                      />
                    </Form.Item>
                  </div>
                  <div className="sm-workflow-pane sm-workflow-pane--preview" ref={workflowPreviewRef}>
                    <div className="sm-workflow-preview">
                      <div className="sm-workflow-preview-head">
                        <span>
                          <EyeOutlined />
                          效果预览
                        </span>
                        <em title="左右滚动位置实时同步">同步滚动</em>
                      </div>
                      <div className="sm-workflow-preview-body">
                        <MarkdownRenderer content={workflowBody} />
                      </div>
                    </div>
                  </div>
                </div>

                <Collapse
                  ghost
                  className="sm-ref-collapse"
                  items={[{
                    key: 'references',
                    label: (
                      <span className="sm-collapse-label">
                        参考资料
                        <em>可选 · JSON</em>
                      </span>
                    ),
                    children: (
                      <>
                        <Form.Item
                          name="references"
                          className="sm-ref-item"
                          rules={[{ validator: validateReferences }]}
                          noStyle
                        >
                          <TextArea
                            className="sm-code-input sm-ref-input"
                            placeholder={
                              createModalVisible
                                ? '{\n  "writing-tips": "参考技巧内容...",\n  "examples": "示例内容..."\n}'
                                : '{\n  "writing-tips": "参考技巧内容..."\n}'
                            }
                          />
                        </Form.Item>
                        <p className="sm-field-hint">
                          {createModalVisible
                            ? 'JSON 对象格式，键为文件名（无需 .md），会写入 references 目录。'
                            : '留空会清空现有参考资料；保存后会覆盖 references 目录中的 .md 文件。'}
                        </p>
                      </>
                    ),
                  }]}
                />
              </section>
            </div>

            <footer className="sm-editor-foot">
              <span className="sm-editor-foot-hint">
                {editorDirty ? '有未保存的修改' : createModalVisible ? '创建后可在「技能工具箱」中直接使用' : '保存后立即生效，无需重启服务'}
              </span>
              <div className="sm-editor-foot-actions">
                <Button onClick={() => requestCloseEditor(createModalVisible ? 'create' : 'edit')}>
                  取消
                </Button>
                <Button
                  type="primary"
                  onClick={createModalVisible ? handleCreate : handleSaveEdit}
                  loading={saving}
                >
                  {createModalVisible ? '创建技能' : '保存修改'}
                </Button>
              </div>
            </footer>
          </Form>
        </div>
      </Drawer>
    </div>
  );
}
