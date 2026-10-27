import React, { useEffect, useState } from 'react';
import { theme } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

interface SSELoadingOverlayProps {
  loading: boolean;
  progress: number;
  message: string;
}

interface GenerationErrorInfo {
  /** 卡片标题，例如「内容审核拦截」 */
  title: string;
  /** 下一步操作建议，与原始报错一并展示，不覆盖后端已给出的详细说明 */
  hint: string;
}

function formatGenerationError(message: string): GenerationErrorInfo | null {
  if (!message) return null;
  if (message.includes('内容审核') || message.includes('服务商拒绝') || message.includes('涉嫌违反')) {
    return {
      title: '内容审核拦截',
      hint: '服务商的内容安全策略拒绝了本次送审内容，重试无效。请在「设置 → API 设置」更换模型或服务商。'
    };
  }
  if (message.includes('模型不可用')) {
    return { title: '模型不可用', hint: '请在「设置 → API 设置」中重新选择可用模型。' };
  }
  if (message.includes('余额不足') || message.includes('Insufficient credits')) {
    return { title: '余额不足', hint: '请为当前 AI 账户充值，或在设置中更换可用模型。' };
  }
  if (message.includes('API Key') || message.includes('401')) {
    return { title: 'API Key 无效', hint: '请在「设置 → API 设置」中重新填写有效的 API Key。' };
  }
  return null;
}

export const SSELoadingOverlay: React.FC<SSELoadingOverlayProps> = ({
  loading,
  progress,
  message
}) => {
  const { token } = theme.useToken();
  const errorInfo = formatGenerationError(message);
  // 后端报错原文可能很长（含审核话术与链接），保留展示但限制高度，超出可滚动。
  const detailMessage = message.replace(/^生成失败：/, '');
  // 失败卡片不会自动消失，允许用户手动关闭；同一则提示关闭后保持隐藏，
  // 新的错误或新一轮生成（loading 再次为 true）会重新显示。
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (loading) setDismissedMessage(null);
  }, [loading]);

  // 仅在非生成中展示错误态，避免上一轮的报错文案盖掉新一轮生成的进度条。
  const errorVisible = !loading && Boolean(errorInfo) && dismissedMessage !== message;
  if (!loading && !errorVisible) return null;

  const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const isError = errorVisible;

  return (
    <div style={{
      position: 'fixed',
      right: 24,
      bottom: 84,
      width: 'min(360px, calc(100vw - 48px))',
      background: token.colorBgElevated,
      border: `1px solid ${isError ? token.colorErrorBorder : token.colorBorderSecondary}`,
      borderRadius: 12,
      boxShadow: token.boxShadowSecondary,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: '16px 18px',
      zIndex: 1001
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: errorVisible ? token.colorError : token.colorPrimary,
          flexShrink: 0
        }} />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: token.colorText }}>
          {errorVisible ? `AI 创作失败 · ${errorInfo!.title}` : 'AI 正在创作'}
        </div>
        {errorVisible ? (
          <button
            type="button"
            onClick={() => setDismissedMessage(message)}
            aria-label="关闭提示"
            style={{
              border: 'none',
              background: 'transparent',
              color: token.colorTextTertiary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: 2,
              margin: -2
            }}
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        ) : (
          <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: token.colorTextSecondary }}>
            {normalizedProgress}%
          </span>
        )}
      </div>

      {!errorVisible && (
        <div style={{
          height: 3,
          background: token.colorFillTertiary,
          borderRadius: 999,
          overflow: 'hidden'
        }}>
          <div style={{
            height: '100%',
            background: token.colorPrimary,
            width: `${normalizedProgress}%`,
            transition: 'width 0.35s ease',
            borderRadius: 999
          }} />
        </div>
      )}

      <div style={{
        fontSize: 12,
        lineHeight: 1.6,
        color: errorVisible ? token.colorText : token.colorTextSecondary,
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
        maxHeight: errorVisible ? 160 : undefined,
        overflowY: errorVisible ? 'auto' : undefined
      }}>
        {errorVisible ? detailMessage : message || '准备生成...'}
      </div>

      {!errorVisible && (
        <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
          生成完成后会自动保存，请保持页面打开
        </div>
      )}

      {errorVisible && (
        <div style={{
          fontSize: 11,
          lineHeight: 1.6,
          color: token.colorTextSecondary,
          background: token.colorFillQuaternary,
          borderRadius: 8,
          padding: '8px 10px'
        }}>
          {errorInfo!.hint}
        </div>
      )}
    </div>
  );
};
