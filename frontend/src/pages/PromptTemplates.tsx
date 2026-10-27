import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Input,
  Modal,
  Spin,
  Switch,
  Upload,
  message,
  theme,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseOutlined,
  DownloadOutlined,
  EditOutlined,
  FileSearchOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useThemeMode } from '../theme/useThemeMode';
import './PromptTemplates.css';

const { TextArea } = Input;

interface PromptTemplate {
  id: string;
  template_key: string;
  template_name: string;
  template_content: string;
  description: string;
  category: string;
  parameters: string;
  is_active: boolean;
  is_system_default: boolean;
  created_at: string;
  updated_at: string;
}

interface CategoryGroup {
  category: string;
  count: number;
  templates: PromptTemplate[];
}

type TemplateFilter = 'all' | 'system' | 'custom' | 'disabled';

export default function PromptTemplates() {
  const { token } = theme.useToken();
  const { resolvedMode } = useThemeMode();
  const [modal, contextHolder] = Modal.useModal();
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<TemplateFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const isMobile = window.innerWidth <= 768;
  const accentColor = resolvedMode === 'dark' ? '#EDEDE7' : token.colorPrimary;
  const themeVars = {
    '--pt-page-bg': token.colorBgLayout,
    '--pt-text': token.colorText,
    '--pt-secondary': token.colorTextSecondary,
    '--pt-tertiary': token.colorTextTertiary,
    '--pt-border': token.colorBorderSecondary,
    '--pt-fill': token.colorFillQuaternary,
    '--pt-card-bg': token.colorBgContainer,
    '--pt-accent': accentColor,
    '--pt-accent-contrast': resolvedMode === 'dark' ? '#1B1B18' : '#FFFFFF',
  } as CSSProperties;

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const response = await axios.get<CategoryGroup[]>('/api/prompt-templates/categories');
      setCategories(response.data);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const allTemplates = useMemo(
    () => categories.flatMap((cat) => cat.templates),
    [categories],
  );

  const totalCount = allTemplates.length;
  const systemCount = allTemplates.filter((t) => t.is_system_default).length;
  const customCount = totalCount - systemCount;
  const disabledCount = allTemplates.filter((t) => !t.is_system_default && !t.is_active).length;

  const currentTemplates = useMemo(() => {
    const scoped = selectedCategory === 'all'
      ? allTemplates
      : categories.find((cat) => cat.category === selectedCategory)?.templates ?? [];

    const filtered = scoped.filter((template) => {
      if (activeFilter === 'system' && !template.is_system_default) return false;
      if (activeFilter === 'custom' && template.is_system_default) return false;
      if (activeFilter === 'disabled' && (template.is_system_default || template.is_active)) return false;
      if (!keyword.trim()) return true;
      const q = keyword.trim().toLowerCase();
      return (
        template.template_name.toLowerCase().includes(q)
        || template.template_key.toLowerCase().includes(q)
        || (template.description || '').toLowerCase().includes(q)
      );
    });

    return filtered;
  }, [activeFilter, allTemplates, categories, keyword, selectedCategory]);

  const filters: { key: TemplateFilter; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: totalCount },
    { key: 'system', label: '系统默认', count: systemCount },
    { key: 'custom', label: '已自定义', count: customCount },
    { key: 'disabled', label: '已停用', count: disabledCount },
  ];

  const handleEdit = (template: PromptTemplate) => {
    setEditingTemplate({ ...template });
    setEditorVisible(true);
  };

  const handleSave = async () => {
    if (!editingTemplate) return;
    try {
      setSaving(true);
      const createsAccountCopy = editingTemplate.is_system_default;
      await axios.post('/api/prompt-templates', {
        template_key: editingTemplate.template_key,
        template_name: editingTemplate.template_name,
        template_content: editingTemplate.template_content,
        description: editingTemplate.description,
        category: editingTemplate.category,
        parameters: editingTemplate.parameters,
        is_active: editingTemplate.is_active,
      });
      message.success(createsAccountCopy ? '已保存为当前账户的自定义副本' : '保存成功');
      setEditorVisible(false);
      loadTemplates();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = (template: PromptTemplate) => {
    if (template.is_system_default) {
      message.info('该模板已是系统默认，无需重置');
      return;
    }
    modal.confirm({
      title: '恢复系统默认？',
      content: `将删除「${template.template_name}」在当前账户下的自定义副本，并恢复系统默认内容。此操作不影响其他账户。`,
      okText: '恢复默认',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        try {
          setLoading(true);
          await axios.post(`/api/prompt-templates/${template.template_key}/reset`);
          message.success('已恢复系统默认');
          loadTemplates();
        } catch (error: unknown) {
          const err = error as { response?: { data?: { detail?: string } } };
          message.error(err.response?.data?.detail || '重置失败');
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleToggleActive = async (template: PromptTemplate, checked: boolean) => {
    try {
      await axios.put(`/api/prompt-templates/${template.template_key}`, {
        is_active: checked,
      });
      setCategories((prev) => prev.map((cat) => ({
        ...cat,
        templates: cat.templates.map((item) => (
          item.template_key === template.template_key ? { ...item, is_active: checked } : item
        )),
      })));
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '操作失败');
    }
  };

  const handleExport = async () => {
    try {
      const response = await axios.post('/api/prompt-templates/export');
      const stats = response.data.statistics;
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prompt-templates-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (stats) {
        message.success(
          `已导出 ${stats.total} 个模板（${stats.customized} 个自定义，${stats.system_default} 个系统默认）`,
        );
      } else {
        message.success('导出成功');
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '导出失败');
    }
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const response = await axios.post('/api/prompt-templates/import', data);
      const result = response.data;
      const stats = result.statistics;

      let successMsg = '导入完成';
      if (stats) {
        successMsg = `导入完成：保持默认 ${stats.kept_system_default} 个，创建或更新 ${stats.created_or_updated} 个`;
        if (stats.converted_to_custom > 0) {
          successMsg += `，转为自定义 ${stats.converted_to_custom} 个`;
        }
      }

      if (result.converted_templates && result.converted_templates.length > 0) {
        modal.info({
          title: '导入完成',
          width: 600,
          centered: true,
          content: (
            <div>
              <p style={{ marginBottom: 12 }}>{successMsg}</p>
              <p style={{ fontWeight: 600, marginBottom: 6 }}>以下模板内容与系统默认不一致，已转为自定义：</p>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                {result.converted_templates.map((t: { template_key: string; template_name: string }) => (
                  <li key={t.template_key}>{t.template_name}（{t.template_key}）</li>
                ))}
              </ul>
            </div>
          ),
          okText: '知道了',
        });
      } else {
        message.success(successMsg);
      }
      loadTemplates();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '导入失败，请检查文件格式');
    }
    return false;
  };

  return (
    <div className="pt-page" style={themeVars}>
      {contextHolder}
      <div className="pt-shell">
        <header className="pt-header">
          <div className="pt-header-main">
            <span className="pt-header-icon">
              <FileSearchOutlined />
            </span>
            <div className="pt-header-copy">
              <div className="pt-title-row">
                <h2 className="pt-title">提示词管理</h2>
                <span className="pt-count">{totalCount}</span>
              </div>
              <p className="pt-subtitle">
                按账户维护 AI 生成提示词，系统默认模板可直接编辑并保存为自定义副本。
              </p>
            </div>
          </div>
          <div className="pt-header-actions">
            <Button icon={<InfoCircleOutlined />} onClick={() => setHelpVisible(true)}>
              使用说明
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出
            </Button>
            <Upload accept=".json" showUploadList={false} beforeUpload={handleImport}>
              <Button type="primary" icon={<UploadOutlined />}>
                导入
              </Button>
            </Upload>
          </div>
        </header>

        <div className="pt-metrics">
          <div className="pt-metric">
            <span className="pt-metric-label">全部模板</span>
            <span className="pt-metric-value">{totalCount}</span>
          </div>
          <div className="pt-metric">
            <span className="pt-metric-label">系统默认</span>
            <span className="pt-metric-value">{systemCount}</span>
          </div>
          <div className="pt-metric">
            <span className="pt-metric-label">已自定义</span>
            <span className="pt-metric-value">{customCount}</span>
          </div>
          <div className="pt-metric">
            <span className="pt-metric-label">已停用</span>
            <span className="pt-metric-value">{disabledCount}</span>
          </div>
        </div>

        <div className="pt-toolbar">
          <div className="pt-filters" role="tablist" aria-label="按来源筛选模板">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={activeFilter === item.key}
                className={`pt-filter${activeFilter === item.key ? ' pt-filter--active' : ''}`}
                onClick={() => setActiveFilter(item.key)}
              >
                {item.label}
                <span className="pt-filter-count">{item.count}</span>
              </button>
            ))}
          </div>
          <Input
            allowClear
            className="pt-search"
            prefix={<SearchOutlined />}
            placeholder="搜索名称、模板键或描述"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <div className="pt-categories" role="tablist" aria-label="按分类筛选模板">
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === 'all'}
            className={`pt-category${selectedCategory === 'all' ? ' pt-category--active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            全部分类
            <span>{totalCount}</span>
          </button>
          {categories.map((cat) => (
            <button
              key={cat.category}
              type="button"
              role="tab"
              aria-selected={selectedCategory === cat.category}
              className={`pt-category${selectedCategory === cat.category ? ' pt-category--active' : ''}`}
              onClick={() => setSelectedCategory(cat.category)}
            >
              {cat.category}
              <span>{cat.count}</span>
            </button>
          ))}
        </div>

        <Spin spinning={loading}>
          {currentTemplates.length === 0 ? (
            <div className="pt-empty">
              <span className="pt-empty-icon">
                <FileSearchOutlined />
              </span>
              <h3 className="pt-empty-title">
                {keyword || activeFilter !== 'all' ? '没有匹配的模板' : '暂无模板数据'}
              </h3>
              <p className="pt-empty-desc">
                {keyword || activeFilter !== 'all'
                  ? '换个关键词，或切换筛选条件再试。'
                  : '模板由系统内置，导入配置文件后即可在这里看到。'}
              </p>
              {(keyword || activeFilter !== 'all') && (
                <Button
                  onClick={() => {
                    setKeyword('');
                    setActiveFilter('all');
                    setSelectedCategory('all');
                  }}
                >
                  清除筛选
                </Button>
              )}
            </div>
          ) : (
            <div className="pt-list">
              <div className="pt-list-head">
                <span>模板</span>
                <span>来源</span>
                <span>模板键</span>
                <span>状态</span>
                <span className="pt-col-actions">操作</span>
              </div>
              {currentTemplates.map((template) => (
                <article className="pt-row" key={template.id}>
                  <div className="pt-cell pt-cell--main">
                    <div className="pt-cell-head">
                      <h3 className="pt-name" title={template.template_name}>{template.template_name}</h3>
                      <span className="pt-cat-tag">{template.category}</span>
                    </div>
                    <p className="pt-desc" title={template.description}>
                      {template.description || '暂无描述'}
                    </p>
                  </div>

                  <div className="pt-cell pt-cell--source">
                    <span className={`pt-source pt-source--${template.is_system_default ? 'system' : 'custom'}`}>
                      {template.is_system_default ? '系统默认' : '已自定义'}
                    </span>
                  </div>

                  <div className="pt-cell pt-cell--key">
                    <code className="pt-key" title={template.template_key}>{template.template_key}</code>
                  </div>

                  <div className="pt-cell pt-cell--status">
                    <span className={`pt-state pt-state--${template.is_system_default || template.is_active ? 'on' : 'off'}`}>
                      <CheckCircleOutlined />
                      {template.is_system_default ? '始终启用' : template.is_active ? '已启用' : '已停用'}
                    </span>
                    {!template.is_system_default && (
                      <Switch
                        size="small"
                        checked={template.is_active}
                        onChange={(checked) => handleToggleActive(template, checked)}
                      />
                    )}
                  </div>

                  <div className="pt-cell pt-cell--actions">
                    <Button
                      type="text"
                      size="small"
                      className="pt-action"
                      icon={<EditOutlined />}
                      onClick={() => handleEdit(template)}
                    >
                      编辑
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      className="pt-action"
                      icon={<ReloadOutlined />}
                      disabled={template.is_system_default}
                      onClick={() => handleReset(template)}
                    >
                      重置
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Spin>
      </div>

      {/* 使用说明抽屉 */}
      <Drawer
        open={helpVisible}
        onClose={() => setHelpVisible(false)}
        closable={false}
        width={isMobile ? '100%' : 480}
        styles={{ body: { padding: 0 } }}
      >
        <div className="pt-drawer" style={themeVars}>
          <div className="pt-drawer-head">
            <span className="pt-drawer-icon">
              <InfoCircleOutlined />
            </span>
            <div className="pt-drawer-head-main">
              <h3 className="pt-drawer-title">使用说明</h3>
              <p className="pt-drawer-subtitle">模板的来源、作用范围与编辑规则</p>
            </div>
            <Button
              type="text"
              size="small"
              className="pt-drawer-close"
              icon={<CloseOutlined />}
              aria-label="关闭"
              onClick={() => setHelpVisible(false)}
            />
          </div>
          <div className="pt-drawer-body">
            <section className="pt-help-section">
              <h4>系统默认模板</h4>
              <p>
                系统内置的提示词，始终启用，不需要手动开关。点击「编辑」后会为当前账户创建一份自定义副本，
                不会修改系统原始内容，也不影响其他账户。
              </p>
            </section>
            <section className="pt-help-section">
              <h4>已自定义模板</h4>
              <p>
                只对当前账户生效。可以用开关停用；点击「重置」会删除自定义副本并恢复系统默认内容。
              </p>
            </section>
            <section className="pt-help-section">
              <h4>变量占位符</h4>
              <p>
                模板中用 <code>{'{variable_name}'}</code> 表示变量，运行时会被实际内容替换。
                编辑时请保留需要的占位符，避免生成结果缺字段。
              </p>
            </section>
            <section className="pt-help-section">
              <h4>导入与导出</h4>
              <p>
                导出会生成包含全部模板的 JSON 文件，适合备份或迁移。
                导入时内容与系统默认不一致的模板会自动转为当前账户的自定义副本。
              </p>
            </section>
          </div>
          <div className="pt-drawer-foot">
            <Button type="primary" onClick={() => setHelpVisible(false)}>知道了</Button>
          </div>
        </div>
      </Drawer>

      {/* 编辑模板抽屉 */}
      <Drawer
        open={editorVisible}
        onClose={() => setEditorVisible(false)}
        closable={false}
        width={isMobile ? '100%' : 760}
        styles={{ body: { padding: 0 } }}
      >
        <div className="pt-drawer" style={themeVars}>
          <div className="pt-drawer-head">
            <span className="pt-drawer-icon">
              <EditOutlined />
            </span>
            <div className="pt-drawer-head-main">
              <h3 className="pt-drawer-title">{editingTemplate?.template_name || '编辑模板'}</h3>
              <p className="pt-drawer-subtitle">
                {editingTemplate?.is_system_default
                  ? '保存后会生成仅当前账户生效的自定义副本'
                  : `模板键 ${editingTemplate?.template_key || ''}`}
              </p>
            </div>
            <Button
              type="text"
              size="small"
              className="pt-drawer-close"
              icon={<CloseOutlined />}
              aria-label="关闭"
              onClick={() => setEditorVisible(false)}
            />
          </div>

          <div className="pt-drawer-body pt-editor-body">
            <div className="pt-field">
              <label className="pt-field-label" htmlFor="pt-template-name">模板名称</label>
              <Input
                id="pt-template-name"
                value={editingTemplate?.template_name || ''}
                onChange={(e) => setEditingTemplate((prev) => (
                  prev ? { ...prev, template_name: e.target.value } : null
                ))}
                placeholder="输入模板名称"
              />
            </div>

            <div className="pt-field">
              <label className="pt-field-label" htmlFor="pt-template-desc">描述</label>
              <TextArea
                id="pt-template-desc"
                value={editingTemplate?.description || ''}
                onChange={(e) => setEditingTemplate((prev) => (
                  prev ? { ...prev, description: e.target.value } : null
                ))}
                rows={2}
                placeholder="简要描述这个模板的用途"
              />
            </div>

            <div className="pt-field pt-field--grow">
              <div className="pt-field-row">
                <label className="pt-field-label" htmlFor="pt-template-content">模板内容</label>
                <span className="pt-field-hint">
                  用 <code>{'{variable_name}'}</code> 表示变量占位符
                </span>
              </div>
              <TextArea
                id="pt-template-content"
                className="pt-content-input"
                value={editingTemplate?.template_content || ''}
                onChange={(e) => setEditingTemplate((prev) => (
                  prev ? { ...prev, template_content: e.target.value } : null
                ))}
                rows={isMobile ? 14 : 20}
                placeholder="输入提示词模板内容..."
              />
            </div>

            <Alert
              type="info"
              showIcon
              message="编辑系统默认模板不会影响原始内容，保存后会生成当前账户的独立副本。"
              className="pt-editor-note"
            />
          </div>

          <div className="pt-drawer-foot">
            <Button onClick={() => setEditorVisible(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
