export interface BrandConfig {
  name: string;
  fullName: string;
  tagline: string;
  description: string;
  repoUrl: string;
  license: string;
  licenseUrl: string;
  upstream: {
    name: string;
    author: string;
    url: string;
  };
}

export const BRAND: BrandConfig = {
  name: '小新工坊',
  fullName: '小新工坊 · AI 创作工作台',
  tagline: '从灵感到定稿，把 AI 变成你的编辑团队',
  description: '围绕构思、搭建、写作与精修构建的一体化 AI 小说创作工作台。',
  repoUrl: '',
  license: 'GPL v3.0',
  licenseUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
  upstream: {
    name: 'MuMuAINovel',
    author: 'xiamuceer-j',
    url: 'https://github.com/xiamuceer-j/MuMuAINovel',
  },
};

export const BRAND_COPYRIGHT = `© ${new Date().getFullYear()} ${BRAND.name}`;

export const CREATION_STAGES = ['构思', '搭建', '写作', '精修'] as const;
