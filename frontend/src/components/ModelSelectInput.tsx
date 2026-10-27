import { Button, Select, Space } from 'antd';
import { InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';

interface ModelSelectInputProps {
  value?: string;
  onChange?: (value: string) => void;
  loading?: boolean;
  onRefresh: () => void;
  isMobile: boolean;
  refreshLabel: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectProps: Record<string, any>;
}

/**
 * 模型选择框 + 刷新按钮。
 * 作为 Form.Item 的直接子节点，显式透传 value/onChange，
 * 否则 Space.Compact 会吞掉 Form 注入的受控属性。
 */
export default function ModelSelectInput({
  value,
  onChange,
  loading,
  onRefresh,
  isMobile,
  refreshLabel,
  selectProps,
}: ModelSelectInputProps) {
  return (
    <Space.Compact className="st-model-row">
      <Select
        {...selectProps}
        value={value}
        onChange={onChange}
        size={isMobile ? 'middle' : 'large'}
        className="st-model-select"
      />
      <Button
        size={isMobile ? 'middle' : 'large'}
        className="st-model-refresh"
        icon={<ReloadOutlined />}
        loading={loading}
        onClick={onRefresh}
      >
        {isMobile ? undefined : refreshLabel}
      </Button>
    </Space.Compact>
  );
}

/** 统一表单字段标题：主标签 + 可选说明图标 + 可选右侧读数 */
export function FieldLabel({
  text,
  hint,
  extra,
}: {
  text: string;
  hint?: string;
  extra?: React.ReactNode;
}) {
  return (
    <span className="st-field-label">
      <span className="st-field-label-text">{text}</span>
      {hint && <InfoCircleOutlined className="st-field-label-hint" title={hint} />}
      {extra}
    </span>
  );
}
