export type CoverFailureCategory = 'auth' | 'timeout' | 'other';

const COVER_ERROR_COPY: Record<CoverFailureCategory, string> = {
  auth: '图像模型认证失败，请检查 API 密钥',
  timeout: '生成超时，请稍后重试',
  other: '封面生成失败，请检查图像模型配置',
};

export function getCoverErrorCopy(category?: string | null): string {
  if (category === 'auth' || category === 'timeout') {
    return COVER_ERROR_COPY[category];
  }
  return COVER_ERROR_COPY.other;
}

function collectErrorText(error: unknown): string {
  const candidate = error as {
    code?: string;
    message?: string;
    response?: {
      status?: number;
      data?: unknown;
    };
  };
  const parts = [candidate?.code, candidate?.message];

  try {
    parts.push(JSON.stringify(candidate?.response?.data));
  } catch {
    parts.push(String(candidate?.response?.data || ''));
  }

  return parts.filter(Boolean).join(' ').toLowerCase();
}

export function getCoverFailureCopy(error: unknown): string {
  const candidate = error as { response?: { status?: number } };
  const status = candidate?.response?.status;
  const text = collectErrorText(error);

  if (
    status === 401
    || status === 403
    || /unauthorized|authentication|api key|apikey|invalid key|permission denied|invalid token|token expired|bearer token|access token/.test(text)
  ) {
    return COVER_ERROR_COPY.auth;
  }
  if (
    status === 408
    || status === 504
    || /timeout|timed out|deadline exceeded|econnaborted/.test(text)
  ) {
    return COVER_ERROR_COPY.timeout;
  }
  return COVER_ERROR_COPY.other;
}
