import { Button, Card, Checkbox, Dropdown, theme, Typography } from 'antd';
import {
  ArrowRightOutlined,
  BankOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  MoreOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { Character } from '../types';

const { Text } = Typography;

interface CharacterCardProps {
  character: Character;
  selected?: boolean;
  onSelect?: () => void;
  onOpen?: (character: Character) => void;
  onEdit?: (character: Character) => void;
  onDelete: (id: string) => void;
  onExport?: () => void;
}

export const CharacterCard: React.FC<CharacterCardProps> = ({
  character,
  selected = false,
  onSelect,
  onOpen,
  onEdit,
  onDelete,
  onExport,
}) => {
  const { token } = theme.useToken();
  const isOrganization = character.is_organization;

  const roleConfig: Record<string, { label: string; color: string }> = {
    protagonist: { label: '主角', color: token.colorPrimary },
    supporting: { label: '配角', color: token.colorSuccess },
    antagonist: { label: '反派', color: token.colorError },
  };
  const role = roleConfig[character.role_type || ''] || { label: '其他', color: token.colorTextTertiary };

  const statusConfig: Record<string, { label: string; color: string }> = {
    deceased: { label: '已死亡', color: token.colorTextTertiary },
    missing: { label: '已失踪', color: token.colorWarning },
    retired: { label: '已退场', color: token.colorTextTertiary },
    destroyed: { label: '已覆灭', color: token.colorTextTertiary },
  };
  const status = statusConfig[character.status || ''];
  const isInactive = Boolean(character.status && character.status !== 'active');

  const metaLine = isOrganization
    ? [character.organization_type, character.location, character.power_level != null ? `等级 ${character.power_level}` : null]
        .filter(Boolean)
        .join(' · ')
    : [character.age, character.gender].filter(Boolean).join(' · ');

  const summary = isOrganization
    ? character.organization_purpose || character.background
    : character.personality || character.background;

  const footnoteLabel = isOrganization ? '格言' : '关系';
  const footnote = isOrganization ? character.motto : character.relationships;

  const menuItems = [
    ...(onEdit ? [{ key: 'edit', icon: <EditOutlined />, label: '编辑' }] : []),
    ...(onExport ? [{ key: 'export', icon: <ExportOutlined />, label: '导出' }] : []),
    { type: 'divider' as const },
    { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true },
  ];

  return (
    <Card
      hoverable
      onClick={onOpen ? () => onOpen(character) : undefined}
      style={{
        height: '100%',
        minHeight: 184,
        borderRadius: 10,
        border: `1px solid ${selected ? token.colorText : token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        boxShadow: selected ? `inset 0 0 0 1px ${token.colorText}` : 'none',
        opacity: isInactive ? 0.62 : 1,
        cursor: onOpen ? 'pointer' : 'default',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
      }}
      styles={{
        body: {
          height: '100%',
          minHeight: 182,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {onSelect && (
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            style={{ flexShrink: 0, paddingTop: 8 }}
          >
            <Checkbox
              checked={selected}
              onChange={onSelect}
              aria-label={`选择${character.name}`}
            />
          </div>
        )}

        <div
          style={{
            width: 38,
            height: 38,
            flexShrink: 0,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: token.colorFillTertiary,
            color: isOrganization ? token.colorTextSecondary : token.colorText,
            fontSize: 17,
          }}
        >
          {isOrganization ? <BankOutlined /> : <UserOutlined />}
        </div>

        <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <Text
              strong
              style={{
                minWidth: 0,
                maxWidth: '100%',
                fontSize: 15,
                lineHeight: 1.4,
                color: token.colorText,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={character.name}
            >
              {character.name}
            </Text>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                flexShrink: 0,
                fontSize: 11,
                color: token.colorTextSecondary,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: isOrganization ? token.colorTextTertiary : role.color,
                }}
              />
              {isOrganization ? '组织' : role.label}
            </span>
            {status && (
              <span style={{ flexShrink: 0, fontSize: 11, color: status.color }}>
                {status.label}
              </span>
            )}
          </div>

          <div
            style={{
              marginTop: 4,
              minHeight: 18,
              fontSize: 12,
              color: token.colorTextTertiary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {metaLine || (isOrganization ? '组织信息待完善' : '角色信息待完善')}
          </div>
        </div>

        {menuItems.length > 0 && (
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            style={{ flexShrink: 0 }}
          >
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: menuItems,
                onClick: ({ key }) => {
                  if (key === 'edit' && onEdit) onEdit(character);
                  if (key === 'export' && onExport) onExport();
                  if (key === 'delete') onDelete(character.id);
                },
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<MoreOutlined />}
                aria-label={`${character.name}的操作`}
                style={{
                  width: 26,
                  height: 26,
                  minWidth: 26,
                  marginTop: -3,
                  marginRight: -5,
                  color: token.colorTextTertiary,
                }}
              />
            </Dropdown>
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 14,
          fontSize: 13,
          lineHeight: 1.75,
          color: summary ? token.colorTextSecondary : token.colorTextTertiary,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
        }}
      >
        {summary || (isOrganization ? '暂无组织简介' : '暂无角色简介')}
      </div>

      <div
        style={{
          marginTop: 'auto',
          paddingTop: 10,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          minWidth: 0,
          fontSize: 11,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {footnote ? (
            <>
              <span style={{ flexShrink: 0, color: token.colorTextTertiary }}>{footnoteLabel}</span>
              <span
                style={{
                  minWidth: 0,
                  color: token.colorTextSecondary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={footnote}
              >
                {footnote}
              </span>
            </>
          ) : (
            <span style={{ color: token.colorTextTertiary }}>完整档案</span>
          )}
        </div>
        {onOpen && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(character);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              flexShrink: 0,
              padding: 0,
              border: 0,
              background: 'transparent',
              color: token.colorTextSecondary,
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 11,
            }}
          >
            详情
            <ArrowRightOutlined style={{ fontSize: 9 }} />
          </button>
        )}
      </div>
    </Card>
  );
};
