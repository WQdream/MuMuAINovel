import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import {
  Button,
  Drawer,
  Modal,
  Form,
  Input,
  message,
  Popconfirm,
  Empty,
  theme,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  StarOutlined,
  StarFilled,
  HighlightOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { useStore } from '../store';
import { writingStyleApi } from '../services/api';
import type { WritingStyle, WritingStyleCreate, WritingStyleUpdate } from '../types';
import { useThemeMode } from '../theme/useThemeMode';
import './WritingStyles.css';

const { TextArea } = Input;

export default function WritingStyles() {
  const { currentProject } = useStore();
  const [styles, setStyles] = useState<WritingStyle[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingStyle, setEditingStyle] = useState<WritingStyle | null>(null);
  const [detailStyle, setDetailStyle] = useState<WritingStyle | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const { token } = theme.useToken();
  const { resolvedMode } = useThemeMode();

  const isMobile = window.innerWidth <= 768;
  // 深色模式下主题色接近纯黑，默认标识需要提亮才能看清。
  const accentColor = resolvedMode === 'dark' ? '#EDEDE7' : token.colorPrimary;
  const themeVars = {
    '--ws-text': token.colorText,
    '--ws-secondary': token.colorTextSecondary,
    '--ws-tertiary': token.colorTextTertiary,
    '--ws-border': token.colorBorderSecondary,
    '--ws-fill': token.colorFillQuaternary,
    '--ws-accent': accentColor,
    '--ws-card-bg': token.colorBgContainer,
  } as CSSProperties;

  // 加载风格列表 - 如果有项目则加载项目风格（包含默认标记），否则加载用户风格
  useEffect(() => {
    loadStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  const loadStyles = useCallback(async () => {
    try {
      setLoading(true);
      // 如果有当前项目，使用项目API获取（包含is_default标记）
      // 否则使用用户API获取（所有风格的is_default都是false）
      const response = currentProject?.id
        ? await writingStyleApi.getProjectStyles(currentProject.id)
        : await writingStyleApi.getUserStyles();
      
      // 排序：默认风格优先显示
      const sortedStyles = (response.styles || []).sort((a, b) => {
        // 默认风格排在最前面
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        // 其他按原有顺序（order_index）
        return 0;
      });
      
      setStyles(sortedStyles);
    } catch {
      message.error('加载风格列表失败');
    } finally {
      setLoading(false);
    }
  }, [currentProject?.id]);

  const handleCreate = async (values: { name: string; description?: string; prompt_content: string }) => {
    try {
      const createData: WritingStyleCreate = {
        name: values.name,
        style_type: 'custom',
        description: values.description,
        prompt_content: values.prompt_content,
      };

      await writingStyleApi.createStyle(createData);
      message.success('创建成功');
      setIsCreateModalOpen(false);
      createForm.resetFields();
      await loadStyles();
    } catch {
      message.error('创建失败');
    }
  };

  const handleEdit = (style: WritingStyle) => {
    setDetailStyle(null);
    setEditingStyle(style);
    editForm.setFieldsValue({
      name: style.name,
      description: style.description,
      prompt_content: style.prompt_content,
    });
    setIsEditModalOpen(true);
  };

  const handleUpdate = async (values: WritingStyleUpdate) => {
    if (!editingStyle) return;

    try {
      await writingStyleApi.updateStyle(editingStyle.id, values);
      message.success('更新成功');
      setIsEditModalOpen(false);
      editForm.resetFields();
      setEditingStyle(null);
      await loadStyles();
    } catch {
      message.error('更新失败');
    }
  };

  const handleDelete = async (styleId: number) => {
    try {
      await writingStyleApi.deleteStyle(styleId);
      message.success('删除成功');
      await loadStyles();
    } catch {
      message.error('删除失败');
    }
  };

  const handleSetDefault = async (styleId: number) => {
    if (!currentProject?.id) {
      message.warning('请先选择项目');
      return;
    }
    
    try {
      await writingStyleApi.setDefaultStyle(styleId, currentProject.id);
      message.success('设置默认风格成功');
      await loadStyles();
    } catch {
      message.error('设置失败');
    }
  };

  const showCreateModal = () => {
    createForm.resetFields();
    setIsCreateModalOpen(true);
  };

  const getStyleTypeLabel = (styleType: string) => {
    return styleType === 'preset' ? '预设' : '自定义';
  };

  return (
    <div
      className="writing-styles-page"
      style={themeVars}
    >
      <div className="ws-header">
        <div className="ws-header-main">
          <HighlightOutlined
            style={{ fontSize: 20, color: token.colorTextSecondary, marginTop: 2 }}
          />
          <div style={{ minWidth: 0 }}>
            <h2 className="ws-title">写作风格</h2>
            <p className="ws-subtitle">
              {styles.length > 0
                ? `共 ${styles.length} 个风格 · 设为默认后，AI 生成新章节时优先使用`
                : '为本作挑选叙事语气，或创建专属风格。'}
            </p>
          </div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={showCreateModal}
        >
          创建风格
        </Button>
      </div>

      <div className="ws-scroll">
        {styles.length === 0 ? (
          <div className="ws-empty">
            <Empty description="还没有写作风格">
              <Button type="primary" icon={<PlusOutlined />} onClick={showCreateModal}>
                创建风格
              </Button>
            </Empty>
          </div>
        ) : (
          <div className="ws-grid">
            {styles.map((style) => (
              <article
                key={style.id}
                className={`ws-card${style.is_default ? ' ws-card--default' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`查看 ${style.name} 详情`}
                onClick={() => setDetailStyle(style)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setDetailStyle(style);
                  }
                }}
              >
                <div className="ws-card-head">
                  <div className="ws-card-title">
                    <span className="ws-card-name" title={style.name}>{style.name}</span>
                    {style.is_default && (
                      <span className="ws-card-default">
                        <StarFilled style={{ fontSize: 11 }} />
                        默认
                      </span>
                    )}
                  </div>
                  <span className="ws-card-kind">{getStyleTypeLabel(style.style_type)}</span>
                </div>

                <p className={`ws-card-desc${style.description ? '' : ' ws-card-desc--empty'}`}>
                  {style.description || '暂无简介'}
                </p>

                <p className="ws-card-prompt" title={style.prompt_content}>
                  {style.prompt_content}
                </p>

                <div className="ws-card-foot" onClick={(event) => event.stopPropagation()}>
                  <Button
                    type="text"
                    size="small"
                    className="ws-default-btn"
                    icon={style.is_default
                      ? <StarFilled style={{ color: accentColor, fontSize: 12 }} />
                      : <StarOutlined style={{ fontSize: 12 }} />}
                    disabled={style.is_default}
                    onClick={() => handleSetDefault(style.id)}
                  >
                    {style.is_default ? '默认风格' : '设为默认'}
                  </Button>
                  <div className="ws-card-actions">
                    <Tooltip title={style.user_id === null ? '预设风格不可编辑' : '编辑'}>
                      <Button
                        type="text"
                        size="small"
                        aria-label="编辑风格"
                        icon={<EditOutlined />}
                        disabled={style.user_id === null}
                        onClick={() => handleEdit(style)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="删除这个风格？"
                      description={style.is_default ? '删除后需要重新设置默认风格' : undefined}
                      onConfirm={() => handleDelete(style.id)}
                      okText="删除"
                      cancelText="取消"
                      disabled={style.user_id === null}
                    >
                      <Tooltip title={style.user_id === null ? '预设风格不可删除' : '删除'}>
                        <Button
                          type="text"
                          size="small"
                          aria-label="删除风格"
                          icon={<DeleteOutlined />}
                          disabled={style.user_id === null}
                        />
                      </Tooltip>
                    </Popconfirm>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* 风格详情抽屉 */}
      <Drawer
        open={Boolean(detailStyle)}
        onClose={() => setDetailStyle(null)}
        closable={false}
        width={isMobile ? '100%' : 520}
        styles={{ body: { padding: 0 } }}
      >
        {detailStyle && (
          <div className="ws-drawer" style={themeVars}>
            <div className="ws-drawer-head">
              <div className="ws-drawer-head-main">
                <div className="ws-drawer-title-row">
                  <span className="ws-drawer-title">{detailStyle.name}</span>
                  {detailStyle.is_default && (
                    <span className="ws-card-default">
                      <StarFilled style={{ fontSize: 11 }} />
                      默认
                    </span>
                  )}
                  <span className="ws-card-kind">{getStyleTypeLabel(detailStyle.style_type)}</span>
                </div>
                <p className="ws-drawer-desc">
                  {detailStyle.description || '暂无简介'}
                </p>
              </div>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                aria-label="关闭详情"
                onClick={() => setDetailStyle(null)}
                style={{ flexShrink: 0, color: token.colorTextTertiary }}
              />
            </div>

            <div className="ws-drawer-body">
              <section>
                <div className="ws-drawer-label">提示词内容</div>
                <div className="ws-drawer-prompt">{detailStyle.prompt_content}</div>
              </section>
            </div>

            <div className="ws-drawer-foot">
              {!detailStyle.is_default && (
                <Button
                  icon={<StarOutlined />}
                  onClick={() => {
                    handleSetDefault(detailStyle.id);
                    setDetailStyle(null);
                  }}
                >
                  设为默认
                </Button>
              )}
              {detailStyle.user_id !== null && (
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => handleEdit(detailStyle)}
                >
                  编辑
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* 创建自定义风格 Modal */}
      <Modal
        title={(
          <div className="ws-modal-head">
            <span className="ws-modal-title">创建写作风格</span>
            <span className="ws-modal-subtitle">描述语气与写法，AI 将按此风格生成正文。</span>
          </div>
        )}
        open={isCreateModalOpen}
        onCancel={() => {
          setIsCreateModalOpen(false);
          createForm.resetFields();
        }}
        footer={null}
        centered
        width={isMobile ? 'calc(100vw - 24px)' : 640}
        className="ws-modal"
        style={isMobile
          ? { ...themeVars, maxWidth: 'calc(100vw - 24px)', margin: '0 12px' }
          : themeVars}
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={handleCreate}
          className="ws-form"
        >
          <Form.Item
            label="风格名称"
            name="name"
            rules={[{ required: true, message: '请输入风格名称' }]}
          >
            <Input placeholder="如：武侠风、科幻风" />
          </Form.Item>
          
          <Form.Item label="风格描述" name="description">
            <TextArea rows={2} placeholder="简要描述这个风格的特点..." />
          </Form.Item>
          
          <Form.Item
            label="提示词内容"
            name="prompt_content"
            rules={[{ required: true, message: '请输入提示词内容' }]}
          >
            <TextArea
              className="ws-prompt-input"
              rows={isMobile ? 10 : 14}
              placeholder="输入风格的提示词，用于引导AI生成符合该风格的内容..."
            />
          </Form.Item>

          <div className="ws-modal-foot">
            <Button onClick={() => {
              setIsCreateModalOpen(false);
              createForm.resetFields();
            }}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              创建
            </Button>
          </div>
        </Form>
      </Modal>

      {/* 编辑风格 Modal */}
      <Modal
        title={(
          <div className="ws-modal-head">
            <span className="ws-modal-title">编辑写作风格</span>
            <span className="ws-modal-subtitle">调整后仅影响之后生成的章节内容。</span>
          </div>
        )}
        open={isEditModalOpen}
        onCancel={() => {
          setIsEditModalOpen(false);
          editForm.resetFields();
          setEditingStyle(null);
        }}
        footer={null}
        centered
        width={isMobile ? 'calc(100vw - 24px)' : 640}
        className="ws-modal"
        style={isMobile
          ? { ...themeVars, maxWidth: 'calc(100vw - 24px)', margin: '0 12px' }
          : themeVars}
      >
        <Form form={editForm} layout="vertical" onFinish={handleUpdate} className="ws-form">
          <Form.Item
            label="风格名称"
            name="name"
            rules={[{ required: true, message: '请输入风格名称' }]}
          >
            <Input placeholder="输入风格名称" />
          </Form.Item>
          
          <Form.Item label="风格描述" name="description">
            <TextArea rows={2} placeholder="简要描述这个风格的特点..." />
          </Form.Item>
          
          <Form.Item
            label="提示词内容"
            name="prompt_content"
            rules={[{ required: true, message: '请输入提示词内容' }]}
          >
            <TextArea
              className="ws-prompt-input"
              rows={isMobile ? 10 : 14}
              placeholder="输入风格的提示词..."
            />
          </Form.Item>

          <div className="ws-modal-foot">
            <Button onClick={() => {
              setIsEditModalOpen(false);
              editForm.resetFields();
              setEditingStyle(null);
            }}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              保存
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
