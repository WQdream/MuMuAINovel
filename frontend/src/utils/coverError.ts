const MAX_COVER_ERROR_LENGTH = 500;
const COVER_FAILURE_DISMISS_PREFIX = 'mumu.cover-failure.dismissed:';

function stringifyErrorValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function truncateCoverError(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_COVER_ERROR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_COVER_ERROR_LENGTH)}…`;
}

export function extractCoverError(error: unknown): string {
  const candidate = error as {
    response?: { data?: unknown };
    message?: string;
  };
  const responseData = candidate?.response?.data;
  let detail = '';

  if (responseData && typeof responseData === 'object') {
    const record = responseData as Record<string, unknown>;
    detail = stringifyErrorValue(record.detail ?? record.message);
  }
  if (!detail) detail = stringifyErrorValue(responseData);
  if (!detail) detail = candidate?.message || '封面生成失败，请稍后重试';

  return truncateCoverError(detail);
}

export function formatCoverError(error?: string | null): string {
  const normalized = (error || '').replace(/\s+/g, ' ').trim();
  return normalized
    ? truncateCoverError(normalized)
    : '图片服务未返回具体原因，请检查图片模型配置后重试。';
}

export function isCoverRequestTimeout(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  return candidate?.code === 'ECONNABORTED' || /timeout/i.test(candidate?.message || '');
}

export function getCoverFailureDismissKey(projectId: string, coverError?: string | null): string {
  return `${projectId}:${formatCoverError(coverError)}`;
}

export function isCoverFailureDismissed(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(`${COVER_FAILURE_DISMISS_PREFIX}${key}`) === '1';
  } catch {
    return false;
  }
}

export function dismissCoverFailure(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${COVER_FAILURE_DISMISS_PREFIX}${key}`, '1');
  } catch {
    // localStorage may be unavailable in private browsing; the in-memory state still works.
  }
}

export function restoreCoverFailure(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${COVER_FAILURE_DISMISS_PREFIX}${key}`);
  } catch {
    // Ignore storage failures; a new generation attempt should still be allowed.
  }
}
