import { BRAND } from '../config/brand';
import { VERSION_INFO } from '../config/version';

export interface ChangelogEntry {
  id: string;
  date: string;
  version?: string;
  author: {
    name: string;
    avatar?: string;
    username?: string;
  };
  message: string;
  commitUrl?: string;
  type: 'feature' | 'fix' | 'docs' | 'style' | 'refactor' | 'perf' | 'test' | 'chore' | 'update' | 'other';
  scope?: string;
}

const RELEASE_DATE = VERSION_INFO.buildTime;
const RELEASE_AUTHOR = {
  name: BRAND.name,
  username: BRAND.name,
};

// 独立部署默认不读取上游仓库历史。这里维护当前产品自己的版本记录。
const LOCAL_CHANGELOG: ChangelogEntry[] = [
  {
    id: `release-${VERSION_INFO.version}-editorial-shell`,
    date: `${RELEASE_DATE}T09:00:00+08:00`,
    version: VERSION_INFO.version,
    author: RELEASE_AUTHOR,
    message: `作品库、项目工作台与登录页升级为“现代编辑部”视觉，保留全部创作流程与数据。`,
    commitUrl: BRAND.repoUrl || undefined,
    type: 'style',
    scope: '界面',
  },
  {
    id: `release-${VERSION_INFO.version}-chapter-polish`,
    date: `${RELEASE_DATE}T08:40:00+08:00`,
    version: VERSION_INFO.version,
    author: RELEASE_AUTHOR,
    message: '章节生成支持自动精修，精修台增加改写前后对照、命中分析和原文视图。',
    commitUrl: BRAND.repoUrl || undefined,
    type: 'feature',
    scope: '写作',
  },
  {
    id: `release-${VERSION_INFO.version}-cover-failure`,
    date: `${RELEASE_DATE}T08:20:00+08:00`,
    version: VERSION_INFO.version,
    author: RELEASE_AUTHOR,
    message: '封面生成失败后保留可见提示，支持重新生成、检查配置和手动关闭。',
    commitUrl: BRAND.repoUrl || undefined,
    type: 'fix',
    scope: '封面',
  },
];

export async function fetchChangelog(page: number = 1, perPage: number = 30): Promise<ChangelogEntry[]> {
  const start = Math.max(0, (page - 1) * perPage);
  return LOCAL_CHANGELOG.slice(start, start + perPage);
}

export function groupChangelogByDate(entries: ChangelogEntry[]): Map<string, ChangelogEntry[]> {
  const grouped = new Map<string, ChangelogEntry[]>();

  entries.forEach((entry) => {
    const date = new Date(entry.date).toISOString().split('T')[0];
    const existing = grouped.get(date) || [];
    existing.push(entry);
    grouped.set(date, existing);
  });

  return grouped;
}

export function shouldFetchChangelog(): boolean {
  return true;
}

export function markChangelogFetched(): void {
  localStorage.setItem('workshop_changelog_last_fetch', new Date().toISOString());
}

export function getCachedChangelog(): ChangelogEntry[] | null {
  const cached = localStorage.getItem('workshop_changelog_cache');
  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

export function cacheChangelog(entries: ChangelogEntry[]): void {
  localStorage.setItem('workshop_changelog_cache', JSON.stringify(entries));
}

export function clearChangelogCache(): void {
  localStorage.removeItem('workshop_changelog_cache');
  localStorage.removeItem('workshop_changelog_last_fetch');
}
