import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Tag, Button, Space, message, Modal, Form, Select, Slider, Input, AutoComplete, theme, Drawer, Pagination, Progress, Spin, Tooltip, Empty } from 'antd';
import { PlusOutlined, ApartmentOutlined, UserOutlined, EditOutlined, DeleteOutlined, ArrowRightOutlined, SearchOutlined, TagsOutlined } from '@ant-design/icons';
import axios from 'axios';

const { TextArea } = Input;

interface Relationship {
  id: string;
  character_from_id: string;
  character_to_id: string;
  relationship_name: string;
  intimacy_level: number;
  status: string;
  description?: string;
  source: string;
}

interface RelationshipType {
  id: number;
  name: string;
  category: string;
  reverse_name?: string;
  icon?: string;
}

interface Character {
  id: string;
  name: string;
  is_organization: boolean;
}

export default function Relationships() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [relationshipTypes, setRelationshipTypes] = useState<RelationshipType[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingRelationship, setEditingRelationship] = useState<Relationship | null>(null);
  const [form] = Form.useForm();
  const [modal, contextHolder] = Modal.useModal();
  const { token } = theme.useToken();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [isTypesDrawerOpen, setIsTypesDrawerOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (projectId) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCharacterId, searchText]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [relsRes, typesRes, charsRes] = await Promise.all([
        axios.get(`/api/relationships/project/${projectId}`),
        axios.get('/api/relationships/types'),
        axios.get(`/api/characters?project_id=${projectId}`)
      ]);

      setRelationships(relsRes.data);
      setRelationshipTypes(typesRes.data);
      setCharacters(charsRes.data.items || []);
    } catch (error) {
      message.error('加载数据失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRelationship = async (values: {
    character_from_id: string;
    character_to_id: string;
    relationship_name: string;
    intimacy_level: number;
    status: string;
    description?: string;
  }) => {
    try {
      await axios.post('/api/relationships/', {
        project_id: projectId,
        ...values
      });
      message.success('关系创建成功');
      setIsModalOpen(false);
      form.resetFields();
      loadData();
    } catch (error) {
      message.error('创建关系失败');
      console.error(error);
    }
  };

  const handleEditRelationship = (record: Relationship) => {
    setEditingRelationship(record);
    setIsEditMode(true);
    form.setFieldsValue({
      character_from_id: record.character_from_id,
      character_to_id: record.character_to_id,
      relationship_name: record.relationship_name,
      intimacy_level: record.intimacy_level,
      status: record.status,
      description: record.description,
    });
    setIsModalOpen(true);
  };

  const handleUpdateRelationship = async (values: {
    character_from_id: string;
    character_to_id: string;
    relationship_name: string;
    intimacy_level: number;
    status: string;
    description?: string;
  }) => {
    if (!editingRelationship) return;

    try {
      await axios.put(`/api/relationships/${editingRelationship.id}`, {
        relationship_name: values.relationship_name,
        intimacy_level: values.intimacy_level,
        status: values.status,
        description: values.description,
      });
      message.success('关系更新成功');
      setIsModalOpen(false);
      setIsEditMode(false);
      setEditingRelationship(null);
      form.resetFields();
      loadData();
    } catch (error) {
      message.error('更新关系失败');
      console.error(error);
    }
  };

  const handleDeleteRelationship = async (id: string) => {
    modal.confirm({
      title: '确认删除',
      content: '确定要删除这条关系吗？',
      centered: true,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await axios.delete(`/api/relationships/${id}`);
          message.success('关系删除成功');
          loadData();
        } catch (error) {
          message.error('删除失败');
          console.error(error);
        }
      }
    });
  };

  const getCharacterName = (id: string) => {
    const char = characters.find(c => c.id === id);
    return char?.name || '未知';
  };

  const getIntimacyTone = (level: number) => {
    if (level >= 75) return token.colorSuccess;
    if (level >= 25) return token.colorInfo;
    if (level >= 0) return token.colorWarning;
    return token.colorError;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'green',
      broken: 'red',
      past: 'default',
      complicated: 'orange'
    };
    return colors[status] || 'default';
  };

  const getStatusText = (status: string) => {
    const labels: Record<string, string> = {
      active: '活跃',
      broken: '破裂',
      past: '过去',
      complicated: '复杂'
    };
    return labels[status] || status;
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      family: 'magenta',
      social: 'blue',
      hostile: 'red',
      professional: 'cyan'
    };
    return colors[category] || 'default';
  };

  // 按类别分组关系类型
  const groupedTypes = relationshipTypes.reduce((acc, type) => {
    if (!acc[type.category]) {
      acc[type.category] = [];
    }
    acc[type.category].push(type);
    return acc;
  }, {} as Record<string, RelationshipType[]>);

  const categoryLabels: Record<string, string> = {
    family: '家族关系',
    social: '社交关系',
    professional: '职业关系',
    hostile: '敌对关系'
  };

  const characterStats = characters
    .filter(c => !c.is_organization)
    .map(c => ({
      ...c,
      count: relationships.filter(rel => rel.character_from_id === c.id || rel.character_to_id === c.id).length
    }))
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));

  const normalizedSearch = searchText.trim().toLowerCase();
  const filteredRelationships = relationships.filter(rel => {
    if (selectedCharacterId
      && rel.character_from_id !== selectedCharacterId
      && rel.character_to_id !== selectedCharacterId) {
      return false;
    }
    if (!normalizedSearch) return true;

    return [
      getCharacterName(rel.character_from_id),
      getCharacterName(rel.character_to_id),
      rel.relationship_name,
      rel.description || '',
    ].some(value => value.toLowerCase().includes(normalizedSearch));
  });
  const pagedRelationships = filteredRelationships.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );
  const selectedCharacterName = selectedCharacterId ? getCharacterName(selectedCharacterId) : null;

  const renderCharacterEntity = (id: string, alignRight = false) => {
    const name = getCharacterName(id);
    const avatar = (
      <div style={{
        width: 26,
        height: 26,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        background: token.colorFillTertiary,
        color: token.colorTextSecondary,
        fontSize: 12,
      }}>
        <UserOutlined />
      </div>
    );

    return (
      <div style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: alignRight ? 'flex-end' : 'flex-start',
        gap: 7,
      }}>
        {!alignRight && avatar}
        <span
          title={name}
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13,
            fontWeight: 500,
            color: token.colorText,
          }}
        >
          {name}
        </span>
        {alignRight && avatar}
      </div>
    );
  };

  const renderRelationshipCard = (relationship: Relationship) => {
    const tone = getIntimacyTone(relationship.intimacy_level);
    const relationLabel = (
      <span style={{
        display: 'block',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: 12,
        fontWeight: 500,
        color: token.colorText,
      }}>
        {relationship.relationship_name}
      </span>
    );

    return (
      <Card
        key={relationship.id}
        size="small"
        style={{
          borderRadius: 10,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
        }}
        styles={{ body: { padding: 14 } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {renderCharacterEntity(relationship.character_from_id)}

          <div style={{
            width: isMobile ? 128 : 150,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
          }}>
            {relationship.description ? (
              <Tooltip title={relationship.description}>{relationLabel}</Tooltip>
            ) : relationLabel}
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
              <ArrowRightOutlined style={{ fontSize: 9, color: token.colorTextTertiary }} />
            </div>
          </div>

          {renderCharacterEntity(relationship.character_to_id, true)}
        </div>

        <div style={{
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>亲密度</span>
            <Progress
              percent={Math.min(100, Math.abs(relationship.intimacy_level))}
              showInfo={false}
              strokeWidth={4}
              strokeColor={tone}
              trailColor={token.colorFillSecondary}
              style={{ width: 62, margin: 0, flexShrink: 0 }}
            />
            <span style={{
              minWidth: 26,
              fontSize: 12,
              color: tone,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {relationship.intimacy_level}
            </span>
            <Tag color={getStatusColor(relationship.status)} style={{ marginInlineEnd: 0 }}>
              {getStatusText(relationship.status)}
            </Tag>
            {relationship.source === 'ai' && (
              <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>AI</span>
            )}
          </div>

          <Space size={0} style={{ flexShrink: 0 }}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEditRelationship(relationship)}
              aria-label={`编辑${relationship.relationship_name}`}
            />
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteRelationship(relationship.id)}
              aria-label={`删除${relationship.relationship_name}`}
            />
          </Space>
        </div>
      </Card>
    );
  };

  return (
    <>
      {contextHolder}
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          padding: isMobile ? '4px 0 16px' : '2px 0 18px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'flex-start',
          gap: isMobile ? 14 : 20,
          flexShrink: 0,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <ApartmentOutlined style={{ fontSize: 18, color: token.colorTextSecondary }} />
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: token.colorText }}>关系管理</h2>
            </div>
            <div style={{ marginTop: 5, fontSize: 12, color: token.colorTextTertiary }}>
              {relationships.length} 条关系 · {characterStats.length} 位角色
            </div>
          </div>

          <Space wrap size={8}>
            <Button
              icon={<TagsOutlined />}
              size={isMobile ? 'small' : 'middle'}
              onClick={() => setIsTypesDrawerOpen(true)}
            >
              {isMobile ? '类型' : '关系类型'}
            </Button>
            <Button
              icon={<ApartmentOutlined />}
              onClick={() => projectId && navigate(`/project/${projectId}/relationships-graph`)}
              size={isMobile ? 'small' : 'middle'}
            >
              {isMobile ? '图谱' : '关系图谱'}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsModalOpen(true)}
              size={isMobile ? 'small' : 'middle'}
            >
              {isMobile ? '添加' : '添加关系'}
            </Button>
          </Space>
        </div>

        <div style={{
          flex: 1,
          display: 'flex',
          gap: isMobile ? 0 : 16,
          overflow: 'hidden',
          paddingTop: isMobile ? 12 : 16,
        }}>
          {!isMobile && (
            <aside style={{
              width: 208,
              flexShrink: 0,
              borderRight: `1px solid ${token.colorBorderSecondary}`,
              paddingRight: 14,
              overflowY: 'auto',
            }}>
              <div style={{ marginBottom: 8, fontSize: 11, fontWeight: 600, color: token.colorTextTertiary }}>
                筛选
              </div>

              <button
                type="button"
                onClick={() => setSelectedCharacterId(null)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '7px 9px',
                  border: 0,
                  borderRadius: 8,
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                  background: selectedCharacterId === null ? token.colorFillTertiary : 'transparent',
                  color: selectedCharacterId === null ? token.colorText : token.colorTextSecondary,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <ApartmentOutlined />
                  <span>全部关系</span>
                </span>
                <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{relationships.length}</span>
              </button>

              <div style={{ margin: '18px 0 8px', fontSize: 11, fontWeight: 600, color: token.colorTextTertiary }}>
                按角色
              </div>

              {characterStats.map(character => {
                const active = selectedCharacterId === character.id;
                return (
                  <button
                    key={character.id}
                    type="button"
                    onClick={() => setSelectedCharacterId(character.id)}
                    title={character.name}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '7px 9px',
                      border: 0,
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      font: 'inherit',
                      background: active ? token.colorFillTertiary : 'transparent',
                      color: active ? token.colorText : token.colorTextSecondary,
                    }}
                  >
                    <span style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {character.name}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 11, color: token.colorTextTertiary }}>{character.count}</span>
                  </button>
                );
              })}
            </aside>
          )}

          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{
              flexShrink: 0,
              paddingBottom: 12,
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                  {selectedCharacterName ? `${selectedCharacterName}的关系` : '全部关系'}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, color: token.colorTextTertiary }}>
                  共 {filteredRelationships.length} 条
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexDirection: isMobile ? 'column' : 'row' }}>
                {isMobile && (
                  <Select
                    size="small"
                    value={selectedCharacterId ?? '__all__'}
                    onChange={(value) => setSelectedCharacterId(value === '__all__' ? null : value)}
                    options={[
                      { label: `全部关系 (${relationships.length})`, value: '__all__' },
                      ...characterStats.map(character => ({
                        label: `${character.name} (${character.count})`,
                        value: character.id,
                      })),
                    ]}
                  />
                )}
                <Input
                  allowClear
                  size="small"
                  prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
                  placeholder="搜索角色、关系或描述"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  style={{ width: isMobile ? '100%' : 230 }}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
              {loading ? (
                <div style={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
                  <Spin />
                </div>
              ) : pagedRelationships.length > 0 ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(400px, 1fr))',
                  gap: isMobile ? 10 : 12,
                  alignItems: 'stretch',
                }}>
                  {pagedRelationships.map(renderRelationshipCard)}
                </div>
              ) : (
                <div style={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
                  <Empty
                    description={
                      searchText.trim()
                        ? '没有匹配的关系'
                        : selectedCharacterId
                          ? '这个角色还没有关系'
                          : '还没有关系，先添加一条吧。'
                    }
                  />
                </div>
              )}
            </div>

            {filteredRelationships.length > 0 && (
              <div style={{ flexShrink: 0, paddingTop: 12, display: 'flex', justifyContent: 'center' }}>
                <Pagination
                  current={currentPage}
                  pageSize={pageSize}
                  total={filteredRelationships.length}
                  showSizeChanger={!isMobile}
                  pageSizeOptions={[10, 20, 50]}
                  simple={isMobile}
                  showTotal={(total) => `共 ${total} 条`}
                  onChange={(page, size) => {
                    setCurrentPage(page);
                    if (size !== pageSize) {
                      setPageSize(size);
                      setCurrentPage(1);
                    }
                  }}
                />
              </div>
            )}
          </main>
        </div>
      </div>

      <Drawer
        title="关系类型"
        open={isTypesDrawerOpen}
        onClose={() => setIsTypesDrawerOpen(false)}
        width={isMobile ? '100%' : 460}
        styles={{ body: { padding: isMobile ? 16 : 24 } }}
      >
        <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
          共 {relationshipTypes.length} 种关系类型，按类别整理。
        </div>

        {Object.entries(groupedTypes).map(([category, types]) => (
          <div key={category} style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                {categoryLabels[category] || category}
              </span>
              <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{types.length}</span>
              <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {types.map(type => (
                <Tag key={type.id} color={getCategoryColor(category)} style={{ marginInlineEnd: 0, padding: '2px 8px' }}>
                  {type.icon} {type.name}
                  {type.reverse_name && ` ↔ ${type.reverse_name}`}
                </Tag>
              ))}
            </div>
          </div>
        ))}
      </Drawer>

      <Modal
        title={isEditMode ? '编辑关系' : '添加关系'}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          setIsEditMode(false);
          setEditingRelationship(null);
          form.resetFields();
        }}
        footer={null}
        centered={!isMobile}
        width={isMobile ? '100%' : 600}
        style={isMobile ? { top: 0, paddingBottom: 0, maxWidth: '100vw' } : undefined}
        styles={isMobile ? { body: { maxHeight: 'calc(100vh - 110px)', overflowY: 'auto' } } : undefined}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={isEditMode ? handleUpdateRelationship : handleCreateRelationship}
        >
          <Form.Item
            name="character_from_id"
            label="角色A"
            rules={[{ required: true, message: '请选择角色A' }]}
          >
            <Select
              placeholder="选择角色"
              showSearch
              disabled={isEditMode}
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={characters
                .filter(c => !c.is_organization)
                .map(c => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>

          <Form.Item
            name="relationship_name"
            label="关系类型"
            rules={[{ required: true, message: '请选择或输入关系类型' }]}
          >
            <AutoComplete
              placeholder="选择预定义类型或输入自定义关系"
              options={relationshipTypes.map(t => ({
                label: `${t.icon || ''} ${t.name} (${categoryLabels[t.category]})`,
                value: t.name
              }))}
              filterOption={(inputValue, option) =>
                option!.value.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
              }
            />
          </Form.Item>

          <Form.Item
            name="character_to_id"
            label="角色B"
            rules={[{ required: true, message: '请选择角色B' }]}
          >
            <Select
              placeholder="选择角色"
              showSearch
              disabled={isEditMode}
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={characters
                .filter(c => !c.is_organization)
                .map(c => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>

          <Form.Item
            name="intimacy_level"
            label="亲密度"
            initialValue={50}
          >
            <Slider
              min={-100}
              max={100}
              marks={{
                '-100': '-100',
                '-50': '-50',
                0: '0',
                50: '50',
                100: '100'
              }}
            />
          </Form.Item>

          <Form.Item
            name="status"
            label="状态"
            initialValue="active"
          >
            <Select>
              <Select.Option value="active">活跃</Select.Option>
              <Select.Option value="broken">破裂</Select.Option>
              <Select.Option value="past">过去</Select.Option>
              <Select.Option value="complicated">复杂</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="description" label="关系描述">
            <TextArea rows={3} placeholder="描述这段关系的细节..." />
          </Form.Item>

          <Form.Item>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => {
                setIsModalOpen(false);
                setIsEditMode(false);
                setEditingRelationship(null);
                form.resetFields();
              }}>取消</Button>
              <Button type="primary" htmlType="submit">
                {isEditMode ? '更新' : '创建'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
