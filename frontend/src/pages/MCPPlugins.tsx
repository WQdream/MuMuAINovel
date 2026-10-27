import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import {
  Button,
  Typography,
  Modal,
  Drawer,
  Form,
  Input,
  Switch,
  Select,
  message,
  Tag,
  Spin,
  Empty,
  Alert,
  Tooltip,
  theme,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined,
  ToolOutlined,
  ApiOutlined,
  QuestionCircleOutlined,
  WarningOutlined,
  ReloadOutlined,
  CloseOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { mcpPluginApi, settingsApi } from '../services/api';
import type { MCPPlugin, MCPTool } from '../types';
import { useThemeMode } from '../theme/useThemeMode';
import './MCPPlugins.css';

const { Text } = Typography;
const { TextArea } = Input;

export default function MCPPluginsPage() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [form] = Form.useForm();
  const { token } = theme.useToken();
  const { resolvedMode } = useThemeMode();
  const accentColor = resolvedMode === 'dark' ? '#EDEDE7' : token.colorPrimary;
  const themeVars = {
    '--mcp-page-bg': token.colorBgLayout,
    '--mcp-text': token.colorText,
    '--mcp-secondary': token.colorTextSecondary,
    '--mcp-tertiary': token.colorTextTertiary,
    '--mcp-border': token.colorBorderSecondary,
    '--mcp-fill': token.colorFillQuaternary,
    '--mcp-card-bg': token.colorBgContainer,
    '--mcp-accent': accentColor,
    '--mcp-accent-contrast': resolvedMode === 'dark' ? '#1B1B18' : '#FFFFFF',
  } as CSSProperties;

  const statusStyles = {
    success: {
      bg: token.colorSuccessBg,
      border: token.colorSuccessBorder,
      text: token.colorSuccessText,
    },
    info: {
      bg: token.colorInfoBg,
      border: token.colorInfoBorder,
      text: token.colorInfoText,
    },
    warning: {
      bg: token.colorWarningBg,
      border: token.colorWarningBorder,
      text: token.colorWarningText,
    },
    error: {
      bg: token.colorErrorBg,
      border: token.colorErrorBorder,
      text: token.colorErrorText,
    },
  };

  // 响应式监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [modal, contextHolder] = Modal.useModal();
  const [loading, setLoading] = useState(false);
  const [plugins, setPlugins] = useState<MCPPlugin[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPlugin, setEditingPlugin] = useState<MCPPlugin | null>(null);
  const [testingPluginId, setTestingPluginId] = useState<string | null>(null);
  const [viewingTools, setViewingTools] = useState<{ pluginId: string; tools: MCPTool[] } | null>(null);
  const [checkingFunctionCalling, setCheckingFunctionCalling] = useState(false);
  const [modelSupportStatus, setModelSupportStatus] = useState<'unknown' | 'supported' | 'unsupported'>('unknown');

  useEffect(() => {
    const initPage = async () => {
      setLoading(true);
      try {
        // 1. 并行获取插件列表和当前设置
        const [pluginsData, settings] = await Promise.all([
          mcpPluginApi.getPlugins(),
          settingsApi.getSettings()
        ]);
        
        setPlugins(pluginsData);

        // 2. 检查配置一致性
        const verifiedConfigStr = localStorage.getItem('mcp_verified_config');
        if (verifiedConfigStr) {
          try {
            const verifiedConfig = JSON.parse(verifiedConfigStr);
            const currentConfig = {
              provider: settings.api_provider,
              baseUrl: settings.api_base_url,
              model: settings.llm_model
            };

            // 比较关键配置是否发生变更
            const isConfigChanged =
              verifiedConfig.provider !== currentConfig.provider ||
              verifiedConfig.baseUrl !== currentConfig.baseUrl ||
              verifiedConfig.model !== currentConfig.model;

            if (isConfigChanged) {
              // 配置已变更
              setModelSupportStatus('unknown');
              
              // 检查是否有正在运行的插件
              const activePlugins = pluginsData.filter(p => p.enabled);
              if (activePlugins.length > 0) {
                // 自动禁用所有插件
                message.loading({ content: '检测到模型配置变更，正在为了安全自动禁用插件...', key: 'auto_disable' });
                
                await Promise.all(activePlugins.map(p => mcpPluginApi.togglePlugin(p.id, false)));
                
                // 重新加载插件列表状态
                const updatedPlugins = await mcpPluginApi.getPlugins();
                setPlugins(updatedPlugins);
                
                message.success({ content: '已自动禁用所有插件，请重新检测模型能力', key: 'auto_disable' });
                
                modal.warning({
                  title: '配置变更提醒',
                  centered: true,
                  content: '检测到您更换了 AI 模型或接口地址。为了防止错误调用，系统已自动暂停所有 MCP 插件。请重新进行"模型能力检查"，确认新模型支持 Function Calling 后再启用插件。',
                  okText: '知道了',
                });
              } else {
                // 没有运行中的插件，仅提示
                message.info('检测到模型配置已变更，请重新检测模型能力');
              }
              
              // 清除旧的验证状态
              localStorage.removeItem('mcp_verified_config');
            } else {
              // 配置未变更，恢复验证状态（根据缓存的状态恢复）
              const cachedStatus = verifiedConfig.status || 'supported';
              setModelSupportStatus(cachedStatus as 'unknown' | 'supported' | 'unsupported');
            }
          } catch (e) {
            console.error('Failed to parse verified config:', e);
            localStorage.removeItem('mcp_verified_config');
          }
        }
      } catch (error) {
        console.error('Init page failed:', error);
        message.error('页面初始化失败');
      } finally {
        setLoading(false);
      }
    };
    initPage();
  }, [modal]);

  const loadPlugins = async () => {
    try {
      const data = await mcpPluginApi.getPlugins();
      setPlugins(data);
    } catch (error) {
      console.error('Load plugins failed:', error);
      message.error('加载插件列表失败');
    }
  };

  const handleCreate = () => {
    if (modelSupportStatus !== 'supported') {
      modal.confirm({
        title: '模型能力检查',
        centered: true,
        icon: <WarningOutlined />,
        content: '为了确保 MCP 插件正常工作，您当前使用的 AI 模型必须支持 Function Calling（工具调用）能力。请先进行模型支持检测。',
        okText: '去检测',
        cancelText: '取消',
        onOk: handleCheckFunctionCalling,
      });
      return;
    }
    setEditingPlugin(null);
    form.resetFields();
    form.setFieldsValue({
      enabled: true,
      category: 'search',
      config_json: `{
  "mcpServers": {
    "exa": {
      "type": "http",
      "url": "https://mcp.exa.ai/mcp?exaApiKey=YOUR_API_KEY",
      "headers": {}
    }
  }
}`
    });
    setModalVisible(true);
  };

  const handleEdit = (plugin: MCPPlugin) => {
    setEditingPlugin(plugin);

    // 重构为标准MCP配置格式
    const mcpConfig: Record<string, Record<string, Record<string, unknown>>> = {
      mcpServers: {
        [plugin.plugin_name]: {
          type: plugin.plugin_type || 'http'
        }
      }
    };

    if (plugin.plugin_type === 'http' || plugin.plugin_type === 'streamable_http' || plugin.plugin_type === 'sse') {
      mcpConfig.mcpServers[plugin.plugin_name].url = plugin.server_url;
      mcpConfig.mcpServers[plugin.plugin_name].headers = plugin.headers || {};
    } else {
      mcpConfig.mcpServers[plugin.plugin_name].command = plugin.command;
      mcpConfig.mcpServers[plugin.plugin_name].args = plugin.args || [];
      mcpConfig.mcpServers[plugin.plugin_name].env = plugin.env || {};
    }

    form.setFieldsValue({
      config_json: JSON.stringify(mcpConfig, null, 2),
      enabled: plugin.enabled,
      category: plugin.category || 'general',
    });
    setModalVisible(true);
  };

  const handleDelete = (plugin: MCPPlugin) => {
    modal.confirm({
      title: '删除插件',
      content: `确定要删除插件 "${plugin.display_name || plugin.plugin_name}" 吗？`,
      centered: true,
      okText: '确定',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await mcpPluginApi.deletePlugin(plugin.id);
          message.success('插件已删除');
          loadPlugins();
        } catch (error) {
          console.error('Delete plugin failed:', error);
          message.error('删除插件失败');
        }
      },
    });
  };

  const handleToggle = async (plugin: MCPPlugin, enabled: boolean) => {
    try {
      await mcpPluginApi.togglePlugin(plugin.id, enabled);
      message.success(enabled ? '插件已启用' : '插件已禁用');
      loadPlugins();
    } catch (error) {
      console.error('Toggle plugin failed:', error);
      message.error('切换插件状态失败');
    }
  };

  const handleTest = async (pluginId: string) => {
    setTestingPluginId(pluginId);
    try {
      const result = await mcpPluginApi.testPlugin(pluginId);

      // 测试完成后，无论成功失败都刷新插件列表以更新状态
      await loadPlugins();

      if (result.success) {
        const suggestions = result.suggestions || [];
        const aiChoice = suggestions.find((s: string) => s.startsWith('🤖'))?.replace('🤖 AI选择: ', '') || '';
        const paramsStr = suggestions.find((s: string) => s.startsWith('📝'))?.replace('📝 参数: ', '') || '';
        const callTime = suggestions.find((s: string) => s.startsWith('⏱️'))?.replace('⏱️ 耗时: ', '') || '';
        const resultStr = suggestions.find((s: string) => s.startsWith('📊'))?.replace('📊 结果:\n', '') || '';

        modal.success({
          title: '🎉 测试成功',
          centered: true,
          width: isMobile ? '95%' : 700,
          content: (
            <div style={{ padding: '8px 0' }}>
              <div style={{ marginBottom: 16, padding: 12, background: statusStyles.success.bg, border: `1px solid ${statusStyles.success.border}`, borderRadius: 8 }}>
                <Typography.Text strong style={{ color: statusStyles.success.text, fontSize: 14 }}>
                  ✓ {result.message}
                </Typography.Text>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ padding: 12, background: token.colorBgLayout, borderRadius: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>可用工具数</Text>
                  <div><Text strong style={{ fontSize: 20 }}>{result.tools_count || 0}</Text></div>
                </div>
                <div style={{ padding: 12, background: token.colorBgLayout, borderRadius: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>总响应时间</Text>
                  <div><Text strong style={{ fontSize: 20 }}>{result.response_time_ms?.toFixed(0) || 0}ms</Text></div>
                </div>
              </div>

              {aiChoice && (
                <div style={{ marginBottom: 12, padding: 12, background: statusStyles.info.bg, borderRadius: 8, border: `1px solid ${statusStyles.info.border}` }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>🤖 AI选择的工具</Text>
                  <Text code strong>{aiChoice}</Text>
                  {callTime && <Tag color="blue" style={{ marginLeft: 8 }}>{callTime}</Tag>}
                </div>
              )}

              {paramsStr && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>📝 调用参数</Text>
                  <pre style={{ margin: 0, padding: 8, background: token.colorBgLayout, borderRadius: 4, fontSize: 12, overflow: 'auto', maxHeight: 100 }}>
                    {(() => { try { return JSON.stringify(JSON.parse(paramsStr), null, 2); } catch { return paramsStr; } })()}
                  </pre>
                </div>
              )}

              {resultStr && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>📊 返回结果预览</Text>
                  <pre style={{ margin: 0, padding: 8, background: token.colorBgLayout, borderRadius: 4, fontSize: 11, overflow: 'auto', maxHeight: 150, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {resultStr}
                  </pre>
                </div>
              )}

              <Alert message='插件状态已自动更新为"运行中"' type="success" showIcon />
            </div>
          ),
        });
      } else {
        modal.error({
          title: '测试失败',
          centered: true,
          width: isMobile ? '90%' : 600,
          content: (
            <div style={{ padding: '8px 0' }}>
              <div style={{ marginBottom: 16 }}>
                <Alert
                  message={result.message || 'MCP插件测试失败'}
                  type="error"
                  showIcon
                />
              </div>

              {result.error && (
                <div style={{
                  padding: 16,
                  background: statusStyles.error.bg,
                  border: `1px solid ${statusStyles.error.border}`,
                  borderRadius: 8,
                  marginBottom: 16
                }}>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>错误信息:</Text>
                  <Text style={{ fontSize: 13, color: statusStyles.error.text, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {result.error}
                  </Text>
                </div>
              )}

              {result.suggestions && result.suggestions.length > 0 && (
                <div style={{
                  padding: 16,
                  background: statusStyles.warning.bg,
                  border: `1px solid ${statusStyles.warning.border}`,
                  borderRadius: 8,
                  marginBottom: 16
                }}>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>💡 建议:</Text>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {result.suggestions.map((s: string, i: number) => (
                      <li key={i} style={{ marginBottom: 4 }}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Alert
                message="插件状态已更新，请检查配置后重试"
                type="warning"
                showIcon
              />
            </div>
          ),
        });
      }
    } catch {
      message.error('测试插件失败');
    } finally {
      setTestingPluginId(null);
    }
  };

  const handleViewTools = async (pluginId: string) => {
    try {
      const result = await mcpPluginApi.getPluginTools(pluginId);
      setViewingTools({ pluginId, tools: result.tools });
    } catch (error) {
      console.error('Get tools failed:', error);
      message.error('获取工具列表失败');
    }
  };

  const handleCheckFunctionCalling = async () => {
    // 从设置中获取当前配置
    setCheckingFunctionCalling(true);
    try {
      const settings = await settingsApi.getSettings();
      
      if (!settings.llm_model) {
        message.warning('请先在设置页面配置模型');
        return;
      }

      const result = await settingsApi.checkFunctionCalling({
        // 公共配置生效时服务端会按当前配置解析，前端无需（也无法）传密钥
        api_key: settings.shared_config_active ? '' : settings.api_key,
        api_base_url: settings.shared_config_active ? '' : (settings.api_base_url || ''),
        provider: settings.api_provider || 'openai',
        llm_model: settings.llm_model,
      });

      // 无论成功失败，都缓存当前测试的配置和状态
      const configToCache = {
        provider: settings.api_provider,
        baseUrl: settings.api_base_url,
        model: settings.llm_model,
        status: result.success && result.supported ? 'supported' : 'unsupported',
        testedAt: new Date().toISOString()
      };
      localStorage.setItem('mcp_verified_config', JSON.stringify(configToCache));

      if (result.success && result.supported) {
        setModelSupportStatus('supported');

        modal.success({
          title: '✅ Function Calling 支持检测',
          centered: true,
          width: isMobile ? '95%' : 700,
          content: (
            <div style={{ padding: '8px 0' }}>
              <div style={{ marginBottom: 16, padding: 12, background: statusStyles.success.bg, border: `1px solid ${statusStyles.success.border}`, borderRadius: 8 }}>
                <Typography.Text strong style={{ color: statusStyles.success.text, fontSize: 14 }}>
                  ✓ {result.message}
                </Typography.Text>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ padding: 12, background: token.colorBgLayout, borderRadius: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>API 提供商</Text>
                  <div><Text strong style={{ fontSize: 16 }}>{result.provider}</Text></div>
                </div>
                <div style={{ padding: 12, background: token.colorBgLayout, borderRadius: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>响应时间</Text>
                  <div><Text strong style={{ fontSize: 16 }}>{result.response_time_ms?.toFixed(0) || 0}ms</Text></div>
                </div>
              </div>

              <div style={{ marginBottom: 12, padding: 12, background: statusStyles.info.bg, borderRadius: 8, border: `1px solid ${statusStyles.info.border}` }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>🔧 模型信息</Text>
                <Text code strong>{result.model}</Text>
                {result.details?.finish_reason && (
                  <Tag color="green" style={{ marginLeft: 8 }}>finish_reason: {result.details.finish_reason}</Tag>
                )}
              </div>

              {result.details && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>📊 检测详情</Text>
                  <div style={{ padding: 8, background: token.colorBgLayout, borderRadius: 4, fontSize: 12 }}>
                    <div>✓ 工具调用数量: {result.details.tool_call_count || 0}</div>
                    <div>✓ 测试工具: {result.details.test_tool || 'N/A'}</div>
                    <div>✓ 响应类型: {result.details.response_type || 'N/A'}</div>
                  </div>
                </div>
              )}

              {result.tool_calls && result.tool_calls.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>🔨 工具调用示例</Text>
                  <pre style={{ margin: 0, padding: 8, background: token.colorBgLayout, borderRadius: 4, fontSize: 11, overflow: 'auto', maxHeight: 150 }}>
                    {JSON.stringify(result.tool_calls[0], null, 2)}
                  </pre>
                </div>
              )}

              {result.suggestions && result.suggestions.length > 0 && (
                <div style={{ padding: 12, background: statusStyles.success.bg, border: `1px solid ${statusStyles.success.border}`, borderRadius: 8 }}>
                  <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>💡 建议</Text>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                    {result.suggestions.map((s: string, i: number) => (
                      <li key={i} style={{ marginBottom: 4 }}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ),
        });
      } else {
        setModelSupportStatus('unsupported');
        modal.warning({
          title: '❌ Function Calling 支持检测',
          centered: true,
          width: isMobile ? '95%' : 700,
          content: (
            <div style={{ padding: '8px 0' }}>
              <div style={{ marginBottom: 16 }}>
                <Alert
                  message={result.message || '模型不支持 Function Calling'}
                  type="warning"
                  showIcon
                />
              </div>

              {result.error && (
                <div style={{
                  padding: 16,
                  background: statusStyles.warning.bg,
                  border: `1px solid ${statusStyles.warning.border}`,
                  borderRadius: 8,
                  marginBottom: 16
                }}>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>错误信息:</Text>
                  <Text style={{ fontSize: 13, fontFamily: 'monospace' }}>
                    {result.error}
                  </Text>
                </div>
              )}

              {result.response_preview && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>📝 模型返回内容（前200字符）</Text>
                  <pre style={{ margin: 0, padding: 8, background: token.colorBgLayout, borderRadius: 4, fontSize: 11, overflow: 'auto', maxHeight: 100, whiteSpace: 'pre-wrap' }}>
                    {result.response_preview}
                  </pre>
                </div>
              )}

              {result.suggestions && result.suggestions.length > 0 && (
                <div style={{
                  padding: 16,
                  background: statusStyles.info.bg,
                  border: `1px solid ${statusStyles.info.border}`,
                  borderRadius: 8
                }}>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>💡 建议:</Text>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {result.suggestions.map((s: string, i: number) => (
                      <li key={i} style={{ marginBottom: 4 }}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ),
        });
      }
    } catch (error) {
      console.error('Check function calling failed:', error);
      message.error('检测失败，请稍后重试');
      setModelSupportStatus('unsupported');
    } finally {
      setCheckingFunctionCalling(false);
    }
  };

  const handleSubmit = async (values: { config_json: string; enabled: boolean; category?: string }) => {
    setLoading(true);
    try {
      // 验证JSON格式
      try {
        JSON.parse(values.config_json);
      } catch {
        message.error('配置JSON格式错误，请检查');
        setLoading(false);
        return;
      }

      const data = {
        config_json: values.config_json,
        enabled: values.enabled,
        category: values.category || 'general',
      };

      // 统一使用简化API，后端会自动判断是创建还是更新
      await mcpPluginApi.createPluginSimple(data);
      message.success(editingPlugin ? '插件已更新' : '插件已创建');

      setModalVisible(false);
      form.resetFields();
      loadPlugins();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      const errorMsg = err?.response?.data?.detail || '操作失败';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const getStatusMeta = (plugin: MCPPlugin) => {
    if (!plugin.enabled) return { label: '已禁用', tone: 'muted' as const };
    if (plugin.status === 'active') return { label: '运行中', tone: 'ok' as const };
    if (plugin.status === 'error') return { label: '错误', tone: 'error' as const };
    return { label: '未激活', tone: 'muted' as const };
  };

  const maskEndpoint = (plugin: MCPPlugin): string | null => {
    if (plugin.plugin_type === 'stdio') {
      return plugin.command ? `${plugin.command} ${plugin.args?.join(' ') ?? ''}`.trim() : null;
    }
    if (!plugin.server_url) return null;
    const url = plugin.server_url;
    try {
      const urlObj = new URL(url);
      const params = new URLSearchParams(urlObj.search);
      const sensitiveKeys = ['apiKey', 'api_key', 'key', 'token', 'secret', 'password', 'auth'];
      let maskedUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
      let hasParams = false;
      params.forEach((value, key) => {
        const isSensitive = sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()));
        maskedUrl += `${hasParams ? '&' : '?'}${key}=${isSensitive ? '***' : value}`;
        hasParams = true;
      });
      return maskedUrl;
    } catch {
      return url.replace(/([?&])(apiKey|api_key|key|token|secret|password|auth)=([^&]+)/gi, '$1$2=***');
    }
  };

  const activeCount = plugins.filter((p) => p.enabled && p.status === 'active').length;
  const requiresCheck = modelSupportStatus !== 'supported';
  const checkTitle = requiresCheck ? '请先完成模型能力检查' : undefined;

  return (
    <div className="mcp-page" style={themeVars}>
      {contextHolder}
      <div className="mcp-shell">
        <header className="mcp-header">
          <div className="mcp-header-main">
            <span className="mcp-header-icon">
              <ToolOutlined />
            </span>
            <div className="mcp-header-copy">
              <div className="mcp-title-row">
                <h2 className="mcp-title">MCP 插件</h2>
                <span className="mcp-count">{plugins.length}</span>
                {activeCount > 0 && <span className="mcp-status mcp-status--ok">{activeCount} 个运行中</span>}
              </div>
              <p className="mcp-subtitle">让 AI 调用外部搜索、数据库与服务，扩展创作能力边界。</p>
            </div>
          </div>
          <div className="mcp-header-actions">
            <Button icon={<ReloadOutlined />} onClick={loadPlugins} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              添加插件
            </Button>
          </div>
        </header>

        <div className="mcp-overview">
          <section className="mcp-overview-card">
            <div className="mcp-overview-head">
              <span className={`mcp-overview-icon mcp-overview-icon--${modelSupportStatus === 'supported' ? 'ok' : modelSupportStatus === 'unsupported' ? 'error' : 'info'}`}>
                {modelSupportStatus === 'supported' ? (
                  <CheckCircleOutlined />
                ) : modelSupportStatus === 'unsupported' ? (
                  <CloseCircleOutlined />
                ) : (
                  <QuestionCircleOutlined />
                )}
              </span>
              <div className="mcp-overview-copy">
                <div className="mcp-overview-title">模型能力检查</div>
                <div className="mcp-overview-desc">
                  {modelSupportStatus === 'supported'
                    ? '当前模型支持 Function Calling，可正常使用 MCP 插件。'
                    : modelSupportStatus === 'unsupported'
                      ? '当前模型不支持 Function Calling，插件操作已禁用。'
                      : '先检测模型是否支持 Function Calling，再启用插件。'}
                </div>
              </div>
            </div>
            <div className="mcp-overview-foot">
              <span className={`mcp-pill mcp-pill--${modelSupportStatus === 'supported' ? 'ok' : modelSupportStatus === 'unsupported' ? 'error' : 'muted'}`}>
                {modelSupportStatus === 'supported' ? '已通过' : modelSupportStatus === 'unsupported' ? '不支持' : '待检测'}
              </span>
              <Button
                size="small"
                type={modelSupportStatus === 'supported' ? 'default' : 'primary'}
                icon={<ApiOutlined />}
                onClick={handleCheckFunctionCalling}
                loading={checkingFunctionCalling}
              >
                {modelSupportStatus === 'unknown' ? '开始检测' : '重新检测'}
              </Button>
            </div>
          </section>

          <section className="mcp-overview-card mcp-overview-card--info">
            <div className="mcp-overview-head">
              <span className="mcp-overview-icon">
                <InfoCircleOutlined />
              </span>
              <div className="mcp-overview-copy">
                <div className="mcp-overview-title">什么是 MCP 插件？</div>
                <div className="mcp-overview-desc">
                  通过 Model Context Protocol 连接外部工具，让 AI 在写作时主动搜索资料、
                  查询数据库或调用第三方 API。
                </div>
              </div>
            </div>
            <div className="mcp-overview-foot">
              <span className="mcp-meta">支持的接入方式</span>
              <div className="mcp-types">
                <span>HTTP</span>
                <span>SSE</span>
                <span>STDIO</span>
              </div>
            </div>
          </section>
        </div>

        {requiresCheck && plugins.length > 0 && (
          <Alert
            className="mcp-guard"
            message={
              modelSupportStatus === 'unsupported'
                ? '当前模型不支持 Function Calling，插件操作已禁用'
                : '请先完成模型能力检查，才能操作插件'
            }
            type={modelSupportStatus === 'unsupported' ? 'error' : 'warning'}
            showIcon
            icon={modelSupportStatus === 'unsupported' ? <CloseCircleOutlined /> : <WarningOutlined />}
            action={
              <Button size="small" onClick={handleCheckFunctionCalling} loading={checkingFunctionCalling}>
                去检测
              </Button>
            }
          />
        )}

        <div className="mcp-toolbar">
          <div className="mcp-toolbar-title">
            已安装插件
            <span className="mcp-toolbar-count">{plugins.length}</span>
          </div>
          <span className="mcp-toolbar-note">
            {plugins.length > 0 ? '开关控制插件是否参与 AI 调用' : '还没有安装任何插件'}
          </span>
        </div>

        <Spin spinning={loading}>
          {plugins.length === 0 ? (
            <div className="mcp-empty">
              <span className="mcp-empty-icon">
                <ApiOutlined />
              </span>
              <h3 className="mcp-empty-title">还没有添加任何插件</h3>
              <p className="mcp-empty-desc">
                粘贴一段标准 MCP 配置即可接入，例如 Exa 搜索、文件系统或数据库服务。
              </p>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                添加第一个插件
              </Button>
            </div>
          ) : (
            <div className="mcp-list">
              <div className="mcp-list-head">
                <span>插件</span>
                <span>类型</span>
                <span>地址 / 命令</span>
                <span>状态</span>
                <span className="mcp-col-actions">操作</span>
              </div>
              {plugins.map((plugin) => {
                const status = getStatusMeta(plugin);
                const endpoint = maskEndpoint(plugin);
                return (
                  <article className="mcp-row" key={plugin.id}>
                    <div className="mcp-cell mcp-cell--main">
                      <div className="mcp-plugin-icon">
                        {plugin.plugin_type === 'stdio' ? <ApiOutlined /> : <LinkOutlined />}
                      </div>
                      <div className="mcp-plugin-copy">
                        <div className="mcp-plugin-name" title={plugin.display_name || plugin.plugin_name}>
                          {plugin.display_name || plugin.plugin_name}
                        </div>
                        <div className="mcp-plugin-key" title={plugin.plugin_name}>{plugin.plugin_name}</div>
                        {plugin.description && (
                          <div className="mcp-plugin-desc" title={plugin.description}>{plugin.description}</div>
                        )}
                      </div>
                    </div>
                    <div className="mcp-cell">
                      <span className="mcp-type-tag">
                        {(plugin.plugin_type || 'unknown').toUpperCase().replace('_', ' ')}
                      </span>
                      {plugin.category && plugin.category !== 'general' && (
                        <span className="mcp-cat">{plugin.category}</span>
                      )}
                    </div>
                    <div className="mcp-cell mcp-cell--endpoint">
                      {endpoint ? (
                        <span className="mcp-endpoint" title={endpoint}>{endpoint}</span>
                      ) : (
                        <span className="mcp-muted">未配置</span>
                      )}
                      {plugin.last_error && (
                        <span className="mcp-plugin-error" title={plugin.last_error}>{plugin.last_error}</span>
                      )}
                    </div>
                    <div className="mcp-cell mcp-cell--status">
                      <span className={`mcp-pill mcp-pill--${status.tone}`}>{status.label}</span>
                      <Switch
                        size="small"
                        checked={plugin.enabled}
                        onChange={(checked) => handleToggle(plugin, checked)}
                        disabled={requiresCheck}
                        title={checkTitle ?? (plugin.enabled ? '禁用插件' : '启用插件')}
                      />
                    </div>
                    <div className="mcp-cell mcp-cell--actions">
                      <Tooltip title={checkTitle ?? '测试连接'}>
                        <Button
                          type="text"
                          size="small"
                          className="mcp-action"
                          icon={<ThunderboltOutlined />}
                          onClick={() => handleTest(plugin.id)}
                          loading={testingPluginId === plugin.id}
                          disabled={requiresCheck}
                        />
                      </Tooltip>
                      <Tooltip title={checkTitle ?? '查看工具'}>
                        <Button
                          type="text"
                          size="small"
                          className="mcp-action"
                          icon={<ToolOutlined />}
                          onClick={() => handleViewTools(plugin.id)}
                          disabled={requiresCheck || !plugin.enabled || plugin.status !== 'active'}
                        />
                      </Tooltip>
                      <Tooltip title={checkTitle ?? '编辑'}>
                        <Button
                          type="text"
                          size="small"
                          className="mcp-action"
                          icon={<EditOutlined />}
                          onClick={() => handleEdit(plugin)}
                          disabled={requiresCheck}
                        />
                      </Tooltip>
                      <Tooltip title={checkTitle ?? '删除'}>
                        <Button
                          type="text"
                          size="small"
                          className="mcp-action mcp-action--danger"
                          icon={<DeleteOutlined />}
                          onClick={() => handleDelete(plugin)}
                          disabled={requiresCheck}
                        />
                      </Tooltip>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Spin>
      </div>

      {/* 添加 / 编辑插件抽屉 */}
      <Drawer
        open={modalVisible}
        onClose={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        closable={false}
        width={isMobile ? '100%' : 560}
        styles={{ body: { padding: 0 } }}
      >
        <div className="mcp-drawer" style={themeVars}>
          <div className="mcp-drawer-head">
            <span className="mcp-drawer-icon">
              {editingPlugin ? <EditOutlined /> : <PlusOutlined />}
            </span>
            <div className="mcp-drawer-head-main">
              <h3 className="mcp-drawer-title">{editingPlugin ? '编辑插件' : '添加插件'}</h3>
              <p className="mcp-drawer-subtitle">
                {editingPlugin
                  ? `修改 ${editingPlugin.display_name || editingPlugin.plugin_name} 的连接配置`
                  : '粘贴标准 MCP 配置，系统会自动识别插件名称与接入方式'}
              </p>
            </div>
            <Button
              type="text"
              size="small"
              className="mcp-drawer-close"
              icon={<CloseOutlined />}
              aria-label="关闭"
              onClick={() => {
                setModalVisible(false);
                form.resetFields();
              }}
            />
          </div>

          <div className="mcp-drawer-body">
            <Form form={form} layout="vertical" onFinish={handleSubmit} className="mcp-form">
              <Form.Item
                label="MCP 配置 JSON"
                name="config_json"
                rules={[{ required: true, message: '请输入配置JSON' }]}
                extra="支持 HTTP、SSE 与 STDIO 三种类型，插件名称从 mcpServers 的键名读取。"
              >
                <TextArea
                  rows={isMobile ? 12 : 14}
                  className="mcp-json-input"
                  placeholder={`{
  "mcpServers": {
    "exa": {
      "type": "streamable_http",
      "url": "https://mcp.exa.ai/mcp?exaApiKey=YOUR_API_KEY",
      "headers": {}
    }
  }
}`}
                />
              </Form.Item>

              <Form.Item
                label="插件分类"
                name="category"
                rules={[{ required: true, message: '请选择插件分类' }]}
                extra="分类会用于 AI 判断何时调用该插件。"
              >
                <Select placeholder="请选择分类">
                  <Select.Option value="search">搜索类 · 网络搜索、信息查询</Select.Option>
                  <Select.Option value="analysis">分析类 · 数据分析、文本处理</Select.Option>
                  <Select.Option value="filesystem">文件系统 · 文件读写操作</Select.Option>
                  <Select.Option value="database">数据库 · 数据库查询</Select.Option>
                  <Select.Option value="api">API 调用 · 第三方服务接口</Select.Option>
                  <Select.Option value="generation">生成类 · 内容生成工具</Select.Option>
                  <Select.Option value="general">通用 · 其他功能</Select.Option>
                </Select>
              </Form.Item>
            </Form>
          </div>

          <div className="mcp-drawer-foot">
            <Button onClick={() => {
              setModalVisible(false);
              form.resetFields();
            }}>
              取消
            </Button>
            <Button type="primary" loading={loading} onClick={() => form.submit()}>
              {editingPlugin ? '保存修改' : '添加插件'}
            </Button>
          </div>
        </div>
      </Drawer>

      {/* 工具列表抽屉 */}
      <Drawer
        open={!!viewingTools}
        onClose={() => setViewingTools(null)}
        closable={false}
        width={isMobile ? '100%' : 640}
        styles={{ body: { padding: 0 } }}
      >
        <div className="mcp-drawer" style={themeVars}>
          <div className="mcp-drawer-head">
            <span className="mcp-drawer-icon">
              <ToolOutlined />
            </span>
            <div className="mcp-drawer-head-main">
              <div className="mcp-drawer-title-row">
                <h3 className="mcp-drawer-title">可用工具</h3>
                {viewingTools && <span className="mcp-count">{viewingTools.tools.length}</span>}
              </div>
              <p className="mcp-drawer-subtitle">插件向 AI 暴露的工具及其输入参数定义</p>
            </div>
            <Button
              type="text"
              size="small"
              className="mcp-drawer-close"
              icon={<CloseOutlined />}
              aria-label="关闭"
              onClick={() => setViewingTools(null)}
            />
          </div>

          <div className="mcp-drawer-body">
            {viewingTools && viewingTools.tools.length === 0 ? (
              <Empty description="该插件没有提供任何工具" style={{ padding: '40px 0' }} />
            ) : (
              <div className="mcp-tools">
                {viewingTools?.tools.map((tool, index) => (
                  <article className="mcp-tool" key={`${tool.name}-${index}`}>
                    <div className="mcp-tool-head">
                      <code className="mcp-tool-name">{tool.name}</code>
                      <span className="mcp-tool-index">#{index + 1}</span>
                    </div>
                    {tool.description && (
                      <p className="mcp-tool-desc">{tool.description}</p>
                    )}
                    {tool.inputSchema && (
                      <div className="mcp-tool-schema">
                        <div className="mcp-tool-label">输入参数</div>
                        <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="mcp-drawer-foot">
            <Button type="primary" onClick={() => setViewingTools(null)}>
              关闭
            </Button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
