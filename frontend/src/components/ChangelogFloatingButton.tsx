import { useState } from 'react';
import { Button, theme } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import ChangelogModal from './ChangelogModal';

/**
 * 更新日志入口：以内联按钮形式放在顶栏，避免浮动按钮遮挡页面内容
 */
export default function ChangelogFloatingButton() {
  const [showChangelog, setShowChangelog] = useState(false);
  const { token } = theme.useToken();

  return (
    <>
      <Button
        type="text"
        icon={<FileTextOutlined />}
        onClick={() => setShowChangelog(true)}
        title="更新日志"
        style={{
          color: token.colorTextSecondary,
          width: 36,
          height: 36,
          borderRadius: 18,
        }}
      />

      <ChangelogModal
        visible={showChangelog}
        onClose={() => setShowChangelog(false)}
      />
    </>
  );
}
