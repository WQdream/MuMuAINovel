import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Spin,
  Switch,
  Upload,
  message,
  theme,
} from 'antd';
import {
  DatabaseOutlined,
  DeleteOutlined,
  InboxOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import type { UploadProps } from 'antd';
import { knowledgeApi } from '../services/api';
import { useThemeMode } from '../theme/useThemeMode';
import type { KnowledgeBase, KnowledgeDocument, KnowledgeSearchHit } from '../types';
import './KnowledgeBase.css';

const { Dragger } = Upload;

const statusMap: Record<string, { label: string; tone: 'neutral' | 'processing' | 'success' | 'error' }> = {
  pending: { label: '等待处理', tone: 'neutral' },
  parsing: { label: '解析中', tone: 'processing' },
  embedding: { label: '生成向量', tone: 'processing' },
  ready: { label: '已索引', tone: 'success' },
  failed: { label: '处理失败', tone: 'error' },
};

const parseHeadingPath = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(' / ');
  if (!value) return '';
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).join(' / ') : String(value);
  } catch {
    return String(value);
  }
};

export default function KnowledgeBasePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { token } = theme.useToken();
  const { resolvedMode } = useThemeMode();
  // 深色模式下主题色接近纯黑，主按钮需要提亮以保证对比度。
  const isDark = resolvedMode === 'dark';
  const [base, setBase] = useState<KnowledgeBase | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KnowledgeSearchHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [retrievalEnabled, setRetrievalEnabled] = useState(true);
  const [topK, setTopK] = useState(8);
  const [minScore, setMinScore] = useState(0.25);
  const [maxContextChars, setMaxContextChars] = useState(6000);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const bases = await knowledgeApi.listBases(projectId);
      let current = bases.items[0];
      if (!current) {
        current = (await knowledgeApi.createBase(projectId, {
          name: '项目知识库',
          description: '用于存放本项目的参考资料和设定文档',
        })).item;
      }
      setBase(current);
      setRetrievalEnabled(current.settings?.retrieval_enabled ?? true);
      setTopK(current.settings?.top_k ?? 8);
      setMinScore(current.settings?.min_score ?? 0.25);
      setMaxContextChars(current.settings?.max_context_chars ?? 6000);
      setDocuments((await knowledgeApi.listDocuments(current.id)).items);
    } catch (error) {
      console.error('加载知识库失败', error);
      message.error('加载知识库失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!documents.some((item) => ['pending', 'parsing', 'embedding'].includes(item.status))) return;
    const timer = window.setInterval(() => { void load(); }, 2500);
    return () => window.clearInterval(timer);
  }, [documents, load]);

  const uploadProps: UploadProps = useMemo(() => ({
    multiple: true,
    accept: '.txt,.md,.markdown,.json',
    showUploadList: false,
    beforeUpload: async (file) => {
      if (!base) return false;
      try {
        await knowledgeApi.uploadDocument(base.id, file);
        message.success(`${file.name} 已加入索引队列`);
        await load();
      } catch (error) {
        console.error('上传知识库文档失败', error);
        message.error(error instanceof Error ? error.message : '上传失败，请检查文件格式和大小');
      }
      return false;
    },
  }), [base, load]);

  const saveRetrievalSettings = async () => {
    if (!base) return;
    setSavingSettings(true);
    try {
      const response = await knowledgeApi.updateBase(base.id, {
        settings: {
          retrieval_enabled: retrievalEnabled,
          top_k: topK,
          min_score: minScore,
          max_context_chars: maxContextChars,
        },
      });
      setBase(response.item);
      message.success('检索参数已保存');
    } catch (error) {
      console.error('保存检索参数失败', error);
      message.error('保存检索参数失败，请稍后重试');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSearch = async () => {
    if (!base || !query.trim()) return;
    setSearching(true);
    try {
      setHits((await knowledgeApi.search(base.id, { query: query.trim(), top_k: topK, min_score: minScore })).items);
    } catch (error) {
      console.error('检索知识库失败', error);
      message.error('检索失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  };

  const remove = async (document: KnowledgeDocument) => {
    try {
      await knowledgeApi.deleteDocument(document.id);
      message.success('文档已删除');
      await load();
    } catch (error) {
      console.error('删除知识库文档失败', error);
      message.error('删除失败，请稍后重试');
    }
  };

  const reindex = async (document: KnowledgeDocument) => {
    try {
      await knowledgeApi.reindexDocument(document.id);
      message.success('已重新加入索引队列');
      await load();
    } catch (error) {
      console.error('重建知识库索引失败', error);
      message.error('重建索引失败，请稍后重试');
    }
  };

  if (loading && !base) {
    return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;
  }

  const isEmpty = documents.length === 0;


  const primaryButtonBg = isDark ? '#EDEDE7' : token.colorPrimary;
  const primaryButtonColor = isDark ? '#1F1F1B' : token.colorTextLightSolid;

  const statusTone = (status: string) => {
    const tone = statusMap[status]?.tone ?? 'neutral';
    if (tone === 'success') return token.colorSuccess;
    if (tone === 'error') return token.colorError;
    if (tone === 'processing') return token.colorInfo;
    return token.colorTextQuaternary;
  };

  const metrics = base
    ? [
        { key: 'documents', label: '文档', value: `${base.document_count}`, suffix: '份', text: false },
        { key: 'chunks', label: '文本块', value: `${base.chunk_count}`, suffix: '块', text: false },
        { key: 'index', label: '索引方式', value: '本地向量', suffix: '', text: true },
      ]
    : [];

  const cssVars = {
    '--kb-text': token.colorText,
    '--kb-text-strong': token.colorTextSecondary,
    '--kb-text-secondary': token.colorTextTertiary,
    '--kb-text-tertiary': token.colorTextQuaternary,
    '--kb-split': token.colorBorderSecondary,
    '--kb-primary-btn-bg': primaryButtonBg,
    '--kb-primary-btn-color': primaryButtonColor,
  } as React.CSSProperties;

  return (
    <div className="knowledge-base-page" style={cssVars}>
      <div
        className="kb-header"
        style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
      >
        <div className="kb-header-main">
          <DatabaseOutlined style={{ fontSize: 20, color: token.colorTextSecondary, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <h2 className="kb-title">{base?.name || '项目知识库'}</h2>
            <p className="kb-subtitle">
              上传本作的设定与参考资料。
            </p>
          </div>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          刷新
        </Button>
      </div>

      <div className="knowledge-base-main">
        {base && (
          <div
            className="kb-metrics"
            style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
          >
            {metrics.map((metric, index) => (
              <div
                key={metric.key}
                className="kb-metric"
                style={{ borderLeft: index === 0 ? 'none' : `1px solid ${token.colorBorderSecondary}` }}
              >
                <span className="kb-metric-label">{metric.label}</span>
                <span
                  className={`kb-metric-value${metric.text ? ' kb-metric-value--text' : ''}`}
                  style={{ color: metric.text ? token.colorText : token.colorText }}
                >
                  {metric.value}
                  {metric.suffix && <span className="kb-metric-suffix">{metric.suffix}</span>}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="knowledge-base-panels">
          <section
            className="kb-panel"
            style={{
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <div
              className="kb-panel-head"
              style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
            >
              <div className="kb-panel-title">
                <InboxOutlined style={{ fontSize: 13, color: token.colorTextTertiary }} />
                <span>文档</span>
                <span
                  className="kb-panel-count"
                  style={{ background: token.colorFillTertiary, color: token.colorTextTertiary }}
                >
                  {documents.length}
                </span>
              </div>
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void load()}
                aria-label="刷新文档列表"
              />
            </div>

            <div className="kb-panel-body">
              <Dragger
                {...uploadProps}
                className={`kb-dropzone${isEmpty ? '' : ' kb-dropzone--compact'}`}
                style={{ borderColor: token.colorBorder }}
              >
                {isEmpty ? (
                  <>
                    <p className="ant-upload-drag-icon">
                      <InboxOutlined style={{ color: token.colorTextQuaternary }} />
                    </p>
                    <p className="ant-upload-text">点击或拖拽文件到这里</p>
                    <p className="ant-upload-hint">支持 TXT、Markdown、JSON，单文件最大 20MB</p>
                  </>
                ) : (
                  <>
                    <p className="ant-upload-text kb-dropzone-compact-text">继续添加文件</p>
                    <p className="ant-upload-hint">TXT / Markdown / JSON · 单文件 ≤ 20MB</p>
                  </>
                )}
              </Dragger>

              {!isEmpty && (
                <div className="kb-doc-list">
                  {documents.map((document) => {
                    const status = statusMap[document.status] || statusMap.pending;
                    return (
                      <div
                        key={document.id}
                        className="kb-doc"
                        style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
                      >
                        <div className="kb-doc-main">
                          <div className="kb-doc-title">
                            <span className="kb-doc-name">{document.title}</span>
                            <span className="kb-status">
                              <span
                                className="kb-dot"
                                style={{ background: statusTone(document.status) }}
                              />
                              {status.label}
                            </span>
                          </div>
                          <div className="kb-doc-meta" style={{ color: token.colorTextTertiary }}>
                            <span className="kb-doc-file">{document.original_filename}</span>
                            <span>{document.chunk_count} 块</span>
                            <span>{document.extracted_char_count.toLocaleString()} 字</span>
                          </div>
                          {document.error_message && (
                            <div className="kb-doc-error" style={{ color: token.colorError }}>
                              {document.error_message}
                            </div>
                          )}
                        </div>
                        <div className="kb-doc-actions">
                          {(document.status === 'failed' || document.status === 'ready') && (
                            <Button
                              type="text"
                              size="small"
                              onClick={() => void reindex(document)}
                              className="kb-doc-action"
                            >
                              重建
                            </Button>
                          )}
                          <Button
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => void remove(document)}
                            aria-label="删除文档"
                            style={{ color: token.colorTextTertiary }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section
            className="kb-panel"
            style={{
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <div
              className="kb-panel-head"
              style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
            >
              <div className="kb-panel-title">
                <SearchOutlined style={{ fontSize: 13, color: token.colorTextTertiary }} />
                <span>检索</span>
              </div>
              <Button
                type="text"
                size="small"
                icon={<SettingOutlined />}
                onClick={() => setSettingsOpen((value) => !value)}
                style={{ color: settingsOpen ? token.colorText : token.colorTextTertiary }}
              >
                参数
              </Button>
            </div>

            <div className="kb-panel-body">
              {settingsOpen && (
                <div
                  className="kb-settings"
                  style={{ background: token.colorFillQuaternary }}
                >
                  <div className="kb-settings-grid">
                    <label className="kb-field">
                      <span className="kb-field-label">自动注入</span>
                      <Switch size="small" checked={retrievalEnabled} onChange={setRetrievalEnabled} />
                    </label>
                    <label className="kb-field">
                      <span className="kb-field-label">召回数量</span>
                      <InputNumber
                        size="small"
                        min={1}
                        max={30}
                        value={topK}
                        onChange={(value) => setTopK(value ?? 8)}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label className="kb-field">
                      <span className="kb-field-label">最低匹配度</span>
                      <InputNumber
                        size="small"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        value={minScore}
                        onChange={(value) => setMinScore(value ?? 0.25)}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label className="kb-field">
                      <span className="kb-field-label">上下文上限</span>
                      <InputNumber
                        size="small"
                        min={1000}
                        max={20000}
                        step={500}
                        value={maxContextChars}
                        onChange={(value) => setMaxContextChars(value ?? 6000)}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                  <div className="kb-settings-foot">
                    <span className="kb-settings-hint" style={{ color: token.colorTextTertiary }}>
                      自动注入关闭后，仅保留手动检索
                    </span>
                    <Button size="small" loading={savingSettings} onClick={() => void saveRetrievalSettings()}>
                      保存参数
                    </Button>
                  </div>
                </div>
              )}

              <Input.Search
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onSearch={() => void handleSearch()}
                loading={searching}
                enterButton="搜索"
                className="kb-search"
                placeholder="例如：主角进入禁地需要遵守哪些规则？"
              />

              <div className="kb-hit-list">
                {hits.length === 0 ? (
                  <div className="kb-empty">
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        isEmpty
                          ? '先上传文档，再在这里验证检索效果'
                          : query
                            ? '没有匹配到内容，试试换个说法'
                            : '输入问题，看看 AI 会读到哪些片段'
                      }
                    />
                  </div>
                ) : (
                  hits.map((hit, index) => {
                    const metadata = hit.metadata || {};
                    const heading = parseHeadingPath(metadata.heading_path);
                    return (
                      <div
                        key={`${metadata.original_filename || 'hit'}-${index}`}
                        className="kb-hit"
                        style={{ background: token.colorFillQuaternary }}
                      >
                        <div className="kb-hit-head">
                          <span
                            className="kb-score"
                            style={{ background: token.colorBgContainer, color: token.colorTextSecondary }}
                          >
                            {(hit.score * 100).toFixed(0)}%
                          </span>
                          <span className="kb-hit-source">
                            {metadata.original_filename || metadata.title || '知识库文档'}
                          </span>
                          {heading && (
                            <span className="kb-hit-heading" style={{ color: token.colorTextTertiary }}>
                              {heading}
                            </span>
                          )}
                        </div>
                        <div className="kb-hit-body" style={{ color: token.colorTextSecondary }}>
                          {hit.content}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
