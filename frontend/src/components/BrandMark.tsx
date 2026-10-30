import { theme } from 'antd';
import { BRAND } from '../config/brand';

interface BrandMarkProps {
  size?: number;
  showText?: boolean;
  textSize?: number;
  compact?: boolean;
  color?: string;
}

export default function BrandMark({
  size = 30,
  showText = true,
  textSize = 15,
  compact = false,
  color,
}: BrandMarkProps) {
  const { token } = theme.useToken();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 0 : 10, minWidth: 0 }}>
      <img
        src="/logo.png"
        alt={BRAND.name}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          objectFit: 'contain',
        }}
      />
      {showText && (
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: color || token.colorText,
            fontSize: textSize,
            fontWeight: 500,
            letterSpacing: '0.22em',
            fontFamily: 'var(--font-editorial)',
          }}
        >
          {BRAND.name}
        </span>
      )}
    </div>
  );
}
