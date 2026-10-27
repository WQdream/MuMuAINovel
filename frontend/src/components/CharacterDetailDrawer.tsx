import { Button, Drawer, theme } from 'antd';
import {
  BankOutlined,
  CloseOutlined,
  EditOutlined,
  ExportOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { Character } from '../types';

interface CharacterDetailDrawerProps {
  character: Character | null;
  careerNames: Record<string, string>;
  onClose: () => void;
  onEdit?: (character: Character) => void;
  onExport?: (characterId: string) => void;
}

export function CharacterDetailDrawer({
  character,
  careerNames,
  onClose,
  onEdit,
  onExport,
}: CharacterDetailDrawerProps) {
  const { token } = theme.useToken();
  const isOrganization = character?.is_organization ?? false;

  const roleLabels: Record<string, string> = {
    protagonist: '主角',
    supporting: '配角',
    antagonist: '反派',
  };
  const roleLabel = character?.role_type ? roleLabels[character.role_type] || '其他' : '其他';

  const statusLabels: Record<string, string> = {
    deceased: '已死亡',
    missing: '已失踪',
    retired: '已退场',
    destroyed: '已覆灭',
  };
  const statusLabel = character?.status ? statusLabels[character.status] : null;

  const mainCareer = character?.main_career_id ? careerNames[character.main_career_id] : null;
  const subCareerText = character?.sub_careers
    ?.map((career) => {
      const name = careerNames[career.career_id] || '未知职业';
      return `${name} · 第 ${career.stage || 1} 阶`;
    })
    .join('；');

  const basicRows = character
    ? isOrganization
      ? [
          { label: '类型', value: character.organization_type },
          { label: '势力等级', value: character.power_level != null ? String(character.power_level) : null },
          { label: '所在地', value: character.location },
          { label: '代表颜色', value: character.color },
        ]
      : [
          { label: '年龄', value: character.age },
          { label: '性别', value: character.gender },
          {
            label: '主职业',
            value: mainCareer
              ? `${mainCareer}${character.main_career_stage ? ` · 第 ${character.main_career_stage} 阶` : ''}`
              : null,
          },
          { label: '副职业', value: subCareerText },
        ]
    : [];

  const detailSections = character
    ? isOrganization
      ? [
          { title: '组织目的', value: character.organization_purpose },
          { title: '背景设定', value: character.background },
          { title: '组织格言', value: character.motto },
          { title: '组织成员', value: character.organization_members },
          { title: '当前状态', value: character.current_state },
        ]
      : [
          { title: '性格特点', value: character.personality },
          { title: '外貌描写', value: character.appearance },
          { title: '角色背景', value: character.background },
          { title: '人际关系', value: character.relationships },
          { title: '角色特质', value: character.traits },
          { title: '当前状态', value: character.current_state },
        ]
    : [];

  const visibleBasicRows = basicRows.filter((row) => row.value);
  const visibleSections = detailSections.filter((section) => section.value);

  return (
    <Drawer
      open={Boolean(character)}
      onClose={onClose}
      closable={false}
      width={window.innerWidth <= 768 ? '100%' : 480}
      styles={{
        body: { padding: 0 },
      }}
    >
      {character && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              flexShrink: 0,
              padding: '22px 24px 18px',
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  flexShrink: 0,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  background: token.colorFillTertiary,
                  color: token.colorTextSecondary,
                  fontSize: 20,
                }}
              >
                {isOrganization ? <BankOutlined /> : <UserOutlined />}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 19, fontWeight: 600, color: token.colorText, lineHeight: 1.4 }}>
                    {character.name}
                  </span>
                  <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
                    {isOrganization ? '组织' : roleLabel}
                  </span>
                  {statusLabel && (
                    <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{statusLabel}</span>
                  )}
                </div>
                <div style={{ marginTop: 5, fontSize: 12, color: token.colorTextTertiary }}>
                  {isOrganization
                    ? [character.organization_type, character.location].filter(Boolean).join(' · ') || '组织信息待完善'
                    : [character.age, character.gender].filter(Boolean).join(' · ') || '角色信息待完善'}
                </div>
              </div>

              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                aria-label="关闭详情"
                onClick={onClose}
                style={{ flexShrink: 0, color: token.colorTextTertiary }}
              />
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 24px 28px' }}>
            {visibleBasicRows.length > 0 && (
              <section style={{ marginBottom: 26 }}>
                <div
                  style={{
                    marginBottom: 12,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    color: token.colorTextTertiary,
                  }}
                >
                  基础信息
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', rowGap: 10, fontSize: 13 }}>
                  {visibleBasicRows.map((row) => (
                    <div key={row.label} style={{ display: 'contents' }}>
                      <span style={{ color: token.colorTextTertiary }}>{row.label}</span>
                      <span style={{ color: token.colorTextSecondary, overflowWrap: 'anywhere' }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {visibleSections.map((section) => (
              <section key={section.title} style={{ marginBottom: 24 }}>
                <div
                  style={{
                    marginBottom: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    color: token.colorTextTertiary,
                  }}
                >
                  {section.title}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.9,
                    color: token.colorTextSecondary,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {section.value}
                </div>
              </section>
            ))}

            {visibleBasicRows.length === 0 && visibleSections.length === 0 && (
              <div style={{ fontSize: 13, color: token.colorTextTertiary }}>暂无更多信息</div>
            )}
          </div>

          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '14px 24px',
              borderTop: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            {onExport && (
              <Button icon={<ExportOutlined />} onClick={() => onExport(character.id)}>
                导出
              </Button>
            )}
            {onEdit && (
              <Button type="primary" icon={<EditOutlined />} onClick={() => onEdit(character)}>
                编辑
              </Button>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
