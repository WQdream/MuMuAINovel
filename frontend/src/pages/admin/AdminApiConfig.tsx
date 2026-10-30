import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Col,
  Drawer,
  Form,
  Grid,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Slider,
  Space,
  Spin,
  Switch,
  Tabs,
  Tooltip,
  message,
  theme,
} from 'antd';
import {
  BulbOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  PictureOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SettingOutlined,
  SlidersOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import ModelSelectInput, { FieldLabel } from '../../components/ModelSelectInput';
import {
  builtInKeyProviders,
  textApiProviders,
} from '../../constants/aiProviders';
import { adminApiConfig, adminImageApiConfig, settingsApi } from '../../services/api';
import type { SharedApiConfig, SharedImageApiConfig } from '../../types';
import '../Settings.css';
import './AdminApiConfig.css';

const { Option } = Select;
const { TextArea } = Input;
const { useBreakpoint } = Grid;

const imageApiProviders = [
  {
    value: 'openai',
    label: 'OpenAI 兼容',
    defaultUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-image-1',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash-exp-image-generation',
  },
  {
    value: 'grok',
    label: 'Grok',
    defaultUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-image',
  },
];

type TestResult = {
  success: boolean;
  message: string;
  response_time_ms?: number;
  response_preview?: string;
  error?: string;
};

export default function AdminApiConfig() {
  const { token } = theme.useToken();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm();
  const [imageForm] = Form.useForm();
  const activeTab = searchParams.get('tab') === 'image' ? 'image' : 'text';

  const [configs, setConfigs] = useState<SharedApiConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<SharedApiConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingApi, setTestingApi] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [imageTestResult, setImageTestResult] = useState<{
    success: boolean;
    message: string;
    provider?: string;
    model?: string;
  } | null>(null);
  const [modelOptions, setModelOptions] = useState<
    Array<{ value: string; label: string; description: string }>
  >([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [modelSearchText, setModelSearchText] = useState('');
  const [imageConfigs, setImageConfigs] = useState<SharedImageApiConfig[]>([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageDrawerOpen, setImageDrawerOpen] = useState(false);
  const [editingImage, setEditingImage] = useState<SharedImageApiConfig | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const [togglingImageId, setTogglingImageId] = useState<string | null>(null);
  const [testingImageId, setTestingImageId] = useState<string | null>(null);

  const selectedProvider = Form.useWatch('api_provider', form);
  const selectedImageProvider = Form.useWatch('api_provider', imageForm);
  const temperatureWatch = Form.useWatch('temperature', form);

  const quotaSummary = (record: { daily_call_limit?: number | null; total_call_limit?: number | null }) => {
    const parts: string[] = [];
    if (record.daily_call_limit) parts.push(`每日 ${record.daily_call_limit} 次`);
    if (record.total_call_limit) parts.push(`累计 ${record.total_call_limit} 次`);
    return parts.length ? parts.join(' · ') : '不限次数';
  };

  const handleTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (key === 'image') {
      next.set('tab', 'image');
    } else {
      next.delete('tab');
    }
    setSearchParams(next, { replace: true });
  };

  // Settings.css 的卡片/抽屉依赖 --st-* 变量，这里按管理后台主题补齐
  const themeVars = {
    '--st-page-bg': token.colorBgLayout,
    '--st-text': token.colorText,
    '--st-secondary': token.colorTextSecondary,
    '--st-tertiary': token.colorTextTertiary,
    '--st-border': token.colorBorderSecondary,
    '--st-fill': token.colorFillQuaternary,
    '--st-card-bg': token.colorBgContainer,
    '--st-accent': 'var(--editorial-accent)',
  } as CSSProperties;

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApiConfig.list();
      setConfigs(result || []);
    } catch (error) {
      console.error('加载公共 API 配置失败:', error);
      message.error('加载公共 API 配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadImageConfigs = useCallback(async () => {
    setImageLoading(true);
    try {
      const result = await adminImageApiConfig.list();
      setImageConfigs(result || []);
    } catch (error) {
      console.error('加载公共图片配置失败:', error);
      message.error('加载公共图片配置失败');
    } finally {
      setImageLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
    loadImageConfigs();
  }, [loadConfigs, loadImageConfigs]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditing(null);
    setTestResult(null);
    setModelOptions([]);
    setModelsFetched(false);
    setModelSearchText('');
    form.resetFields();
  };

  const openDrawer = (record?: SharedApiConfig) => {
    setEditing(record ?? null);
    setTestResult(null);
    setModelOptions([]);
    setModelsFetched(false);
    setModelSearchText('');
    form.resetFields();
    if (record) {
      form.setFieldsValue({
        name: record.name,
        note: record.note,
        api_provider: record.api_provider,
        api_key: record.api_key,
        api_base_url: record.api_base_url,
        llm_model: record.llm_model,
        model_display_name: record.model_display_name,
        temperature: record.temperature ?? 0.7,
        max_tokens: record.max_tokens ?? 2000,
        system_prompt: record.system_prompt,
        disable_thinking: Boolean(record.disable_thinking),
        daily_call_limit: record.daily_call_limit ?? null,
        total_call_limit: record.total_call_limit ?? null,
        is_enabled: record.is_enabled,
      });
    } else {
      form.setFieldsValue({
        api_provider: 'openai',
        temperature: 0.7,
        max_tokens: 2000,
        disable_thinking: false,
        daily_call_limit: null,
        total_call_limit: null,
        is_enabled: true,
      });
    }
    setDrawerOpen(true);
  };

  const handleProviderChange = (value: string) => {
    const provider = textApiProviders.find((item) => item.value === value);
    if (!provider) return;
    const next: Record<string, unknown> = { api_provider: provider.value };
    if (provider.defaultUrl) next.api_base_url = provider.defaultUrl;
    if (provider.defaultModel) next.llm_model = provider.defaultModel;
    if (builtInKeyProviders.includes(provider.value)) {
      next.api_key = '';
    }
    form.setFieldsValue(next);
    setModelOptions([]);
    setModelsFetched(false);
  };

  const handleFetchModels = async (silent = false) => {
    const apiKey = form.getFieldValue('api_key');
    const apiBaseUrl = form.getFieldValue('api_base_url');
    const provider = form.getFieldValue('api_provider');
    const isBuiltInKeyProvider = builtInKeyProviders.includes(provider);

    if ((!apiKey && !isBuiltInKeyProvider) || !apiBaseUrl) {
      if (!silent) message.warning('请先填写 API 密钥和 API 地址');
      return;
    }

    setFetchingModels(true);
    try {
      const response = await settingsApi.getAvailableModels({
        api_key: isBuiltInKeyProvider ? '' : apiKey,
        api_base_url: apiBaseUrl,
        provider: provider || 'openai',
      });
      setModelOptions(response.models);
      setModelsFetched(true);
      if (!silent) {
        message.success(`成功获取 ${response.count || response.models.length} 个可用模型`);
      }
    } catch (error) {
      const errorMsg =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any)?.response?.data?.detail || '获取模型列表失败';
      if (!silent) message.error(errorMsg);
      setModelOptions([]);
      setModelsFetched(true);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestConnection = async () => {
    const values = form.getFieldsValue();
    const isBuiltInKeyProvider = builtInKeyProviders.includes(values.api_provider);
    if (
      (!values.api_key && !isBuiltInKeyProvider) ||
      !values.api_base_url ||
      !values.api_provider ||
      !values.llm_model
    ) {
      message.warning('请先填写完整的配置信息');
      return;
    }

    setTestingApi(true);
    setTestResult(null);
    try {
      const result = await settingsApi.testApiConnection({
        api_key: isBuiltInKeyProvider ? '' : values.api_key,
        api_base_url: values.api_base_url,
        provider: values.api_provider,
        llm_model: values.llm_model,
        temperature: values.temperature,
        max_tokens: values.max_tokens,
      });
      setTestResult(result);
      if (result.success) {
        message.success(`测试成功！响应时间: ${result.response_time_ms}ms`);
      } else {
        message.error('API 测试失败，请查看详细信息');
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errorMsg = (error as any)?.response?.data?.detail || '测试请求失败';
      message.error(errorMsg);
      setTestResult({ success: false, message: '测试请求失败', error: errorMsg });
    } finally {
      setTestingApi(false);
    }
  };

  const handleSave = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const payload = {
      name: String(values.name ?? '').trim(),
      note: values.note ? String(values.note) : undefined,
      api_provider: String(values.api_provider ?? 'openai'),
      api_key: builtInKeyProviders.includes(String(values.api_provider))
        ? ''
        : String(values.api_key ?? ''),
      api_base_url: values.api_base_url ? String(values.api_base_url) : undefined,
      llm_model: String(values.llm_model ?? ''),
      model_display_name: String(values.model_display_name ?? '').trim() || null,
      temperature: Number(values.temperature ?? 0.7),
      max_tokens: Number(values.max_tokens ?? 2000),
      system_prompt: values.system_prompt ? String(values.system_prompt) : undefined,
      disable_thinking: Boolean(values.disable_thinking),
      daily_call_limit: values.daily_call_limit ? Number(values.daily_call_limit) : null,
      total_call_limit: values.total_call_limit ? Number(values.total_call_limit) : null,
      is_enabled: Boolean(values.is_enabled),
    };

    setSaving(true);
    try {
      if (editing) {
        await adminApiConfig.update(editing.id, payload);
        message.success('公共配置已更新');
      } else {
        await adminApiConfig.create(payload);
        message.success('公共配置已创建');
      }
      closeDrawer();
      await loadConfigs();
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (error as any)?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (record: SharedApiConfig, next: boolean) => {
    setTogglingId(record.id);
    try {
      const updated = await adminApiConfig.toggle(record.id, next);
      setConfigs((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      message.success(next ? '已开放给用户加载' : '已停止对用户开放');
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (error as any)?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : '操作失败');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (record: SharedApiConfig) => {
    try {
      await adminApiConfig.remove(record.id);
      setConfigs((prev) => prev.filter((item) => item.id !== record.id));
      message.success('已删除');
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (error as any)?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : '删除失败');
    }
  };

  const handleTestCard = async (record: SharedApiConfig) => {
    setTestingId(record.id);
    try {
      const result = await adminApiConfig.test(record.id);
      if (result.success) {
        message.success(`「${record.name}」连接正常，响应 ${result.response_time_ms ?? '—'} ms`);
      } else {
        message.error(result.error || result.message || '连接测试失败');
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (error as any)?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : '测试请求失败');
    } finally {
      setTestingId(null);
    }
  };

  const closeImageDrawer = () => {
    setImageDrawerOpen(false);
    setEditingImage(null);
    setImageTestResult(null);
    imageForm.resetFields();
  };

  const openImageDrawer = (record?: SharedImageApiConfig) => {
    setEditingImage(record ?? null);
    setImageTestResult(null);
    imageForm.resetFields();
    if (record) {
      imageForm.setFieldsValue({
        name: record.name,
        note: record.note,
        api_provider: record.api_provider,
        api_key: record.api_key,
        api_base_url: record.api_base_url,
        image_model: record.image_model,
        model_display_name: record.model_display_name,
        daily_call_limit: record.daily_call_limit ?? null,
        total_call_limit: record.total_call_limit ?? null,
        is_enabled: record.is_enabled,
      });
    } else {
      imageForm.setFieldsValue({
        api_provider: imageApiProviders[0].value,
        api_base_url: imageApiProviders[0].defaultUrl,
        image_model: imageApiProviders[0].defaultModel,
        daily_call_limit: null,
        total_call_limit: null,
        is_enabled: true,
      });
    }
    setImageDrawerOpen(true);
  };

  const handleImageProviderChange = (value: string) => {
    const provider = imageApiProviders.find((item) => item.value === value);
    if (!provider) return;
    imageForm.setFieldsValue({
      api_provider: provider.value,
      api_base_url: provider.defaultUrl,
      image_model: provider.defaultModel,
    });
    setImageTestResult(null);
  };

  const handleImageTestConnection = async () => {
    const values = imageForm.getFieldsValue();
    if (!values.api_provider || !values.image_model) {
      message.warning('请先填写图片 Provider 和模型名称');
      return;
    }
    if (!values.api_key) {
      message.warning('请输入图片 API Key');
      return;
    }
    if (!values.api_base_url) {
      message.warning('请输入图片 API 地址');
      return;
    }

    setTestingImageId('drawer');
    setImageTestResult(null);
    try {
      const result = await settingsApi.testCoverConnection({
        cover_api_provider: values.api_provider,
        cover_api_key: values.api_key || '',
        cover_api_base_url: values.api_base_url,
        cover_image_model: values.image_model,
      });
      setImageTestResult(result);
      if (result.success) {
        message.success('图片接口测试成功');
      } else {
        message.error(result.message || '图片接口测试失败');
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (error as any)?.response?.data?.detail;
      const errorMsg = typeof detail === 'string' ? detail : '图片接口测试失败';
      message.error(errorMsg);
      setImageTestResult({ success: false, message: errorMsg });
    } finally {
      setTestingImageId(null);
    }
  };

  const handleImageSave = async () => {
    let values;
    try {
      values = await imageForm.validateFields();
    } catch {
      return;
    }

    const payload = {
      name: String(values.name ?? '').trim(),
      note: values.note ? String(values.note) : undefined,
      api_provider: String(values.api_provider ?? 'openai'),
      api_key: String(values.api_key ?? ''),
      api_base_url: values.api_base_url ? String(values.api_base_url) : undefined,
      image_model: String(values.image_model ?? '').trim(),
      model_display_name: String(values.model_display_name ?? '').trim() || null,
      daily_call_limit: values.daily_call_limit ? Number(values.daily_call_limit) : null,
      total_call_limit: values.total_call_limit ? Number(values.total_call_limit) : null,
      is_enabled: Boolean(values.is_enabled),
    };

    setSavingImage(true);
    try {
      if (editingImage) {
        await adminImageApiConfig.update(editingImage.id, payload);
        message.success('公共图片配置已更新');
      } else {
        await adminImageApiConfig.create(payload);
        message.success('公共图片配置已创建');
      }
      closeImageDrawer();
      await loadImageConfigs();
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (error as any)?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : '保存图片配置失败');
    } finally {
      setSavingImage(false);
    }
  };

  const handleImageToggle = async (record: SharedImageApiConfig, next: boolean) => {
    setTogglingImageId(record.id);
    try {
      const updated = await adminImageApiConfig.toggle(record.id, next);
      setImageConfigs((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      message.success(next ? '已开放给用户加载' : '已停止对用户开放');
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (error as any)?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : '操作失败');
    } finally {
      setTogglingImageId(null);
    }
  };

  const handleImageDelete = async (record: SharedImageApiConfig) => {
    try {
      await adminImageApiConfig.remove(record.id);
      setImageConfigs((prev) => prev.filter((item) => item.id !== record.id));
      message.success('已删除');
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (error as any)?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : '删除失败');
    }
  };

  const handleImageTestCard = async (record: SharedImageApiConfig) => {
    setTestingImageId(record.id);
    try {
      const result = await adminImageApiConfig.test(record.id);
      if (result.success) {
        message.success(`「${record.name}」图片接口连接正常`);
      } else {
        message.error(result.message || '图片接口测试失败');
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (error as any)?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : '图片接口测试失败');
    } finally {
      setTestingImageId(null);
    }
  };

  const enabledCount = configs.filter((item) => item.is_enabled).length;
  const enabledImageCount = imageConfigs.filter((item) => item.is_enabled).length;

  return (
    <div className="adm-page apc-page" style={themeVars}>
      <div className="adm-page-head">
        <div className="adm-page-head-main">
          <h1 className="adm-page-title">API 配置</h1>
        </div>
        <div className="adm-page-actions">
          <Button
            icon={<ReloadOutlined />}
            onClick={activeTab === 'text' ? loadConfigs : loadImageConfigs}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => (activeTab === 'text' ? openDrawer() : openImageDrawer())}
          >
            新增配置
          </Button>
        </div>
      </div>

      <Tabs
        className="st-tabs apc-tabs"
        activeKey={activeTab}
        onChange={handleTabChange}
        items={[
          {
            key: 'text',
            label: (
              <Space size={6}>
                <FileTextOutlined />
                文本模型
                <span className="st-models-count">{configs.length}</span>
              </Space>
            ),
            children: (
      <div className="adm-panel apc-panel">
        <div className="apc-toolbar">
          <div className="apc-toolbar-copy">
            <span className="apc-toolbar-title">
              公共配置
              <span className="st-models-count">{configs.length}</span>
            </span>
            <span className="apc-toolbar-desc">
              已开放 {enabledCount} 条 · 停用后用户无法加载，已导入的卡片会立即失效
            </span>
          </div>
        </div>

        <Spin spinning={loading}>
          {configs.length === 0 ? (
            <div className="st-models-empty apc-empty">
              <span className="st-models-empty-icon" aria-hidden="true">
                <ThunderboltOutlined />
              </span>
              <div className="st-models-empty-title">还没有对外提供的公共配置</div>
              <p className="st-models-empty-desc">
                点击「新增配置」填写接口地址与模型参数，保存并开启开关后，用户即可在自己的 API
                设置里加载这套配置。
              </p>
            </div>
          ) : (
            <div className="st-model-cards apc-cards">
              {configs.map((record) => {
                const providerLabel =
                  textApiProviders.find((item) => item.value === record.api_provider)?.label ||
                  record.api_provider;
                return (
                  <article
                    key={record.id}
                    className={`st-model-card apc-card${record.is_enabled ? '' : ' apc-card--off'}`}
                    onClick={() => openDrawer(record)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openDrawer(record);
                      }
                    }}
                  >
                    <div className="st-model-card-head">
                      <span
                        className={`st-provider-dot st-provider-dot--${record.api_provider}`}
                        aria-hidden="true"
                      />
                      <span className="st-model-card-name" title={record.name}>
                        {record.name}
                      </span>
                      <div className="st-model-card-flags">
                        <span
                          className={`st-model-card-badge${
                            record.is_enabled ? '' : ' apc-badge--off'
                          }`}
                        >
                          {record.is_enabled ? '已开放' : '已停用'}
                        </span>
                      </div>
                    </div>

                    <div
                      className="st-model-card-model"
                      title={
                        record.model_display_name
                          ? `${record.model_display_name}（真实模型：${record.llm_model}）`
                          : record.llm_model
                      }
                    >
                      {record.model_display_name || record.llm_model}
                    </div>

                    {record.model_display_name && (
                      <div className="apc-real-model">
                        真实模型 <span>{record.llm_model}</span>
                      </div>
                    )}

                    <div className="st-model-card-meta">
                      <span>{providerLabel}</span>
                      <span>温度 {record.temperature ?? '—'}</span>
                      <span>{(record.max_tokens ?? 0).toLocaleString()} tokens</span>
                      {record.disable_thinking && <span>已关闭思考</span>}
                      <span className={record.daily_call_limit || record.total_call_limit ? 'apc-quota' : ''}>
                        {quotaSummary(record)}
                      </span>
                    </div>

                    {record.note && (
                      <p className="st-model-card-note" title={record.note}>
                        {record.note}
                      </p>
                    )}

                    <div
                      className="st-model-card-foot"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Tooltip
                        title={
                          record.is_enabled
                            ? '用户可在 API 设置中加载这套配置'
                            : '已停用：用户看不到，也无法加载'
                        }
                      >
                        <span className="apc-switch">
                          <Switch
                            size="small"
                            checked={record.is_enabled}
                            loading={togglingId === record.id}
                            onChange={(next) => handleToggle(record, next)}
                          />
                          <span className="apc-switch-label">
                            {record.is_enabled ? '开放中' : '已停用'}
                          </span>
                        </span>
                      </Tooltip>
                      <div className="st-model-card-actions">
                        <Button
                          size="small"
                          type="text"
                          icon={<ThunderboltOutlined />}
                          loading={testingId === record.id}
                          onClick={() => handleTestCard(record)}
                        >
                          测试
                        </Button>
                        <Button
                          size="small"
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => openDrawer(record)}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="确定删除此公共配置吗？"
                          description="已导入该配置的用户卡片会立即失效。"
                          onConfirm={() => handleDelete(record)}
                          okText="删除"
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
            ),
          },
          {
            key: 'image',
            label: (
              <Space size={6}>
                <PictureOutlined />
                图片模型
                <span className="st-models-count">{imageConfigs.length}</span>
              </Space>
            ),
            children: (
              <div className="adm-panel apc-panel">
                <div className="apc-toolbar">
                  <div className="apc-toolbar-copy">
                    <span className="apc-toolbar-title">
                      公共图片配置
                      <span className="st-models-count">{imageConfigs.length}</span>
                    </span>
                    <span className="apc-toolbar-desc">
                      已开放 {enabledImageCount} 条 · 用户启用后可直接用于封面生成，密钥不会下发
                    </span>
                  </div>
                </div>

                <Spin spinning={imageLoading}>
                  {imageConfigs.length === 0 ? (
                    <div className="st-models-empty apc-empty">
                      <span className="st-models-empty-icon" aria-hidden="true">
                        <PictureOutlined />
                      </span>
                      <div className="st-models-empty-title">还没有公共图片配置</div>
                      <p className="st-models-empty-desc">
                        新增一套生图接口并开放后，用户可在「API 设置 → 图片模型」中直接启用。
                      </p>
                    </div>
                  ) : (
                    <div className="st-model-cards apc-cards">
                      {imageConfigs.map((record) => {
                        const providerLabel =
                          imageApiProviders.find(
                            (item) => item.value === record.api_provider,
                          )?.label || record.api_provider.toUpperCase();
                        return (
                          <article
                            key={record.id}
                            className={`st-model-card apc-card${record.is_enabled ? '' : ' apc-card--off'}`}
                            onClick={() => openImageDrawer(record)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openImageDrawer(record);
                              }
                            }}
                          >
                            <div className="st-model-card-head">
                              <span className="st-provider-dot st-provider-dot--gemini" />
                              <span className="st-model-card-name" title={record.name}>
                                {record.name}
                              </span>
                              <div className="st-model-card-flags">
                                <span
                                  className={`st-model-card-badge${
                                    record.is_enabled ? '' : ' apc-badge--off'
                                  }`}
                                >
                                  {record.is_enabled ? '已开放' : '已停用'}
                                </span>
                              </div>
                            </div>

                            <div
                              className="st-model-card-model"
                              title={
                                record.model_display_name
                                  ? `${record.model_display_name}（真实模型：${record.image_model}）`
                                  : record.image_model
                              }
                            >
                              {record.model_display_name || record.image_model}
                            </div>
                            {record.model_display_name && (
                              <div className="apc-real-model">
                                真实模型 <span>{record.image_model}</span>
                              </div>
                            )}
                            <div className="st-model-card-meta">
                              <span>{providerLabel}</span>
                              <span>封面生成</span>
                              <span className={record.daily_call_limit || record.total_call_limit ? 'apc-quota' : ''}>
                                {quotaSummary(record)}
                              </span>
                            </div>
                            {record.note && (
                              <p className="st-model-card-note" title={record.note}>
                                {record.note}
                              </p>
                            )}

                            <div
                              className="st-model-card-foot"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Tooltip
                                title={
                                  record.is_enabled
                                    ? '用户可在 API 设置中启用这套图片配置'
                                    : '已停用：用户看不到，也无法加载'
                                }
                              >
                                <span className="apc-switch">
                                  <Switch
                                    size="small"
                                    checked={record.is_enabled}
                                    loading={togglingImageId === record.id}
                                    onChange={(next) => handleImageToggle(record, next)}
                                  />
                                  <span className="apc-switch-label">
                                    {record.is_enabled ? '开放中' : '已停用'}
                                  </span>
                                </span>
                              </Tooltip>
                              <div className="st-model-card-actions">
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<ThunderboltOutlined />}
                                  loading={testingImageId === record.id}
                                  onClick={() => handleImageTestCard(record)}
                                >
                                  测试
                                </Button>
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<EditOutlined />}
                                  onClick={() => openImageDrawer(record)}
                                >
                                  编辑
                                </Button>
                                <Popconfirm
                                  title="确定删除此公共图片配置吗？"
                                  description="已启用该配置的用户卡片会立即失效。"
                                  onConfirm={() => handleImageDelete(record)}
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
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </Spin>
              </div>
            ),
          },
        ]}
      />

      <Drawer
        title={editing ? '编辑公共配置' : '新增公共配置'}
        open={drawerOpen}
        onClose={closeDrawer}
        width={isMobile ? '100%' : 560}
        className="st-drawer"
        rootStyle={themeVars}
        styles={{ body: { padding: 0 } }}
        footer={
          <div className="st-drawer-footer">
            <Button icon={<ThunderboltOutlined />} loading={testingApi} onClick={handleTestConnection}>
              {testingApi ? '测试中…' : '测试连接'}
            </Button>
            <div className="st-drawer-footer-main">
              <Button onClick={closeDrawer}>取消</Button>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="st-drawer-body">
          <Form form={form} layout="vertical" size={isMobile ? 'middle' : 'large'} autoComplete="off">
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
                <span className="st-section-icon">
                  <SettingOutlined />
                </span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">基本信息</h3>
                  <p className="st-section-desc">名称与备注会直接展示在用户的加载列表中。</p>
                </div>
              </div>
              <Form.Item
                name="name"
                label={<FieldLabel text="配置名称" hint="用户在 API 设置里看到的名字" />}
                rules={[
                  { required: true, message: '请输入配置名称' },
                  { max: 50, message: '不能超过 50 个字符' },
                ]}
              >
                <Input placeholder="例如：官方免费通道 · Gemini" />
              </Form.Item>
              <Form.Item
                name="note"
                label={<FieldLabel text="备注" hint="说明适用场景、额度限制等" />}
              >
                <Input placeholder="例如：日常写作通用，勿用于长文分析" maxLength={200} />
              </Form.Item>
              <div className="st-inline-setting">
                <span className="st-inline-setting-icon">
                  <ThunderboltOutlined />
                </span>
                <div className="st-inline-setting-copy">
                  <div className="st-inline-setting-label">开放给用户加载</div>
                  <div className="st-inline-setting-desc">
                    关闭后用户在「API 设置」里看不到这条配置，已导入的卡片也会立即失效。
                  </div>
                </div>
                <Form.Item name="is_enabled" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </div>
            </div>

            <div className="st-section">
              <div className="st-section-head">
                <span className="st-section-icon">
                  <StopOutlined />
                </span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">用户调用额度</h3>
                  <p className="st-section-desc">
                    按每个用户单独计算，留空表示不限；每日额度在北京时间零点重置。
                  </p>
                </div>
              </div>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="daily_call_limit"
                    label={<FieldLabel text="每日上限" hint="每个用户每天最多可调用多少次；留空不限" />}
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={1}
                      precision={0}
                      placeholder="不限"
                      addonAfter={<span className="st-input-unit">次/天</span>}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="total_call_limit"
                    label={<FieldLabel text="总上限" hint="每个用户累计最多可调用多少次；留空不限" />}
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={1}
                      precision={0}
                      placeholder="不限"
                      addonAfter={<span className="st-input-unit">次</span>}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Alert
                type="info"
                showIcon
                className="apc-quota-tip"
                message="每日与总上限可以同时设置"
                description="例如每日 10 次、总 100 次：用户每天最多 10 次，累计最多 100 次；任一额度用完都会停止调用。"
              />
            </div>

            <div className="st-section">
              <div className="st-section-head">
                <span className="st-section-icon">
                  <LinkOutlined />
                </span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">接口连接</h3>
                  <p className="st-section-desc">密钥只存在管理后台，不会下发给用户。</p>
                </div>
              </div>
              <Form.Item
                name="api_provider"
                label={<FieldLabel text="API 提供商" hint="选择你的 AI 服务提供商" />}
                rules={[{ required: true, message: '请选择 API 提供商' }]}
              >
                <Select placeholder="选择提供商" onChange={handleProviderChange}>
                  {textApiProviders.map((provider) => (
                    <Option key={provider.value} value={provider.value}>
                      {provider.label}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="api_key"
                label={<FieldLabel text="API 密钥" hint="该密钥仅管理员可见" />}
                rules={
                  builtInKeyProviders.includes(String(selectedProvider))
                    ? []
                    : [{ required: !editing, message: '请输入 API 密钥' }]
                }
              >
                <Input.Password
                  placeholder={
                    builtInKeyProviders.includes(String(selectedProvider))
                      ? '使用后端内置密钥'
                      : editing
                        ? '留空则不修改已保存的密钥'
                        : 'sk-...'
                  }
                  autoComplete="new-password"
                  disabled={builtInKeyProviders.includes(String(selectedProvider))}
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
                <Input placeholder="https://api.openai.com/v1" className="st-input-mono" />
              </Form.Item>

            </div>

            <div className="st-section">
              <div className="st-section-head">
                <span className="st-section-icon">
                  <SlidersOutlined />
                </span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">模型参数</h3>
                  <p className="st-section-desc">这些值会作为用户导入后的默认参数。</p>
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
                    placeholder: isMobile ? '输入或选择模型' : '输入模型名称，或聚焦后自动获取',
                    optionFilterProp: 'label',
                    onFocus: () => {
                      if (!modelsFetched && !fetchingModels) handleFetchModels(true);
                    },
                    onSearch: (value: string) => setModelSearchText(value),
                    onSelect: () => setModelSearchText(''),
                    onBlur: () => setModelSearchText(''),
                    filterOption: (
                      input: string,
                      option?: { value?: string; label?: string; description?: string },
                    ) => {
                      if (option?.value === input && !modelOptions.some((m) => m.value === input)) {
                        return true;
                      }
                      return (
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                        (option?.description ?? '').toLowerCase().includes(input.toLowerCase())
                      );
                    },
                    notFoundContent: fetchingModels ? (
                      <div className="st-dropdown-tip">
                        <Spin size="small" /> 加载中…
                      </div>
                    ) : null,
                    options: (() => {
                      const opts = modelOptions.map((model) => ({
                        value: model.value,
                        label: model.label,
                        description: model.description,
                      }));
                      if (
                        modelSearchText &&
                        !modelOptions.some(
                          (m) =>
                            m.value.toLowerCase() === modelSearchText.toLowerCase() ||
                            m.label.toLowerCase() === modelSearchText.toLowerCase(),
                        )
                      ) {
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

              <Alert
                type="info"
                showIcon
                className="apc-display-name-tip"
                message="真实模型名只在这里可见"
                description="填写「模型显示名称」后，用户在卡片、模型下拉框和测试结果里只会看到显示名称；留空则显示上面的真实模型名。"
              />

              <Form.Item
                label={
                  <FieldLabel
                    text="模型显示名称"
                    hint="用户在卡片和模型下拉框中看到的名称；留空则显示上面的真实模型名"
                  />
                }
                name="model_display_name"
                rules={[{ max: 100, message: '不能超过 100 个字符' }]}
              >
                <Input
                  placeholder="例如：GPT（留空则显示真实模型名）"
                  maxLength={100}
                  allowClear
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
                            {typeof temperatureWatch === 'number'
                              ? temperatureWatch.toFixed(1)
                              : '—'}
                          </span>
                        }
                      />
                    }
                    name="temperature"
                  >
                    <Slider className="st-slider" min={0} max={2} step={0.1} tooltip={{ open: false }} />
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
                      addonAfter={<span className="st-input-unit">tokens</span>}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <div className="st-inline-setting">
                <span className="st-inline-setting-icon">
                  <BulbOutlined />
                </span>
                <div className="st-inline-setting-copy">
                  <div className="st-inline-setting-label">关闭模型思考</div>
                  <div className="st-inline-setting-desc">
                    思考型模型开启后跳过思考阶段，降低等待时间与 Token 消耗。
                  </div>
                </div>
                <Form.Item name="disable_thinking" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </div>
            </div>

            <div className="st-section st-section--last">
              <div className="st-section-head">
                <span className="st-section-icon">
                  <FileTextOutlined />
                </span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">系统提示词</h3>
                  <p className="st-section-desc">作为默认值下发，用户导入后可在自己的卡片里调整。</p>
                </div>
              </div>
              <Form.Item name="system_prompt" className="st-field-last">
                <TextArea
                  rows={4}
                  placeholder="例如：你是一个专业的小说创作助手，请用生动、细腻的文字进行创作…"
                  maxLength={10000}
                  showCount
                />
              </Form.Item>
            </div>
          </Form>
        </div>
      </Drawer>

      <Drawer
        title={editingImage ? '编辑公共图片配置' : '新增公共图片配置'}
        open={imageDrawerOpen}
        onClose={closeImageDrawer}
        width={isMobile ? '100%' : 560}
        className="st-drawer"
        rootStyle={themeVars}
        styles={{ body: { padding: 0 } }}
        footer={
          <div className="st-drawer-footer">
            <Button
              icon={<ThunderboltOutlined />}
              loading={testingImageId === 'drawer'}
              onClick={handleImageTestConnection}
            >
              {testingImageId === 'drawer' ? '测试中…' : '测试连接'}
            </Button>
            <div className="st-drawer-footer-main">
              <Button onClick={closeImageDrawer}>取消</Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={savingImage}
                onClick={handleImageSave}
              >
                {savingImage ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="st-drawer-body">
          <Form
            form={imageForm}
            layout="vertical"
            size={isMobile ? 'middle' : 'large'}
            autoComplete="off"
          >
            {imageTestResult && (
              <Alert
                className="st-drawer-test"
                type={imageTestResult.success ? 'success' : 'error'}
                showIcon
                closable
                onClose={() => setImageTestResult(null)}
                message={imageTestResult.success ? '图片接口连接成功' : '图片接口连接失败'}
                description={
                  imageTestResult.success
                    ? `Provider: ${imageTestResult.provider || '-'} / Model: ${imageTestResult.model || '-'}`
                    : imageTestResult.message
                }
              />
            )}

            <div className="st-section">
              <div className="st-section-head">
                <span className="st-section-icon">
                  <SettingOutlined />
                </span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">基本信息</h3>
                  <p className="st-section-desc">
                    名称与备注会显示在用户的图片模型卡片中。
                  </p>
                </div>
              </div>
              <Form.Item
                name="name"
                label={<FieldLabel text="配置名称" hint="用户在 API 设置里看到的名字" />}
                rules={[
                  { required: true, message: '请输入配置名称' },
                  { max: 50, message: '不能超过 50 个字符' },
                ]}
              >
                <Input placeholder="例如：官方免费通道 · 封面图片" />
              </Form.Item>
              <Form.Item
                name="note"
                label={<FieldLabel text="备注" hint="说明适用场景或额度限制" />}
              >
                <Input placeholder="例如：仅用于小说封面生成" maxLength={200} />
              </Form.Item>
              <div className="st-inline-setting">
                <span className="st-inline-setting-icon">
                  <ThunderboltOutlined />
                </span>
                <div className="st-inline-setting-copy">
                  <div className="st-inline-setting-label">开放给用户加载</div>
                  <div className="st-inline-setting-desc">
                    关闭后用户看不到这套图片配置，已启用的卡片会立即失效。
                  </div>
                </div>
                <Form.Item name="is_enabled" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </div>
            </div>

            <div className="st-section">
              <div className="st-section-head">
                <span className="st-section-icon">
                  <StopOutlined />
                </span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">用户调用额度</h3>
                  <p className="st-section-desc">
                    按每个用户单独计算，留空表示不限；每日额度在北京时间零点重置。
                  </p>
                </div>
              </div>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="daily_call_limit"
                    label={
                      <FieldLabel
                        text="每日上限"
                        hint="每个用户每天最多可生成多少次封面；留空不限"
                      />
                    }
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={1}
                      precision={0}
                      placeholder="不限"
                      addonAfter={<span className="st-input-unit">次/天</span>}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="total_call_limit"
                    label={
                      <FieldLabel
                        text="总上限"
                        hint="每个用户累计最多可生成多少次封面；留空不限"
                      />
                    }
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={1}
                      precision={0}
                      placeholder="不限"
                      addonAfter={<span className="st-input-unit">次</span>}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Alert
                type="info"
                showIcon
                className="apc-quota-tip"
                message="每日与总上限可以同时设置"
                description="例如每日 10 次、总 100 次：用户每天最多生成 10 张，累计最多 100 张；任一额度用完都会停止生成。"
              />
            </div>

            <div className="st-section">
              <div className="st-section-head">
                <span className="st-section-icon">
                  <PictureOutlined />
                </span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">图片服务与模型</h3>
                  <p className="st-section-desc">
                    切换服务商会自动填入推荐地址和默认模型。
                  </p>
                </div>
              </div>
              <Form.Item
                name="api_provider"
                label={<FieldLabel text="图片 Provider" hint="提供封面生成能力的服务商" />}
                rules={[{ required: true, message: '请选择图片 Provider' }]}
              >
                <Select onChange={handleImageProviderChange}>
                  {imageApiProviders.map((provider) => (
                    <Option key={provider.value} value={provider.value}>
                      {provider.label}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item
                name="image_model"
                label={<FieldLabel text="图片模型" hint="实际用于生成封面的模型名称" />}
                rules={[{ required: true, message: '请输入图片模型名称' }]}
              >
                <Input
                  className="st-input-mono"
                  placeholder={
                    selectedImageProvider === 'openai'
                      ? 'gpt-image-1'
                      : selectedImageProvider === 'grok'
                        ? 'grok-2-image'
                        : 'gemini-2.0-flash-exp-image-generation'
                  }
                />
              </Form.Item>
              <Alert
                type="info"
                showIcon
                className="apc-display-name-tip"
                message="真实模型名只在这里可见"
                description="填写「模型显示名称」后，用户在图片卡片和测试结果中只会看到别名；留空则显示真实模型名。"
              />
              <Form.Item
                name="model_display_name"
                label={
                  <FieldLabel
                    text="模型显示名称"
                    hint="用户端显示的图片模型名称；留空则显示真实模型名"
                  />
                }
                rules={[{ max: 100, message: '不能超过 100 个字符' }]}
              >
                <Input placeholder="例如：封面绘图（留空则显示真实模型名）" allowClear />
              </Form.Item>
            </div>

            <div className="st-section st-section--last">
              <div className="st-section-head">
                <span className="st-section-icon">
                  <LinkOutlined />
                </span>
                <div className="st-section-head-copy">
                  <h3 className="st-section-title">接口凭证</h3>
                  <p className="st-section-desc">
                    密钥仅保存在管理后台，用户端不会收到明文。
                  </p>
                </div>
              </div>
              <Form.Item
                name="api_key"
                label={<FieldLabel text="图片 API Key" hint="该密钥仅管理员可见" />}
                rules={[{ required: !editingImage, message: '请输入图片 API Key' }]}
              >
                <Input.Password
                  className="st-input-mono"
                  placeholder={
                    editingImage
                      ? '留空则不修改已保存的密钥'
                      : '输入图片 API Key'
                  }
                  autoComplete="new-password"
                />
              </Form.Item>
              <Form.Item
                className="st-field-last"
                name="api_base_url"
                label={
                  <FieldLabel
                    text="图片 API 地址"
                    hint="切换服务商会填入推荐值，也可以手动填写"
                  />
                }
                rules={[
                  { required: true, message: '请输入图片 API 地址' },
                  { type: 'url', message: '请输入有效的 URL' },
                ]}
              >
                <Input
                  className="st-input-mono"
                  allowClear
                  placeholder={
                    selectedImageProvider === 'openai'
                      ? 'https://api.openai.com/v1'
                      : selectedImageProvider === 'grok'
                        ? 'https://api.x.ai/v1'
                        : 'https://generativelanguage.googleapis.com/v1beta'
                  }
                />
              </Form.Item>
            </div>
          </Form>
        </div>
      </Drawer>
    </div>
  );
}
