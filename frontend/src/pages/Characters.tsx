import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { Button, Modal, Form, Input, Select, message, Row, Col, Empty, Divider, Typography, Space, InputNumber, Checkbox, theme } from 'antd';
import { ThunderboltOutlined, UserOutlined, PlusOutlined, ExportOutlined, ImportOutlined, DownloadOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import { useCharacterSync } from '../store/hooks';
import { CharacterCard } from '../components/CharacterCard';
import { CharacterDetailDrawer } from '../components/CharacterDetailDrawer';
import { SSELoadingOverlay } from '../components/SSELoadingOverlay';
import type { Character, ApiError } from '../types';
import { characterApi } from '../services/api';
import { SSEPostClient } from '../utils/sseClient';
import api from '../services/api';

const { TextArea } = Input;

function EditSectionTitle({ title, hint }: { title: string; hint?: string }) {
  const { token } = theme.useToken();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 12px' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{title}</span>
      {hint && <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{hint}</span>}
      <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
    </div>
  );
}

interface Career {
  id: string;
  name: string;
  type: 'main' | 'sub';
  max_stage: number;
}

// 副职业数据类型
interface SubCareerData {
  career_id: string;
  stage: number;
}

// 角色创建表单值类型
interface CharacterFormValues {
  name: string;
  age?: string;
  gender?: string;
  role_type?: string;
  personality?: string;
  appearance?: string;
  background?: string;
  main_career_id?: string;
  main_career_stage?: number;
  sub_career_data?: SubCareerData[];
  // 组织字段
  organization_type?: string;
  organization_purpose?: string;
  organization_members?: string;
  power_level?: number;
  location?: string;
  motto?: string;
  color?: string;
}

// 角色创建数据类型
interface CharacterCreateData {
  project_id: string;
  name: string;
  is_organization: boolean;
  age?: string;
  gender?: string;
  role_type?: string;
  personality?: string;
  appearance?: string;
  background?: string;
  main_career_id?: string;
  main_career_stage?: number;
  sub_careers?: string;
  organization_type?: string;
  organization_purpose?: string;
  organization_members?: string;
  power_level?: number;
  location?: string;
  motto?: string;
  color?: string;
}

// 角色更新数据类型
interface CharacterUpdateData {
  name?: string;
  age?: string;
  gender?: string;
  role_type?: string;
  personality?: string;
  appearance?: string;
  background?: string;
  main_career_id?: string;
  main_career_stage?: number;
  sub_careers?: string;
  organization_type?: string;
  organization_purpose?: string;
  organization_members?: string;
  power_level?: number;
  location?: string;
  motto?: string;
  color?: string;
}

export default function Characters() {
  const { token } = theme.useToken();
  const { currentProject, characters } = useStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [generateForm] = Form.useForm();
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [detailCharacter, setDetailCharacter] = useState<Character | null>(null);
  const [mainCareers, setMainCareers] = useState<Career[]>([]);
  const [subCareers, setSubCareers] = useState<Career[]>([]);
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    refreshCharacters,
    deleteCharacter
  } = useCharacterSync();

  useEffect(() => {
    if (currentProject?.id) {
      refreshCharacters();
      fetchCareers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);
  const [modal, contextHolder] = Modal.useModal();

  const fetchCareers = async () => {
    if (!currentProject?.id) return;
    try {
      const response = await api.get<unknown, { main_careers: Career[]; sub_careers: Career[] }>('/careers', {
        params: { project_id: currentProject.id }
      });
      setMainCareers(response.main_careers || []);
      setSubCareers(response.sub_careers || []);
    } catch (error) {
      console.error('获取职业列表失败:', error);
    }
  };

  if (!currentProject) return null;

  const handleDeleteCharacter = async (id: string) => {
    try {
      await deleteCharacter(id);
      message.success('删除成功');
    } catch {
      message.error('删除失败');
    }
  };

  const handleGenerate = async (values: { name?: string; role_type: string; background?: string }) => {
    try {
      setIsGenerating(true);
      setProgress(0);
      setProgressMessage('准备生成角色...');

      const client = new SSEPostClient(
        '/api/characters/generate-stream',
        {
          project_id: currentProject.id,
          name: values.name,
          role_type: values.role_type,
          background: values.background,
        },
        {
          onProgress: (msg, prog) => {
            setProgress(prog);
            setProgressMessage(msg);
          },
          onResult: (data) => {
            console.log('角色生成完成:', data);
          },
          onError: (error) => {
            message.error(`生成失败: ${error}`);
          },
          onComplete: () => {
            setProgress(100);
            setProgressMessage('生成完成！');
          }
        }
      );

      await client.connect();
      message.success('AI生成角色成功');
      Modal.destroyAll();
      await refreshCharacters();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'AI生成失败';
      message.error(errorMessage);
    } finally {
      setTimeout(() => {
        setIsGenerating(false);
        setProgress(0);
        setProgressMessage('');
      }, 500);
    }
  };

  const handleCreateCharacter = async (values: CharacterFormValues) => {
    try {
      const createData: CharacterCreateData = {
        project_id: currentProject.id,
        name: values.name,
        is_organization: false,
      };

      createData.age = values.age;
      createData.gender = values.gender;
      createData.role_type = values.role_type || 'supporting';
      createData.personality = values.personality;
      createData.appearance = values.appearance;
      createData.background = values.background;

      if (values.main_career_id) {
        createData.main_career_id = values.main_career_id;
        createData.main_career_stage = values.main_career_stage || 1;
      }

      if (values.sub_career_data && Array.isArray(values.sub_career_data) && values.sub_career_data.length > 0) {
        createData.sub_careers = JSON.stringify(values.sub_career_data);
      }

      await characterApi.createCharacter(createData);
      message.success('角色创建成功');
      setIsCreateModalOpen(false);
      createForm.resetFields();
      await refreshCharacters();
    } catch {
      message.error('创建失败');
    }
  };

  const handleEditCharacter = (character: Character) => {
    setEditingCharacter(character);

    // 提取副职业数据（包含职业ID和阶段）
    const subCareerData: SubCareerData[] = character.sub_careers?.map((sc) => ({
      career_id: sc.career_id,
      stage: sc.stage || 1
    })) || [];

    editForm.setFieldsValue({
      ...character,
      sub_career_data: subCareerData
    });
    setIsEditModalOpen(true);
  };

  const handleUpdateCharacter = async (values: CharacterFormValues) => {
    if (!editingCharacter) return;

    try {
      // 提取副职业数据，剩余的作为更新数据
      const { sub_career_data: subCareerData, ...restValues } = values;
      const updateData: CharacterUpdateData = { ...restValues };

      // 转换为sub_careers格式
      if (subCareerData && Array.isArray(subCareerData) && subCareerData.length > 0) {
        updateData.sub_careers = JSON.stringify(subCareerData);
      } else {
        updateData.sub_careers = JSON.stringify([]);
      }

      await characterApi.updateCharacter(editingCharacter.id, updateData);
      message.success('更新成功');
      setIsEditModalOpen(false);
      editForm.resetFields();
      setEditingCharacter(null);
      await refreshCharacters();
    } catch (error) {
      console.error('更新失败:', error);
      message.error('更新失败');
    }
  };

  const handleDeleteCharacterWrapper = (id: string) => {
    const target = characters.find((item) => item.id === id);
    modal.confirm({
      title: `删除${target?.is_organization ? '组织' : '角色'}`,
      content: `确定删除「${target?.name || '该条目'}」吗？此操作无法撤销。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => handleDeleteCharacter(id),
    });
  };

  // 导出选中的角色/组织
  const handleExportSelected = async () => {
    if (selectedCharacters.length === 0) {
      message.warning('请至少选择一个角色或组织');
      return;
    }

    try {
      await characterApi.exportCharacters(selectedCharacters);
      message.success(`成功导出 ${selectedCharacters.length} 个角色/组织`);
      setSelectedCharacters([]);
    } catch (error) {
      message.error('导出失败');
      console.error('导出错误:', error);
    }
  };

  // 导出单个角色/组织
  const handleExportSingle = async (characterId: string) => {
    try {
      await characterApi.exportCharacters([characterId]);
      message.success('导出成功');
    } catch (error) {
      message.error('导出失败');
      console.error('导出错误:', error);
    }
  };

  // 处理文件选择
  const handleFileSelect = async (file: File) => {
    try {
      // 验证文件
      const validation = await characterApi.validateImportCharacters(file);
      
      if (!validation.valid) {
        modal.error({
          title: '文件验证失败',
          centered: true,
          content: (
            <div>
              {validation.errors.map((error, index) => (
                <div key={index} style={{ color: token.colorError }}>• {error}</div>
              ))}
            </div>
          ),
        });
        return;
      }

      // 显示预览对话框
      modal.confirm({
        title: '导入预览',
        width: 500,
        centered: true,
        content: (
          <div>
            <p><strong>文件版本:</strong> {validation.version}</p>
            <Divider style={{ margin: '12px 0' }} />
            <p><strong>将要导入:</strong></p>
            <ul style={{ marginLeft: 20 }}>
              <li>角色: {validation.statistics.characters} 个</li>
              <li>组织: {validation.statistics.organizations} 个</li>
            </ul>
            {validation.warnings.length > 0 && (
              <>
                <Divider style={{ margin: '12px 0' }} />
                <p style={{ color: token.colorWarning }}><strong>⚠️ 警告:</strong></p>
                <ul style={{ marginLeft: 20 }}>
                  {validation.warnings.map((warning, index) => (
                    <li key={index} style={{ color: token.colorWarning }}>{warning}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ),
        okText: '确认导入',
        cancelText: '取消',
        onOk: async () => {
          try {
            const result = await characterApi.importCharacters(currentProject.id, file);
            
            if (result.success) {
              // 显示导入结果
              modal.success({
                title: '导入完成',
                width: 600,
                centered: true,
                content: (
                  <div>
                    <p><strong>✅ 成功导入: {result.statistics.imported} 个</strong></p>
                    {result.details.imported_characters.length > 0 && (
                      <>
                        <p style={{ marginTop: 12, marginBottom: 4 }}>角色:</p>
                        <ul style={{ marginLeft: 20 }}>
                          {result.details.imported_characters.map((name, index) => (
                            <li key={index}>{name}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {result.details.imported_organizations.length > 0 && (
                      <>
                        <p style={{ marginTop: 12, marginBottom: 4 }}>组织:</p>
                        <ul style={{ marginLeft: 20 }}>
                          {result.details.imported_organizations.map((name, index) => (
                            <li key={index}>{name}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {result.statistics.skipped > 0 && (
                      <>
                        <Divider style={{ margin: '12px 0' }} />
                        <p style={{ color: token.colorWarning }}>⚠️ 跳过: {result.statistics.skipped} 个</p>
                        <ul style={{ marginLeft: 20 }}>
                          {result.details.skipped.map((name, index) => (
                            <li key={index} style={{ color: token.colorWarning }}>{name}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {result.warnings.length > 0 && (
                      <>
                        <Divider style={{ margin: '12px 0' }} />
                        <p style={{ color: token.colorWarning }}>⚠️ 警告:</p>
                        <ul style={{ marginLeft: 20 }}>
                          {result.warnings.map((warning, index) => (
                            <li key={index} style={{ color: token.colorWarning }}>{warning}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {result.details.errors.length > 0 && (
                      <>
                        <Divider style={{ margin: '12px 0' }} />
                        <p style={{ color: token.colorError }}>❌ 失败: {result.statistics.errors} 个</p>
                        <ul style={{ marginLeft: 20 }}>
                          {result.details.errors.map((error, index) => (
                            <li key={index} style={{ color: token.colorError }}>{error}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ),
              });
              
              // 刷新列表
              await refreshCharacters();
              setIsImportModalOpen(false);
            } else {
              message.error(result.message || '导入失败');
            }
          } catch (error: unknown) {
            const apiError = error as ApiError;
            message.error(apiError.response?.data?.detail || '导入失败');
            console.error('导入错误:', error);
          }
        },
      });
    } catch (error: unknown) {
      const apiError = error as ApiError;
      message.error(apiError.response?.data?.detail || '文件验证失败');
      console.error('验证错误:', error);
    }
  };

  // 切换选择
  const toggleSelectCharacter = (id: string) => {
    setSelectedCharacters(prev =>
      prev.includes(id) ? prev.filter(cid => cid !== id) : [...prev, id]
    );
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedCharacters.length === displayList.length) {
      setSelectedCharacters([]);
    } else {
      setSelectedCharacters(displayList.map(c => c.id));
    }
  };

  const showGenerateModal = () => {
    modal.confirm({
      title: 'AI生成角色',
      width: 600,
      centered: true,
      content: (
        <Form form={generateForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="角色名称"
            name="name"
          >
            <Input placeholder="如：张三、李四（可选，AI会自动生成）" />
          </Form.Item>
          <Form.Item
            label="角色定位"
            name="role_type"
            rules={[{ required: true, message: '请选择角色定位' }]}
          >
            <Select placeholder="选择角色定位">
              <Select.Option value="protagonist">主角</Select.Option>
              <Select.Option value="supporting">配角</Select.Option>
              <Select.Option value="antagonist">反派</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="背景设定" name="background">
            <TextArea rows={3} placeholder="简要描述角色背景和故事环境..." />
          </Form.Item>
        </Form>
      ),
      okText: '生成',
      cancelText: '取消',
      onOk: async () => {
        const values = await generateForm.validateFields();
        await handleGenerate(values);
      },
    });
  };

  const characterList = characters.filter(c => !c.is_organization);
  const careerNames = [...mainCareers, ...subCareers].reduce<Record<string, string>>((names, career) => {
    names[career.id] = career.name;
    return names;
  }, {});

  const displayList = characterList;

  const isMobile = window.innerWidth <= 768;

  const characterGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(255px, 1fr))',
    gap: isMobile ? 10 : 12,
    alignItems: 'stretch',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {contextHolder}
      <div style={{
        padding: isMobile ? '4px 0 16px' : '2px 0 18px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 14 : 20,
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'flex-start',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <UserOutlined style={{ fontSize: 18, color: token.colorTextSecondary }} />
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: token.colorText }}>角色管理</h2>
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: token.colorTextTertiary }}>
            共 {characterList.length} 个角色
          </div>
        </div>

        <Space wrap size={8}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size={isMobile ? 'small' : 'middle'}
            onClick={() => setIsCreateModalOpen(true)}
          >
            新建角色
          </Button>
          <Button
            icon={<ThunderboltOutlined />}
            loading={isGenerating}
            size={isMobile ? 'small' : 'middle'}
            onClick={showGenerateModal}
          >
            AI 生成角色
          </Button>
          <Button icon={<ImportOutlined />} onClick={() => setIsImportModalOpen(true)} size={isMobile ? 'small' : 'middle'}>
            导入
          </Button>
        </Space>
      </div>

      {characterList.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '7px 0',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: token.colorText }}>全部角色</span>
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{characterList.length}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {selectedCharacters.length > 0 && (
              <Button type="text" size="small" icon={<ExportOutlined />} onClick={handleExportSelected}>
                导出 {selectedCharacters.length} 项
              </Button>
            )}
            <Checkbox
              checked={selectedCharacters.length === displayList.length && displayList.length > 0}
              indeterminate={selectedCharacters.length > 0 && selectedCharacters.length < displayList.length}
              onChange={toggleSelectAll}
            >
              {selectedCharacters.length > 0 ? `已选 ${selectedCharacters.length} 个` : '全选'}
            </Checkbox>
            {selectedCharacters.length > 0 && (
              <Button type="text" size="small" onClick={() => setSelectedCharacters([])}>
                取消
              </Button>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {characterList.length === 0 ? (
          <div style={{ minHeight: 360, display: 'grid', placeItems: 'center' }}>
            <Empty description="还没有角色，先创建一个角色吧。" />
          </div>
        ) : (
          <div style={{ ...characterGridStyle, paddingTop: 18 }}>
            {characterList.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                selected={selectedCharacters.includes(character.id)}
                onSelect={() => toggleSelectCharacter(character.id)}
                onOpen={setDetailCharacter}
                onEdit={handleEditCharacter}
                onDelete={handleDeleteCharacterWrapper}
                onExport={() => handleExportSingle(character.id)}
              />
            ))}
          </div>
        )}
      </div>

      <CharacterDetailDrawer
        character={detailCharacter}
        careerNames={careerNames}
        onClose={() => setDetailCharacter(null)}
        onEdit={(character) => {
          setDetailCharacter(null);
          handleEditCharacter(character);
        }}
        onExport={handleExportSingle}
      />

      <Modal
        title={
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: token.colorText }}>
              {editingCharacter?.is_organization ? '编辑组织' : '编辑角色'}
            </div>
            <div style={{ marginTop: 3, fontSize: 12, fontWeight: 400, color: token.colorTextTertiary }}>
              完善{editingCharacter?.is_organization ? '组织' : '角色'}档案，保存后将用于后续创作
            </div>
          </div>
        }
        open={isEditModalOpen}
        onCancel={() => {
          setIsEditModalOpen(false);
          editForm.resetFields();
          setEditingCharacter(null);
        }}
        footer={
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => {
              setIsEditModalOpen(false);
              editForm.resetFields();
              setEditingCharacter(null);
            }}>
              取消
            </Button>
            <Button type="primary" onClick={() => editForm.submit()}>
              保存修改
            </Button>
          </Space>
        }
        centered
        width={isMobile ? '100%' : 820}
        style={isMobile ? { top: 0, paddingBottom: 0, maxWidth: '100vw' } : undefined}
        styles={{
          body: {
            maxHeight: isMobile ? 'calc(100vh - 110px)' : 'calc(100vh - 190px)',
            overflowY: 'auto',
            overflowX: 'hidden'
          }
        }}
      >
        <Form form={editForm} layout="vertical" onFinish={handleUpdateCharacter} style={{ marginTop: 8 }}>
          {!editingCharacter?.is_organization ? (
            <>
              <EditSectionTitle title="基础信息" hint="角色身份与基本信息" />
              <Row gutter={12}>
                <Col xs={24} sm={10}>
                  <Form.Item
                    label="角色名称"
                    name="name"
                    rules={[{ required: true, message: '请输入角色名称' }]}
                    style={{ marginBottom: 16 }}
                  >
                    <Input placeholder="角色名称" />
                  </Form.Item>
                </Col>
                <Col xs={8} sm={5}>
                  <Form.Item label="角色定位" name="role_type" style={{ marginBottom: 16 }}>
                    <Select>
                      <Select.Option value="protagonist">主角</Select.Option>
                      <Select.Option value="supporting">配角</Select.Option>
                      <Select.Option value="antagonist">反派</Select.Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={8} sm={5}>
                  <Form.Item label="年龄" name="age" style={{ marginBottom: 16 }}>
                    <Input placeholder="如：25" />
                  </Form.Item>
                </Col>
                <Col xs={8} sm={4}>
                  <Form.Item label="性别" name="gender" style={{ marginBottom: 16 }}>
                    <Select placeholder="性别">
                      <Select.Option value="男">男</Select.Option>
                      <Select.Option value="女">女</Select.Option>
                      <Select.Option value="其他">其他</Select.Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>

              <EditSectionTitle title="角色设定" hint="性格、外貌与背景" />
              <Form.Item label="性格特点" name="personality" style={{ marginBottom: 16 }}>
                <TextArea rows={3} placeholder="描述角色的性格、行为习惯与说话方式..." />
              </Form.Item>

              <Form.Item label="外貌描写" name="appearance" style={{ marginBottom: 16 }}>
                <TextArea rows={3} placeholder="描述角色的外貌、穿着与辨识特征..." />
              </Form.Item>

              {/* 人际关系（只读，由关系管理页面维护） */}
              {editingCharacter?.relationships && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ marginBottom: 7, fontSize: 13, color: token.colorText }}>
                    人际关系
                    <span style={{ marginLeft: 8, fontSize: 11, color: token.colorTextTertiary }}>由关系管理维护</span>
                  </div>
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: token.colorFillQuaternary,
                      fontSize: 13,
                      lineHeight: 1.75,
                      color: token.colorTextSecondary,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {editingCharacter.relationships}
                  </div>
                </div>
              )}

              <Form.Item label="角色背景" name="background" style={{ marginBottom: 4 }}>
                <TextArea rows={4} placeholder="描述角色的成长经历、处境与重要过往..." />
              </Form.Item>

              {/* 职业信息 */}
              {(mainCareers.length > 0 || subCareers.length > 0) && (
                <>
                  <EditSectionTitle title="职业信息" hint="主职业与副职业" />
                  {mainCareers.length > 0 && (
                    <Row gutter={12}>
                      <Col xs={16} sm={18}>
                        <Form.Item label="主职业" name="main_career_id" tooltip="角色的主要修炼职业" style={{ marginBottom: 16 }}>
                          <Select placeholder="选择主职业" allowClear>
                            {mainCareers.map(career => (
                              <Select.Option key={career.id} value={career.id}>
                                {career.name}（最高{career.max_stage}阶）
                              </Select.Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col xs={8} sm={6}>
                        <Form.Item label="当前阶段" name="main_career_stage" tooltip="主职业当前修炼到的阶段" style={{ marginBottom: 16 }}>
                          <InputNumber
                            min={1}
                            max={editForm.getFieldValue('main_career_id') ?
                              mainCareers.find(c => c.id === editForm.getFieldValue('main_career_id'))?.max_stage || 10
                              : 10}
                            style={{ width: '100%' }}
                            placeholder="阶段"
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  )}
                  {subCareers.length > 0 && (
                    <Form.List name="sub_career_data">
                      {(fields, { add, remove }) => (
                        <>
                          <div style={{ marginBottom: 7, fontSize: 13, color: token.colorText }}>副职业</div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {fields.map((field) => (
                              <div
                                key={field.key}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'minmax(0, 1fr) 104px 44px',
                                  gap: 8,
                                  alignItems: 'start',
                                }}
                              >
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'career_id']}
                                  rules={[{ required: true, message: '请选择副职业' }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Select placeholder="选择副职业">
                                    {subCareers.map(career => (
                                      <Select.Option key={career.id} value={career.id}>
                                        {career.name}（最高{career.max_stage}阶）
                                      </Select.Option>
                                    ))}
                                  </Select>
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'stage']}
                                  rules={[{ required: true, message: '阶段' }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <InputNumber
                                    min={1}
                                    max={(() => {
                                      const careerId = editForm.getFieldValue(['sub_career_data', field.name, 'career_id']);
                                      const career = subCareers.find(c => c.id === careerId);
                                      return career?.max_stage || 10;
                                    })()}
                                    placeholder="阶段"
                                    style={{ width: '100%' }}
                                  />
                                </Form.Item>
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  onClick={() => remove(field.name)}
                                  style={{ height: 32, paddingInline: 4 }}
                                >
                                  删除
                                </Button>
                              </div>
                            ))}
                          </div>
                          <Button
                            type="text"
                            size="small"
                            icon={<PlusOutlined />}
                            onClick={() => add({ career_id: undefined, stage: 1 })}
                            style={{ marginTop: 6, paddingInline: 0, color: token.colorTextSecondary }}
                          >
                            添加副职业
                          </Button>
                        </>
                      )}
                    </Form.List>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <EditSectionTitle title="基础信息" hint="组织身份与基本设定" />
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    label="组织名称"
                    name="name"
                    rules={[{ required: true, message: '请输入组织名称' }]}
                    style={{ marginBottom: 16 }}
                  >
                    <Input placeholder="组织名称" />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={6}>
                  <Form.Item
                    label="组织类型"
                    name="organization_type"
                    rules={[{ required: true, message: '请输入组织类型' }]}
                    style={{ marginBottom: 16 }}
                  >
                    <Input placeholder="如：门派、帮派" />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={6}>
                  <Form.Item
                    label="势力等级"
                    name="power_level"
                    tooltip="0-100的数值"
                    style={{ marginBottom: 16 }}
                  >
                    <InputNumber min={0} max={100} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <EditSectionTitle title="组织设定" hint="目标、成员与背景" />
              <Form.Item
                label="组织目的"
                name="organization_purpose"
                rules={[{ required: true, message: '请输入组织目的' }]}
                style={{ marginBottom: 16 }}
              >
                <TextArea rows={2} placeholder="描述组织的宗旨和目标..." />
              </Form.Item>

              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 7, fontSize: 13, color: token.colorText }}>
                  主要成员
                  <span style={{ marginLeft: 8, fontSize: 11, color: token.colorTextTertiary }}>由组织管理维护</span>
                </div>
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: token.colorFillQuaternary,
                    fontSize: 13,
                    lineHeight: 1.75,
                    color: token.colorTextSecondary,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {editingCharacter?.organization_members || '暂无成员信息'}
                </div>
              </div>

              <Row gutter={12}>
                <Col xs={12}>
                  <Form.Item label="所在地" name="location" style={{ marginBottom: 16 }}>
                    <Input placeholder="总部位置" />
                  </Form.Item>
                </Col>
                <Col xs={12}>
                  <Form.Item label="代表颜色" name="color" style={{ marginBottom: 16 }}>
                    <Input placeholder="如：金色" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item label="格言/口号" name="motto" style={{ marginBottom: 16 }}>
                <Input placeholder="组织的宗旨、格言或口号" />
              </Form.Item>

              <Form.Item label="组织背景" name="background" style={{ marginBottom: 4 }}>
                <TextArea rows={4} placeholder="描述组织的成立背景、经历与现状..." />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      {/* 手动创建角色模态框 */}
      <Modal
        title="创建角色"
        open={isCreateModalOpen}
        onCancel={() => {
          setIsCreateModalOpen(false);
          createForm.resetFields();
        }}
        footer={null}
        centered
        width={isMobile ? '100%' : 700}
        style={isMobile ? { top: 0, paddingBottom: 0, maxWidth: '100vw' } : undefined}
        styles={{
          body: {
            maxHeight: isMobile ? 'calc(100vh - 110px)' : 'calc(100vh - 200px)',
            overflowY: 'auto',
            overflowX: 'hidden'
          }
        }}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreateCharacter} style={{ marginTop: 8 }}>
          <>
              {/* 角色基本信息 - 第一行：名称、定位、年龄、性别 */}
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item
                    label="角色名称"
                    name="name"
                    rules={[{ required: true, message: '请输入角色名称' }]}
                    style={{ marginBottom: 12 }}
                  >
                    <Input placeholder="角色名称" />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item label="角色定位" name="role_type" initialValue="supporting" style={{ marginBottom: 12 }}>
                    <Select>
                      <Select.Option value="protagonist">主角</Select.Option>
                      <Select.Option value="supporting">配角</Select.Option>
                      <Select.Option value="antagonist">反派</Select.Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={5}>
                  <Form.Item label="年龄" name="age" style={{ marginBottom: 12 }}>
                    <Input placeholder="如：25岁" />
                  </Form.Item>
                </Col>
                <Col span={5}>
                  <Form.Item label="性别" name="gender" style={{ marginBottom: 12 }}>
                    <Select placeholder="性别">
                      <Select.Option value="男">男</Select.Option>
                      <Select.Option value="女">女</Select.Option>
                      <Select.Option value="其他">其他</Select.Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>

              {/* 第二行：性格特点、外貌描写 */}
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="性格特点" name="personality" style={{ marginBottom: 12 }}>
                    <TextArea rows={2} placeholder="描述角色的性格特点..." />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="外貌描写" name="appearance" style={{ marginBottom: 12 }}>
                    <TextArea rows={2} placeholder="描述角色的外貌特征..." />
                  </Form.Item>
                </Col>
              </Row>

              {/* 第三行：角色背景 */}
              <Form.Item label="角色背景" name="background" style={{ marginBottom: 12 }}>
                <TextArea rows={2} placeholder="描述角色的背景故事..." />
              </Form.Item>

              {/* 职业信息 - 折叠区域 */}
              {(mainCareers.length > 0 || subCareers.length > 0) && (
                <>
                  <Divider style={{ margin: '8px 0' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>职业信息（可选）</Typography.Text>
                  </Divider>
                  {mainCareers.length > 0 && (
                    <Row gutter={12}>
                      <Col span={16}>
                        <Form.Item label="主职业" name="main_career_id" tooltip="角色的主要修炼职业" style={{ marginBottom: 12 }}>
                          <Select placeholder="选择主职业" allowClear size="small">
                            {mainCareers.map(career => (
                              <Select.Option key={career.id} value={career.id}>
                                {career.name}（最高{career.max_stage}阶）
                              </Select.Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item label="当前阶段" name="main_career_stage" tooltip="主职业当前修炼到的阶段" style={{ marginBottom: 12 }}>
                          <InputNumber
                            min={1}
                            max={createForm.getFieldValue('main_career_id') ?
                              mainCareers.find(c => c.id === createForm.getFieldValue('main_career_id'))?.max_stage || 10
                              : 10}
                            style={{ width: '100%' }}
                            placeholder="阶段"
                            size="small"
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  )}
                  {subCareers.length > 0 && (
                    <Form.List name="sub_career_data">
                      {(fields, { add, remove }) => (
                        <>
                          <div style={{ marginBottom: 4 }}>
                            <Typography.Text strong style={{ fontSize: 12 }}>副职业</Typography.Text>
                          </div>
                          <div style={{ maxHeight: '80px', overflowY: 'auto', overflowX: 'hidden', marginBottom: 8, paddingRight: 8 }}>
                            {fields.map((field) => (
                              <Row key={field.key} gutter={8} style={{ marginBottom: 4 }}>
                                <Col span={16}>
                                  <Form.Item
                                    {...field}
                                    name={[field.name, 'career_id']}
                                    rules={[{ required: true, message: '请选择副职业' }]}
                                    style={{ marginBottom: 0 }}
                                  >
                                    <Select placeholder="选择副职业" size="small">
                                      {subCareers.map(career => (
                                        <Select.Option key={career.id} value={career.id}>
                                          {career.name}（最高{career.max_stage}阶）
                                        </Select.Option>
                                      ))}
                                    </Select>
                                  </Form.Item>
                                </Col>
                                <Col span={5}>
                                  <Form.Item
                                    {...field}
                                    name={[field.name, 'stage']}
                                    rules={[{ required: true, message: '阶段' }]}
                                    style={{ marginBottom: 0 }}
                                  >
                                    <InputNumber
                                      min={1}
                                      max={(() => {
                                        const careerId = createForm.getFieldValue(['sub_career_data', field.name, 'career_id']);
                                        const career = subCareers.find(c => c.id === careerId);
                                        return career?.max_stage || 10;
                                      })()}
                                      placeholder="阶段"
                                      style={{ width: '100%' }}
                                      size="small"
                                    />
                                  </Form.Item>
                                </Col>
                                <Col span={3}>
                                  <Button
                                    type="text"
                                    danger
                                    size="small"
                                    onClick={() => remove(field.name)}
                                  >
                                    删除
                                  </Button>
                                </Col>
                              </Row>
                            ))}
                          </div>
                          <Button
                            type="dashed"
                            onClick={() => add({ career_id: undefined, stage: 1 })}
                            block
                            size="small"
                          >
                            + 添加副职业
                          </Button>
                        </>
                      )}
                    </Form.List>
                  )}
                </>
              )}
          </>

          <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => {
                setIsCreateModalOpen(false);
                createForm.resetFields();
              }}>
                取消
              </Button>
              <Button type="primary" htmlType="submit">
                创建
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 导入对话框 */}
      <Modal
        title="导入角色/组织"
        open={isImportModalOpen}
        onCancel={() => setIsImportModalOpen(false)}
        footer={null}
        width={500}
        centered
      >
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <DownloadOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
          <p style={{ fontSize: 16, marginBottom: 24 }}>
            选择之前导出的角色/组织JSON文件进行导入
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleFileSelect(file);
                e.target.value = ''; // 清空input，允许重复选择同一文件
              }
            }}
          />
          <Button
            type="primary"
            size="large"
            icon={<ImportOutlined />}
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件
          </Button>
          <Divider />
          <div style={{ textAlign: 'left', fontSize: 12, color: '#666' }}>
            <p style={{ marginBottom: 8 }}><strong>说明：</strong></p>
            <ul style={{ marginLeft: 20 }}>
              <li>支持导入.json格式的角色/组织文件</li>
              <li>重复名称的角色/组织将被跳过</li>
              <li>职业信息如不存在将被忽略</li>
            </ul>
          </div>
        </div>
      </Modal>

      {/* SSE进度显示 */}
      <SSELoadingOverlay
        loading={isGenerating}
        progress={progress}
        message={progressMessage}
      />
    </div>
  );
}
