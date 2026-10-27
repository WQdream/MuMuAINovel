import { useState, useEffect, useMemo } from 'react';
import { Button, Modal, Form, Input, message, Empty, Space, Popconfirm, Card, Select, Radio, Tag, InputNumber, Tabs, Pagination, theme, Upload, Alert, Divider, Dropdown, Drawer } from 'antd';
import type { ReactNode } from 'react';
import type { FormInstance } from 'antd';
import { EditOutlined, DeleteOutlined, ThunderboltOutlined, BranchesOutlined, AppstoreAddOutlined, CheckCircleOutlined, ExclamationCircleOutlined, PlusOutlined, FileTextOutlined, UploadOutlined, DownloadOutlined, MoreOutlined, CloseOutlined, BulbOutlined, ReloadOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import { eventBus, EventNames } from '../store/eventBus';
import { getProjectTasks, type TaskStatus } from '../services/backgroundTaskService';
import { useOutlineSync } from '../store/hooks';
import { generateOutlineBackground } from '../services/backgroundTaskService';
import { outlineApi, chapterApi, projectApi, characterApi } from '../services/api';
import type { ApiError, Character, Outline as OutlineItem, OutlineDirectionSuggestion, OutlineImportMode, OutlineImportPreview } from '../types';

// 大纲生成请求数据类型
interface OutlineGenerateRequestData {
  project_id: string;
  genre: string;
  theme: string;
  chapter_count: number;
  narrative_perspective: string;
  target_words: number;
  requirements?: string;
  mode: 'auto' | 'new' | 'continue';
  story_direction?: string;
  plot_stage: 'development' | 'climax' | 'ending';
  model?: string;
  provider?: string;
}

// 角色/组织条目类型（新格式）
interface CharacterEntry {
  name: string;
  type: 'character' | 'organization';
}

/**
 * 解析 characters 字段，兼容新旧格式
 * 旧格式: string[] -> 全部当作 character
 * 新格式: {name: string, type: "character"|"organization"}[]
 */
function parseCharacterEntries(characters: unknown): CharacterEntry[] {
  if (!Array.isArray(characters) || characters.length === 0) return [];
  
  return characters.map((entry) => {
    if (typeof entry === 'string') {
      // 旧格式：纯字符串，默认为 character
      return { name: entry, type: 'character' as const };
    }
    if (typeof entry === 'object' && entry !== null && 'name' in entry) {
      // 新格式：带类型标识的对象
      return {
        name: (entry as { name: string }).name,
        type: ((entry as { type?: string }).type === 'organization' ? 'organization' : 'character') as 'character' | 'organization'
      };
    }
    return null;
  }).filter((e): e is CharacterEntry => e !== null);
}

/** 从 entries 中提取角色名称列表 */
function getCharacterNames(entries: CharacterEntry[]): string[] {
  return entries.filter(e => e.type === 'character').map(e => e.name);
}

/** 从 entries 中提取组织名称列表 */
function getOrganizationNames(entries: CharacterEntry[]): string[] {
  return entries.filter(e => e.type === 'organization').map(e => e.name);
}

interface OutlineStructureData {
  key_events?: string[];
  key_points?: string[];
  characters_involved?: string[];
  characters?: unknown[];
  scenes?: string[] | Array<{
    location: string;
    characters: string[];
    purpose: string;
  }>;
  emotion?: string;
  goal?: string;
  title?: string;
  summary?: string;
  content?: string;
}

function parseOutlineStructure(structure?: string): OutlineStructureData {
  if (!structure) return {};
  try {
    return JSON.parse(structure) as OutlineStructureData;
  } catch (e) {
    console.error('解析structure失败:', e);
    return {};
  }
}

const alphaColor = (color: string, alpha: number) =>
  `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

function getOutlinePreview(content: string, maxLength = 120): { text: string; truncated: boolean } {
  const normalized = (content || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return { text: normalized, truncated: false };
  }
  return {
    text: `${normalized.slice(0, maxLength).trimEnd()}...`,
    truncated: true
  };
}

function OutlineDetailSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const { token } = theme.useToken();

  return (
    <section style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: token.colorText }}>{title}</span>
        {count !== undefined && (
          <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{count}</span>
        )}
        <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
      </div>
      {children}
    </section>
  );
}

function OutlineTextList({ items }: { items: string[] }) {
  const { token } = theme.useToken();

  return (
    <div>
      {items.map((item, index) => (
        <div
          key={`${index}-${item}`}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '9px 0',
            borderBottom: index < items.length - 1 ? `1px solid ${token.colorBorderSecondary}` : 'none',
          }}
        >
          <span style={{
            width: 22,
            height: 22,
            flexShrink: 0,
            borderRadius: 11,
            background: token.colorFillTertiary,
            color: token.colorTextSecondary,
            fontSize: 11,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {index + 1}
          </span>
          <span style={{
            flex: 1,
            minWidth: 0,
            paddingTop: 1,
            fontSize: 13,
            lineHeight: 1.75,
            color: token.colorTextSecondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {item}
          </span>
        </div>
      ))}
    </div>
  );
}

interface OutlineDetailDrawerProps {
  outline: OutlineItem | null;
  structureData: OutlineStructureData;
  modeLabel: '章' | '卷';
  isMobile: boolean;
  onClose: () => void;
  onEdit: () => void;
}

function OutlineDetailDrawer({
  outline,
  structureData,
  modeLabel,
  isMobile,
  onClose,
  onEdit,
}: OutlineDetailDrawerProps) {
  const { token } = theme.useToken();

  const characterEntries = parseCharacterEntries(structureData.characters);
  const characterNames = getCharacterNames(characterEntries);
  const organizationNames = getOrganizationNames(characterEntries);
  const involvedCharacterNames = characterNames.length > 0
    ? characterNames
    : (structureData.characters_involved || []);
  const hasStructure = Boolean(
    involvedCharacterNames.length > 0 ||
    organizationNames.length > 0 ||
    structureData.scenes?.length ||
    structureData.key_events?.length ||
    structureData.key_points?.length ||
    structureData.emotion ||
    structureData.goal
  );

  return (
    <Drawer
      open={Boolean(outline)}
      onClose={onClose}
      closable={false}
      width={isMobile ? '100%' : 760}
      styles={{ body: { padding: 0 } }}
    >
      {outline && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            flexShrink: 0,
            padding: isMobile ? '18px 18px 16px' : '22px 26px 18px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{
                width: 46,
                height: 46,
                flexShrink: 0,
                borderRadius: 10,
                background: token.colorFillTertiary,
                color: token.colorTextSecondary,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: token.colorText, lineHeight: 1.1 }}>
                  {outline.order_index || '?'}
                </span>
                <span style={{ marginTop: 2, fontSize: 9, color: token.colorTextTertiary, lineHeight: 1 }}>
                  {modeLabel}
                </span>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: isMobile ? 17 : 19,
                  fontWeight: 600,
                  lineHeight: 1.5,
                  color: token.colorText,
                  overflowWrap: 'anywhere',
                }}>
                  {outline.title}
                </div>
                <div style={{
                  marginTop: 5,
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  fontSize: 12,
                  color: token.colorTextTertiary,
                }}>
                  <span>{modeLabel} {outline.order_index || '?'}</span>
                  {involvedCharacterNames.length > 0 && <span>{involvedCharacterNames.length} 个角色</span>}
                  {organizationNames.length > 0 && <span>{organizationNames.length} 个组织</span>}
                  {(structureData.scenes?.length || 0) > 0 && <span>{structureData.scenes?.length} 个场景</span>}
                </div>
              </div>

              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                aria-label="关闭大纲详情"
                onClick={onClose}
                style={{ flexShrink: 0, color: token.colorTextTertiary }}
              />
            </div>
          </div>

          <div style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: isMobile ? '20px 18px 28px' : '24px 26px 32px',
          }}>
            <div style={{
              fontSize: 14,
              lineHeight: 2,
              color: token.colorTextSecondary,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}>
              {outline.content || '暂无内容'}
            </div>

            {hasStructure && (
              <div style={{
                marginTop: 26,
                paddingTop: 4,
                borderTop: `1px solid ${token.colorBorderSecondary}`,
              }}>
                {involvedCharacterNames.length > 0 && (
                  <OutlineDetailSection title="涉及角色" count={involvedCharacterNames.length}>
                    <Space wrap size={[6, 6]}>
                      {involvedCharacterNames.map((name, idx) => (
                        <Tag
                          key={`${name}-${idx}`}
                          style={{
                            margin: 0,
                            padding: '3px 10px',
                            borderRadius: 6,
                            borderColor: token.colorBorderSecondary,
                            background: token.colorFillQuaternary,
                            color: token.colorTextSecondary,
                            fontSize: isMobile ? 11 : 12,
                            lineHeight: '20px',
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                            height: 'auto',
                          }}
                        >
                          {name}
                        </Tag>
                      ))}
                    </Space>
                  </OutlineDetailSection>
                )}

                {organizationNames.length > 0 && (
                  <OutlineDetailSection title="涉及组织" count={organizationNames.length}>
                    <Space wrap size={[6, 6]}>
                      {organizationNames.map((name, idx) => (
                        <Tag
                          key={`${name}-${idx}`}
                          style={{
                            margin: 0,
                            padding: '3px 10px',
                            borderRadius: 6,
                            borderColor: token.colorBorderSecondary,
                            background: token.colorFillQuaternary,
                            color: token.colorTextSecondary,
                            fontSize: isMobile ? 11 : 12,
                            lineHeight: '20px',
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                            height: 'auto',
                          }}
                        >
                          {name}
                        </Tag>
                      ))}
                    </Space>
                  </OutlineDetailSection>
                )}

                {structureData.scenes && structureData.scenes.length > 0 && (
                  <OutlineDetailSection title="场景设定" count={structureData.scenes.length}>
                    <div>
                      {structureData.scenes.map((scene, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            padding: '10px 0',
                            borderBottom: idx < structureData.scenes!.length - 1
                              ? `1px solid ${token.colorBorderSecondary}`
                              : 'none',
                          }}
                        >
                          <span style={{
                            width: 22,
                            height: 22,
                            flexShrink: 0,
                            borderRadius: 11,
                            background: token.colorFillTertiary,
                            color: token.colorTextSecondary,
                            fontSize: 11,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            {idx + 1}
                          </span>
                          <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                            {typeof scene === 'string' ? (
                              <div style={{
                                fontSize: 13,
                                lineHeight: 1.75,
                                color: token.colorTextSecondary,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}>
                                {scene}
                              </div>
                            ) : (
                              <>
                                <div style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  lineHeight: 1.7,
                                  color: token.colorText,
                                  wordBreak: 'break-word',
                                }}>
                                  {scene.location || `场景 ${idx + 1}`}
                                </div>
                                {scene.characters && scene.characters.length > 0 && (
                                  <div style={{
                                    marginTop: 3,
                                    fontSize: 12,
                                    lineHeight: 1.7,
                                    color: token.colorTextSecondary,
                                    wordBreak: 'break-word',
                                  }}>
                                    <span style={{ color: token.colorTextTertiary }}>角色：</span>
                                    {scene.characters.join('、')}
                                  </div>
                                )}
                                {scene.purpose && (
                                  <div style={{
                                    marginTop: 3,
                                    fontSize: 12,
                                    lineHeight: 1.7,
                                    color: token.colorTextSecondary,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                  }}>
                                    <span style={{ color: token.colorTextTertiary }}>目的：</span>
                                    {scene.purpose}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </OutlineDetailSection>
                )}

                {structureData.key_events && structureData.key_events.length > 0 && (
                  <OutlineDetailSection title="关键事件" count={structureData.key_events.length}>
                    <OutlineTextList items={structureData.key_events} />
                  </OutlineDetailSection>
                )}

                {structureData.key_points && structureData.key_points.length > 0 && (
                  <OutlineDetailSection title="情节要点" count={structureData.key_points.length}>
                    <OutlineTextList items={structureData.key_points} />
                  </OutlineDetailSection>
                )}

                {structureData.emotion && (
                  <OutlineDetailSection title="情感基调">
                    <div style={{
                      fontSize: 13,
                      lineHeight: 1.8,
                      color: token.colorTextSecondary,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {structureData.emotion}
                    </div>
                  </OutlineDetailSection>
                )}

                {structureData.goal && (
                  <OutlineDetailSection title="叙事目标">
                    <div style={{
                      fontSize: 13,
                      lineHeight: 1.8,
                      color: token.colorTextSecondary,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {structureData.goal}
                    </div>
                  </OutlineDetailSection>
                )}
              </div>
            )}
          </div>

          <div style={{
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: isMobile ? '12px 18px' : '14px 26px',
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}>
            <Button onClick={onClose}>关闭</Button>
            <Button type="primary" icon={<EditOutlined />} onClick={onEdit}>
              编辑大纲
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

const { TextArea } = Input;

function DirectionSuggestionPanel({
  form,
  hasOutlines,
  projectId,
}: {
  form: FormInstance;
  hasOutlines: boolean;
  projectId: string;
}) {
  const { token } = theme.useToken();
  const [suggestions, setSuggestions] = useState<OutlineDirectionSuggestion[]>([]);
  const [selectedDescription, setSelectedDescription] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const currentDirection = Form.useWatch('story_direction', form);

  const handleGenerate = async () => {
    if (loading) return;

    const values = form.getFieldsValue();
    setLoading(true);
    try {
      const nextSuggestions = await outlineApi.generateContinueDirections({
        project_id: projectId,
        plot_stage: values.plot_stage || 'development',
        requirements: values.requirements,
        current_direction: values.story_direction,
        exclude_directions: history,
        model: values.model,
      });
      setSuggestions(nextSuggestions);
      setSelectedDescription(null);
      setHistory(prev => [
        ...prev,
        ...nextSuggestions.flatMap(item => [item.title, item.description]),
      ].slice(-24));
    } catch (error: unknown) {
      const apiError = error as ApiError;
      message.error(apiError.response?.data?.detail || '生成续写方向失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (suggestion: OutlineDirectionSuggestion) => {
    form.setFieldsValue({ story_direction: suggestion.description });
    setSelectedDescription(suggestion.description);
  };

  return (
    <div style={{
      marginTop: -6,
      marginBottom: 18,
      padding: 14,
      borderRadius: token.borderRadiusLG,
      border: `1px solid ${token.colorBorderSecondary}`,
      background: token.colorFillQuaternary,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
            暂时没有思路？让 AI 提供几个方向
          </div>
          <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.6, color: token.colorTextTertiary }}>
            基于最近大纲生成，选中后仍可继续修改。
          </div>
        </div>
        <Button
          size="small"
          icon={suggestions.length > 0 ? <ReloadOutlined /> : <BulbOutlined />}
          loading={loading}
          disabled={!hasOutlines}
          onClick={handleGenerate}
        >
          {suggestions.length > 0 ? '换一批' : 'AI 帮我想方向'}
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {suggestions.map((suggestion, index) => {
            const selected = selectedDescription === suggestion.description
              && currentDirection === suggestion.description;
            return (
              <button
                key={`${suggestion.title}-${index}`}
                type="button"
                onClick={() => handleSelect(suggestion)}
                style={{
                  width: '100%',
                  padding: '11px 12px',
                  textAlign: 'left',
                  borderRadius: token.borderRadius,
                  border: `1px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
                  background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, background 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 20,
                    height: 20,
                    flexShrink: 0,
                    borderRadius: 10,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: selected ? token.colorPrimary : token.colorTextTertiary,
                    background: selected ? token.colorPrimaryBgHover : token.colorFillTertiary,
                  }}>
                    {index + 1}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                    {suggestion.title}
                  </span>
                  {selected && (
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: token.colorPrimary }}>
                      已填入
                    </span>
                  )}
                </div>
                <div style={{
                  marginTop: 7,
                  fontSize: 12,
                  lineHeight: 1.7,
                  color: token.colorTextSecondary,
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                }}>
                  {suggestion.description}
                </div>
                {suggestion.conflict && (
                  <div style={{ marginTop: 6, fontSize: 11, color: token.colorTextTertiary }}>
                    核心冲突：{suggestion.conflict}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {suggestions.length > 0 && !currentDirection?.trim() && (
        <div style={{ marginTop: 8, fontSize: 11, color: token.colorTextTertiary }}>
          选择一条方向后，会自动写入下方输入框。
        </div>
      )}
    </div>
  );
}

export default function Outline() {
  const { currentProject, outlines, setCurrentProject } = useStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [editForm] = Form.useForm();
  const [generateForm] = Form.useForm();
  const [expansionForm] = Form.useForm();
  const [modalApi, contextHolder] = Modal.useModal();
  const [batchExpansionForm] = Form.useForm();
  const [manualCreateForm] = Form.useForm();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isExpanding, setIsExpanding] = useState(false);
  const [projectCharacters, setProjectCharacters] = useState<Array<{ label: string; value: string }>>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<OutlineImportMode>('append');
  const [importPreview, setImportPreview] = useState<OutlineImportPreview | null>(null);
  const [isPreviewingImport, setIsPreviewingImport] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { token } = theme.useToken();

  const [detailOutline, setDetailOutline] = useState<OutlineItem | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 大纲查询与分页状态
  const [outlineSearchKeyword, setOutlineSearchKeyword] = useState('');
  const [outlinePage, setOutlinePage] = useState(1);
  const [outlinePageSize, setOutlinePageSize] = useState(20);

  // 使用同步 hooks
  const {
    refreshOutlines,
    updateOutline,
    deleteOutline
  } = useOutlineSync();

  // 初始加载大纲列表和角色列表
  useEffect(() => {
    if (currentProject?.id) {
      refreshOutlines();
      // 加载项目角色列表
      loadProjectCharacters();
      // 检查是否有活跃的大纲生成任务，恢复按钮禁用状态
      checkActiveOutlineTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]); // 只依赖 ID，不依赖函数

  // 检查是否有活跃的大纲生成任务（页面切换后恢复状态）
  const checkActiveOutlineTasks = async () => {
    if (!currentProject?.id) return;
    try {
      const result = await getProjectTasks(currentProject.id, 'outline_new', 5);
      const result2 = await getProjectTasks(currentProject.id, 'outline_continue', 5);
      const allTasks = [...(result.items || []), ...(result2.items || [])];
      const hasActive = allTasks.some((t: TaskStatus) => t.status === 'running' || t.status === 'pending');
      setIsGenerating(hasActive);
    } catch (error) {
      console.error('检查活跃大纲任务失败:', error);
    }
  };

  // 加载项目角色列表
  const loadProjectCharacters = async () => {
    if (!currentProject?.id) return;
    try {
      const characters = await characterApi.getCharacters(currentProject.id);
      setProjectCharacters(
        characters.map((char: Character) => ({
          label: char.name,
          value: char.name
        }))
      );
    } catch (error) {
      console.error('加载角色列表失败:', error);
    }
  };

  // 从后端返回字段直接构建展开状态，避免前端 N+1 请求
  const outlineExpandStatus = useMemo(() => {
    const statusMap: Record<string, boolean> = {};
    outlines.forEach((outline) => {
      statusMap[outline.id] = Boolean(outline.has_chapters);
    });
    return statusMap;
  }, [outlines]);

  // 统一预解析 structure，避免 render 阶段重复 JSON.parse
  const outlineStructureMap = useMemo(() => {
    const parsedMap: Record<string, OutlineStructureData> = {};
    outlines.forEach((outline) => {
      parsedMap[outline.id] = parseOutlineStructure(outline.structure);
    });
    return parsedMap;
  }, [outlines]);

  // 当角色确认数据变化时，初始化选中状态（默认全选）
  // 当组织确认数据变化时，初始化选中状态（默认全选）
  // 移除事件监听，避免无限循环
  // Hook 内部已经更新了 store，不需要再次刷新

  // 确保大纲按 order_index 排序
  const sortedOutlines = [...outlines].sort((a, b) => a.order_index - b.order_index);

  // 前端查询过滤
  const filteredOutlines = useMemo(() => {
    const keyword = outlineSearchKeyword.trim().toLowerCase();
    if (!keyword) return sortedOutlines;

    return sortedOutlines.filter((outline) => {
      return (
        String(outline.order_index).includes(keyword) ||
        outline.title.toLowerCase().includes(keyword) ||
        outline.content.toLowerCase().includes(keyword)
      );
    });
  }, [sortedOutlines, outlineSearchKeyword]);

  // 当前分页数据
  const pagedOutlines = useMemo(() => {
    const start = (outlinePage - 1) * outlinePageSize;
    return filteredOutlines.slice(start, start + outlinePageSize);
  }, [filteredOutlines, outlinePage, outlinePageSize]);

  // 搜索词或页大小变化时，回到第一页
  useEffect(() => {
    setOutlinePage(1);
  }, [outlineSearchKeyword, outlinePageSize]);

  // 数据变化导致页码越界时自动纠正
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredOutlines.length / outlinePageSize));
    if (outlinePage > maxPage) {
      setOutlinePage(maxPage);
    }
  }, [filteredOutlines.length, outlinePage, outlinePageSize]);

  if (!currentProject) return null;

  const handleOpenEditModal = (id: string) => {
    const outline = outlines.find(o => o.id === id);
    if (outline) {
      const structureData = outlineStructureMap[outline.id] || {};
      
      // 解析角色/组织条目（兼容新旧格式）
      const editEntries = parseCharacterEntries(structureData.characters);
      const editCharNames = getCharacterNames(editEntries);
      const editOrgNames = getOrganizationNames(editEntries);
      
      // 处理场景数据 - 可能是字符串数组或对象数组
      let scenesText = '';
      if (structureData.scenes) {
        if (typeof structureData.scenes[0] === 'string') {
          // 字符串数组格式
          scenesText = (structureData.scenes as string[]).join('\n');
        } else {
          // 对象数组格式
          scenesText = (structureData.scenes as Array<{location: string; characters: string[]; purpose: string}>)
            .map(s => `${s.location}|${(s.characters || []).join('、')}|${s.purpose}`)
            .join('\n');
        }
      }
      
      // 处理情节要点数据
      const keyPointsText = structureData.key_points ? structureData.key_points.join('\n') : '';
      
      // 设置表单初始值
      editForm.setFieldsValue({
        title: outline.title,
        content: outline.content,
        characters: editCharNames,
        organizations: editOrgNames,
        scenes: scenesText,
        key_points: keyPointsText,
        emotion: structureData.emotion || '',
        goal: structureData.goal || ''
      });
      
      modalApi.confirm({
        title: '编辑大纲',
        width: 800,
        centered: true,
        styles: {
          body: {
            maxHeight: 'calc(100vh - 200px)',
            overflowY: 'auto'
          }
        },
        content: (
          <Form
            form={editForm}
            layout="vertical"
            style={{ marginTop: 12 }}
          >
            <Form.Item
              label="标题"
              name="title"
              rules={[{ required: true, message: '请输入标题' }]}
              style={{ marginBottom: 12 }}
            >
              <Input placeholder="输入大纲标题" />
            </Form.Item>

            <Form.Item
              label="内容"
              name="content"
              rules={[{ required: true, message: '请输入内容' }]}
              style={{ marginBottom: 12 }}
            >
              <TextArea rows={4} placeholder="输入大纲内容..." />
            </Form.Item>
            
            <Form.Item
              label="涉及角色"
              name="characters"
              tooltip="从项目角色中选择，也可以手动输入新角色名"
              style={{ marginBottom: 12 }}
            >
              <Select
                mode="tags"
                style={{ width: '100%' }}
                placeholder="选择或输入角色名"
                options={projectCharacters}
                tokenSeparators={[',', '，']}
                maxTagCount="responsive"
              />
            </Form.Item>
            
            <Form.Item
              label="涉及组织"
              name="organizations"
              tooltip="从项目组织中选择，也可以手动输入新组织名"
              style={{ marginBottom: 12 }}
            >
              <Select
                mode="tags"
                style={{ width: '100%' }}
                placeholder="选择或输入组织/势力名"
                tokenSeparators={[',', '，']}
                maxTagCount="responsive"
              />
            </Form.Item>
            
            <Form.Item
              label="场景信息"
              name="scenes"
              tooltip="支持两种格式：简单描述（每行一个场景）或详细格式（地点|角色|目的）"
              style={{ marginBottom: 12 }}
            >
              <TextArea
                rows={3}
                placeholder="每行一个场景&#10;详细格式：地点|角色1、角色2|目的"
              />
            </Form.Item>
            
            <Form.Item
              label="情节要点"
              name="key_points"
              tooltip="每行一个情节要点"
              style={{ marginBottom: 12 }}
            >
              <TextArea
                rows={2}
                placeholder="每行一个情节要点"
              />
            </Form.Item>
            
            <Form.Item
              label="情感基调"
              name="emotion"
              tooltip="描述本章的情感氛围"
              style={{ marginBottom: 12 }}
            >
              <Input placeholder="例如：冷冽与躁动并存" />
            </Form.Item>
            
            <Form.Item
              label="叙事目标"
              name="goal"
              tooltip="本章要达成的叙事目的"
              style={{ marginBottom: 0 }}
            >
              <Input placeholder="例如：建立世界观对比并完成主角初遇" />
            </Form.Item>
          </Form>
        ),
        okText: '更新',
        cancelText: '取消',
        onOk: async () => {
          const values = await editForm.validateFields();
          try {
            // 解析并重构structure数据（使用预解析缓存，避免重复 JSON.parse）
            const originalStructure = outlineStructureMap[outline.id] || {};
            
            // 处理角色和组织数据 - 合并为带类型标识的新格式
            const charNames = Array.isArray(values.characters)
              ? values.characters.filter((c: string) => c && c.trim())
              : [];
            const orgNames = Array.isArray(values.organizations)
              ? values.organizations.filter((c: string) => c && c.trim())
              : [];
            const characters: CharacterEntry[] = [
              ...charNames.map((name: string) => ({ name: name.trim(), type: 'character' as const })),
              ...orgNames.map((name: string) => ({ name: name.trim(), type: 'organization' as const }))
            ];
            
            // 处理场景数据 - 检测原始格式
            let scenes: string[] | Array<{location: string; characters: string[]; purpose: string}> | undefined;
            if (values.scenes) {
              const lines = values.scenes.split('\n')
                .map((line: string) => line.trim())
                .filter((line: string) => line);
              
              // 检查是否包含管道符，判断格式
              const hasStructuredFormat = lines.some((line: string) => line.includes('|'));
              
              if (hasStructuredFormat) {
                // 尝试解析为对象数组格式
                scenes = lines
                  .map((line: string) => {
                    const parts = line.split('|');
                    if (parts.length >= 3) {
                      return {
                        location: parts[0].trim(),
                        characters: parts[1].split('、').map(c => c.trim()).filter(c => c),
                        purpose: parts[2].trim()
                      };
                    }
                    return null;
                  })
                  .filter((s: { location: string; characters: string[]; purpose: string } | null): s is { location: string; characters: string[]; purpose: string } => s !== null);
              } else {
                // 保持字符串数组格式
                scenes = lines;
              }
            }
            
            // 处理情节要点数据
            const keyPoints = values.key_points
              ? values.key_points.split('\n')
                  .map((line: string) => line.trim())
                  .filter((line: string) => line)
              : undefined;
            
            // 合并structure数据，只包含AI实际生成的字段
            const newStructure = {
              ...originalStructure,
              title: values.title,
              summary: values.content,
              characters: characters.length > 0 ? characters : undefined,
              scenes: scenes && scenes.length > 0 ? scenes : undefined,
              key_points: keyPoints && keyPoints.length > 0 ? keyPoints : undefined,
              emotion: values.emotion || undefined,
              goal: values.goal || undefined
            };
            
            // 更新大纲
            await updateOutline(id, {
              title: values.title,
              content: values.content,
              structure: JSON.stringify(newStructure, null, 2)
            });
            
            message.success('大纲更新成功');
          } catch (error) {
            console.error('更新失败:', error);
            message.error('更新失败');
          }
        },
      });
    }
  };

  const handleDeleteOutline = async (id: string) => {
    try {
      await deleteOutline(id);
      message.success('删除成功');
      // 删除后刷新大纲列表和项目信息，更新字数显示
      await refreshOutlines();
      if (currentProject?.id) {
        const updatedProject = await projectApi.getProject(currentProject.id);
        setCurrentProject(updatedProject);
      }
    } catch {
      message.error('删除失败');
    }
  };

  interface GenerateFormValues {
    theme?: string;
    chapter_count?: number;
    narrative_perspective?: string;
    requirements?: string;
    provider?: string;
    model?: string;
    mode?: 'auto' | 'new' | 'continue';
    story_direction?: string;
    plot_stage?: 'development' | 'climax' | 'ending';
    keep_existing?: boolean;
  }

  const handleGenerate = async (values: GenerateFormValues) => {
    try {
      setIsGenerating(true);

      // 添加详细的调试日志
      console.log('=== 大纲生成调试信息 ===');
      console.log('1. Form values 原始数据:', values);
      console.log('2. values.model:', values.model);
      console.log('3. values.provider:', values.provider);

      // 关闭生成表单Modal
      Modal.destroyAll();

      // 准备请求数据
      const requestData: OutlineGenerateRequestData = {
        project_id: currentProject.id,
        genre: currentProject.genre || '通用',
        theme: values.theme || currentProject.theme || '',
        chapter_count: values.chapter_count || 5,
        narrative_perspective: values.narrative_perspective || currentProject.narrative_perspective || '第三人称',
        target_words: currentProject.target_words || 100000,
        requirements: values.requirements,
        mode: values.mode || 'auto',
        story_direction: values.story_direction,
        plot_stage: values.plot_stage || 'development'
      };

      // 只有在用户选择了模型时才添加model参数
      if (values.model) {
        requestData.model = values.model;
        console.log('4. 添加model到请求:', values.model);
      } else {
        console.log('4. values.model为空，不添加到请求');
      }

      // 添加provider参数（如果有）
      if (values.provider) {
        requestData.provider = values.provider;
        console.log('5. 添加provider到请求:', values.provider);
      }

      console.log('6. 最终请求数据:', JSON.stringify(requestData, null, 2));
      console.log('=========================');

      // 使用后台任务生成（不怕断连，关闭浏览器也继续运行）
      // 不再强制显示进度弹窗，任务进度在右下角悬浮任务框中显示
      await generateOutlineBackground(
        requestData,
        () => {
          // 进度更新由悬浮任务框处理，无需额外操作
        },
        (result) => {
          message.success(result.task_result?.message as string || '大纲生成完成！');
          setIsGenerating(false);
          refreshOutlines();
        },
        (error) => {
          message.error(`生成失败: ${error}`);
          setIsGenerating(false);
        }
      );

      message.info('大纲生成任务已提交，可在右下角任务面板查看进度');
      // 通知悬浮任务框刷新
      eventBus.emit('background-task-created');

    } catch (error) {
      console.error('AI生成失败:', error);
      message.error(error instanceof Error ? error.message : 'AI生成失败');
      setIsGenerating(false);
    }
  };

  const showGenerateModal = async () => {
    const hasOutlines = outlines.length > 0;
    const initialMode = hasOutlines ? 'continue' : 'new';

    // 直接加载可用模型列表
    const settingsResponse = await fetch('/api/settings');
    const settings = await settingsResponse.json();
    const { api_key, api_base_url, api_provider } = settings;

    let loadedModels: Array<{ value: string, label: string }> = [];
    let defaultModel: string | undefined = undefined;

    if (settings.shared_config_active) {
      // 公共配置只暴露管理员设置的展示名称，不能列真实模型
      const displayModel = settings.model_display_name || settings.llm_model;
      if (displayModel) {
        loadedModels = [{ value: displayModel, label: displayModel }];
        defaultModel = displayModel;
      }
    } else {
      // 公共配置之外的普通配置仍然拉取供应商模型列表
      try {
        const modelsUrl = api_base_url
          ? `/api/settings/models?api_key=${encodeURIComponent(api_key || '')}&api_base_url=${encodeURIComponent(api_base_url)}&provider=${api_provider}`
          : '/api/settings/models';
        const modelsResponse = await fetch(modelsUrl);
        if (modelsResponse.ok) {
          const data = await modelsResponse.json();
          if (data.models && data.models.length > 0) {
            loadedModels = data.models;
            defaultModel = settings.model_display_name || settings.llm_model;
          }
        }
      } catch {
        console.log('获取模型列表失败，将使用默认模型');
      }
    }

    modalApi.confirm({
      title: hasOutlines ? (
        <Space>
          <span>AI生成/续写大纲</span>
          <Tag color="blue">当前已有 {outlines.length} 卷</Tag>
        </Space>
      ) : 'AI生成大纲',
      width: 700,
      centered: true,
      content: (
        <Form
          form={generateForm}
          layout="vertical"
          style={{ marginTop: 16 }}
          initialValues={{
            mode: initialMode,
            chapter_count: 5,
            narrative_perspective: currentProject.narrative_perspective || '第三人称',
            plot_stage: 'development',
            keep_existing: true,
            theme: currentProject.theme || '',
            model: defaultModel,
          }}
        >
          {hasOutlines && (
            <Form.Item
              label="生成模式"
              name="mode"
              tooltip="自动判断：根据是否有大纲自动选择；全新生成：删除旧大纲重新生成；续写模式：基于已有大纲继续创作"
            >
              <Radio.Group buttonStyle="solid">
                <Radio.Button value="auto">自动判断</Radio.Button>
                <Radio.Button value="new">全新生成</Radio.Button>
                <Radio.Button value="continue">续写模式</Radio.Button>
              </Radio.Group>
            </Form.Item>
          )}

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.mode !== currentValues.mode}
          >
            {({ getFieldValue }) => {
              const mode = getFieldValue('mode');
              const isContinue = mode === 'continue' || (mode === 'auto' && hasOutlines);

              // 续写模式不显示主题输入，使用项目原有主题
              if (isContinue) {
                return null;
              }

              // 全新生成模式需要输入主题
              return (
                <Form.Item
                  label="故事主题"
                  name="theme"
                  rules={[{ required: true, message: '请输入故事主题' }]}
                >
                  <TextArea rows={3} placeholder="描述你的故事主题、核心设定和主要情节..." />
                </Form.Item>
              );
            }}
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.mode !== currentValues.mode}
          >
            {({ getFieldValue }) => {
              const mode = getFieldValue('mode');
              const isContinue = mode === 'continue' || (mode === 'auto' && hasOutlines);

              return (
                <>
                  {isContinue && (
                    <>
                      <Form.Item
                        label="故事发展方向"
                        name="story_direction"
                        tooltip="告诉AI你希望故事接下来如何发展"
                      >
                        <TextArea
                          rows={3}
                          placeholder="例如：主角遇到新的挑战、引入新角色、揭示关键秘密等..."
                        />
                      </Form.Item>

                      <DirectionSuggestionPanel
                        form={generateForm}
                        hasOutlines={hasOutlines}
                        projectId={currentProject.id}
                      />

                      <Form.Item
                        label="情节阶段"
                        name="plot_stage"
                        tooltip="帮助AI理解当前故事所处的阶段"
                      >
                        <Select>
                          <Select.Option value="development">发展阶段 - 继续展开情节</Select.Option>
                          <Select.Option value="climax">高潮阶段 - 矛盾激化</Select.Option>
                          <Select.Option value="ending">结局阶段 - 收束伏笔</Select.Option>
                        </Select>
                      </Form.Item>
                    </>
                  )}

                  <Form.Item
                    label={isContinue ? "续写章节数" : "章节数量"}
                    name="chapter_count"
                    tooltip={isContinue ? '这里填写的是你要向后续写几章' : undefined}
                    rules={[{ required: true, message: '请输入章节数量' }]}
                  >
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      placeholder={isContinue ? "建议5-10章" : "如：30"}
                    />
                  </Form.Item>

                  <Form.Item
                    label="叙事视角"
                    name="narrative_perspective"
                    rules={[{ required: true, message: '请选择叙事视角' }]}
                  >
                    <Select>
                      <Select.Option value="第一人称">第一人称</Select.Option>
                      <Select.Option value="第三人称">第三人称</Select.Option>
                      <Select.Option value="全知视角">全知视角</Select.Option>
                    </Select>
                  </Form.Item>

                  <Form.Item label="其他要求" name="requirements">
                    <TextArea rows={2} placeholder="其他特殊要求（可选）" />
                  </Form.Item>

                </>
              );
            }}
          </Form.Item>

          {/* 自定义模型选择 - 移到外层，所有模式都显示 */}
          {loadedModels.length > 0 && (
            <Form.Item
              label="AI模型"
              name="model"
              tooltip="选择用于生成的AI模型，不选则使用系统默认模型"
            >
              <Select
                placeholder={defaultModel ? `默认: ${loadedModels.find(m => m.value === defaultModel)?.label || defaultModel}` : "使用默认模型"}
                allowClear
                showSearch
                optionFilterProp="label"
                options={loadedModels}
                onChange={(value) => {
                  console.log('用户在下拉框中选择了模型:', value);
                  // 手动同步到Form
                  generateForm.setFieldsValue({ model: value });
                  console.log('已同步到Form，当前Form值:', generateForm.getFieldsValue());
                }}
              />
              <div style={{ color: token.colorTextTertiary, fontSize: 12, marginTop: 4 }}>
                {defaultModel ? `当前默认模型: ${loadedModels.find(m => m.value === defaultModel)?.label || defaultModel}` : '未配置默认模型'}
              </div>
            </Form.Item>
          )}
        </Form>
      ),
      okText: hasOutlines ? '开始续写' : '开始生成',
      cancelText: '取消',
      onOk: async () => {
        const values = await generateForm.validateFields();
        const willReplaceOutlines = hasOutlines && values.mode === 'new';

        if (willReplaceOutlines) {
          Modal.destroyAll();
          modalApi.confirm({
            title: '确认全新生成？',
            icon: <ExclamationCircleOutlined style={{ color: token.colorWarning }} />,
            width: 440,
            centered: true,
            content: (
              <div style={{ lineHeight: 1.8 }}>
                <div>
                  此操作会删除当前项目中的全部 <strong>{outlines.length}</strong> 条旧大纲，并重新生成。
                </div>
                <div style={{ marginTop: 8, color: token.colorError }}>
                  旧大纲及相关内容可能无法恢复，请谨慎操作。
                </div>
              </div>
            ),
            okText: '确认并开始生成',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: () => handleGenerate(values),
          });
          return;
        }

        await handleGenerate(values);
      },
    });
  };

  // 手动创建大纲
  const showManualCreateOutlineModal = () => {
    const nextOrderIndex = outlines.length > 0
      ? Math.max(...outlines.map(o => o.order_index)) + 1
      : 1;

    modalApi.confirm({
      title: '手动创建大纲',
      width: 600,
      centered: true,
      content: (
        <Form
          form={manualCreateForm}
          layout="vertical"
          initialValues={{ order_index: nextOrderIndex }}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="大纲序号"
            name="order_index"
            rules={[{ required: true, message: '请输入序号' }]}
            tooltip={currentProject?.outline_mode === 'one-to-one' ? '在传统模式下，序号即章节编号' : '在细化模式下，序号为卷数'}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="自动计算的下一个序号" />
          </Form.Item>

          <Form.Item
            label="大纲标题"
            name="title"
            rules={[{ required: true, message: '请输入标题' }]}
          >
            <Input placeholder={currentProject?.outline_mode === 'one-to-one' ? '例如：第一章 初入江湖' : '例如：第一卷 初入江湖'} />
          </Form.Item>

          <Form.Item
            label="大纲内容"
            name="content"
            rules={[{ required: true, message: '请输入内容' }]}
          >
            <TextArea
              rows={6}
              placeholder="描述本章/卷的主要情节和发展方向..."
            />
          </Form.Item>
        </Form>
      ),
      okText: '创建',
      cancelText: '取消',
      onOk: async () => {
        const values = await manualCreateForm.validateFields();

        // 校验序号是否重复
        const existingOutline = outlines.find(o => o.order_index === values.order_index);
        if (existingOutline) {
          modalApi.warning({
            title: '序号冲突',
            content: (
              <div>
                <p>序号 <strong>{values.order_index}</strong> 已被使用：</p>
                <div style={{
                  padding: 12,
                  background: token.colorWarningBg,
                  borderRadius: token.borderRadius,
                  border: `1px solid ${token.colorWarningBorder}`,
                  marginTop: 8
                }}>
                  <div style={{ fontWeight: 500, color: token.colorWarning }}>
                    {currentProject?.outline_mode === 'one-to-one'
                      ? `第${existingOutline.order_index}章`
                      : `第${existingOutline.order_index}卷`
                    }：{existingOutline.title}
                  </div>
                </div>
                <p style={{ marginTop: 12, color: token.colorTextSecondary }}>
                  💡 建议使用序号 <strong>{nextOrderIndex}</strong>，或选择其他未使用的序号
                </p>
              </div>
            ),
            okText: '我知道了',
            centered: true
          });
          throw new Error('序号重复');
        }

        try {
          await outlineApi.createOutline({
            project_id: currentProject.id,
            ...values
          });
          message.success('大纲创建成功');
          await refreshOutlines();
          manualCreateForm.resetFields();
        } catch (error: unknown) {
          const err = error as Error;
          if (err.message === '序号重复') {
            // 序号重复错误已经显示了Modal，不需要再显示message
            throw error;
          }
          message.error('创建失败：' + (err.message || '未知错误'));
          throw error;
        }
      }
    });
  };

  // 展开单个大纲为多章 - 提交后台任务并在悬浮任务面板显示进度
  const handleExpandOutline = async (outlineId: string, outlineTitle: string) => {
    try {
      setIsExpanding(true);

      // ✅ 新增：检查是否需要按顺序展开
      const currentOutline = sortedOutlines.find(o => o.id === outlineId);
      if (currentOutline) {
        // 获取所有在当前大纲之前的大纲
        const previousOutlines = sortedOutlines.filter(
          o => o.order_index < currentOutline.order_index
        );

        // 检查前面的大纲是否都已展开
        for (const prevOutline of previousOutlines) {
          try {
            const prevChapters = await outlineApi.getOutlineChapters(prevOutline.id);
            if (!prevChapters.has_chapters) {
              // 如果前面有未展开的大纲，显示提示并阻止操作
              setIsExpanding(false);
              modalApi.warning({
                title: '请按顺序展开大纲',
                width: 600,
                centered: true,
                content: (
                  <div>
                    <p style={{ marginBottom: 12 }}>
                      为了保持章节编号的连续性和内容的连贯性，请先展开前面的大纲。
                    </p>
                    <div style={{
                      padding: 12,
                      background: token.colorWarningBg,
                      borderRadius: token.borderRadius,
                      border: `1px solid ${token.colorWarningBorder}`
                    }}>
                      <div style={{ fontWeight: 500, marginBottom: 8, color: token.colorWarning }}>
                        ⚠️ 需要先展开：
                      </div>
                      <div style={{ color: token.colorTextSecondary }}>
                        第{prevOutline.order_index}卷：《{prevOutline.title}》
                      </div>
                    </div>
                    <p style={{ marginTop: 12, color: token.colorTextSecondary, fontSize: 13 }}>
                      💡 提示：您也可以使用「批量展开」功能，系统会自动按顺序处理所有大纲。
                    </p>
                  </div>
                ),
                okText: '我知道了'
              });
              return;
            }
          } catch (error) {
            console.error(`检查大纲 ${prevOutline.id} 失败:`, error);
            // 如果检查失败，继续处理（避免因网络问题阻塞）
          }
        }
      }

      // 第一步：检查是否已有展开的章节
      const existingChapters = await outlineApi.getOutlineChapters(outlineId);

      if (existingChapters.has_chapters && existingChapters.expansion_plans && existingChapters.expansion_plans.length > 0) {
        // 如果已有章节，显示已有的展开规划信息
        setIsExpanding(false);
        showExistingExpansionPreview(outlineTitle, existingChapters);
        return;
      }

      // 如果没有章节，显示展开表单
      setIsExpanding(false);
      modalApi.confirm({
        title: (
          <Space>
            <BranchesOutlined />
            <span>展开大纲为多章</span>
          </Space>
        ),
        width: 600,
        centered: true,
        content: (
          <div>
            <div style={{ marginBottom: 16, padding: 12, background: token.colorBgLayout, borderRadius: token.borderRadius }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>大纲标题</div>
              <div style={{ color: token.colorTextSecondary }}>{outlineTitle}</div>
            </div>
            <Form
              form={expansionForm}
              layout="vertical"
              initialValues={{
                target_chapter_count: 3,
                expansion_strategy: 'balanced',
              }}
            >
              <Form.Item
                label="目标章节数"
                name="target_chapter_count"
                rules={[{ required: true, message: '请输入目标章节数' }]}
                tooltip="将这个大纲展开为几章内容"
              >
                <InputNumber
                  min={2}
                  max={10}
                  style={{ width: '100%' }}
                  placeholder="建议2-5章"
                />
              </Form.Item>

              <Form.Item
                label="展开策略"
                name="expansion_strategy"
                tooltip="选择如何分配内容到各章节"
              >
                <Radio.Group>
                  <Radio.Button value="balanced">均衡分配</Radio.Button>
                  <Radio.Button value="climax">高潮重点</Radio.Button>
                  <Radio.Button value="detail">细节丰富</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Form>
          </div>
        ),
        okText: '提交后台任务',
        cancelText: '取消',
        onOk: async () => {
          try {
            const values = await expansionForm.validateFields();

            Modal.destroyAll();
            setIsExpanding(true);

            const requestData = {
              ...values,
              auto_create_chapters: true,
              enable_scene_analysis: true
            };

            const response = await fetch(`/api/outlines/${outlineId}/expand-background`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestData),
            });

            if (!response.ok) {
              const err = await response.json().catch(() => ({ detail: response.statusText }));
              throw new Error(err.detail || '创建大纲展开任务失败');
            }

            message.success('大纲展开任务已提交，可在右下角任务面板查看进度');
            eventBus.emit('background-task-created');
            setIsExpanding(false);

          } catch (error) {
            console.error('展开失败:', error);
            message.error(error instanceof Error ? error.message : '展开失败');
            setIsExpanding(false);
          }
        },
      });
    } catch (error) {
      console.error('检查章节失败:', error);
      message.error('检查章节失败');
      setIsExpanding(false);
    }
  };

  // 删除展开的章节内容（保留大纲）
  const handleDeleteExpandedChapters = async (outlineTitle: string, chapters: Array<{ id: string }>) => {
    try {
      // 使用顺序删除避免并发导致的字数计算竞态条件
      // 并发删除会导致多个请求同时读取项目字数并各自减去章节字数，造成计算错误
      for (const chapter of chapters) {
        await chapterApi.deleteChapter(chapter.id);
      }

      message.success(`已删除《${outlineTitle}》展开的所有 ${chapters.length} 个章节`);
      await refreshOutlines();
      // 刷新项目信息以更新字数显示
      if (currentProject?.id) {
        const updatedProject = await projectApi.getProject(currentProject.id);
        setCurrentProject(updatedProject);
      }
    } catch (error: unknown) {
      const apiError = error as ApiError;
      message.error(apiError.response?.data?.detail || '删除章节失败');
    }
  };

  // 显示已存在章节的展开规划
  const showExistingExpansionPreview = (
    outlineTitle: string,
    data: {
      chapter_count: number;
      chapters: Array<{ id: string; chapter_number: number; title: string }>;
      expansion_plans: Array<{
        sub_index: number;
        title: string;
        plot_summary: string;
        key_events: string[];
        character_focus: string[];
        emotional_tone: string;
        narrative_goal: string;
        conflict_type: string;
        estimated_words: number;
        scenes?: Array<{
          location: string;
          characters: string[];
          purpose: string;
        }> | null;
      }> | null;
    }
  ) => {
    modalApi.info({
      title: (
        <Space style={{ flexWrap: 'wrap' }}>
          <CheckCircleOutlined style={{ color: token.colorSuccess }} />
          <span>《{outlineTitle}》展开信息</span>
        </Space>
      ),
      width: isMobile ? '95%' : 900,
      centered: true,
      style: isMobile ? {
        top: 20,
        maxWidth: 'calc(100vw - 16px)',
        margin: '0 8px'
      } : undefined,
      styles: {
        body: {
          maxHeight: isMobile ? 'calc(100vh - 200px)' : 'calc(80vh - 60px)',
          overflowY: 'auto',
          overflowX: 'hidden'
        }
      },
      footer: (
        <Space wrap style={{ width: '100%', justifyContent: isMobile ? 'center' : 'flex-end' }}>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.destroyAll();
              modalApi.confirm({
                title: '确认删除',
                icon: <ExclamationCircleOutlined />,
                centered: true,
                content: (
                  <div>
                    <p>此操作将删除大纲《{outlineTitle}》展开的所有 <strong>{data.chapter_count}</strong> 个章节。</p>
                    <p style={{ color: token.colorPrimary, marginTop: 8 }}>
                      📝 注意：大纲本身会保留，您可以重新展开
                    </p>
                    <p style={{ color: token.colorError, marginTop: 8 }}>
                      ⚠️ 警告：章节内容将永久删除且无法恢复！
                    </p>
                  </div>
                ),
                okText: '确认删除',
                okType: 'danger',
                cancelText: '取消',
                onOk: () => handleDeleteExpandedChapters(outlineTitle, data.chapters || []),
              });
            }}
            block={isMobile}
            size={isMobile ? 'middle' : undefined}
          >
            删除所有展开的章节 ({data.chapter_count}章)
          </Button>
          <Button onClick={() => Modal.destroyAll()}>
            关闭
          </Button>
        </Space>
      ),
      content: (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Space wrap style={{ maxWidth: '100%' }}>
              <Tag
                color="blue"
                style={{
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  height: 'auto',
                  lineHeight: '1.5',
                  padding: '4px 8px'
                }}
              >
                大纲: {outlineTitle}
              </Tag>
              <Tag color="green">章节数: {data.chapter_count}</Tag>
              <Tag color="orange">已创建章节</Tag>
            </Space>
          </div>
          <Tabs
            defaultActiveKey="0"
            type="card"
            items={data.expansion_plans?.map((plan, idx) => ({
              key: idx.toString(),
              label: (
                <Space size="small" style={{ maxWidth: isMobile ? '150px' : 'none' }}>
                  <span
                    style={{
                      fontWeight: 500,
                      whiteSpace: isMobile ? 'normal' : 'nowrap',
                      wordBreak: isMobile ? 'break-word' : 'normal',
                      fontSize: isMobile ? 12 : 14
                    }}
                  >
                    {plan.sub_index}. {plan.title}
                  </span>
                </Space>
              ),
              children: (
                <div style={{ maxHeight: '500px', overflowY: 'auto', padding: '8px 0' }}>
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Card size="small" title="基本信息">
                      <Space wrap style={{ maxWidth: '100%' }}>
                        <Tag
                          color="blue"
                          style={{
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                            height: 'auto',
                            lineHeight: '1.5',
                            padding: '4px 8px'
                          }}
                        >
                          {plan.emotional_tone}
                        </Tag>
                        <Tag
                          color="orange"
                          style={{
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                            height: 'auto',
                            lineHeight: '1.5',
                            padding: '4px 8px'
                          }}
                        >
                          {plan.conflict_type}
                        </Tag>
                        <Tag color="green">约{plan.estimated_words}字</Tag>
                      </Space>
                    </Card>

                    <Card size="small" title="情节概要">
                      <div style={{
                        wordBreak: 'break-word',
                        whiteSpace: 'normal',
                        overflowWrap: 'break-word'
                      }}>
                        {plan.plot_summary}
                      </div>
                    </Card>

                    <Card size="small" title="叙事目标">
                      <div style={{
                        wordBreak: 'break-word',
                        whiteSpace: 'normal',
                        overflowWrap: 'break-word'
                      }}>
                        {plan.narrative_goal}
                      </div>
                    </Card>

                    <Card size="small" title="关键事件">
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        {plan.key_events.map((event, eventIdx) => (
                          <div
                            key={eventIdx}
                            style={{
                              wordBreak: 'break-word',
                              whiteSpace: 'normal',
                              overflowWrap: 'break-word'
                            }}
                          >
                            • {event}
                          </div>
                        ))}
                      </Space>
                    </Card>

                    <Card size="small" title="涉及角色">
                      <Space wrap style={{ maxWidth: '100%' }}>
                        {plan.character_focus.map((char, charIdx) => (
                          <Tag
                            key={charIdx}
                            color="purple"
                            style={{
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              height: 'auto',
                              lineHeight: '1.5'
                            }}
                          >
                            {char}
                          </Tag>
                        ))}
                      </Space>
                    </Card>

                    {plan.scenes && plan.scenes.length > 0 && (
                      <Card size="small" title="场景">
                        <Space direction="vertical" size="small" style={{ width: '100%' }}>
                          {plan.scenes.map((scene, sceneIdx) => (
                            <Card
                              key={sceneIdx}
                              size="small"
                              style={{
                                backgroundColor: token.colorFillQuaternary,
                                maxWidth: '100%',
                                overflow: 'hidden'
                              }}
                            >
                              <div style={{
                                wordBreak: 'break-word',
                                whiteSpace: 'normal',
                                overflowWrap: 'break-word'
                              }}>
                                <strong>地点：</strong>{scene.location}
                              </div>
                              <div style={{
                                wordBreak: 'break-word',
                                whiteSpace: 'normal',
                                overflowWrap: 'break-word'
                              }}>
                                <strong>角色：</strong>{scene.characters.join('、')}
                              </div>
                              <div style={{
                                wordBreak: 'break-word',
                                whiteSpace: 'normal',
                                overflowWrap: 'break-word'
                              }}>
                                <strong>目的：</strong>{scene.purpose}
                              </div>
                            </Card>
                          ))}
                        </Space>
                      </Card>
                    )
                    }
                  </Space>
                </div >
              )
            }))}
          />
        </div >
      ),
    });
  };

  // 批量展开所有大纲 - 提交后台任务并在悬浮任务面板显示进度
  const handleBatchExpandOutlines = () => {
    if (!currentProject?.id || outlines.length === 0) {
      message.warning('没有可展开的大纲');
      return;
    }

    modalApi.confirm({
      title: (
        <Space>
          <AppstoreAddOutlined />
          <span>批量展开所有大纲</span>
        </Space>
      ),
      width: 600,
      centered: true,
      content: (
        <div>
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              background: token.colorWarningBg,
              borderRadius: token.borderRadius,
              border: `1px solid ${token.colorWarningBorder}`,
            }}
          >
            <div style={{ color: token.colorWarningText }}>
              ⚠️ 将对当前项目的所有 {outlines.length} 个大纲进行展开
            </div>
          </div>
          <Form
            form={batchExpansionForm}
            layout="vertical"
            initialValues={{
              chapters_per_outline: 3,
              expansion_strategy: 'balanced',
            }}
          >
            <Form.Item
              label="每个大纲展开章节数"
              name="chapters_per_outline"
              rules={[{ required: true, message: '请输入章节数' }]}
              tooltip="每个大纲将被展开为几章"
            >
              <InputNumber
                min={2}
                max={10}
                style={{ width: '100%' }}
                placeholder="建议2-5章"
              />
            </Form.Item>

            <Form.Item
              label="展开策略"
              name="expansion_strategy"
            >
              <Radio.Group>
                <Radio.Button value="balanced">均衡分配</Radio.Button>
                <Radio.Button value="climax">高潮重点</Radio.Button>
                <Radio.Button value="detail">细节丰富</Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Form>
        </div>
      ),
      okText: '提交后台任务',
      cancelText: '取消',
      okButtonProps: { type: 'primary' },
      onOk: async () => {
        try {
          const values = await batchExpansionForm.validateFields();

          Modal.destroyAll();
          setIsExpanding(true);

          const requestData = {
            project_id: currentProject.id,
            ...values,
            auto_create_chapters: true,
            enable_scene_analysis: true
          };

          const response = await fetch('/api/outlines/batch-expand-background', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData),
          });

          if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: response.statusText }));
            throw new Error(err.detail || '创建批量展开任务失败');
          }

          message.success('批量展开任务已提交，可在右下角任务面板查看进度');
          eventBus.emit('background-task-created');
          setIsExpanding(false);

        } catch (error) {
          console.error('批量展开失败:', error);
          message.error(error instanceof Error ? error.message : '批量展开失败');
          setIsExpanding(false);
        }
      },
    });
  };

  const resetImportDialog = () => {
    setImportFile(null);
    setImportMode('append');
    setImportPreview(null);
    setIsPreviewingImport(false);
  };

  const handleExportOutlines = async () => {
    if (!currentProject?.id) return;
    setIsExporting(true);
    try {
      await outlineApi.exportOutlines(currentProject.id);
      message.success(`已导出 ${outlines.length} 条大纲`);
    } catch (error) {
      console.error('导出大纲失败:', error);
      message.error('导出大纲失败，请稍后重试');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePreviewImport = async () => {
    if (!currentProject?.id || !importFile) {
      message.warning('请先选择要导入的 JSON 文件');
      return;
    }

    setIsPreviewingImport(true);
    setImportPreview(null);
    try {
      const preview = await outlineApi.previewImport(currentProject.id, importMode, importFile);
      setImportPreview(preview);
    } catch (error) {
      console.error('预览大纲导入失败:', error);
    } finally {
      setIsPreviewingImport(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!currentProject?.id || !importFile || !importPreview?.valid) return;

    setIsImporting(true);
    try {
      const result = await outlineApi.importOutlines(currentProject.id, importMode, importFile);
      const chapterMessage = result.created_chapters > 0
        ? `，同步创建 ${result.created_chapters} 个章节`
        : '';
      message.success(`${result.message}${chapterMessage}`);
      setImportModalOpen(false);
      resetImportDialog();
      await refreshOutlines();
      if (result.created_chapters > 0) {
        eventBus.emit(EventNames.CHAPTER_NEEDS_REFRESH);
      }
    } catch (error) {
      console.error('导入大纲失败:', error);
      setImportPreview(null);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      {contextHolder}

      <Modal
        title="导入大纲"
        open={importModalOpen}
        width={680}
        okText="确认导入"
        cancelText="取消"
        confirmLoading={isImporting}
        okButtonProps={{ disabled: !importPreview?.valid || isPreviewingImport }}
        maskClosable={!isImporting}
        closable={!isImporting}
        onOk={handleConfirmImport}
        onCancel={() => {
          if (isImporting) return;
          setImportModalOpen(false);
          resetImportDialog();
        }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="支持大纲导出文件，也支持从完整项目导出文件中提取大纲。文件须为 JSON 格式，最大 10MB。"
          />

          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>1. 选择文件</div>
            <Upload
              accept=".json,application/json"
              maxCount={1}
              fileList={importFile ? [{
                uid: 'outline-import-file',
                name: importFile.name,
                size: importFile.size,
                type: importFile.type,
                status: 'done',
              }] : []}
              beforeUpload={(file) => {
                if (!file.name.toLowerCase().endsWith('.json')) {
                  message.error('只支持 JSON 格式文件');
                  return Upload.LIST_IGNORE;
                }
                if (file.size > 10 * 1024 * 1024) {
                  message.error('文件大小不能超过 10MB');
                  return Upload.LIST_IGNORE;
                }
                setImportFile(file);
                setImportPreview(null);
                return false;
              }}
              onRemove={() => {
                setImportFile(null);
                setImportPreview(null);
                return true;
              }}
            >
              <Button icon={<UploadOutlined />}>选择 JSON 文件</Button>
            </Upload>
          </div>

          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>2. 选择导入方式</div>
            <Radio.Group
              value={importMode}
              onChange={(event) => {
                setImportMode(event.target.value as OutlineImportMode);
                setImportPreview(null);
              }}
            >
              <Space direction="vertical">
                <Radio value="append">追加：从当前末尾新增，自动重新编号</Radio>
                <Radio value="merge">按序号合并：相同序号更新，不同序号新增</Radio>
              </Space>
            </Radio.Group>
          </div>

          <Button
            type="primary"
            ghost
            icon={<FileTextOutlined />}
            disabled={!importFile}
            loading={isPreviewingImport}
            onClick={handlePreviewImport}
          >
            预览导入结果
          </Button>

          {importPreview && (
            <>
              <Divider style={{ margin: '4px 0' }} />
              <Alert
                type={importPreview.valid ? 'success' : 'error'}
                showIcon
                message={importPreview.valid ? '文件校验通过' : '文件校验失败'}
                description={
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <div>
                      文件格式版本：{importPreview.version || '未知'}
                      {importPreview.source_project?.title && ` · 来源项目：${importPreview.source_project.title}`}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <Tag>共 {importPreview.statistics.total} 条</Tag>
                      <Tag color="green">新增 {importPreview.statistics.will_create} 条</Tag>
                      <Tag color="blue">更新 {importPreview.statistics.will_update} 条</Tag>
                      {importPreview.target_outline_mode === 'one-to-one' && (
                        <Tag color="purple">创建章节 {importPreview.statistics.will_create_chapters} 个</Tag>
                      )}
                    </div>
                  </Space>
                }
              />

              {importPreview.errors.length > 0 && (
                <Alert
                  type="error"
                  showIcon
                  message="无法导入"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {importPreview.errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
                    </ul>
                  }
                />
              )}

              {importPreview.warnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message="注意事项"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {importPreview.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
                    </ul>
                  }
                />
              )}
            </>
          )}
        </Space>
      </Modal>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}>
        {/* 固定头部 */}
        <div style={{
          padding: isMobile ? '4px 0 16px' : '2px 0 18px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? 14 : 20,
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'flex-start',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <FileTextOutlined style={{ fontSize: 18, color: token.colorTextSecondary }} />
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: token.colorText }}>故事大纲</h2>
            </div>
            <div style={{ marginTop: 5, fontSize: 12, color: token.colorTextTertiary }}>
              {outlines.length} 条大纲
              {currentProject?.outline_mode === 'one-to-one' ? ' · 传统模式' : ' · 细化模式'}
              {outlineSearchKeyword.trim() ? ` · 找到 ${filteredOutlines.length} 条` : ''}
            </div>
          </div>

          <Space wrap size={8}>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={showGenerateModal}
              loading={isGenerating}
              size={isMobile ? 'small' : 'middle'}
            >
              {isMobile ? 'AI 生成/续写' : 'AI 生成/续写大纲'}
            </Button>
            <Button
              icon={<PlusOutlined />}
              onClick={showManualCreateOutlineModal}
              size={isMobile ? 'small' : 'middle'}
            >
              手动创建
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'import',
                    icon: <UploadOutlined />,
                    label: '导入大纲',
                    onClick: () => {
                      resetImportDialog();
                      setImportModalOpen(true);
                    },
                  },
                  {
                    key: 'export',
                    icon: <DownloadOutlined />,
                    label: isExporting ? '正在导出...' : '导出大纲',
                    disabled: outlines.length === 0 || isExporting,
                    onClick: handleExportOutlines,
                  },
                  ...(outlines.length > 0 && currentProject?.outline_mode === 'one-to-many'
                    ? [{
                        key: 'batch-expand',
                        icon: <AppstoreAddOutlined />,
                        label: '批量展开为多章',
                        disabled: isGenerating || isExpanding,
                        onClick: handleBatchExpandOutlines,
                      }]
                    : []),
                ],
              }}
            >
              <Button icon={<MoreOutlined />} size={isMobile ? 'small' : 'middle'}>
                更多
              </Button>
            </Dropdown>
          </Space>
        </div>

        <div style={{
          flexShrink: 0,
          padding: '12px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <Input.Search
            allowClear
            placeholder="搜索序号、标题或内容"
            value={outlineSearchKeyword}
            onChange={(e) => setOutlineSearchKeyword(e.target.value)}
            style={{ width: isMobile ? '100%' : 320 }}
          />
          {!isMobile && (
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
              共 {filteredOutlines.length} 条
            </span>
          )}
        </div>

        {/* 可滚动内容区域 */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {outlines.length === 0 ? (
            <Empty description="还没有大纲，开始创建吧！" />
          ) : filteredOutlines.length === 0 ? (
            <Empty description="未找到匹配大纲" />
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile
                ? 'minmax(0, 1fr)'
                : 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 14,
              alignItems: 'stretch',
            }}>
              {pagedOutlines.map((item) => {
                  const structureData = outlineStructureMap[item.id] || {};

                  // 解析角色/组织条目（兼容新旧格式）
                  const characterEntries = parseCharacterEntries(structureData.characters);
                  const characterNames = getCharacterNames(characterEntries);
                  const organizationNames = getOrganizationNames(characterEntries);
                  const involvedCharacterNames = characterNames.length > 0
                    ? characterNames
                    : (structureData.characters_involved || []);
                  const previewContent = getOutlinePreview(item.content, isMobile ? 70 : 140);
                  
                  return (
                    <Card
                      key={item.id}
                        style={{
                          width: '100%',
                          height: '100%',
                          minHeight: 196,
                          borderRadius: 10,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          boxShadow: `0 1px 2px ${alphaColor(token.colorTextBase, 0.08)}`,
                          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                        }}
                        bodyStyle={{
                          padding: isMobile ? 14 : 16,
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                        onMouseEnter={(e) => {
                          if (!isMobile) {
                            e.currentTarget.style.borderColor = token.colorPrimary;
                            e.currentTarget.style.boxShadow = `0 4px 12px ${alphaColor(token.colorTextBase, 0.16)}`;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isMobile) {
                            e.currentTarget.style.borderColor = token.colorBorderSecondary;
                            e.currentTarget.style.boxShadow = `0 1px 2px ${alphaColor(token.colorTextBase, 0.08)}`;
                          }
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{
                            width: 38,
                            height: 38,
                            flexShrink: 0,
                            borderRadius: 8,
                            background: token.colorFillTertiary,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText, lineHeight: 1.1 }}>
                              {item.order_index || '?'}
                            </span>
                            <span style={{ fontSize: 9, color: token.colorTextTertiary, lineHeight: 1.3 }}>
                              {currentProject?.outline_mode === 'one-to-one' ? '章' : '卷'}
                            </span>
                          </div>

                          <div style={{ flex: 1, minWidth: 180 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: isMobile ? 14 : 15, fontWeight: 600, color: token.colorText, lineHeight: 1.5 }}>
                                {item.title}
                              </span>
                              {currentProject?.outline_mode === 'one-to-many' && (
                                outlineExpandStatus[item.id] ? (
                                  <Tag color="success" icon={<CheckCircleOutlined />} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                                    已展开
                                  </Tag>
                                ) : (
                                  <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>未展开</Tag>
                                )
                              )}
                            </div>

                            {(involvedCharacterNames.length > 0 || organizationNames.length > 0 || (structureData.scenes?.length || 0) > 0) && (
                              <div style={{
                                marginTop: 5,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                flexWrap: 'wrap',
                                fontSize: 11,
                                color: token.colorTextTertiary,
                              }}>
                                {involvedCharacterNames.length > 0 && <span>{involvedCharacterNames.length} 个角色</span>}
                                {organizationNames.length > 0 && <span>{organizationNames.length} 个组织</span>}
                                {(structureData.scenes?.length || 0) > 0 && <span>{structureData.scenes?.length} 个场景</span>}
                              </div>
                            )}
                          </div>

                          <Space size={4} style={{ flexShrink: 0, marginLeft: 'auto' }}>
                            {currentProject?.outline_mode === 'one-to-many' && (
                              <Button
                                icon={<BranchesOutlined />}
                                onClick={() => handleExpandOutline(item.id, item.title)}
                                loading={isExpanding}
                                size="small"
                              >
                                {isMobile ? '展开章节' : '展开为章节'}
                              </Button>
                            )}
                            <Button
                              type="text"
                              icon={<EditOutlined />}
                              onClick={() => handleOpenEditModal(item.id)}
                              size="small"
                              aria-label={`编辑${item.title}`}
                            />
                            <Popconfirm
                              title="确定删除这条大纲吗？"
                              onConfirm={() => handleDeleteOutline(item.id)}
                              okText="确定"
                              cancelText="取消"
                            >
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                size="small"
                                aria-label={`删除${item.title}`}
                              />
                            </Popconfirm>
                          </Space>
                        </div>

                        <div style={{
                          flex: 1,
                          marginTop: 12,
                          maxHeight: 62,
                          fontSize: isMobile ? 12 : 13,
                          lineHeight: 1.65,
                          color: token.colorTextSecondary,
                          wordBreak: 'break-word',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical' as const,
                          overflow: 'hidden',
                        }}>
                          {previewContent.text || '暂无内容'}
                        </div>

                        <div style={{
                          marginTop: 10,
                          paddingTop: 8,
                          borderTop: `1px solid ${token.colorBorderSecondary}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}>
                          <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                            {structureData.key_events?.length
                              ? `关键事件 · ${structureData.key_events.length} 项`
                              : `${currentProject?.outline_mode === 'one-to-one' ? '章节' : '卷'}大纲`}
                          </span>
                          <Button
                            type="link"
                            size="small"
                            onClick={() => setDetailOutline(item)}
                            style={{ padding: 0, height: 'auto', fontSize: 12 }}
                          >
                            查看全文 →
                          </Button>
                        </div>

                    </Card>
                  );
                })}
            </div>
          )}

        </div>

        {/* 固定底部分页栏 */}
        {outlines.length > 0 && (
          <div
            style={{
              position: 'sticky',
              bottom: 0,
              zIndex: 10,
              backgroundColor: token.colorBgContainer,
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              padding: isMobile ? '8px 0' : '10px 0',
              display: 'flex',
              justifyContent: 'flex-end'
            }}
          >
            <Pagination
              current={outlinePage}
              pageSize={outlinePageSize}
              total={filteredOutlines.length}
              showSizeChanger
              pageSizeOptions={['10', '20', '50', '100']}
              onChange={(page, size) => {
                setOutlinePage(page);
                if (size !== outlinePageSize) {
                  setOutlinePageSize(size);
                  setOutlinePage(1);
                }
              }}
              showTotal={(total) => `共 ${total} 条`}
              size={isMobile ? 'small' : 'default'}
            />
          </div>
        )}
      </div>

      <OutlineDetailDrawer
        outline={detailOutline}
        structureData={detailOutline ? (outlineStructureMap[detailOutline.id] || {}) : {}}
        modeLabel={currentProject?.outline_mode === 'one-to-one' ? '章' : '卷'}
        isMobile={isMobile}
        onClose={() => setDetailOutline(null)}
        onEdit={() => {
          if (!detailOutline) return;
          const outlineId = detailOutline.id;
          setDetailOutline(null);
          handleOpenEditModal(outlineId);
        }}
      />
    </>
  );
}
