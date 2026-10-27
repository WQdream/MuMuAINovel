import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Button, Modal, Form, Input, Select, message, Row, Col, Empty, Segmented, Card, Tag, Space, Divider, Typography, InputNumber, Drawer, theme } from 'antd';
import { ThunderboltOutlined, PlusOutlined, EditOutlined, DeleteOutlined, TrophyOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import api from '../services/api';
import SSEProgressModal from '../components/SSEProgressModal';
import { eventBus, EventNames } from '../store/eventBus';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
    const { token } = theme.useToken();

    return (
        <section style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{title}</span>
                <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
            </div>
            {children}
        </section>
    );
}

interface CareerStage {
    level: number;
    name: string;
    description?: string;
}

interface Career {
    id: string;
    project_id: string;
    name: string;
    type: 'main' | 'sub';
    description?: string;
    category?: string;
    stages: CareerStage[];
    max_stage: number;
    requirements?: string;
    special_abilities?: string;
    worldview_rules?: string;
    source: string;
}

export default function Careers() {
    const { projectId } = useParams<{ projectId: string }>();
    const { token } = theme.useToken();
    const [mainCareers, setMainCareers] = useState<Career[]>([]);
    const [subCareers, setSubCareers] = useState<Career[]>([]);
    const [, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'main' | 'sub'>('main');
    const [detailCareer, setDetailCareer] = useState<Career | null>(null);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAIModalOpen, setIsAIModalOpen] = useState(false);
    const [editingCareer, setEditingCareer] = useState<Career | null>(null);
    const [form] = Form.useForm();
    const [aiForm] = Form.useForm();
    const [modal, contextHolder] = Modal.useModal();

    // AI生成状态
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiProgress, setAiProgress] = useState(0);
    const [aiMessage, setAiMessage] = useState('');

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const fetchCareers = useCallback(async () => {
        try {
            setLoading(true);
            const response = await api.get('/careers', {
                params: { project_id: projectId }
            }) as { main_careers?: Career[]; sub_careers?: Career[] };
            setMainCareers(response.main_careers || []);
            setSubCareers(response.sub_careers || []);
        } catch (error: unknown) {
            console.error('获取职业列表失败:', error);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (projectId) {
            fetchCareers();
        }
    }, [projectId, fetchCareers]);

    useEffect(() => {
        const handleTaskSettled = (payload?: unknown) => {
            if (!payload || typeof payload !== 'object') return;
            const data = payload as { projectId?: string; resources?: string[] };
            if (data.projectId && data.projectId !== projectId) return;
            if (data.resources?.includes('careers')) {
                void fetchCareers();
            }
        };
        eventBus.on(EventNames.BACKGROUND_TASK_SETTLED, handleTaskSettled);
        return () => eventBus.off(EventNames.BACKGROUND_TASK_SETTLED, handleTaskSettled);
    }, [fetchCareers, projectId]);

    const handleOpenModal = (career?: Career) => {
        if (career) {
            setEditingCareer(career);
            form.setFieldsValue({
                ...career,
                stages: career.stages.map(s => `${s.level}. ${s.name}${s.description ? ` - ${s.description}` : ''}`).join('\n')
            });
        } else {
            setEditingCareer(null);
            form.resetFields();
        }
        setIsModalOpen(true);
    };

    interface CareerFormValues {
        name: string;
        type: 'main' | 'sub';
        description?: string;
        category?: string;
        stages?: string;
        requirements?: string;
        special_abilities?: string;
        worldview_rules?: string;
    }

    const handleSubmit = async (values: CareerFormValues) => {
        try {
            // 解析阶段数据
            const stagesText = values.stages || '';
            const stages: CareerStage[] = stagesText.split('\n')
                .filter((line: string) => line.trim())
                .map((line: string, index: number) => {
                    const match = line.match(/^(\d+)\.\s*([^-]+)(?:\s*-\s*(.*))?$/);
                    if (match) {
                        return {
                            level: parseInt(match[1]),
                            name: match[2].trim(),
                            description: match[3]?.trim() || ''
                        };
                    }
                    return {
                        level: index + 1,
                        name: line.trim(),
                        description: ''
                    };
                });

            const data = {
                ...values,
                stages,
                max_stage: stages.length
            };

            if (editingCareer) {
                await api.put(`/careers/${editingCareer.id}`, data);
                message.success('职业更新成功');
            } else {
                await api.post('/careers', {
                    ...data,
                    project_id: projectId,
                    source: 'manual'
                });
                message.success('职业创建成功');
            }

            setIsModalOpen(false);
            form.resetFields();
            fetchCareers();
        } catch (error: unknown) {
            const axiosError = error as { response?: { data?: { detail?: string } } };
            message.error(axiosError.response?.data?.detail || '操作失败');
        }
    };

    const handleDelete = async (id: string) => {
        modal.confirm({
            title: '确认删除',
            content: '确定要删除这个职业吗？如果有角色使用了该职业，将无法删除。',
            centered: true,
            onOk: async () => {
                try {
                    await api.delete(`/careers/${id}`);
                    message.success('职业删除成功');
                    fetchCareers();
                } catch (error: unknown) {
                    const axiosError = error as { response?: { data?: { detail?: string } } };
                    message.error(axiosError.response?.data?.detail || '删除失败');
                }
            }
        });
    };

    const handleAIGenerate = async (values: {
        main_career_count: number;
        sub_career_count: number;
        user_requirements?: string;
    }) => {
        setIsAIModalOpen(false);
        setAiGenerating(true);
        setAiProgress(0);
        setAiMessage('开始生成新职业...');

        try {
            const userRequirements = values.user_requirements?.trim() || '';

            // 使用 fetch + POST 替代 EventSource GET，避免 URL 长度限制
            const response = await fetch('/api/careers/generate-system', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    project_id: projectId || '',
                    main_career_count: values.main_career_count,
                    sub_career_count: values.sub_career_count,
                    user_requirements: userRequirements,
                    enable_mcp: false
                })
            });

            if (!response.ok || !response.body) {
                setAiGenerating(false);
                message.error(`请求失败: ${response.status}`);
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.type === 'progress') {
                                setAiProgress(data.progress || 0);
                                setAiMessage(data.message || '');
                            } else if (data.type === 'done') {
                                setTimeout(() => {
                                    setAiGenerating(false);
                                    message.success('AI新职业生成完成！');
                                    fetchCareers();
                                }, 1000);
                            } else if (data.type === 'error') {
                                setAiGenerating(false);
                                message.error(data.error || data.message || '生成失败');
                            }
                        } catch {
                            // 忽略非JSON行（如心跳注释）
                        }
                    }
                }
            }

            setAiGenerating(false);
        } catch (err: unknown) {
            setAiGenerating(false);
            const error = err as Error;
            message.error(error.message || '启动生成失败');
        }
    };

    const currentCareers = activeTab === 'main' ? mainCareers : subCareers;

    const renderCareerCard = (career: Career) => (
        <Card
            key={career.id}
            hoverable
            onClick={() => setDetailCareer(career)}
            style={{
                height: '100%',
                borderRadius: 10,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                cursor: 'pointer',
            }}
            styles={{
                body: {
                    height: '100%',
                    minHeight: 196,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                },
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{
                    width: 36,
                    height: 36,
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: '50%',
                    background: token.colorFillTertiary,
                    color: token.colorTextSecondary,
                    fontSize: 16,
                }}>
                    <TrophyOutlined />
                </div>

                <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        <Text
                            strong
                            style={{
                                minWidth: 0,
                                fontSize: 15,
                                lineHeight: 1.4,
                                color: token.colorText,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                            title={career.name}
                        >
                            {career.name}
                        </Text>
                        {career.source === 'ai' && <Tag color="blue" style={{ marginInlineEnd: 0 }}>AI 生成</Tag>}
                    </div>
                    <div style={{
                        marginTop: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                        fontSize: 12,
                        color: token.colorTextTertiary,
                    }}>
                        <span>{activeTab === 'main' ? '主职业' : '副职业'}</span>
                        {career.category && <><span>·</span><span>{career.category}</span></>}
                    </div>
                </div>

                <div
                    style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}
                    onClick={(event) => event.stopPropagation()}
                >
                    <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => handleOpenModal(career)}
                        aria-label={`编辑${career.name}`}
                    />
                    <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(career.id)}
                        aria-label={`删除${career.name}`}
                    />
                </div>
            </div>

            <div style={{
                marginTop: 13,
                minHeight: '3.4em',
                fontSize: 13,
                lineHeight: 1.7,
                color: token.colorTextSecondary,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
            }}>
                {career.description || '暂无职业描述'}
            </div>

            <div style={{
                marginTop: 'auto',
                paddingTop: 11,
                borderTop: `1px solid ${token.colorBorderSecondary}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
            }}>
                <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                    阶段体系 · {career.max_stage} 个
                </span>
                <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: 'auto', fontSize: 12 }}
                    onClick={(event) => {
                        event.stopPropagation();
                        setDetailCareer(career);
                    }}
                >
                    查看设定 <ArrowRightOutlined style={{ fontSize: 11 }} />
                </Button>
            </div>
        </Card>
    );

    return (
        <>
            {contextHolder}
            <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }}>
                {/* 固定头部 */}
                <div style={{
                    padding: isMobile ? '4px 0 16px' : '2px 0 18px',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    justifyContent: 'space-between',
                    alignItems: isMobile ? 'stretch' : 'flex-start',
                    gap: isMobile ? 14 : 20,
                }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <TrophyOutlined style={{ fontSize: 18, color: token.colorTextSecondary }} />
                            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: token.colorText }}>职业管理</h2>
                        </div>
                        <div style={{ marginTop: 5, fontSize: 12, color: token.colorTextTertiary }}>
                            主职业 {mainCareers.length} 个 · 副职业 {subCareers.length} 个
                        </div>
                    </div>

                    <Space wrap size={8}>
                        <Button
                            icon={<ThunderboltOutlined />}
                            size={isMobile ? 'small' : 'middle'}
                            onClick={() => {
                                aiForm.resetFields();
                                setIsAIModalOpen(true);
                            }}
                        >
                            AI 生成新职业
                        </Button>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            size={isMobile ? 'small' : 'middle'}
                            onClick={() => handleOpenModal()}
                        >
                            新增职业
                        </Button>
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
                    <Segmented
                        value={activeTab}
                        onChange={(value) => setActiveTab(value as 'main' | 'sub')}
                        options={[
                            { label: `主职业 ${mainCareers.length}`, value: 'main' },
                            { label: `副职业 ${subCareers.length}`, value: 'sub' },
                        ]}
                    />
                    <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                        共 {currentCareers.length} 个{activeTab === 'main' ? '主职业' : '副职业'}
                    </span>
                </div>

                {/* 可滚动的内容区域 */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '0 0 24px',
                }}>
                    {currentCareers.length > 0 ? (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(330px, 1fr))',
                            gap: isMobile ? 10 : 12,
                            alignItems: 'stretch',
                        }}>
                            {currentCareers.map(renderCareerCard)}
                        </div>
                    ) : (
                        <div style={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                            <Empty description={`还没有${activeTab === 'main' ? '主职业' : '副职业'}，先新增一个吧。`} />
                        </div>
                    )}
                </div>

            {/* 创建/编辑对话框 */}
            <Modal
                title={editingCareer ? '编辑职业' : '新增职业'}
                open={isModalOpen}
                onCancel={() => {
                    setIsModalOpen(false);
                    form.resetFields();
                }}
                footer={null}
                width={700}
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Row gutter={16}>
                        <Col span={16}>
                            <Form.Item label="职业名称" name="name" rules={[{ required: true }]}>
                                <Input placeholder="如：剑修、炼丹师" />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item label="类型" name="type" rules={[{ required: true }]} initialValue="main">
                                <Select>
                                    <Select.Option value="main">主职业</Select.Option>
                                    <Select.Option value="sub">副职业</Select.Option>
                                </Select>
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item label="职业描述" name="description">
                        <TextArea rows={2} placeholder="描述这个职业..." />
                    </Form.Item>

                    <Form.Item label="职业分类" name="category">
                        <Input placeholder="如：战斗系、生产系、辅助系" />
                    </Form.Item>

                    <Form.Item label="职业阶段" name="stages" tooltip="每行一个阶段，格式：1. 阶段名 - 描述">
                        <TextArea
                            rows={8}
                            placeholder="示例：&#10;1. 炼气期 - 初窥门径&#10;2. 筑基期 - 根基稳固&#10;3. 金丹期 - 凝结金丹"
                        />
                    </Form.Item>

                    <Form.Item label="职业要求" name="requirements">
                        <TextArea rows={2} placeholder="需要什么条件才能修炼..." />
                    </Form.Item>

                    <Form.Item label="特殊能力" name="special_abilities">
                        <TextArea rows={2} placeholder="这个职业的特殊能力..." />
                    </Form.Item>

                    <Form.Item label="世界观规则" name="worldview_rules">
                        <TextArea rows={2} placeholder="如何融入世界观..." />
                    </Form.Item>

                    <Form.Item>
                        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                            <Button onClick={() => setIsModalOpen(false)}>取消</Button>
                            <Button type="primary" htmlType="submit">
                                {editingCareer ? '更新' : '创建'}
                            </Button>
                        </Space>
                    </Form.Item>
                </Form>
            </Modal>

            {/* AI生成对话框 */}
            <Modal
                title="AI生成新职业（增量式）"
                open={isAIModalOpen}
                onCancel={() => setIsAIModalOpen(false)}
                footer={null}
            >
                <Form form={aiForm} layout="vertical" onFinish={handleAIGenerate}>
                    <Paragraph type="secondary">
                        AI将分析当前世界观和已有职业，智能生成新的补充职业。
                        <br />
                        💡 可以多次生成，逐步完善职业体系，不会替换已有职业。
                    </Paragraph>
                    <Divider style={{ margin: '12px 0' }} />
                    <Form.Item label="本次新增主职业数量" name="main_career_count" initialValue={3}>
                        <InputNumber min={1} max={10} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item label="本次新增副职业数量" name="sub_career_count" initialValue={5}>
                        <InputNumber min={0} max={15} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                        label="职业要求"
                        name="user_requirements"
                        rules={[{ max: 500, message: '额外要求最多500字' }]}
                        extra="可选。可描述希望新增的职业方向、能力侧重、限制条件或希望避开的职业类型，AI会结合世界观与已有职业综合生成。"
                    >
                        <TextArea
                            rows={4}
                            showCount
                            maxLength={500}
                            placeholder="例如：希望新增一个偏情报收集与潜伏渗透的主职业；副职业偏医术、经营或制造方向；避免再出现纯正面战斗型职业。"
                        />
                    </Form.Item>
                    <Form.Item>
                        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                            <Button onClick={() => setIsAIModalOpen(false)}>取消</Button>
                            <Button type="primary" icon={<ThunderboltOutlined />} htmlType="submit">
                                开始生成
                            </Button>
                        </Space>
                    </Form.Item>
                </Form>
            </Modal>

            {/* 职业详情抽屉 */}
            <Drawer
                open={Boolean(detailCareer)}
                onClose={() => setDetailCareer(null)}
                placement="right"
                width={isMobile ? '100%' : 600}
                title={detailCareer ? (
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 16, fontWeight: 600, color: token.colorText }}>{detailCareer.name}</span>
                            {detailCareer.source === 'ai' && <Tag color="blue" style={{ marginInlineEnd: 0 }}>AI 生成</Tag>}
                            {detailCareer.category && <Tag style={{ marginInlineEnd: 0 }}>{detailCareer.category}</Tag>}
                        </div>
                        <div style={{ marginTop: 3, fontSize: 12, fontWeight: 400, color: token.colorTextTertiary }}>
                            {detailCareer.type === 'main' ? '主职业' : '副职业'} · 共 {detailCareer.max_stage} 个阶段
                        </div>
                    </div>
                ) : null}
                extra={detailCareer ? (
                    <Space size={4}>
                        <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => {
                                const career = detailCareer;
                                setDetailCareer(null);
                                handleOpenModal(career);
                            }}
                        >
                            编辑
                        </Button>
                        <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => {
                                const id = detailCareer.id;
                                setDetailCareer(null);
                                handleDelete(id);
                            }}
                        >
                            删除
                        </Button>
                    </Space>
                ) : null}
                styles={{ body: { padding: isMobile ? 16 : 24 } }}
            >
                {detailCareer && (
                    <div style={{ paddingBottom: 16 }}>
                        <div style={{
                            fontSize: 13,
                            lineHeight: 1.85,
                            color: token.colorTextSecondary,
                            whiteSpace: 'pre-wrap',
                        }}>
                            {detailCareer.description || '暂无职业描述'}
                        </div>

                        <DetailSection title={`阶段体系（${detailCareer.max_stage}）`}>
                            <div>
                                {detailCareer.stages.map((stage, index) => (
                                    <div
                                        key={`${stage.level}-${index}`}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: 12,
                                            padding: '11px 0',
                                            borderBottom: index < detailCareer.stages.length - 1
                                                ? `1px solid ${token.colorBorderSecondary}`
                                                : undefined,
                                        }}
                                    >
                                        <div style={{
                                            width: 26,
                                            height: 26,
                                            flexShrink: 0,
                                            display: 'grid',
                                            placeItems: 'center',
                                            borderRadius: '50%',
                                            background: token.colorFillTertiary,
                                            fontSize: 11,
                                            color: token.colorTextSecondary,
                                        }}>
                                            {stage.level}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>
                                                {stage.name}
                                            </div>
                                            <div style={{
                                                marginTop: 3,
                                                fontSize: 12,
                                                lineHeight: 1.75,
                                                color: token.colorTextTertiary,
                                                whiteSpace: 'pre-wrap',
                                            }}>
                                                {stage.description || '暂无阶段说明'}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </DetailSection>

                        {detailCareer.special_abilities && (
                            <DetailSection title="特殊能力">
                                <div style={{ fontSize: 13, lineHeight: 1.85, color: token.colorTextSecondary, whiteSpace: 'pre-wrap' }}>
                                    {detailCareer.special_abilities}
                                </div>
                            </DetailSection>
                        )}

                        {detailCareer.requirements && (
                            <DetailSection title="职业要求">
                                <div style={{ fontSize: 13, lineHeight: 1.85, color: token.colorTextSecondary, whiteSpace: 'pre-wrap' }}>
                                    {detailCareer.requirements}
                                </div>
                            </DetailSection>
                        )}

                        {detailCareer.worldview_rules && (
                            <DetailSection title="世界观规则">
                                <div style={{ fontSize: 13, lineHeight: 1.85, color: token.colorTextSecondary, whiteSpace: 'pre-wrap' }}>
                                    {detailCareer.worldview_rules}
                                </div>
                            </DetailSection>
                        )}
                    </div>
                )}
            </Drawer>

            {/* AI生成进度 */}
            <SSEProgressModal
                visible={aiGenerating}
                progress={aiProgress}
                message={aiMessage}
                title="AI生成新职业中..."
                onCancel={() => setAiGenerating(false)}
            />
            </div>
        </>
    );
}
