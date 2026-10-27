import { Typography, Button, Modal, Form, Input, message, InputNumber, Select, Grid, theme } from 'antd';
import {
  GlobalOutlined,
  EditOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  CloudOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import { useStore } from '../store';
import { projectApi, wizardStreamApi } from '../services/api';
import { SSELoadingOverlay } from '../components/SSELoadingOverlay';

const { TextArea } = Input;

export default function WorldSetting() {
  const { currentProject, setCurrentProject } = useStore();
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);
  const [isEditProjectModalVisible, setIsEditProjectModalVisible] = useState(false);
  const [editProjectForm] = Form.useForm();
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateProgress, setRegenerateProgress] = useState(0);
  const [regenerateMessage, setRegenerateMessage] = useState('');
  const [isPreviewModalVisible, setIsPreviewModalVisible] = useState(false);
  const [newWorldData, setNewWorldData] = useState<{
    time_period: string;
    location: string;
    atmosphere: string;
    rules: string;
  } | null>(null);
  const [isSavingPreview, setIsSavingPreview] = useState(false);
  const [activeWorldKey, setActiveWorldKey] = useState<string | null>(null);
  const [modal, contextHolder] = Modal.useModal();
  const screens = Grid.useBreakpoint();
  const { token } = theme.useToken();
  const isNarrow = !screens.md;

  // AI重新生成世界观
  const handleRegenerate = async () => {
    if (!currentProject) return;

    modal.confirm({
      title: '确认重新生成',
      content: '确定要使用AI重新生成世界观设定吗？这将替换当前的世界观内容。',
      centered: true,
      okText: '确认重新生成',
      cancelText: '取消',
      onOk: async () => {
        setIsRegenerating(true);
        setRegenerateProgress(0);
        setRegenerateMessage('准备重新生成世界观...');

        try {
          await wizardStreamApi.regenerateWorldBuildingStream(
            currentProject.id,
            {},
            {
              onProgress: (msg: string, progress: number) => {
                setRegenerateProgress(progress);
                setRegenerateMessage(msg);
              },
              onChunk: (chunk: string) => {
                // 可以在这里显示生成的内容片段（可选）
                console.log('生成片段:', chunk);
              },
              onResult: (result: { time_period: string; location: string; atmosphere: string; rules: string }) => {
                // 保存新生成的数据
                const newData = {
                  time_period: result.time_period,
                  location: result.location,
                  atmosphere: result.atmosphere,
                  rules: result.rules,
                };
                setNewWorldData(newData);
              },
              onError: (errorMsg: string) => {
                console.error('重新生成失败:', errorMsg);
                message.error(errorMsg || '重新生成失败，请重试');
              },
              onComplete: () => {
                setIsRegenerating(false);
                setRegenerateProgress(0);
                setRegenerateMessage('');
                // 显示预览对话框
                setIsPreviewModalVisible(true);
              }
            }
          );
        } catch (error) {
          console.error('重新生成出错:', error);
          message.error('重新生成出错，请重试');
          setIsRegenerating(false);
          setRegenerateProgress(0);
          setRegenerateMessage('');
        }
      }
    });
  };

  // 确认保存重新生成的内容
  const handleConfirmSave = async () => {
    if (!currentProject || !newWorldData) return;

    setIsSavingPreview(true);
    try {
      const updatedProject = await projectApi.updateProject(currentProject.id, {
        world_time_period: newWorldData.time_period,
        world_location: newWorldData.location,
        world_atmosphere: newWorldData.atmosphere,
        world_rules: newWorldData.rules,
      });

      setCurrentProject(updatedProject);
      message.success('世界观已更新！');
      setIsPreviewModalVisible(false);
      setNewWorldData(null);
    } catch (error) {
      console.error('保存失败:', error);
      message.error('保存失败，请重试');
    } finally {
      setIsSavingPreview(false);
    }
  };

  // 取消保存，关闭预览
  const handleCancelSave = () => {
    setIsPreviewModalVisible(false);
    setNewWorldData(null);
    message.info('已取消，保持原有内容');
  };

  if (!currentProject) return null;

  // 检查是否有世界设定信息
  const hasWorldSetting = Boolean(
    currentProject.world_time_period ||
    currentProject.world_location ||
    currentProject.world_atmosphere ||
    currentProject.world_rules
  );

  const openEditWorldModal = () => {
    editForm.setFieldsValue({
      world_time_period: currentProject.world_time_period || '',
      world_location: currentProject.world_location || '',
      world_atmosphere: currentProject.world_atmosphere || '',
      world_rules: currentProject.world_rules || '',
    });
    setIsEditModalVisible(true);
  };

  const openEditProjectModal = () => {
    editProjectForm.setFieldsValue({
      title: currentProject.title || '',
      description: currentProject.description || '',
      theme: currentProject.theme || '',
      genre: currentProject.genre || '',
      narrative_perspective: currentProject.narrative_perspective || '',
      target_words: currentProject.target_words || 0,
    });
    setIsEditProjectModalVisible(true);
  };

  const metaLine = [
    currentProject.genre,
    currentProject.narrative_perspective,
    currentProject.target_words ? `目标 ${currentProject.target_words.toLocaleString()} 字` : null,
  ].filter(Boolean).join(' · ');

  const worldBlocks = [
    { key: 'time', label: '时间设定', icon: <ClockCircleOutlined />, value: currentProject.world_time_period },
    { key: 'location', label: '地点设定', icon: <EnvironmentOutlined />, value: currentProject.world_location },
    { key: 'atmosphere', label: '氛围设定', icon: <CloudOutlined />, value: currentProject.world_atmosphere },
    { key: 'rules', label: '规则设定', icon: <SafetyCertificateOutlined />, value: currentProject.world_rules },
  ].filter((block) => Boolean(block.value));
  const selectedWorldKey = worldBlocks.some((block) => block.key === activeWorldKey)
    ? activeWorldKey
    : worldBlocks[0]?.key;
  const activeWorldBlock = worldBlocks.find((block) => block.key === selectedWorldKey);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {contextHolder}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 26,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <GlobalOutlined style={{ fontSize: 18, color: token.colorTextSecondary }} />
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: token.colorText }}>世界设定</h2>
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: token.colorTextTertiary }}>
            故事发生的时代、地点、氛围与规则
          </div>
        </div>
        {hasWorldSetting && (
          <Button icon={<SyncOutlined />} onClick={handleRegenerate} loading={isRegenerating}>
            AI 重新生成
          </Button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {!hasWorldSetting ? (
          <div
            style={{
              height: '100%',
              display: 'grid',
              placeItems: 'center',
              padding: '24px',
              textAlign: 'center',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: token.colorBgLayout,
                  color: token.colorTextSecondary,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 22,
                  marginBottom: 16,
                }}
              >
                <GlobalOutlined />
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: token.colorText }}>还没有世界设定</div>
              <div
                style={{
                  marginTop: 6,
                  maxWidth: 400,
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: token.colorTextSecondary,
                }}
              >
                可以让 AI 根据小说简介生成时代、地点、氛围与规则，也可以手动填写。
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap', justifyContent: 'center' }}>
                <Button type="primary" icon={<SyncOutlined />} onClick={handleRegenerate} loading={isRegenerating}>
                  AI 生成世界观
                </Button>
                <Button icon={<EditOutlined />} onClick={openEditWorldModal}>
                  手动填写
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.9,
                color: currentProject.description ? token.colorTextSecondary : token.colorTextTertiary,
              }}
            >
              {currentProject.description || '还没有填写小说简介。'}
            </p>

            <div
              style={{
                marginTop: 5,
                fontSize: 13,
                lineHeight: 1.8,
                color: currentProject.theme ? token.colorTextSecondary : token.colorTextTertiary,
              }}
            >
              <span style={{ marginRight: 8, fontWeight: 500, color: token.colorText }}>主题</span>
              {currentProject.theme || '还没有填写小说主题。'}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                marginTop: 10,
                fontSize: 12,
                color: token.colorTextTertiary,
              }}
            >
              <span>{metaLine || '尚未设置类型与视角'}</span>
              <Button
                type="text"
                size="small"
                onClick={openEditProjectModal}
                style={{ padding: '0 4px', height: 20, fontSize: 12, color: token.colorTextTertiary }}
              >
                编辑信息
              </Button>
            </div>

            <div style={{ height: 1, margin: '24px 0 0', background: token.colorBorderSecondary }} />

            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: isNarrow ? 'column' : 'row',
              }}
            >
              <nav
                aria-label="世界设定目录"
                style={{
                  width: isNarrow ? '100%' : 184,
                  flexShrink: 0,
                  padding: isNarrow ? '10px 0' : '18px 18px 18px 0',
                  borderRight: isNarrow ? 0 : `1px solid ${token.colorBorderSecondary}`,
                  borderBottom: isNarrow ? `1px solid ${token.colorBorderSecondary}` : 0,
                  display: 'flex',
                  flexDirection: isNarrow ? 'row' : 'column',
                  gap: 4,
                  overflowX: isNarrow ? 'auto' : 'visible',
                }}
              >
                {worldBlocks.map((block) => {
                  const active = block.key === selectedWorldKey;
                  return (
                    <button
                      key={block.key}
                      type="button"
                      onClick={() => setActiveWorldKey(block.key)}
                      aria-current={active ? 'page' : undefined}
                      style={{
                        width: isNarrow ? 'auto' : '100%',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                        padding: '9px 10px',
                        border: 0,
                        borderRadius: 7,
                        background: active ? token.colorFillSecondary : 'transparent',
                        color: active ? token.colorText : token.colorTextSecondary,
                        cursor: 'pointer',
                        textAlign: 'left',
                        font: 'inherit',
                        fontSize: 13,
                        fontWeight: active ? 600 : 400,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ display: 'flex', fontSize: 13, color: active ? token.colorText : token.colorTextTertiary }}>
                        {block.icon}
                      </span>
                      {block.label}
                    </button>
                  );
                })}
              </nav>

              <section
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: isNarrow ? '20px 0 0' : '18px 0 0 28px',
                }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    marginBottom: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <span style={{ display: 'flex', color: token.colorTextTertiary, fontSize: 15 }}>
                      {activeWorldBlock?.icon}
                    </span>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: token.colorText }}>
                      {activeWorldBlock?.label}
                    </h3>
                  </div>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={openEditWorldModal}
                    style={{ color: token.colorTextSecondary, flexShrink: 0 }}
                  >
                    编辑
                  </Button>
                </div>

                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    paddingRight: 8,
                    fontSize: 14,
                    lineHeight: 2,
                    color: token.colorText,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {activeWorldBlock?.value}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      {/* 编辑世界观模态框 */}
      <Modal
        title="编辑世界观"
        open={isEditModalVisible}
        centered
        onCancel={() => {
          setIsEditModalVisible(false);
          editForm.resetFields();
        }}
        onOk={async () => {
          try {
            const values = await editForm.validateFields();
            setIsSaving(true);

            const updatedProject = await projectApi.updateProject(currentProject.id, {
              world_time_period: values.world_time_period,
              world_location: values.world_location,
              world_atmosphere: values.world_atmosphere,
              world_rules: values.world_rules,
            });

            setCurrentProject(updatedProject);
            message.success('世界观更新成功');
            setIsEditModalVisible(false);
            editForm.resetFields();
          } catch (error) {
            console.error('更新世界观失败:', error);
            message.error('更新失败，请重试');
          } finally {
            setIsSaving(false);
          }
        }}
        confirmLoading={isSaving}
        width={800}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={editForm}
          layout="vertical"
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="时间设定"
            name="world_time_period"
            rules={[{ required: true, message: '请输入时间设定' }]}
          >
            <TextArea
              rows={4}
              placeholder="描述故事发生的时代背景..."
              showCount
              maxLength={1000}
            />
          </Form.Item>

          <Form.Item
            label="地点设定"
            name="world_location"
            rules={[{ required: true, message: '请输入地点设定' }]}
          >
            <TextArea
              rows={4}
              placeholder="描述故事发生的地理位置和环境..."
              showCount
              maxLength={1000}
            />
          </Form.Item>

          <Form.Item
            label="氛围设定"
            name="world_atmosphere"
            rules={[{ required: true, message: '请输入氛围设定' }]}
          >
            <TextArea
              rows={4}
              placeholder="描述故事的整体氛围和基调..."
              showCount
              maxLength={1000}
            />
          </Form.Item>

          <Form.Item
            label="规则设定"
            name="world_rules"
            rules={[{ required: true, message: '请输入规则设定' }]}
          >
            <TextArea
              rows={4}
              placeholder="描述这个世界的特殊规则和设定..."
              showCount
              maxLength={1000}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑项目基础信息模态框 */}
      <Modal
        title="编辑项目基础信息"
        open={isEditProjectModalVisible}
        centered
        onCancel={() => {
          setIsEditProjectModalVisible(false);
          editProjectForm.resetFields();
        }}
        onOk={async () => {
          try {
            const values = await editProjectForm.validateFields();
            setIsSavingProject(true);

            const updatedProject = await projectApi.updateProject(currentProject.id, {
              title: values.title,
              description: values.description,
              theme: values.theme,
              genre: values.genre,
              narrative_perspective: values.narrative_perspective,
              target_words: values.target_words,
            });

            setCurrentProject(updatedProject);
            message.success('项目基础信息更新成功');
            setIsEditProjectModalVisible(false);
            editProjectForm.resetFields();
          } catch (error) {
            console.error('更新项目基础信息失败:', error);
            message.error('更新失败，请重试');
          } finally {
            setIsSavingProject(false);
          }
        }}
        confirmLoading={isSavingProject}
        width={800}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={editProjectForm}
          layout="vertical"
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="小说名称"
            name="title"
            rules={[
              { required: true, message: '请输入小说名称' },
              { max: 200, message: '名称不能超过200字' }
            ]}
          >
            <Input
              placeholder="请输入小说名称"
              showCount
              maxLength={200}
            />
          </Form.Item>

          <Form.Item
            label="小说简介"
            name="description"
            rules={[
              { max: 1000, message: '简介不能超过1000字' }
            ]}
          >
            <TextArea
              rows={4}
              placeholder="请输入小说简介（选填）"
              showCount
              maxLength={1000}
            />
          </Form.Item>

          <Form.Item
            label="小说主题"
            name="theme"
            rules={[
              { max: 500, message: '主题不能超过500字' }
            ]}
          >
            <TextArea
              rows={3}
              placeholder="请输入小说主题（选填）"
              showCount
              maxLength={500}
            />
          </Form.Item>

          <Form.Item
            label="小说类型"
            name="genre"
            rules={[
              { max: 100, message: '类型不能超过100字' }
            ]}
          >
            <Input
              placeholder="请输入小说类型，如：玄幻、都市、科幻等（选填）"
              showCount
              maxLength={100}
            />
          </Form.Item>

          <Form.Item
            label="叙事视角"
            name="narrative_perspective"
          >
            <Select
              placeholder="请选择叙事视角（选填）"
              allowClear
              options={[
                { label: '第一人称', value: '第一人称' },
                { label: '第三人称', value: '第三人称' },
                { label: '全知视角', value: '全知视角' }
              ]}
            />
          </Form.Item>

          <Form.Item
            label="目标字数"
            name="target_words"
            rules={[
              { type: 'number', min: 0, message: '目标字数不能为负数' },
              { type: 'number', max: 2147483647, message: '目标字数超出范围' }
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="请输入目标字数（选填，最大21亿字）"
              min={0}
              max={2147483647}
              step={1000}
              addonAfter="字"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* AI重新生成加载遮罩 */}
      <SSELoadingOverlay
        loading={isRegenerating}
        progress={regenerateProgress}
        message={regenerateMessage}
      />

      {/* 预览重新生成的内容模态框 */}
      <Modal
        title="预览重新生成的世界观"
        open={isPreviewModalVisible}
        centered
        width={900}
        onOk={handleConfirmSave}
        onCancel={handleCancelSave}
        confirmLoading={isSavingPreview}
        okText="确认替换"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        {newWorldData && (
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <div style={{ marginBottom: 24, padding: 16, background: token.colorWarningBg, border: `1px solid ${token.colorWarningBorder}`, borderRadius: 8 }}>
              <Typography.Text type="warning" strong>
                ⚠️ 注意：点击"确认替换"将会用新内容替换当前的世界观设定
              </Typography.Text>
            </div>

            {[
              { label: '时间设定', icon: <ClockCircleOutlined />, value: newWorldData.time_period },
              { label: '地点设定', icon: <EnvironmentOutlined />, value: newWorldData.location },
              { label: '氛围设定', icon: <CloudOutlined />, value: newWorldData.atmosphere },
              { label: '规则设定', icon: <SafetyCertificateOutlined />, value: newWorldData.rules },
            ].map((block, index, blocks) => (
              <div
                key={block.label}
                style={{
                  marginBottom: index === blocks.length - 1 ? 0 : 14,
                  padding: '14px 16px',
                  borderRadius: 10,
                  background: token.colorBgLayout,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: token.colorTextSecondary,
                  }}
                >
                  <span style={{ color: token.colorTextTertiary, fontSize: 13 }}>{block.icon}</span>
                  {block.label}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.85, color: token.colorText, whiteSpace: 'pre-wrap' }}>
                  {block.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
