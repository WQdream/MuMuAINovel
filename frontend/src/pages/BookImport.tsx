import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Col,
  Collapse,
  Empty,
  Input,
  InputNumber,
  List,
  message,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Upload,
  theme,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  CheckOutlined,
  FileTextOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  ReloadOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { bookImportApi } from '../services/api';
import { useThemeMode } from '../theme/useThemeMode';
import type {
  BookImportApplyPayload,
  BookImportExtractMode,
  BookImportPreview,
  BookImportStepFailure,
  BookImportTask,
} from '../types';
import './BookImport.css';

const { Dragger } = Upload;
const { TextArea } = Input;

const BOOK_IMPORT_CACHE_KEY = 'book_import_page_cache_v1';

type BookImportPageCache = {
  taskId: string | null;
  taskStatus: BookImportTask | null;
  preview: BookImportPreview | null;
  applyProgress: number;
  applyMessage: string;
  applyError: string | null;
  isApplyComplete: boolean;
  extractMode: BookImportExtractMode;
  tailChapterCount: number;
  cachedAt: number;
};

function loadBookImportCache(): BookImportPageCache | null {
  try {
    const raw = sessionStorage.getItem(BOOK_IMPORT_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BookImportPageCache;
  } catch (error) {
    console.warn('读取拆书页面缓存失败:', error);
    return null;
  }
}

function saveBookImportCache(cache: BookImportPageCache) {
  try {
    sessionStorage.setItem(BOOK_IMPORT_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    const isQuotaExceeded =
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');

    if (isQuotaExceeded) {
      // 发生容量溢出时降级为轻量缓存（不保存预览正文），避免持续报错
      try {
        const lightweightCache: BookImportPageCache = {
          ...cache,
          preview: null,
        };
        sessionStorage.setItem(BOOK_IMPORT_CACHE_KEY, JSON.stringify(lightweightCache));
        return;
      } catch (fallbackError) {
        console.warn('写入轻量拆书页面缓存失败:', fallbackError);
        try {
          sessionStorage.removeItem(BOOK_IMPORT_CACHE_KEY);
        } catch {
          // ignore
        }
      }
    }

    console.warn('写入拆书页面缓存失败:', error);
  }
}

function clearBookImportCache() {
  try {
    sessionStorage.removeItem(BOOK_IMPORT_CACHE_KEY);
  } catch (error) {
    console.warn('清理拆书页面缓存失败:', error);
  }
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { response?: { status?: number } };
  return maybeError.response?.status === 404;
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BookImport() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { resolvedMode } = useThemeMode();
  const [file, setFile] = useState<File | null>(null);
  const [extractMode, setExtractMode] = useState<BookImportExtractMode>('tail');
  const [tailChapterCount, setTailChapterCount] = useState(10);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<BookImportTask | null>(null);
  const [preview, setPreview] = useState<BookImportPreview | null>(null);

  const [creatingTask, setCreatingTask] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyMessage, setApplyMessage] = useState('');
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplyComplete, setIsApplyComplete] = useState(false);
  const [cacheReady, setCacheReady] = useState(false);

  // 步骤级失败和重试相关状态
  const [failedSteps, setFailedSteps] = useState<BookImportStepFailure[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [retryProgress, setRetryProgress] = useState(0);
  const [retryMessage, setRetryMessage] = useState('');
  const importedProjectId = useRef<string | null>(null);

  const isTaskTerminal = useMemo(() => {
    return !!taskStatus && ['completed', 'failed', 'cancelled'].includes(taskStatus.status);
  }, [taskStatus]);

  const currentStep = useMemo(() => {
    if (!taskId) return 0;
    if (taskStatus && ['pending', 'running'].includes(taskStatus.status)) return 1;
    if (applying || isApplyComplete) return 3; // 新增生成导入步骤
    if (preview) return 2;
    return 1;
  }, [taskId, taskStatus, preview, applying, isApplyComplete]);

  const canRestart = useMemo(() => {
    return Boolean(
      file ||
      taskId ||
      taskStatus ||
      preview ||
      applyProgress > 0 ||
      applyMessage ||
      applyError ||
      isApplyComplete ||
      failedSteps.length > 0 ||
      retrying
    );
  }, [
    file,
    taskId,
    taskStatus,
    preview,
    applyProgress,
    applyMessage,
    applyError,
    isApplyComplete,
    failedSteps,
    retrying,
  ]);

  const normalizedTailChapterCount = useMemo(
    () => Math.max(5, Math.ceil(tailChapterCount / 5) * 5),
    [tailChapterCount]
  );
  const effectiveExtractMode = useMemo<BookImportExtractMode>(
    () => (normalizedTailChapterCount > 50 ? 'full' : extractMode),
    [extractMode, normalizedTailChapterCount]
  );
  const rangeLocked = Boolean(taskId || taskStatus || preview || creatingTask || applying || retrying);

  const stepItems = [
    { title: '上传文件' },
    { title: '解析中' },
    { title: '预览修改' },
    { title: '生成导入' },
  ];
  const currentStepText = stepItems[currentStep]?.title || '上传文件';

  const accentColor = token.colorPrimary;
  const themeVars = {
    '--bi-page-bg': token.colorBgLayout,
    '--bi-text': token.colorText,
    '--bi-secondary': token.colorTextSecondary,
    '--bi-tertiary': token.colorTextTertiary,
    '--bi-border': token.colorBorderSecondary,
    '--bi-fill': token.colorFillQuaternary,
    '--bi-card-bg': token.colorBgContainer,
    '--bi-accent': accentColor,
    '--bi-accent-contrast': resolvedMode === 'dark' ? '#1B1B18' : '#FFFFFF',
  } as CSSProperties;

  useEffect(() => {
    const cache = loadBookImportCache();
    if (cache) {
      const cacheAgeMs = typeof cache.cachedAt === 'number'
        ? Date.now() - cache.cachedAt
        : Number.POSITIVE_INFINITY;

      // 超过6小时的缓存直接视为失效，避免后端重启后继续使用旧taskId
      if (cacheAgeMs > 6 * 60 * 60 * 1000) {
        clearBookImportCache();
      } else {
        setTaskId(cache.taskId);
        setTaskStatus(cache.taskStatus);
        setPreview(cache.preview);
        setApplyProgress(cache.applyProgress);
        setApplyError(cache.applyError);
        setIsApplyComplete(cache.isApplyComplete);
        setExtractMode(cache.extractMode ?? 'tail');
        setTailChapterCount(cache.tailChapterCount ?? 10);
        setApplyMessage(
          cache.applyMessage || (cache.applyProgress > 0 && !cache.isApplyComplete
            ? '已恢复页面缓存，请重新点击“确认导入”继续。'
            : '')
        );
        message.info('已恢复拆书导入页面缓存');
      }
    }
    setCacheReady(true);
  }, []);

  useEffect(() => {
    if (!cacheReady) return;

    // 导入完成后必须清理缓存，避免后续回到页面时恢复到旧任务状态
    if (isApplyComplete) {
      clearBookImportCache();
      return;
    }

    const hasCacheData = Boolean(
      taskId ||
      taskStatus ||
      preview ||
      applyError ||
      applyProgress > 0 ||
      applyMessage
    );

    if (!hasCacheData) {
      clearBookImportCache();
      return;
    }

    saveBookImportCache({
      taskId,
      taskStatus,
      // preview 含完整章节正文，体积大，容易触发 sessionStorage 配额限制
      // 页面恢复时可根据 taskId + taskStatus 重新拉取 preview
      preview: null,
      applyProgress,
      applyMessage,
      applyError,
      isApplyComplete,
      extractMode,
      tailChapterCount,
      cachedAt: Date.now(),
    });
  }, [
    cacheReady,
    taskId,
    taskStatus,
    preview,
    applyProgress,
    applyMessage,
    applyError,
    isApplyComplete,
    extractMode,
    tailChapterCount,
  ]);

  useEffect(() => {
    if (!taskId) return;
    if (isTaskTerminal) return;

    const timer = setInterval(async () => {
      try {
        const status = await bookImportApi.getTaskStatus(taskId);
        setTaskStatus(status);
      } catch (error) {
        console.error('轮询任务状态失败:', error);
        if (isNotFoundError(error)) {
          clearBookImportCache();
          setTaskId(null);
          setTaskStatus(null);
          setPreview(null);
          setApplyProgress(0);
          setApplyMessage('');
          setApplyError(null);
          setIsApplyComplete(false);
          message.warning('拆书任务已失效（可能因服务重启），请重新上传TXT并开始解析');
        }
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [taskId, isTaskTerminal]);

  useEffect(() => {
    const fetchPreview = async () => {
      if (!taskId || !taskStatus) return;
      if (taskStatus.status !== 'completed' || preview) return;

      try {
        setLoadingPreview(true);
        const data = await bookImportApi.getPreview(taskId);
        setPreview(data);
      } catch (error) {
        console.error('获取预览失败:', error);
        if (isNotFoundError(error)) {
          clearBookImportCache();
          setTaskId(null);
          setTaskStatus(null);
          setPreview(null);
          setApplyProgress(0);
          setApplyMessage('');
          setApplyError(null);
          setIsApplyComplete(false);
          message.warning('拆书任务预览不存在（可能因服务重启），已清空缓存，请重新上传TXT');
        } else {
          message.error('获取预览失败');
        }
      } finally {
        setLoadingPreview(false);
      }
    };

    fetchPreview();
  }, [taskId, taskStatus, preview]);

  const startTask = async () => {
    if (!file) {
      message.warning('请先选择 TXT 文件');
      return;
    }

    try {
      setCreatingTask(true);
      setPreview(null);
      setTaskStatus(null);

      setExtractMode(effectiveExtractMode);
      setTailChapterCount(normalizedTailChapterCount);

      const response = await bookImportApi.createTask({
        file,
        extract_mode: effectiveExtractMode,
        tail_chapter_count: normalizedTailChapterCount,
      });

      setTaskId(response.task_id);
      message.success('拆书任务已创建');
    } catch (error) {
      console.error('创建任务失败:', error);
      message.error('创建拆书任务失败');
    } finally {
      setCreatingTask(false);
    }
  };

  const refreshStatus = async () => {
    if (!taskId) return;
    try {
      const status = await bookImportApi.getTaskStatus(taskId);
      setTaskStatus(status);
    } catch (error) {
      console.error('刷新状态失败:', error);
      if (isNotFoundError(error)) {
        clearBookImportCache();
        setTaskId(null);
        setTaskStatus(null);
        setPreview(null);
        setApplyProgress(0);
        setApplyMessage('');
        setApplyError(null);
        setIsApplyComplete(false);
        message.warning('任务不存在，已清空本地缓存，请重新创建拆书任务');
      }
    }
  };

  const cancelTask = async () => {
    if (!taskId) return;
    try {
      await bookImportApi.cancelTask(taskId);
      message.success('任务已取消');
      await refreshStatus();
    } catch (error) {
      console.error('取消任务失败:', error);
      message.error('取消任务失败');
    }
  };

  const applyImport = async () => {
    if (!taskId || !preview) return;

    const payload: BookImportApplyPayload = {
      project_suggestion: preview.project_suggestion,
      chapters: preview.chapters,
      outlines: preview.outlines,
      import_mode: 'append',
    };

    try {
      setApplying(true);
      setApplyProgress(0);
      setApplyMessage('准备导入...');
      setApplyError(null);
      setIsApplyComplete(false);
      setFailedSteps([]);

      await bookImportApi.applyImportStream(
        taskId,
        payload,
        {
          onProgress: (msg, prog, status) => {
            // 检查是否是步骤失败的特殊消息
            if (status === 'step_failures') {
              try {
                const parsed = JSON.parse(msg);
                if (parsed.failed_steps && Array.isArray(parsed.failed_steps)) {
                  setFailedSteps(parsed.failed_steps as BookImportStepFailure[]);
                }
              } catch {
                // 不是JSON，忽略
              }
              return;
            }
            setApplyProgress(prog);
            setApplyMessage(msg);
          },
          onResult: (result) => {
            importedProjectId.current = result.project_id;
            const generatedCareers = result.statistics?.generated_careers ?? 0;
            const generatedEntities = result.statistics?.generated_entities ?? 0;

            // 检查最终是否有失败步骤
            setIsApplyComplete(true);

            // 如果没有失败步骤才自动跳转
            // 注意：这里需要延迟一帧来等待 failedSteps 的更新
            setTimeout(() => {
              setFailedSteps(prev => {
                if (prev.length === 0) {
                  message.success(`导入成功：已生成职业${generatedCareers}个，角色/组织${generatedEntities}个`);
                  clearBookImportCache();
                  setTimeout(() => {
                    navigate(`/project/${result.project_id}/chapters`);
                  }, 1000);
                } else {
                  message.warning(`导入完成，但有 ${prev.length} 个生成步骤失败，可点击重试`);
                }
                return prev;
              });
            }, 100);
          },
          onError: (error) => {
            console.error('导入过程发生错误:', error);
            setApplyError(`导入失败: ${error}`);
            message.error(`导入失败: ${error}`);
            setApplying(false);
          },
          onComplete: () => {
            setApplyProgress(100);
            setApplyMessage('导入完成！');
          }
        }
      );
    } catch (error) {
      console.error('确认导入失败:', error);
      setApplyError('确认导入失败，无法连接到服务器');
      message.error('确认导入失败');
      setApplying(false);
    }
  };

  const retryFailedSteps = useCallback(async () => {
    if (!taskId || failedSteps.length === 0) return;

    const stepsToRetry = failedSteps.map(f => f.step_name);

    try {
      setRetrying(true);
      setRetryProgress(0);
      setRetryMessage('正在重试失败的生成步骤...');

      await bookImportApi.retryFailedStepsStream(
        taskId,
        stepsToRetry,
        {
          onProgress: (msg, prog, status) => {
            if (status === 'step_failures') {
              try {
                const parsed = JSON.parse(msg);
                if (parsed.failed_steps && Array.isArray(parsed.failed_steps)) {
                  setFailedSteps(parsed.failed_steps as BookImportStepFailure[]);
                }
              } catch {
                // 不是JSON，忽略
              }
              return;
            }
            setRetryProgress(prog);
            setRetryMessage(msg);
          },
          onResult: (result) => {
            if (result.still_failed && result.still_failed.length > 0) {
              setFailedSteps(result.still_failed);
              message.warning(`重试完成，仍有 ${result.still_failed.length} 个步骤失败`);
            } else {
              setFailedSteps([]);
              message.success('所有步骤重试成功！');
              clearBookImportCache();
              const projectId = result.project_id || importedProjectId.current;
              if (projectId) {
                setTimeout(() => {
                  navigate(`/project/${projectId}/chapters`);
                }, 1000);
              }
            }
          },
          onError: (error) => {
            console.error('重试失败:', error);
            message.error(`重试失败: ${error}`);
          },
          onComplete: () => {
            setRetrying(false);
            setRetryProgress(100);
            setRetryMessage('重试完成');
          }
        }
      );
    } catch (error) {
      console.error('重试请求失败:', error);
      message.error('重试请求失败，无法连接到服务器');
      setRetrying(false);
    }
  }, [taskId, failedSteps, navigate]);

  const skipFailedSteps = useCallback(() => {
    setFailedSteps([]);
    clearBookImportCache();
    const projectId = importedProjectId.current;
    if (projectId) {
      message.info('已跳过失败步骤，正在跳转到项目...');
      navigate(`/project/${projectId}/chapters`);
    }
  }, [navigate]);

  const restartImport = useCallback(() => {
    clearBookImportCache();
    importedProjectId.current = null;

    setFile(null);
    setTaskId(null);
    setTaskStatus(null);
    setPreview(null);

    setCreatingTask(false);
    setLoadingPreview(false);
    setApplying(false);
    setApplyProgress(0);
    setApplyMessage('');
    setApplyError(null);
    setIsApplyComplete(false);

    setFailedSteps([]);
    setRetrying(false);
    setRetryProgress(0);
    setRetryMessage('');
    setExtractMode('tail');
    setTailChapterCount(10);

    message.success('已重新开始，请重新上传 TXT 并解析');
  }, []);

  const updateChapter = (index: number, patch: Partial<BookImportPreview['chapters'][number]>) => {
    setPreview(prev => {
      if (!prev) return prev;
      const next = [...prev.chapters];
      next[index] = { ...next[index], ...patch };
      return { ...prev, chapters: next };
    });
  };

  const renderSteps = () => (
    <div className="bi-steps" role="list" aria-label="拆书导入进度">
      {stepItems.map((item, index) => {
        const state = index < currentStep ? 'done' : index === currentStep ? 'active' : 'todo';
        return (
          <div className={`bi-step bi-step--${state}`} role="listitem" key={item.title}>
            <span className="bi-step-index">
              {state === 'done' ? <CheckOutlined /> : index + 1}
            </span>
            <span className="bi-step-label">{item.title}</span>
            {index < stepItems.length - 1 && <span className="bi-step-line" aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="bi-page" style={themeVars}>
      <div className="bi-shell">
        <header className="bi-header">
          <div className="bi-header-main">
            <span className="bi-header-icon">
              <InboxOutlined />
            </span>
            <div className="bi-header-copy">
              <div className="bi-title-row">
                <h2 className="bi-title">拆书导入</h2>
                <span className={`bi-status bi-status--${currentStep === 3 ? 'busy' : 'idle'}`}>
                  {currentStepText}
                </span>
              </div>
              <p className="bi-subtitle">上传 TXT，自动拆解章节结构、预览校对后一键生成作品。</p>
            </div>
          </div>
          {canRestart && (
            <div className="bi-header-actions">
              <Popconfirm
                title="确认重新开始？"
                description="将清空当前拆书任务与缓存，并回到上传文件步骤。"
                onConfirm={restartImport}
                okText="重新开始"
                cancelText="取消"
              >
                <Button icon={<ReloadOutlined />}>重新开始</Button>
              </Popconfirm>
            </div>
          )}
        </header>

        {renderSteps()}

        {currentStep === 0 && (
          <div className="bi-grid">
            <section className="bi-panel bi-panel--upload">
              <div className="bi-panel-head">
                <div>
                  <h3 className="bi-panel-title">上传原稿</h3>
                  <p className="bi-panel-desc">整本 TXT 或分章 TXT 均可，解析过程不会修改原文件。</p>
                </div>
                <span className="bi-panel-badge">TXT</span>
              </div>

              <Dragger
                accept=".txt"
                multiple={false}
                className="bi-dragger"
                beforeUpload={(f) => {
                  setFile(f);
                  return false;
                }}
                onRemove={() => {
                  setFile(null);
                }}
                showUploadList={false}
                fileList={
                  file
                    ? [
                        {
                          uid: 'selected-txt',
                          name: file.name,
                          status: 'done',
                        } as UploadFile,
                      ]
                    : []
                }
              >
                <div className="bi-drop">
                  <span className="bi-drop-icon">
                    <InboxOutlined />
                  </span>
                  <div className="bi-drop-title">
                    {file ? '已选择文件，可点击更换' : '拖拽 TXT 到此处，或点击选择文件'}
                  </div>
                  <div className="bi-drop-hint">仅支持 .txt，建议不超过 50MB</div>
                </div>
              </Dragger>

              {file && (
                <div className="bi-file">
                  <span className="bi-file-icon">
                    <FileTextOutlined />
                  </span>
                  <div className="bi-file-meta">
                    <span className="bi-file-name" title={file.name}>{file.name}</span>
                    <span className="bi-file-size">{formatFileSize(file.size)}</span>
                  </div>
                  <Button
                    type="text"
                    size="small"
                    onClick={() => setFile(null)}
                    className="bi-file-remove"
                  >
                    移除
                  </Button>
                </div>
              )}

              <div className="bi-panel-foot">
                <span className="bi-foot-note">
                  {file ? '确认范围后即可开始解析' : '先选择文件，再设置解析范围'}
                </span>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={creatingTask}
                  disabled={!file}
                  onClick={startTask}
                >
                  开始解析
                </Button>
              </div>
            </section>

            <section className="bi-panel bi-panel--settings">
              <div className="bi-panel-head">
                <div>
                  <h3 className="bi-panel-title">解析范围</h3>
                  <p className="bi-panel-desc">控制本次拆书取用的章节区间，范围越小解析越快。</p>
                </div>
              </div>

              {rangeLocked && (
                <Alert
                  type="warning"
                  showIcon
                  message="当前任务的解析范围已锁定"
                  description="如需调整范围，请点击右上角「重新开始」后重新上传并解析。"
                  style={{ marginBottom: 14 }}
                />
              )}

              <div className="bi-field">
                <span className="bi-field-label">解析方式</span>
                <Select
                  value={extractMode}
                  onChange={(value) => setExtractMode(value)}
                  options={[
                    { label: '截取末 x 章反向生成', value: 'tail' },
                    { label: '整本反向生成', value: 'full' },
                  ]}
                  style={{ width: '100%' }}
                  disabled={rangeLocked}
                />
              </div>

              <div className="bi-field">
                <span className="bi-field-label">末尾章节数</span>
                <InputNumber
                  min={5}
                  max={55}
                  step={5}
                  precision={0}
                  value={tailChapterCount}
                  disabled={rangeLocked || extractMode !== 'tail'}
                  onChange={(value) => setTailChapterCount(typeof value === 'number' ? value : 10)}
                  suffix="章"
                  style={{ width: '100%' }}
                />
              </div>

              <p className="bi-field-note">
                {effectiveExtractMode === 'tail'
                  ? `将截取末 ${normalizedTailChapterCount} 章反向生成，章节数须为 5 的倍数，最多 50 章。`
                  : extractMode === 'tail' && tailChapterCount > 50
                    ? '输入已超过 50 章，将自动按整本拆处理。'
                    : '将基于整本内容反向生成，适合完整拆书，耗时可能更长。'}
              </p>

              <Collapse
                ghost
                className="bi-format"
                items={[
                  {
                    key: 'format',
                    label: 'TXT 格式要求',
                    children: (
                      <div className="bi-format-body">
                        <ol>
                          <li>仅支持 <strong>.txt</strong> 文件，每章使用单独的标题行。</li>
                          <li>推荐标题格式：<strong>第1章 标题</strong>，下一行开始正文。</li>
                          <li>正文按自然段换行，首行可缩进两个字符。</li>
                          <li>章节间保留空行，避免分割线、导出时间等干扰内容。</li>
                        </ol>
                        <pre className="bi-sample">{`第1章 初入江湖
这里是第1章正文第一段。
这里是第1章正文第二段。

第2章 雨夜追踪
这里是第2章正文内容。`}</pre>
                      </div>
                    ),
                  },
                ]}
              />

              <div className="bi-output">
                <div className="bi-output-title">导入后自动生成</div>
                <ul>
                  <li>
                    <span className="bi-output-dot" />
                    <span>章节与大纲</span>
                  </li>
                  <li>
                    <span className="bi-output-dot" />
                    <span>世界观与职业体系</span>
                  </li>
                  <li>
                    <span className="bi-output-dot" />
                    <span>核心角色与相关组织</span>
                  </li>
                </ul>
              </div>
            </section>
          </div>
        )}

        {currentStep === 1 && (
          <section className="bi-panel bi-panel--wide">
            <div className="bi-panel-head">
              <div>
                <h3 className="bi-panel-title">正在解析</h3>
                <p className="bi-panel-desc">任务在后台执行，离开页面后可从缓存恢复进度。</p>
              </div>
            </div>
            {!taskId ? (
              <Empty description="尚未创建任务" style={{ padding: '40px 0' }} />
            ) : (
              <div className="bi-progress">
                <Progress
                  type="circle"
                  size={168}
                  percent={taskStatus?.progress || 0}
                  strokeWidth={7}
                  status={
                    taskStatus?.status === 'failed' ? 'exception' :
                    taskStatus?.status === 'completed' ? 'success' :
                    'active'
                  }
                />
                <div className="bi-progress-copy">
                  <h4 className="bi-progress-title">
                    {taskStatus?.status === 'pending' && '等待调度...'}
                    {taskStatus?.status === 'running' && '正在解析 TXT 文件...'}
                    {taskStatus?.status === 'completed' && '解析完成，正在生成预览...'}
                    {taskStatus?.status === 'failed' && '解析失败'}
                    {taskStatus?.status === 'cancelled' && '已取消'}
                  </h4>
                  {taskStatus?.message && <p className="bi-progress-msg">{taskStatus.message}</p>}
                  {taskId && <p className="bi-progress-task">任务 ID · {taskId}</p>}
                  {taskStatus?.error && (
                    <Alert type="error" message={taskStatus.error} showIcon style={{ marginTop: 14, textAlign: 'left' }} />
                  )}
                  <Space style={{ marginTop: 20 }}>
                    <Button icon={<ReloadOutlined />} onClick={refreshStatus}>刷新状态</Button>
                    {taskStatus && ['pending', 'running'].includes(taskStatus.status) && (
                      <Button danger icon={<StopOutlined />} onClick={cancelTask}>取消任务</Button>
                    )}
                  </Space>
                </div>
              </div>
            )}
          </section>
        )}

        {currentStep === 2 && (
          <section className="bi-panel bi-panel--wide">
            <div className="bi-panel-head">
              <div>
                <h3 className="bi-panel-title">预览与校正</h3>
                <p className="bi-panel-desc">
                  {preview
                    ? `共解析出 ${preview.chapters.length} 个章节，可直接修改标题、摘要与正文。`
                    : '解析完成后将显示预览数据。'}
                </p>
              </div>
              <Button
                type="primary"
                loading={applying}
                disabled={!preview}
                onClick={applyImport}
              >
                确认导入
              </Button>
            </div>

            <Spin spinning={loadingPreview}>
              {!preview ? (
                <Empty description="解析完成后将显示预览数据" style={{ padding: '40px 0' }} />
              ) : (
                <div className="bi-preview">
                  <Space direction="vertical" style={{ width: '100%' }} size={14}>
                    {preview.warnings.length > 0 && (
                      <Alert
                        type="warning"
                        showIcon
                        message="检测到告警"
                        description={
                          <ul className="bi-warning-list">
                            {preview.warnings.map((w, idx) => (
                              <li key={`${w.code}-${idx}`}>[{w.level}] {w.message}</li>
                            ))}
                          </ul>
                        }
                      />
                    )}

                    <div className="bi-section">
                      <div className="bi-section-title">项目信息</div>
                      <Row gutter={[14, 12]}>
                        <Col xs={24} md={12}>
                          <div className="bi-field">
                            <span className="bi-field-label">标题</span>
                            <Input
                              value={preview.project_suggestion.title}
                              onChange={(e) =>
                                setPreview(prev => prev ? ({
                                  ...prev,
                                  project_suggestion: { ...prev.project_suggestion, title: e.target.value },
                                }) : prev)
                              }
                            />
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="bi-field">
                            <span className="bi-field-label">类型</span>
                            <Input
                              value={preview.project_suggestion.genre}
                              onChange={(e) =>
                                setPreview(prev => prev ? ({
                                  ...prev,
                                  project_suggestion: { ...prev.project_suggestion, genre: e.target.value },
                                }) : prev)
                              }
                            />
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="bi-field">
                            <span className="bi-field-label">叙事角度</span>
                            <Select
                              style={{ width: '100%' }}
                              value={preview.project_suggestion.narrative_perspective}
                              onChange={(v) =>
                                setPreview(prev => prev ? ({
                                  ...prev,
                                  project_suggestion: { ...prev.project_suggestion, narrative_perspective: v },
                                }) : prev)
                              }
                              options={[
                                { value: '第一人称', label: '第一人称' },
                                { value: '第三人称', label: '第三人称' },
                                { value: '全知视角', label: '全知视角' },
                              ]}
                            />
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="bi-field">
                            <span className="bi-field-label">目标字数</span>
                            <InputNumber
                              style={{ width: '100%' }}
                              min={1000}
                              step={1000}
                              value={preview.project_suggestion.target_words}
                              onChange={(v) =>
                                setPreview(prev => prev ? ({
                                  ...prev,
                                  project_suggestion: {
                                    ...prev.project_suggestion,
                                    target_words: Number(v || 100000),
                                  },
                                }) : prev)
                              }
                            />
                          </div>
                        </Col>
                        <Col xs={24}>
                          <div className="bi-field">
                            <span className="bi-field-label">主题</span>
                            <TextArea
                              rows={2}
                              value={preview.project_suggestion.theme}
                              onChange={(e) =>
                                setPreview(prev => prev ? ({
                                  ...prev,
                                  project_suggestion: { ...prev.project_suggestion, theme: e.target.value },
                                }) : prev)
                              }
                            />
                          </div>
                        </Col>
                        <Col xs={24}>
                          <div className="bi-field">
                            <span className="bi-field-label">简介</span>
                            <TextArea
                              rows={3}
                              value={preview.project_suggestion.description}
                              onChange={(e) =>
                                setPreview(prev => prev ? ({
                                  ...prev,
                                  project_suggestion: { ...prev.project_suggestion, description: e.target.value },
                                }) : prev)
                              }
                            />
                          </div>
                        </Col>
                      </Row>
                    </div>

                    <div className="bi-section">
                      <div className="bi-section-title">
                        章节
                        <span className="bi-section-count">{preview.chapters.length}</span>
                      </div>
                      <Collapse
                        className="bi-chapters"
                        items={preview.chapters.map((ch, idx) => ({
                          key: String(idx),
                          label: (
                            <span className="bi-chapter-label">
                              <span className="bi-chapter-no">{ch.chapter_number}</span>
                              <span className="bi-chapter-name">{ch.title}</span>
                            </span>
                          ),
                          children: (
                            <Space direction="vertical" style={{ width: '100%' }} size={10}>
                              <Input
                                value={ch.title}
                                addonBefore="标题"
                                onChange={(e) => updateChapter(idx, { title: e.target.value })}
                              />
                              <TextArea
                                rows={2}
                                value={ch.summary}
                                placeholder="章节摘要"
                                onChange={(e) => updateChapter(idx, { summary: e.target.value })}
                              />
                              <TextArea
                                rows={8}
                                value={ch.content}
                                placeholder="章节正文"
                                onChange={(e) => updateChapter(idx, { content: e.target.value })}
                              />
                            </Space>
                          ),
                        }))}
                      />
                    </div>
                  </Space>
                </div>
              )}
            </Spin>
          </section>
        )}

        {currentStep === 3 && (
          <section className="bi-panel bi-panel--wide">
            <div className="bi-panel-head">
              <div>
                <h3 className="bi-panel-title">生成导入</h3>
                <p className="bi-panel-desc">章节与大纲落库后，AI 会继续补全世界观、职业与角色。</p>
              </div>
            </div>

            <div className="bi-apply">
              <div className="bi-apply-head">
                <h4 className="bi-apply-title">
                  {retrying
                    ? '正在重试失败的生成步骤'
                    : (failedSteps.length > 0 && isApplyComplete
                      ? '导入完成，部分步骤需要重试'
                      : '正在生成并导入项目内容')}
                </h4>
                <span className="bi-apply-percent">
                  {Math.round(retrying ? retryProgress : applyProgress)}%
                </span>
              </div>

              <Progress
                percent={retrying ? retryProgress : applyProgress}
                showInfo={false}
                status={
                  applyError ? 'exception' :
                  (failedSteps.length > 0 && isApplyComplete && !retrying) ? 'exception' :
                  (isApplyComplete && failedSteps.length === 0) ? 'success' :
                  'active'
                }
                strokeColor={failedSteps.length > 0 ? '#C99A3E' : accentColor}
                style={{ marginBottom: 16 }}
              />

              <p className="bi-apply-msg">
                {retrying ? retryMessage : (applyError || applyMessage)}
              </p>

              {applyError && (
                <Alert type="error" message="导入出错" description={applyError} showIcon />
              )}

              {failedSteps.length > 0 && isApplyComplete && !retrying && (
                <div className="bi-failures">
                  <div className="bi-failure-head">
                    <WarningOutlined />
                    <span>{failedSteps.length} 个生成步骤失败</span>
                  </div>
                  <p className="bi-failure-desc">
                    章节与大纲已成功导入，以下 AI 步骤未完成，可以重试或跳过。
                  </p>
                  <List
                    size="small"
                    className="bi-failure-list"
                    dataSource={failedSteps}
                    renderItem={(item) => (
                      <List.Item>
                        <div className="bi-failure-item">
                          <div className="bi-failure-item-head">
                            <span className="bi-failure-tag">{item.step_label}</span>
                            {(item.retry_count ?? 0) > 0 && (
                              <span className="bi-failure-retry">已重试 {item.retry_count} 次</span>
                            )}
                          </div>
                          <p className="bi-failure-error">
                            {item.error.length > 120 ? `${item.error.slice(0, 120)}...` : item.error}
                          </p>
                        </div>
                      </List.Item>
                    )}
                  />
                  <Space style={{ marginTop: 16 }}>
                    <Button type="primary" icon={<RedoOutlined />} onClick={retryFailedSteps} loading={retrying}>
                      智能重试全部失败步骤
                    </Button>
                    <Button onClick={skipFailedSteps}>跳过，直接进入项目</Button>
                  </Space>
                </div>
              )}

              {retrying && (
                <Alert type="info" showIcon message="正在重试..." description={retryMessage} style={{ marginTop: 16 }} />
              )}

              {!failedSteps.length && !retrying && (
                <div className="bi-apply-note">
                  <div className="bi-apply-note-title">AI 将自动补全</div>
                  <ul>
                    <li>世界观设定：时间、地点、氛围与规则</li>
                    <li>职业体系：主职业与副职业</li>
                    <li>核心角色与相关组织</li>
                  </ul>
                  <p>{isApplyComplete ? '所有步骤已完成，即将自动跳转。' : '请耐心等待，完成后将自动跳转。'}</p>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
