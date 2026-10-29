import React, { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Input, Button, Spin, message, Tooltip, Tabs, theme } from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  ThunderboltOutlined,
  ArrowLeftOutlined,
  StopOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import './SkillChat.css';

// 使用简单的文本渲染替代 react-markdown
const MarkdownRender: React.FC<{ content: string }> = ({ content }) => {
  return <div className="sk-markdown">{content}</div>;
};

const { TextArea } = Input;

interface Skill {
  template_key: string;
  template_name: string;
  category: string;
  description: string;
  triggers: string[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SkillChat: React.FC = () => {
  const { token } = theme.useToken();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const themeVars = {
    '--sk-text': token.colorText,
    '--sk-secondary': token.colorTextSecondary,
    '--sk-tertiary': token.colorTextTertiary,
    '--sk-border': token.colorBorderSecondary,
    '--sk-fill': token.colorFillQuaternary,
    '--sk-card-bg': token.colorBgContainer,
    '--sk-accent': token.colorPrimary,
  } as CSSProperties;

  useEffect(() => {
    fetchSkills();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchSkills = async () => {
    try {
      const response = await axios.get('/api/skills/list');
      setSkills(response.data);
      if (response.data.length > 0) {
        setActiveCategory((prev) => prev || response.data[0].category);
      }
    } catch {
      message.error('加载技能列表失败');
    } finally {
      setSkillsLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSkillSelect = (skill: Skill) => {
    setSelectedSkill(skill);
    setMessages([]);
  };

  const handleSend = async () => {
    if (!inputValue.trim() || !selectedSkill || loading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setLoading(true);

    // 添加空的助手消息占位
    const assistantMsg: ChatMessage = { role: 'assistant', content: '' };
    setMessages([...newMessages, assistantMsg]);

    try {
      abortControllerRef.current = new AbortController();
      const response = await fetch('/api/skills/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skill_key: selectedSkill.template_key,
          message: userMessage,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error('请求失败');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'chunk') {
                accumulated += data.content;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: accumulated };
                  return updated;
                });
              } else if (data.type === 'error') {
                message.error(data.error || '生成失败');
              }
            } catch {
              // 忽略非 JSON 流片段
            }
          }
        }
      }
    } catch (error: unknown) {
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      if (!isAbortError) {
        message.error('请求失败，请检查 AI 配置');
        setMessages(prev => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].role === 'assistant' && !updated[updated.length - 1].content) {
            updated.pop();
          }
          return updated;
        });
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  // 按 category 分组
  const groupedSkills = skills.reduce<Record<string, Skill[]>>((acc, skill) => {
    const cat = skill.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(skill);
    return acc;
  }, {});
  const categories = Object.keys(groupedSkills);
  const currentCategory = activeCategory && groupedSkills[activeCategory] ? activeCategory : categories[0];
  const currentSkills = currentCategory ? groupedSkills[currentCategory] : [];

  const categoryColors: Record<string, string> = {
    'Skill·长篇': '#1890ff',
    'Skill·短篇': '#52c41a',
    'Skill·润色': '#faad14',
    'Skill·工具': '#722ed1',
  };
  const categoryLabel = (category: string) => category.replace(/^Skill·/, '技能·');

  if (selectedSkill) {
    return (
      <div className="sk-page" style={themeVars}>
        <div className="sk-chat-head">
          <Button
            type="text"
            size="small"
            className="sk-back"
            icon={<ArrowLeftOutlined />}
            onClick={() => { setSelectedSkill(null); setMessages([]); }}
          >
            返回
          </Button>
          <div className="sk-chat-head-main">
            <div className="sk-chat-title-row">
              <span className="sk-chat-title">{selectedSkill.template_name}</span>
              <span className="sk-row-cat">
                <span
                  className="sk-dot"
                  style={{ background: categoryColors[selectedSkill.category] || 'var(--sk-accent)' }}
                />
                {categoryLabel(selectedSkill.category)}
              </span>
            </div>
            <p className="sk-chat-subtitle">{selectedSkill.description}</p>
          </div>
        </div>

        {/* 消息区域 */}
        <div className="sk-messages">
          {messages.length === 0 && (
            <div className="sk-chat-empty">
              <span className="sk-chat-empty-icon">
                <RobotOutlined />
              </span>
              <p className="sk-chat-empty-title">{selectedSkill.template_name}</p>
              <p className="sk-chat-empty-desc">
                输入你的需求开始对话，也可以直接用触发词唤起对应工作流。
              </p>
              <div className="sk-trigger-list">
                {selectedSkill.triggers.map(t => (
                  <button
                    type="button"
                    className="sk-chip sk-chip--action"
                    key={t}
                    onClick={() => setInputValue(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`sk-msg sk-msg--${msg.role}`}
            >
              <span className="sk-avatar">
                {msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
              </span>
              <div className="sk-bubble">
                <MarkdownRender content={msg.content || '...'} />
              </div>
            </div>
          ))}
          {loading && messages[messages.length - 1]?.content === '' && (
            <div className="sk-thinking">
              <Spin size="small" />
              <span>正在生成</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div className="sk-composer">
          <TextArea
            className="sk-composer-input"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="描述你的需求，Shift + Enter 换行"
            autoSize={{ minRows: 1, maxRows: 6 }}
            disabled={loading}
          />
          <div className="sk-composer-foot">
            <span className="sk-composer-hint">
              {loading ? '生成中，可等待完成' : `触发词：${selectedSkill.triggers.slice(0, 3).join('、')}`}
            </span>
            <Button
              type="primary"
              className="sk-send"
              icon={loading ? <StopOutlined /> : <SendOutlined />}
              onClick={handleSend}
              loading={loading}
            >
              {loading ? '生成中' : '发送'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Skill 选择页
  return (
    <div className="sk-page" style={themeVars}>
      <div className="sk-header">
        <div className="sk-header-main">
          <ThunderboltOutlined className="sk-header-icon" />
          <div style={{ minWidth: 0 }}>
            <h2 className="sk-title">技能工具箱</h2>
            <p className="sk-subtitle">选择一个技能开始创作对话，每项技能都有独立的写作工作流。</p>
          </div>
        </div>
      </div>

      {skillsLoading ? (
        <div className="sk-loading">
          <Spin />
        </div>
      ) : (
        <>
          <div className="sk-tabs-row">
            <Tabs
              className="sk-tabs"
              activeKey={currentCategory}
              onChange={setActiveCategory}
              items={categories.map((category) => ({
                key: category,
                label: (
                  <span className="sk-tab-label">
                    <span
                      className="sk-dot"
                      style={{ background: categoryColors[category] || 'var(--sk-accent)' }}
                    />
                    {category.replace(/^Skill·/, '')}
                    <span className="sk-tab-count">{groupedSkills[category].length}</span>
                  </span>
                ),
              }))}
            />
          </div>

          <div className="sk-scroll">
            {currentSkills.length === 0 ? (
              <div className="sk-empty">该分类下暂无技能</div>
            ) : (
              <div className="sk-grid">
                {currentSkills.map(skill => (
                  <article
                    className="sk-card"
                    key={skill.template_key}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSkillSelect(skill)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSkillSelect(skill);
                      }
                    }}
                  >
                    <div className="sk-card-head">
                      <span
                        className="sk-card-icon"
                        style={{
                          color: categoryColors[skill.category] || 'var(--sk-accent)',
                        }}
                      >
                        <ThunderboltOutlined />
                      </span>
                      <div className="sk-card-title">
                        <span className="sk-card-name" title={skill.template_name}>
                          {skill.template_name}
                        </span>
                        <span className="sk-row-cat">
                          <span
                            className="sk-dot"
                            style={{ background: categoryColors[skill.category] || 'var(--sk-accent)' }}
                          />
                          {skill.category.replace(/^Skill·/, '')}
                        </span>
                      </div>
                    </div>

                    <Tooltip title={skill.description} placement="bottom">
                      <p className="sk-card-desc">{skill.description}</p>
                    </Tooltip>

                    <div className="sk-card-foot">
                      <div className="sk-card-triggers">
                        {skill.triggers.slice(0, 3).map(t => (
                          <span className="sk-chip" key={t}>{t}</span>
                        ))}
                        {skill.triggers.length > 3 && (
                          <Tooltip title={skill.triggers.slice(3).join('、')}>
                            <span className="sk-chip sk-chip--more">+{skill.triggers.length - 3}</span>
                          </Tooltip>
                        )}
                      </div>
                      <span className="sk-card-go">开始</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default SkillChat;
