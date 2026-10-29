import { Grid, theme, Typography } from 'antd';
import { BRAND_COPYRIGHT } from '../config/brand';

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface AppFooterProps {
  sidebarWidth?: number;
}

/**
 * 全局页脚：仅保留版权信息
 * 版本号、GitHub、LinuxDO、赞助、许可证、致谢等已移除
 */
export default function AppFooter({ sidebarWidth = 0 }: AppFooterProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { token } = theme.useToken();
  const alphaColor = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

  // 计算左边距：桌面端有侧边栏时需要偏移
  const leftOffset = isMobile ? 0 : sidebarWidth;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: leftOffset,
        right: 0,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        padding: isMobile ? '6px 12px' : '7px 16px',
        zIndex: 100,
        backgroundColor: alphaColor(token.colorBgLayout, 0.72),
        transition: 'left 0.3s ease',
        textAlign: 'center',
      }}
    >
      <Text
        style={{
          fontSize: 10,
          color: token.colorTextTertiary,
          letterSpacing: '0.2em',
        }}
      >
        {BRAND_COPYRIGHT}
      </Text>
    </div>
  );
}
