import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Form, Input, Button, Select, Slider, InputNumber, message, Space, Typography, Spin, Modal, Alert, Grid, Tabs, Popconfirm, Row, Col, Switch, Drawer, Tooltip, theme } from 'antd';
import { SaveOutlined, DeleteOutlined, CheckCircleOutlined, ThunderboltOutlined, PlusOutlined, EditOutlined, WarningOutlined, PictureOutlined, SettingOutlined, LinkOutlined, SlidersOutlined, FileTextOutlined, BulbOutlined, LayoutOutlined, KeyOutlined } from '@ant-design/icons';
import ModelSelectInput, { FieldLabel } from '../components/ModelSelectInput';
import {
  builtInKeyProviders,
  textApiProviders,
} from '../constants/aiProviders';
import { settingsApi, mcpPluginApi } from '../services/api';
import type { ImageModelConfig, SettingsUpdate, TextModelConfig } from '../types';
import { eventBus, EventNames } from '../store/eventBus';
import './Settings.css';

const { Text } = Typography;
const { Option } = Select;
const { useBreakpoint } = Grid;
const { TextArea } = Input;

export default function SettingsPage() {
  const { token } = theme.useToken();
  const screens = useBreakpoint();
  const isMobile = !screens.md; // md断点是768px
  const [form] = Form.useForm();
  const [modal, contextHolder] = Modal.useModal();
  const [loading, setLoading] = useState(false);
  const [hasSettings, setHasSettings] = useState(false);
  const [isDefaultSettings, setIsDefaultSettings] = useState(false);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string; description: string }>>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [modelSearchText, setModelSearchText] = useState('');
  const [testingApi, setTestingApi] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    response_time_ms?: number;
    response_preview?: string;
    error?: string;
    error_type?: string;
    suggestions?: string[];
  } | null>(null);
  const [testingCoverApi, setTestingCoverApi] = useState(false);

  // 文本模型配置卡片状态
  const [textModels, setTextModels] = useState<TextModelConfig[]>([]);
  const [textModelsLoading, setTextModelsLoading] = useState(false);
  const [activeTextModelId, setActiveTextModelId] = useState<string | undefined>();
  const [chapterAnalysisTextModelId, setChapterAnalysisTextModelId] = useState<string | undefined>();
  const [savingChapterAnalysisModel, setSavingChapterAnalysisModel] = useState(false);
  const [textModelModalOpen, setTextModelModalOpen] = useState(false);
  const [editingTextModel, setEditingTextModel] = useState<TextModelConfig | null>(null);
  const [savingTextModel, setSavingTextModel] = useState(false);
  const [switchingTextModelId, setSwitchingTextModelId] = useState<string | null>(null);
  const [testingTextModelId, setTestingTextModelId] = useState<string | null>(null);
  const [textModelForm] = Form.useForm();
  const [coverForm] = Form.useForm();

  // 图片模型卡片状态
  const [imageModels, setImageModels] = useState<ImageModelConfig[]>([]);
  const [imageModelsLoading, setImageModelsLoading] = useState(false);
  const [activeImageModelId, setActiveImageModelId] = useState<string | undefined>();
  const [imageModelModalOpen, setImageModelModalOpen] = useState(false);
  const [editingImageModel, setEditingImageModel] = useState<ImageModelConfig | null>(null);
  const [savingImageModel, setSavingImageModel] = useState(false);
  const [switchingImageModelId, setSwitchingImageModelId] = useState<string | null>(null);
  const [testingImageModelId, setTestingImageModelId] = useState<string | null>(null);

  // 页面 Tab
  const [activeTab, setActiveTab] = useState(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    return tab === 'cover' ? 'cover' : 'current';
  });

  const accentColor = token.colorPrimary;
  const themeVars = {
    '--st-page-bg': token.colorBgLayout,
    '--st-text': token.colorText,
    '--st-secondary': token.colorTextSecondary,
    '--st-tertiary': token.colorTextTertiary,
    '--st-border': token.colorBorderSecondary,
    '--st-fill': token.colorFillQuaternary,
    '--st-card-bg': token.colorBgContainer,
    '--st-accent': accentColor,
    '--st-danger': token.colorError,
  } as CSSProperties;

  useEffect(() => {
    loadSettings();
    loadTextModels();
    loadImageModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'current') {
      // 切换到当前配置Tab时，刷新设置以获取最新数据
      loadSettings();
      loadTextModels();
      // 清除旧的测试结果，因为可能是其他配置的测试结果
      setTestResult(null);
    } else if (activeTab === 'cover') {
      loadImageModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const loadSettings = async () => {
    try {
      const settings = await settingsApi.getSettings();
      form.setFieldsValue({
        ...defaultCoverSettings,
        ...settings,
        cover_api_provider: settings.cover_api_provider || defaultCoverSettings.cover_api_provider,
        cover_api_key: settings.cover_api_key ?? defaultCoverSettings.cover_api_key,
        cover_api_base_url: settings.cover_api_base_url || defaultCoverSettings.cover_api_base_url,
        cover_image_model: settings.cover_image_model || defaultCoverSettings.cover_image_model,
        cover_enabled: settings.cover_enabled ?? defaultCoverSettings.cover_enabled,
      });

      // 判断是否为默认设置（id='0'表示来自.env的默认配置）
      if (settings.id === '0' || !settings.id) {
        setIsDefaultSettings(true);
        setHasSettings(false);
      } else {
        setIsDefaultSettings(false);
        setHasSettings(true);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // 如果404表示还没有设置，使用默认值
      if (error?.response?.status === 404) {
        setHasSettings(false);
        setIsDefaultSettings(true);
        form.setFieldsValue({
          api_provider: 'openai',
          api_base_url: 'https://api.openai.com/v1',
          llm_model: 'gpt-4',
          temperature: 0.7,
          max_tokens: 2000,
          disable_thinking: false,
          ...defaultCoverSettings,
        });
      } else {
        message.error('加载设置失败');
      }
    }
  };

  const handleSave = async (values: SettingsUpdate) => {
    setLoading(true);
    try {
      // 本表单只负责封面图片配置，文本模型走独立的卡片接口
      await settingsApi.saveSettings(values);
      message.success('封面配置已保存');
      setHasSettings(true);
      setIsDefaultSettings(false);
    } catch {
      message.error('保存封面配置失败');
    } finally {
      setLoading(false);
    }
  };

  const openAIImageDefaults = {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-image-1',
  };
  const defaultCoverSettings = {
    cover_enabled: false,
    cover_api_provider: 'openai',
    cover_api_key: '',
    cover_api_base_url: openAIImageDefaults.baseUrl,
    cover_image_model: openAIImageDefaults.model,
  };

  const selectedProvider = Form.useWatch('api_provider', textModelForm);
  const temperatureWatch = Form.useWatch('temperature', textModelForm);
  const selectedCoverProvider = Form.useWatch('api_provider', coverForm);

  const coverApiProviders = [
    {
      value: 'openai',
      label: 'OpenAI 兼容',
      defaultUrl: openAIImageDefaults.baseUrl,
      defaultModel: openAIImageDefaults.model,
    },
    { value: 'gemini', label: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    { value: 'grok', label: 'Grok', defaultUrl: 'https://api.x.ai/v1' },
  ];

  const handleCoverProviderChange = (value: string) => {
    const provider = coverApiProviders.find(p => p.value === value);
    if (!provider) return;

    const nextValues: Record<string, string> = {};
    if (provider.defaultUrl) {
      nextValues.api_base_url = provider.defaultUrl;
    }
    if (provider.value === 'openai') {
      nextValues.image_model = provider.defaultModel || openAIImageDefaults.model;
    }

    coverForm.setFieldsValue(nextValues);
  };

  const handleCoverTestConnection = async () => {
    const values = coverForm.getFieldsValue();
    const coverApiProvider = values.api_provider;
    const coverApiKey = values.api_key;
    const coverApiBaseUrl = values.api_base_url;
    const coverImageModel = values.image_model;

    if (!coverApiProvider || !coverApiKey || !coverImageModel) {
      message.warning('请先填写完整的封面图片配置信息');
      return;
    }

    setTestingCoverApi(true);
    try {
      const result = await settingsApi.testCoverConnection({
        cover_api_provider: coverApiProvider,
        cover_api_key: coverApiKey,
        cover_api_base_url: coverApiBaseUrl,
        cover_image_model: coverImageModel,
      });
      if (result.success) {
        message.success('封面图片接口测试成功');
      } else {
        message.error(result.message || '封面图片接口测试失败');
      }
    } catch (error) {
      console.error('封面图片接口测试失败:', error);
      message.error('封面图片接口测试失败');
    } finally {
      setTestingCoverApi(false);
    }
  };

  const handleFetchModels = async (silent: boolean = false) => {
    const apiKey = textModelForm.getFieldValue('api_key');
    const apiBaseUrl = textModelForm.getFieldValue('api_base_url');
    const provider = textModelForm.getFieldValue('api_provider');

    const isBuiltInKeyProvider = builtInKeyProviders.includes(provider);

    if ((!apiKey && !isBuiltInKeyProvider) || !apiBaseUrl) {
      if (!silent) {
        message.warning('请先填写 API 密钥和 API 地址');
      }
      return;
    }

    setFetchingModels(true);
    try {
      const response = await settingsApi.getAvailableModels({
        api_key: isBuiltInKeyProvider ? '' : apiKey,
        api_base_url: apiBaseUrl,
        provider: provider || 'openai'
      });

      setModelOptions(response.models);
      setModelsFetched(true);
      if (!silent) {
        message.success(`成功获取 ${response.count || response.models.length} 个可用模型`);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || '获取模型列表失败';
      if (!silent) {
        message.error(errorMsg);
      }
      setModelOptions([]);
      setModelsFetched(true); // 即使失败也标记为已尝试，避免重复请求
    } finally {
      setFetchingModels(false);
    }
  };

  const handleModelSelectFocus = () => {
    // 如果还没有获取过模型列表，自动获取
    if (!modelsFetched && !fetchingModels) {
      handleFetchModels(true); // silent模式，不显示成功消息
    }
  };

  const handleTestConnection = async () => {
    const apiKey = textModelForm.getFieldValue('api_key');
    const apiBaseUrl = textModelForm.getFieldValue('api_base_url');
    const provider = textModelForm.getFieldValue('api_provider');
    const modelName = textModelForm.getFieldValue('llm_model');
    const temperature = textModelForm.getFieldValue('temperature');
    const maxTokens = textModelForm.getFieldValue('max_tokens');

    const isBuiltInKeyProvider = builtInKeyProviders.includes(provider);

    if ((!apiKey && !isBuiltInKeyProvider) || !apiBaseUrl || !provider || !modelName) {
      message.warning('请先填写完整的配置信息');
      return;
    }

    setTestingApi(true);
    setTestResult(null);

    try {
      const result = await settingsApi.testApiConnection({
        api_key: isBuiltInKeyProvider ? '' : apiKey,
        api_base_url: apiBaseUrl,
        provider: provider,
        llm_model: modelName,
        temperature: temperature,
        max_tokens: maxTokens
      });

      setTestResult(result);

      if (result.success) {
        message.success(`测试成功！响应时间: ${result.response_time_ms}ms`);
      } else {
        message.error('API 测试失败，请查看详细信息');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || '测试请求失败';
      message.error(errorMsg);
      setTestResult({
        success: false,
        message: '测试请求失败',
        error: errorMsg,
        error_type: 'RequestError',
        suggestions: ['请检查网络连接', '请确认后端服务是否正常运行']
      });
    } finally {
      setTestingApi(false);
    }
  };

  // ========== 文本模型配置 ==========

  const loadTextModels = async () => {
    setTextModelsLoading(true);
    try {
      const response = await settingsApi.getTextModels();
      setTextModels(response.configs || []);
      setActiveTextModelId(response.active_config_id);
      setChapterAnalysisTextModelId(response.chapter_analysis_config_id);
    } catch (error) {
      console.error('加载文本模型配置失败:', error);
    } finally {
      setTextModelsLoading(false);
    }
  };

  const buildTextModelPayload = (values: Record<string, unknown>) => ({
    name: String(values.name ?? '').trim(),
    note: values.note ? String(values.note) : undefined,
    api_provider: String(values.api_provider ?? 'openai'),
    api_key: builtInKeyProviders.includes(String(values.api_provider))
      ? ''
      : String(values.api_key ?? ''),
    api_base_url: values.api_base_url ? String(values.api_base_url) : undefined,
    llm_model: String(values.llm_model ?? ''),
    temperature: Number(values.temperature ?? 0.7),
    max_tokens: Number(values.max_tokens ?? 2000),
    system_prompt: values.system_prompt ? String(values.system_prompt) : undefined,
    disable_thinking: Boolean(values.disable_thinking),
  });

  const openTextModelModal = (config?: TextModelConfig) => {
    setEditingTextModel(config ?? null);
    setTestResult(null);
    textModelForm.resetFields();
    if (config) {
      textModelForm.setFieldsValue({
        name: config.name,
        note: config.note,
        api_provider: config.api_provider,
        api_key: config.api_key,
        api_base_url: config.api_base_url,
        llm_model: config.llm_model,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        system_prompt: config.system_prompt,
        disable_thinking: config.disable_thinking ?? false,
      });
    } else {
      // 新增时带入当前启用卡片的配置，省去重复填写
      const activeConfig = textModels.find(item => item.id === activeTextModelId);
      const current = activeConfig ?? form.getFieldsValue();
      textModelForm.setFieldsValue({
        api_provider: current.api_provider || 'openai',
        api_key: current.api_key || '',
        api_base_url: current.api_base_url || 'https://api.openai.com/v1',
        llm_model: current.llm_model || '',
        temperature: current.temperature ?? 0.7,
        max_tokens: current.max_tokens ?? 2000,
        system_prompt: current.system_prompt,
        disable_thinking: current.disable_thinking ?? false,
      });
    }
    setTextModelModalOpen(true);
  };

  // 公共配置的接口参数由管理员维护，用户只能改名称/备注
  const editingSharedConfig = Boolean(editingTextModel?.shared_config_id);
  const sharedFieldsDisabled = editingSharedConfig;

  const handleTextModelProviderChange = (value: string) => {
    const provider = textApiProviders.find(p => p.value === value);
    if (!provider) return;
    const next: Record<string, string> = {};
    if (provider.defaultUrl) next.api_base_url = provider.defaultUrl;
    if (builtInKeyProviders.includes(provider.value)) {
      next.api_key = '';
      if (provider.defaultModel) next.llm_model = provider.defaultModel;
    }
    textModelForm.setFieldsValue(next);
  };

  const handleTextModelSave = async () => {
    try {
      const values = await textModelForm.validateFields();
      const payload = buildTextModelPayload(values);
      setSavingTextModel(true);
      if (editingTextModel) {
        // 公共配置只提交名称与备注，其余字段由管理员统一维护
        await settingsApi.updateTextModel(
          editingTextModel.id,
          editingSharedConfig
            ? { name: payload.name, note: payload.note }
            : payload,
        );
        message.success('配置已更新');
      } else {
        if (textModels.length === 0) {
          // 第一条配置直接启用，避免出现「有配置但都没启用」
          const created = await settingsApi.createTextModel(payload);
          await settingsApi.activateTextModel(created.id);
          message.success('配置已保存并启用');
        } else {
          await settingsApi.createTextModel(payload);
          message.success('配置已保存，可随时切换启用');
        }
      }
      setTextModelModalOpen(false);
      setEditingTextModel(null);
      textModelForm.resetFields();
      await Promise.all([loadTextModels(), loadSettings()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error?.errorFields) return; // 表单校验失败，已在字段上提示
      message.error(error?.response?.data?.detail || '保存配置失败');
    } finally {
      setSavingTextModel(false);
    }
  };

  const handleTextModelActivate = async (config: TextModelConfig) => {
    if (config.id === activeTextModelId) return;
    setSwitchingTextModelId(config.id);
    try {
      await settingsApi.activateTextModel(config.id);
      setModelOptions([]);
      setModelsFetched(false);
      setTestResult(null);
      await Promise.all([loadTextModels(), loadSettings()]);
      message.success(`已切换到「${config.name}」`);
      await maybeWarnMcpAfterConfigChange(
        config.api_provider,
        config.api_base_url,
        config.llm_model,
        config.name,
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '切换配置失败');
    } finally {
      setSwitchingTextModelId(null);
    }
  };

  const handleTextModelDelete = async (config: TextModelConfig) => {
    const wasActive = config.id === activeTextModelId;
    try {
      await settingsApi.deleteTextModel(config.id);
      message.success(wasActive ? '卡片已删除，当前接口配置保持不变' : '配置已删除');
      await loadTextModels();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '删除配置失败');
    }
  };

  // ========== 章节分析专用配置 / 卡片测试 ==========

  /** 切换生效配置后，若与 MCP 已验证的配置不一致，则禁用插件并提示重检。 */
  const maybeWarnMcpAfterConfigChange = async (
    nextProvider: string,
    nextBaseUrl: string | undefined,
    nextModel: string,
    configName: string,
  ) => {
    const verifiedConfigStr = localStorage.getItem('mcp_verified_config');
    let configChanged = false;

    if (verifiedConfigStr) {
      try {
        const verifiedConfig = JSON.parse(verifiedConfigStr);
        configChanged =
          verifiedConfig.provider !== nextProvider ||
          verifiedConfig.baseUrl !== nextBaseUrl ||
          verifiedConfig.model !== nextModel;
      } catch (error) {
        console.error('Failed to parse verified config:', error);
        configChanged = true;
      }
    } else {
      configChanged = true;
    }

    if (!configChanged) return;

    localStorage.removeItem('mcp_verified_config');

    try {
      const plugins = await mcpPluginApi.getPlugins();
      const activePlugins = plugins.filter(plugin => plugin.enabled);
      if (activePlugins.length === 0) return;

      message.loading({ content: '正在禁用 MCP 插件...', key: 'disable_mcp' });
      await Promise.all(activePlugins.map(plugin => mcpPluginApi.togglePlugin(plugin.id, false)));
      message.success({ content: '已禁用所有 MCP 插件', key: 'disable_mcp' });

      modal.warning({
        title: (
          <Space>
            <WarningOutlined style={{ color: token.colorWarning }} />
            <span>API 配置已更改</span>
          </Space>
        ),
        centered: true,
        content: (
          <div style={{ padding: '8px 0' }}>
            <Alert
              message={`切换到「${configName}」后，API 配置发生了变化。为确保 MCP 插件正常工作，系统已自动禁用所有插件。`}
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <div style={{
              padding: 12,
              background: token.colorInfoBg,
              border: `1px solid ${token.colorInfoBorder}`,
              borderRadius: 8
            }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>请完成以下步骤：</Text>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                <li>前往 MCP 插件管理页面</li>
                <li>重新进行"模型能力检查"</li>
                <li>确认新模型支持 Function Calling 后再启用插件</li>
              </ol>
            </div>
          </div>
        ),
        okText: '前往 MCP 页面',
        cancelText: '稍后处理',
        onOk: () => {
          eventBus.emit(EventNames.SWITCH_TO_MCP_VIEW);
        },
      });
    } catch (error) {
      console.error('Failed to disable MCP plugins:', error);
    }
  };

  const handleChapterAnalysisModelChange = async (configId?: string) => {
    setSavingChapterAnalysisModel(true);
    try {
      await settingsApi.setChapterAnalysisTextModel(configId || undefined);
      setChapterAnalysisTextModelId(configId || undefined);
      message.success(configId ? '章节分析将使用指定模型配置' : '章节分析已恢复跟随当前启用配置');
      await loadTextModels();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '设置章节分析模型失败');
    } finally {
      setSavingChapterAnalysisModel(false);
    }
  };

  const handleTextModelTest = async (config: TextModelConfig) => {
    setTestingTextModelId(config.id);
    try {
      const result = await settingsApi.testTextModel(config.id);
      if (result.success) {
        modal.success({
          title: '测试成功',
          centered: true,
          width: isMobile ? '90%' : 520,
          content: (
            <div style={{ padding: '4px 0' }}>
              <Alert message="API 连接正常，这套配置可以正常调用。" type="success" showIcon />
              <div style={{ marginTop: 16, color: token.colorTextSecondary, fontSize: 13, lineHeight: 1.9 }}>
                <div>提供商：{result.provider?.toUpperCase() || config.api_provider.toUpperCase()}</div>
                <div>模型：{result.model || config.llm_model}</div>
                {result.response_time_ms !== undefined && <div>响应时间：{result.response_time_ms}ms</div>}
              </div>
            </div>
          ),
        });
      } else {
        modal.error({
          title: '测试失败',
          centered: true,
          width: isMobile ? '90%' : 600,
          content: (
            <div style={{ padding: '4px 0' }}>
              <Alert message={result.message || 'API 测试失败'} type="error" showIcon />
              {result.error && (
                <div style={{
                  marginTop: 12,
                  padding: 12,
                  background: token.colorErrorBg,
                  border: `1px solid ${token.colorErrorBorder}`,
                  borderRadius: 8,
                  color: token.colorError,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {result.error}
                </div>
              )}
              {result.suggestions && result.suggestions.length > 0 && (
                <ul style={{ margin: '12px 0 0', paddingLeft: 20, fontSize: 13 }}>
                  {result.suggestions.map((suggestion, index) => (
                    <li key={index} style={{ marginBottom: 4 }}>{suggestion}</li>
                  ))}
                </ul>
              )}
            </div>
          ),
        });
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '测试失败');
    } finally {
      setTestingTextModelId(null);
    }
  };

  // ========== 图片模型配置 ==========

  const loadImageModels = async () => {
    setImageModelsLoading(true);
    try {
      const response = await settingsApi.getImageModels();
      setImageModels(response.configs || []);
      setActiveImageModelId(response.active_config_id);
    } catch (error) {
      console.error('加载图片模型配置失败:', error);
    } finally {
      setImageModelsLoading(false);
    }
  };

  const openImageModelDrawer = (config?: ImageModelConfig) => {
    setEditingImageModel(config ?? null);
    coverForm.resetFields();
    if (config) {
      coverForm.setFieldsValue({
        name: config.name,
        note: config.note,
        api_provider: config.api_provider,
        api_key: config.api_key,
        api_base_url: config.api_base_url,
        image_model: config.image_model,
        model_display_name: config.model_display_name,
      });
    } else {
      coverForm.setFieldsValue({
        api_provider: coverApiProviders[0].value,
        api_key: '',
        api_base_url: coverApiProviders[0].defaultUrl,
        image_model: coverApiProviders[0].defaultModel,
        model_display_name: '',
      });
    }
    setImageModelModalOpen(true);
  };

  const editingSharedImageConfig = Boolean(editingImageModel?.shared_config_id);
  const editingSharedImageProviderLabel = editingImageModel
    ? coverApiProviders.find((provider) => provider.value === editingImageModel.api_provider)?.label
      || editingImageModel.api_provider.toUpperCase()
    : '';

  const handleImageModelSave = async () => {
    try {
      const values = await coverForm.validateFields();
      const payload = {
        name: String(values.name ?? '').trim(),
        note: values.note ? String(values.note) : undefined,
        api_provider: String(values.api_provider ?? 'openai'),
        api_key: String(values.api_key ?? ''),
        api_base_url: values.api_base_url ? String(values.api_base_url) : undefined,
        image_model: String(values.image_model ?? ''),
        model_display_name: String(values.model_display_name ?? '').trim() || null,
      };

      setSavingImageModel(true);
      if (editingImageModel) {
        await settingsApi.updateImageModel(editingImageModel.id, payload);
        message.success('图片配置已更新');
      } else {
        await settingsApi.createImageModel(payload);
        message.success('图片配置已保存');
      }
      setImageModelModalOpen(false);
      setEditingImageModel(null);
      coverForm.resetFields();
      await loadImageModels();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.response?.data?.detail || '保存图片配置失败');
    } finally {
      setSavingImageModel(false);
    }
  };

  const handleImageModelActivate = async (config: ImageModelConfig) => {
    if (config.id === activeImageModelId) return;
    setSwitchingImageModelId(config.id);
    try {
      await settingsApi.activateImageModel(config.id);
      await Promise.all([loadImageModels(), loadSettings()]);
      message.success(`已切换到「${config.name}」`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '切换图片配置失败');
    } finally {
      setSwitchingImageModelId(null);
    }
  };

  const handleImageModelDelete = async (config: ImageModelConfig) => {
    try {
      await settingsApi.deleteImageModel(config.id);
      await loadImageModels();
      message.success(config.shared_config_id ? '已从列表移除' : '图片配置已删除');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '删除图片配置失败');
    }
  };

  const handleImageModelTest = async (config: ImageModelConfig) => {
    setTestingImageModelId(config.id);
    try {
      const result = await settingsApi.testImageModel(config.id);
      if (result.success) {
        message.success(
          `「${config.name}」连接正常${result.model ? ` · ${result.model}` : ''}`,
        );
      } else {
        message.error(result.message || '图片接口测试失败');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '图片接口测试失败');
    } finally {
      setTestingImageModelId(null);
    }
  };

  return (
    <>
      {contextHolder}
      <div className="st-page" style={themeVars}>
        <div className="st-shell">
          <header className="st-header">
            <div className="st-header-main">
              <span className="st-header-icon"><SettingOutlined /></span>
              <div className="st-header-copy">
                <div className="st-title-row">
                  <h1 className="st-title">API 设置</h1>
                  <span className={`st-status${hasSettings && !isDefaultSettings ? ' st-status--saved' : ''}`}>
                    {hasSettings && !isDefaultSettings ? '个人配置' : isDefaultSettings ? '环境默认' : '未配置'}
                  </span>
                </div>
                <p className="st-subtitle">保存多套文本模型配置随时切换，并为章节分析单独指定一套，图片模型接口独立管理。</p>
              </div>
            </div>
          </header>

          <div className="st-panel">
            <Tabs
              className="st-tabs"
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'current',
                  label: <Space size={6}><ThunderboltOutlined />文本模型</Space>,
                  children: (
                    <div className="st-tab-body">
                      <div className="st-models">
                        <div className="st-models-head">
                          <div className="st-models-head-copy">
                            <div className="st-models-title">
                              文本模型
                              <span className="st-models-count">{textModels.length}</span>
                            </div>
                            <div className="st-models-desc">
                              同一时间只启用一套用于正文写作，点击卡片即可编辑。
                            </div>
                          </div>
                          <Button type="primary" icon={<PlusOutlined />} onClick={() => openTextModelModal()}>
                            新增配置
                          </Button>
                        </div>

                        {textModels.length > 0 && (
                          <div className="st-role-row">
                            <Tooltip title="自动分析、手动重跑、一键分析、记忆分析都会使用这套配置；留空则跟随当前启用配置，不受写作切换影响。">
                              <span className="st-role-row-label">
                                <FileTextOutlined />
                                章节分析模型
                              </span>
                            </Tooltip>
                            <Select
                              size="small"
                              allowClear
                              placeholder="跟随当前启用配置"
                              value={chapterAnalysisTextModelId}
                              loading={savingChapterAnalysisModel || textModelsLoading}
                              disabled={savingChapterAnalysisModel}
                              className="st-role-row-select"
                              popupMatchSelectWidth={false}
                              onChange={(value) => handleChapterAnalysisModelChange(value)}
                              options={textModels.map((config) => ({
                                value: config.id,
                                label: `${config.name} · ${config.llm_model}`,
                              }))}
                            />
                          </div>
                        )}

                        <Spin spinning={textModelsLoading}>
                          {textModels.length === 0 ? (
                            <div className="st-models-empty">
                              <span className="st-models-empty-icon" aria-hidden="true">
                                <ThunderboltOutlined />
                              </span>
                              <div className="st-models-empty-title">还没有任何模型配置</div>
                              <p className="st-models-empty-desc">
                                点击「新增配置」，填写接口地址与模型参数，保存后即会在这里生成一张卡片。
                              </p>
                            </div>
                          ) : (
                            <>
                              {!activeTextModelId && (
                                <div className="st-models-hint">
                                  当前没有启用中的卡片，写作时会沿用上一次生效的接口配置；点击「启用」即可切换。
                                </div>
                              )}
                              <div className="st-model-cards">
                                {textModels.map((config) => {
                                  const isActive = config.id === activeTextModelId;
                                  const isChapterAnalysis = config.id === chapterAnalysisTextModelId;
                                  return (
                                  <article
                                    key={config.id}
                                    className={`st-model-card${isActive ? ' st-model-card--active' : ''}`}
                                    onClick={() => openTextModelModal(config)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        openTextModelModal(config);
                                      }
                                    }}
                                  >
                                    <div className="st-model-card-head">
                                      <span className={`st-provider-dot st-provider-dot--${config.api_provider}`} />
                                      <span className="st-model-card-name" title={config.name}>{config.name}</span>
                                      <div className="st-model-card-flags">
                                        {config.shared_config_id && (
                                          <span
                                            className="st-model-card-role"
                                            title="由管理员提供，参数与密钥统一维护，无需自己填写"
                                          >
                                            公共配置
                                          </span>
                                        )}
                                        {isChapterAnalysis && <span className="st-model-card-role">章节分析</span>}
                                        {isActive && <span className="st-model-card-badge">使用中</span>}
                                      </div>
                                    </div>

                                    <div className="st-model-card-model" title={config.llm_model}>
                                      {config.llm_model}
                                    </div>

                                    <div className="st-model-card-meta">
                                      <span>{config.shared_config_id ? '管理员提供' : config.api_provider.toUpperCase()}</span>
                                      {config.shared_config_id ? (
                                        <>
                                          {config.quota_daily_limit != null && (
                                            <span
                                              className={`st-model-card-quota${
                                                config.quota_daily_remaining === 0
                                                  ? ' st-model-card-quota--empty'
                                                  : ''
                                              }`}
                                            >
                                              今日剩余 {config.quota_daily_remaining ?? 0}/{config.quota_daily_limit}
                                            </span>
                                          )}
                                          {config.quota_total_limit != null && (
                                            <span
                                              className={`st-model-card-quota${
                                                config.quota_total_remaining === 0
                                                  ? ' st-model-card-quota--empty'
                                                  : ''
                                              }`}
                                            >
                                              累计剩余 {config.quota_total_remaining ?? 0}/{config.quota_total_limit}
                                            </span>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          <span>温度 {config.temperature}</span>
                                          <span>{config.max_tokens.toLocaleString()} tokens</span>
                                        </>
                                      )}
                                    </div>

                                    {config.note && (
                                      <p className="st-model-card-note" title={config.note}>{config.note}</p>
                                    )}

                                    <div className="st-model-card-foot" onClick={(event) => event.stopPropagation()}>
                                      {isActive ? (
                                        <span className="st-model-card-current">
                                          <CheckCircleOutlined /> 当前生效
                                        </span>
                                      ) : (
                                        <Button
                                          size="small"
                                          type="primary"
                                          loading={switchingTextModelId === config.id}
                                          onClick={() => handleTextModelActivate(config)}
                                        >
                                          启用
                                        </Button>
                                      )}
                                      <div className="st-model-card-actions">
                                        <Button
                                          size="small"
                                          type="text"
                                          icon={<ThunderboltOutlined />}
                                          loading={testingTextModelId === config.id}
                                          onClick={() => handleTextModelTest(config)}
                                        >
                                          测试
                                        </Button>
                                        <Button
                                          size="small"
                                          type="text"
                                          icon={<EditOutlined />}
                                          onClick={() => openTextModelModal(config)}
                                        >
                                          {config.shared_config_id ? '查看' : '编辑'}
                                        </Button>
                                        {!config.shared_config_id && (
                                          <Popconfirm
                                            title="确定删除此配置吗？"
                                            description={isActive ? '删除卡片不会清空下方正在使用的接口配置' : undefined}
                                            onConfirm={() => handleTextModelDelete(config)}
                                            okText="删除"
                                            cancelText="取消"
                                          >
                                            <Button
                                              size="small"
                                              type="text"
                                              danger
                                              icon={<DeleteOutlined />}
                                            />
                                          </Popconfirm>
                                        )}
                                      </div>
                                    </div>
                                  </article>
                                );
                                })}
                              </div>
                            </>
                          )}
                        </Spin>
                      </div>

                    </div>
                  ),
                },
                {
                  key: 'cover',
                  label: <Space size={6}><PictureOutlined />图片模型</Space>,
                  children: (
                    <div className="st-tab-body">
                      <div className="st-models">
                        <Form
                          className="st-cover-enable"
                          form={form}
                          onFinish={handleSave}
                          autoComplete="off"
                        >
                          <Form.Item noStyle shouldUpdate={(prev, next) => prev.cover_enabled !== next.cover_enabled}>
                            {({ getFieldValue }) => {
                              const coverEnabled = Boolean(getFieldValue('cover_enabled'));
                              return (
                                <div className={`st-cover-status${coverEnabled ? ' st-cover-status--on' : ''}`}>
                                  <span className="st-cover-status-icon"><PictureOutlined /></span>
                                  <div className="st-cover-status-copy">
                                    <div className="st-cover-status-title">
                                      封面图片生成
                                      <span className="st-cover-status-badge">{coverEnabled ? '已启用' : '已停用'}</span>
                                    </div>
                                    <p>用于书架封面自动生成；停用后不影响已有封面。</p>
                                  </div>
                                  <Form.Item name="cover_enabled" valuePropName="checked" noStyle>
                                    <Switch
                                      loading={loading}
                                      onChange={(checked) => {
                                        form.setFieldValue('cover_enabled', checked);
                                        void form.submit();
                                      }}
                                    />
                                  </Form.Item>
                                </div>
                              );
                            }}
                          </Form.Item>
                        </Form>

                        <div className="st-models-head">
                          <div className="st-models-head-copy">
                            <div className="st-models-title">
                              图片模型
                              <span className="st-models-count">{imageModels.length}</span>
                            </div>
                            <div className="st-models-desc">
                              同一时间启用一套用于封面生成，点击卡片即可编辑。
                            </div>
                          </div>
                          <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => openImageModelDrawer()}
                          >
                            新增配置
                          </Button>
                        </div>

                        <Spin spinning={imageModelsLoading}>
                          {imageModels.length === 0 ? (
                            <div className="st-models-empty">
                              <span className="st-models-empty-icon" aria-hidden="true">
                                <PictureOutlined />
                              </span>
                              <div className="st-models-empty-title">还没有图片模型配置</div>
                              <p className="st-models-empty-desc">
                                新增一套生图接口后即可用于封面生成，也可以加载管理员提供的公共图片配置。
                              </p>
                            </div>
                          ) : (
                            <div className="st-model-cards">
                              {imageModels.map((config) => {
                                const isActive = config.id === activeImageModelId;
                                const providerLabel =
                                  coverApiProviders.find(
                                    (provider) => provider.value === config.api_provider,
                                  )?.label || config.api_provider.toUpperCase();
                                return (
                                  <article
                                    key={config.id}
                                    className={`st-model-card${isActive ? ' st-model-card--active' : ''}`}
                                    onClick={() => openImageModelDrawer(config)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        openImageModelDrawer(config);
                                      }
                                    }}
                                  >
                                    <div className="st-model-card-head">
                                      <span className="st-provider-dot st-provider-dot--gemini" />
                                      <span className="st-model-card-name" title={config.name}>
                                        {config.name}
                                      </span>
                                      <div className="st-model-card-flags">
                                        {config.shared_config_id && (
                                          <span className="st-model-card-role">公共配置</span>
                                        )}
                                        {isActive && <span className="st-model-card-badge">使用中</span>}
                                      </div>
                                    </div>
                                    <div className="st-model-card-model" title={config.image_model}>
                                      {config.model_display_name || config.image_model}
                                    </div>
                                    <div className="st-model-card-meta">
                                      <span>{config.shared_config_id ? '管理员提供' : providerLabel}</span>
                                      {config.shared_config_id && config.quota_daily_limit != null && (
                                        <span
                                          className={`st-model-card-quota${
                                            config.quota_daily_remaining === 0
                                              ? ' st-model-card-quota--empty'
                                              : ''
                                          }`}
                                        >
                                          今日剩余 {config.quota_daily_remaining ?? 0}/{config.quota_daily_limit}
                                        </span>
                                      )}
                                      {config.shared_config_id && config.quota_total_limit != null && (
                                        <span
                                          className={`st-model-card-quota${
                                            config.quota_total_remaining === 0
                                              ? ' st-model-card-quota--empty'
                                              : ''
                                          }`}
                                        >
                                          累计剩余 {config.quota_total_remaining ?? 0}/{config.quota_total_limit}
                                        </span>
                                      )}
                                      {!config.shared_config_id &&
                                        config.model_display_name &&
                                        config.model_display_name !== config.image_model && (
                                        <span>{config.image_model}</span>
                                      )}
                                    </div>
                                    {config.note && (
                                      <p className="st-model-card-note" title={config.note}>
                                        {config.note}
                                      </p>
                                    )}
                                    <div
                                      className="st-model-card-foot"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      {isActive ? (
                                        <span className="st-model-card-current">
                                          <CheckCircleOutlined /> 当前生效
                                        </span>
                                      ) : (
                                        <Button
                                          size="small"
                                          type="primary"
                                          loading={switchingImageModelId === config.id}
                                          onClick={() => handleImageModelActivate(config)}
                                        >
                                          启用
                                        </Button>
                                      )}
                                      <div className="st-model-card-actions">
                                        <Button
                                          size="small"
                                          type="text"
                                          icon={<ThunderboltOutlined />}
                                          loading={testingImageModelId === config.id}
                                          onClick={() => handleImageModelTest(config)}
                                        >
                                          测试
                                        </Button>
                                        <Button
                                          size="small"
                                          type="text"
                                          icon={<EditOutlined />}
                                          onClick={() => openImageModelDrawer(config)}
                                        >
                                          {config.shared_config_id ? '查看' : '编辑'}
                                        </Button>
                                        <Popconfirm
                                          title={
                                            config.shared_config_id
                                              ? '从列表移除这套公共图片配置？'
                                              : '确定删除此图片配置吗？'
                                          }
                                          onConfirm={() => handleImageModelDelete(config)}
                                          okText={config.shared_config_id ? '移除' : '删除'}
                                          cancelText="取消"
                                        >
                                          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                                        </Popconfirm>
                                      </div>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          )}
                        </Spin>
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>

        {/* 文本模型配置抽屉 */}
        <Drawer
          title={
            editingSharedConfig
              ? '公共配置（参数由管理员维护）'
              : editingTextModel
                ? '编辑模型配置'
                : '新增模型配置'
          }
          open={textModelModalOpen}
          onClose={() => {
            setTextModelModalOpen(false);
            setEditingTextModel(null);
            textModelForm.resetFields();
          }}
          width={isMobile ? '100%' : 560}
          className="st-drawer"
          rootStyle={themeVars}
          styles={{
            body: { padding: 0 },
          }}
          footer={
            <div className="st-drawer-footer">
              {editingSharedConfig && editingTextModel ? (
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={testingTextModelId === editingTextModel.id}
                  onClick={() => handleTextModelTest(editingTextModel)}
                >
                  {testingTextModelId === editingTextModel.id ? '测试中…' : '测试连接'}
                </Button>
              ) : (
                <Button icon={<ThunderboltOutlined />} loading={testingApi} onClick={handleTestConnection}>
                  {testingApi ? '测试中…' : '测试连接'}
                </Button>
              )}
              <div className="st-drawer-footer-main">
                <Button
                  onClick={() => {
                    setTextModelModalOpen(false);
                    setEditingTextModel(null);
                    textModelForm.resetFields();
                  }}
                >
                  {editingSharedConfig ? '关闭' : '取消'}
                </Button>
                {!editingSharedConfig && (
                  <Button type="primary" icon={<SaveOutlined />} loading={savingTextModel} onClick={handleTextModelSave}>
                    {savingTextModel ? '保存中…' : '保存'}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="st-drawer-body">
          <Form form={textModelForm} layout="vertical" size={isMobile ? 'middle' : 'large'} autoComplete="off">
            {editingSharedConfig && (
              <Alert
                className="st-drawer-test"
                type="info"
                showIcon
                message="这是管理员提供的公共配置"
                description="接口地址、密钥、模型与参数都由管理员统一维护，无法修改。启用后会直接使用管理员的额度；管理员停用后这张卡片会自动从列表消失。"
              />
            )}
            {testResult && (
              <Alert
                className="st-drawer-test"
                type={testResult.success ? 'success' : 'error'}
                showIcon
                closable
                onClose={() => setTestResult(null)}
                message={testResult.success ? '连接成功' : '连接失败'}
                description={
                  testResult.success
                    ? `响应时间 ${testResult.response_time_ms ?? '—'} ms${
                        testResult.response_preview ? ` · ${testResult.response_preview.slice(0, 60)}` : ''
                      }`
                    : testResult.error || testResult.message
                }
              />
            )}
            <div className="st-section">
              <div className="st-section-head">
                <span className="st-section-icon"><SettingOutlined /></span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">基本信息</h3>
                  <p className="st-section-desc">给这套配置起个名字，方便在卡片列表中识别。</p>
                </div>
              </div>
              <Form.Item
                name="name"
                label={<FieldLabel text="配置名称" hint="例如：主账号 · Grok" />}
                rules={[{ required: true, message: '请输入配置名称' }, { max: 50, message: '不能超过 50 个字符' }]}
              >
                <Input placeholder="例如：主账号 · Grok" disabled={sharedFieldsDisabled} />
              </Form.Item>
              <Form.Item name="note" label={<FieldLabel text="备注" hint="可选，用于说明这套配置的用途" />} className="st-field-last">
                <Input
                  placeholder="例如：日常正文写作（可选）"
                  maxLength={200}
                  disabled={sharedFieldsDisabled}
                />
              </Form.Item>
            </div>

            {editingSharedConfig && editingTextModel && (
              <div className="st-section">
                <div className="st-section-head">
                  <span className="st-section-icon"><SlidersOutlined /></span>
                  <div className="st-section-head-copy">
                    <h3 className="st-section-title">配置概览</h3>
                    <p className="st-section-desc">
                      接口地址、密钥与系统提示词由管理员统一维护，不会下发给客户端。
                    </p>
                  </div>
                </div>
                <dl className="st-shared-meta">
                  <div className="st-shared-meta-item">
                    <dt>模型名称</dt>
                    <dd className="st-shared-meta-mono">
                      {editingTextModel.llm_model}
                    </dd>
                  </div>
                  <div className="st-shared-meta-item">
                    <dt>温度参数</dt>
                    <dd>{editingTextModel.temperature}</dd>
                  </div>
                  <div className="st-shared-meta-item">
                    <dt>最大 Token</dt>
                    <dd>{editingTextModel.max_tokens.toLocaleString()}</dd>
                  </div>
                  <div className="st-shared-meta-item">
                    <dt>关闭模型思考</dt>
                    <dd>{editingTextModel.disable_thinking ? '已开启' : '未开启'}</dd>
                  </div>
                  {editingTextModel.quota_daily_limit != null && (
                    <div className="st-shared-meta-item">
                      <dt>今日剩余调用</dt>
                      <dd>
                        {editingTextModel.quota_daily_remaining ?? 0} / {editingTextModel.quota_daily_limit} 次
                      </dd>
                    </div>
                  )}
                  {editingTextModel.quota_total_limit != null && (
                    <div className="st-shared-meta-item">
                      <dt>累计剩余调用</dt>
                      <dd>
                        {editingTextModel.quota_total_remaining ?? 0} / {editingTextModel.quota_total_limit} 次
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {!editingSharedConfig && (
            <div className="st-section">
              <div className="st-section-head">
                <span className="st-section-icon"><LinkOutlined /></span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">接口连接</h3>
                  <p className="st-section-desc">选择服务商并填写访问凭证。</p>
                </div>
              </div>
              <Form.Item
                name="api_provider"
                label={<FieldLabel text="API 提供商" hint="选择你的 AI 服务提供商" />}
                rules={[{ required: true, message: '请选择 API 提供商' }]}
              >
                <Select
                  placeholder="选择提供商"
                  disabled={sharedFieldsDisabled}
                  onChange={handleTextModelProviderChange}
                >
                  {textApiProviders.map(provider => (
                    <Option key={provider.value} value={provider.value}>
                      {provider.label}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="api_key"
                label={<FieldLabel text="API 密钥" hint="该密钥仅用于这套配置" />}
                rules={builtInKeyProviders.includes(String(selectedProvider))
                  ? []
                  : [{ required: true, message: '请输入 API 密钥' }]}
              >
                <Input.Password
                  placeholder={builtInKeyProviders.includes(String(selectedProvider)) ? '使用后端内置密钥' : 'sk-...'}
                  autoComplete="new-password"
                  disabled={sharedFieldsDisabled || builtInKeyProviders.includes(String(selectedProvider))}
                  className="st-input-mono"
                />
              </Form.Item>

              <Form.Item
                name="api_base_url"
                label={<FieldLabel text="API 地址" hint="接口的基础 URL，通常以 /v1 结尾" />}
                rules={[
                  { required: true, message: '请输入 API 地址' },
                  { type: 'url', message: '请输入有效的 URL' },
                ]}
                className="st-field-last"
              >
                <Input
                  placeholder="https://api.openai.com/v1"
                  disabled={sharedFieldsDisabled}
                  className="st-input-mono"
                />
              </Form.Item>

            </div>
            )}

            {!editingSharedConfig && (
            <div className="st-section">
              <div className="st-section-head">
                <span className="st-section-icon"><SlidersOutlined /></span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">模型参数</h3>
                  <p className="st-section-desc">控制模型选择、生成随机性与单次输出上限。</p>
                </div>
              </div>

              <Form.Item
                label={<FieldLabel text="模型名称" hint="例如 gpt-4、gemini-3-flash-preview" />}
                name="llm_model"
                rules={[{ required: true, message: '请输入或选择模型名称' }]}
              >
                <ModelSelectInput
                  isMobile={isMobile}
                  loading={fetchingModels}
                  refreshLabel="刷新"
                  onRefresh={() => {
                    if (!fetchingModels) {
                      setModelsFetched(false);
                      handleFetchModels(false);
                    }
                  }}
                  selectProps={{
                    showSearch: true,
                    disabled: sharedFieldsDisabled,
                    placeholder: isMobile ? '输入或选择模型' : '输入模型名称，或聚焦后自动获取',
                    optionFilterProp: 'label',
                    onFocus: handleModelSelectFocus,
                    onSearch: (value: string) => setModelSearchText(value),
                    onSelect: () => setModelSearchText(''),
                    onBlur: () => setModelSearchText(''),
                    filterOption: (input: string, option?: { value?: string; label?: string; description?: string }) => {
                      if (option?.value === input && !modelOptions.some(m => m.value === input)) return true;
                      return (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                        (option?.description ?? '').toLowerCase().includes(input.toLowerCase());
                    },
                    notFoundContent: fetchingModels ? (
                      <div className="st-dropdown-tip">
                        <Spin size="small" /> 加载中…
                      </div>
                    ) : null,
                    options: (() => {
                      const opts = modelOptions.map(model => ({
                        value: model.value,
                        label: model.label,
                        description: model.description,
                      }));
                      if (modelSearchText && !modelOptions.some(m =>
                        m.value.toLowerCase() === modelSearchText.toLowerCase() ||
                        m.label.toLowerCase() === modelSearchText.toLowerCase()
                      )) {
                        opts.unshift({
                          value: modelSearchText,
                          label: modelSearchText,
                          description: '手动输入的模型名称',
                        });
                      }
                      return opts;
                    })(),
                  }}
                />
              </Form.Item>

              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    label={
                      <FieldLabel
                        text="温度参数"
                        hint="控制输出的随机性，值越高越随机（0.0 - 2.0）"
                        extra={
                          <span className="st-value-chip">
                            {typeof temperatureWatch === 'number' ? temperatureWatch.toFixed(1) : '—'}
                          </span>
                        }
                      />
                    }
                    name="temperature"
                  >
                    <Slider
                      className="st-slider"
                      min={0}
                      max={2}
                      step={0.1}
                      disabled={sharedFieldsDisabled}
                      tooltip={{ open: false }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    label={<FieldLabel text="最大 Token 数" hint="单次请求允许输出的最大 token 数量" />}
                    name="max_tokens"
                    rules={[{ required: true, message: '请输入最大 token 数' }]}
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={1}
                      placeholder="32000"
                      disabled={sharedFieldsDisabled}
                      addonAfter={<span className="st-input-unit">tokens</span>}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <div className="st-inline-setting">
                <span className="st-inline-setting-icon"><BulbOutlined /></span>
                <div className="st-inline-setting-copy">
                  <div className="st-inline-setting-label">关闭模型思考</div>
                  <div className="st-inline-setting-desc">
                    思考型模型开启后跳过思考阶段，降低等待时间与 Token 消耗。
                  </div>
                </div>
                <Form.Item name="disable_thinking" valuePropName="checked" noStyle>
                  <Switch disabled={sharedFieldsDisabled} />
                </Form.Item>
              </div>
            </div>
            )}

            {!editingSharedConfig && (
            <div className="st-section st-section--last">
              <div className="st-section-head">
                <span className="st-section-icon"><FileTextOutlined /></span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">系统提示词</h3>
                  <p className="st-section-desc">仅对这套配置生效，启用后自动附加到每次调用。</p>
                </div>
              </div>
              <Form.Item name="system_prompt" className="st-field-last">
                <TextArea
                  rows={4}
                  disabled={sharedFieldsDisabled}
                  placeholder="例如：你是一个专业的小说创作助手，请用生动、细腻的文字进行创作…"
                  maxLength={10000}
                  showCount
                />
              </Form.Item>
            </div>
            )}
          </Form>
          </div>
        </Drawer>

        {/* 图片模型配置抽屉 */}
        <Drawer
          title={
            editingSharedImageConfig
              ? '公共图片配置（由管理员维护）'
              : editingImageModel
                ? '编辑图片模型'
                : '新增图片模型'
          }
          open={imageModelModalOpen}
          onClose={() => {
            setImageModelModalOpen(false);
            setEditingImageModel(null);
            coverForm.resetFields();
          }}
          width={isMobile ? '100%' : 560}
          className="st-drawer"
          rootStyle={themeVars}
          styles={{ body: { padding: 0 } }}
          footer={
            <div className="st-drawer-footer">
              {editingSharedImageConfig && editingImageModel ? (
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={testingImageModelId === editingImageModel.id}
                  onClick={() => handleImageModelTest(editingImageModel)}
                >
                  测试连接
                </Button>
              ) : (
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={testingCoverApi}
                  onClick={handleCoverTestConnection}
                >
                  {testingCoverApi ? '测试中…' : '测试连接'}
                </Button>
              )}
              <div className="st-drawer-footer-main">
                <Button
                  onClick={() => {
                    setImageModelModalOpen(false);
                    setEditingImageModel(null);
                    coverForm.resetFields();
                  }}
                >
                  {editingSharedImageConfig ? '关闭' : '取消'}
                </Button>
                {!editingSharedImageConfig && (
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={savingImageModel}
                    onClick={handleImageModelSave}
                  >
                    {savingImageModel ? '保存中…' : '保存'}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="st-drawer-body">
            <Form
              form={coverForm}
              layout="vertical"
              size={isMobile ? 'middle' : 'large'}
              autoComplete="off"
            >
              {editingSharedImageConfig && (
                <Alert
                  className="st-drawer-test"
                  type="info"
                  showIcon
                  message="这是管理员提供的公共图片配置"
                  description="接口地址、密钥和模型都由管理员统一维护，无法修改。启用后会使用管理员的额度生成封面。"
                />
              )}

              {editingSharedImageConfig && editingImageModel && (
                <div className="st-section">
                  <div className="st-section-head">
                    <span className="st-section-icon"><SlidersOutlined /></span>
                    <div className="st-section-head-copy">
                      <h3 className="st-section-title">配置概览</h3>
                      <p className="st-section-desc">
                        接口地址、密钥与真实模型不会下发给客户端。
                      </p>
                    </div>
                  </div>
                  <dl className="st-shared-meta">
                    <div className="st-shared-meta-item">
                      <dt>配置名称</dt>
                      <dd>{editingImageModel.name}</dd>
                    </div>
                    <div className="st-shared-meta-item">
                      <dt>图片模型</dt>
                      <dd className="st-shared-meta-mono">
                        {editingImageModel.model_display_name || editingImageModel.image_model}
                      </dd>
                    </div>
                    <div className="st-shared-meta-item">
                      <dt>图片服务</dt>
                      <dd>{editingSharedImageProviderLabel}</dd>
                    </div>
                    <div className="st-shared-meta-item">
                      <dt>接口凭证</dt>
                      <dd>由管理员统一维护</dd>
                    </div>
                    {editingImageModel.quota_daily_limit != null && (
                      <div className="st-shared-meta-item">
                        <dt>今日剩余生成</dt>
                        <dd>
                          {editingImageModel.quota_daily_remaining ?? 0} /{' '}
                          {editingImageModel.quota_daily_limit} 次
                        </dd>
                      </div>
                    )}
                    {editingImageModel.quota_total_limit != null && (
                      <div className="st-shared-meta-item">
                        <dt>累计剩余生成</dt>
                        <dd>
                          {editingImageModel.quota_total_remaining ?? 0} /{' '}
                          {editingImageModel.quota_total_limit} 次
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {!editingSharedImageConfig && (
                <>
                  <div className="st-section">
                    <div className="st-section-head">
                      <span className="st-section-icon"><SettingOutlined /></span>
                      <div className="st-section-head-copy">
                        <h3 className="st-section-title">基本信息</h3>
                        <p className="st-section-desc">用名称和备注区分不同的生图渠道。</p>
                      </div>
                    </div>
                    <Form.Item
                      name="name"
                      label={<FieldLabel text="配置名称" hint="例如：主账号 · Gemini 图片" />}
                      rules={[
                        { required: true, message: '请输入配置名称' },
                        { max: 50, message: '不能超过 50 个字符' },
                      ]}
                    >
                      <Input placeholder="例如：主账号 · Gemini 图片" />
                    </Form.Item>
                    <Form.Item
                      name="note"
                      label={<FieldLabel text="备注" hint="可选，用于说明这套图片配置的用途" />}
                      className="st-field-last"
                    >
                      <Input placeholder="例如：书籍封面生成（可选）" maxLength={200} />
                    </Form.Item>
                  </div>

                  <div className="st-section">
                    <div className="st-section-head">
                      <span className="st-section-icon"><LayoutOutlined /></span>
                      <div className="st-section-head-copy">
                        <h3 className="st-section-title">服务与模型</h3>
                        <p className="st-section-desc">切换服务商会自动填入推荐地址与默认模型。</p>
                      </div>
                    </div>
                    <div className="st-field-grid">
                      <Form.Item
                        label={<FieldLabel text="图片 Provider" hint="提供图片生成能力的服务商" />}
                        name="api_provider"
                        rules={[{ required: true, message: '请选择图片 Provider' }]}
                      >
                        <Select onChange={handleCoverProviderChange}>
                          {coverApiProviders.map((provider) => (
                            <Option key={provider.value} value={provider.value}>
                              {provider.label}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                      <Form.Item
                        label={<FieldLabel text="图片模型" hint="生成封面所使用的真实模型名称" />}
                        name="image_model"
                        rules={[{ required: true, message: '请输入图片模型名称' }]}
                      >
                        <Input
                          className="st-input-mono"
                          placeholder={
                            selectedCoverProvider === 'openai'
                              ? 'gpt-image-1'
                              : selectedCoverProvider === 'grok'
                                ? 'grok-2-image'
                                : 'gemini-2.0-flash-exp-image-generation'
                          }
                        />
                      </Form.Item>
                    </div>
                    <Form.Item
                      label={
                        <FieldLabel
                          text="模型显示名称"
                          hint="用户在卡片和测试结果里看到的名称；留空则显示真实模型名"
                        />
                      }
                      name="model_display_name"
                      rules={[{ max: 100, message: '不能超过 100 个字符' }]}
                    >
                      <Input placeholder="例如：封面绘图（留空则显示真实模型名）" allowClear />
                    </Form.Item>
                  </div>

                  <div className="st-section">
                    <div className="st-section-head">
                      <span className="st-section-icon"><KeyOutlined /></span>
                      <div className="st-section-head-copy">
                        <h3 className="st-section-title">接口凭证</h3>
                        <p className="st-section-desc">密钥仅保存在服务端，不会返回前端。</p>
                      </div>
                    </div>
                    <Form.Item
                      label={<FieldLabel text="图片 API Key" hint="仅用于图片生成" />}
                      name="api_key"
                      rules={[{ required: true, message: '请输入图片 API Key' }]}
                    >
                      <Input.Password
                        className="st-input-mono"
                        placeholder={
                          '输入图片 API Key'
                        }
                        autoComplete="new-password"
                      />
                    </Form.Item>
                    <Form.Item
                      className="st-field-last"
                      label={
                        <FieldLabel
                          text="图片 API 地址"
                          hint="切换服务商会填入推荐值，也可以手动填写"
                        />
                      }
                      name="api_base_url"
                      rules={[
                        { required: true, message: '请输入图片 API 地址' },
                        { type: 'url', message: '请输入有效的 URL' },
                      ]}
                    >
                      <Input
                        className="st-input-mono"
                        allowClear
                        placeholder={
                          selectedCoverProvider === 'openai'
                            ? 'https://api.openai.com/v1'
                            : selectedCoverProvider === 'grok'
                              ? 'https://api.x.ai/v1'
                              : 'https://generativelanguage.googleapis.com/v1beta'
                        }
                      />
                    </Form.Item>
                  </div>
                </>
              )}
            </Form>
          </div>
        </Drawer>

      </div>
    </>
  );
}
