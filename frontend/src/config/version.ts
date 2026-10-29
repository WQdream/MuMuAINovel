/**
 * 应用版本信息配置
 * 版本号遵循语义化版本规范 (Semantic Versioning)
 *
 * 注意：版本号从 package.json 自动读取，无需手动维护
 */
import { BRAND } from './brand';

export const VERSION_INFO = {
  // 应用版本号（从 package.json 读取，构建时注入）
  version: import.meta.env.VITE_APP_VERSION || '1.5.7',
  
  // 构建时间（将在构建时由 Vite 注入）
  buildTime: import.meta.env.VITE_BUILD_TIME || new Date().toISOString().split('T')[0],
  
  // 项目信息
  projectName: BRAND.name,
  projectFullName: BRAND.fullName,
  
  // 链接信息
  repoUrl: BRAND.repoUrl,
  upstreamUrl: BRAND.upstream.url,
  
  // 许可证
  license: BRAND.license,
  licenseUrl: BRAND.licenseUrl,
};

/**
 * 获取格式化的版本信息
 */
export const getVersionString = () => {
  return `v${VERSION_INFO.version}`;
};

/**
 * 获取完整的版本描述
 */
export const getFullVersionInfo = () => {
  return `${VERSION_INFO.projectName} ${getVersionString()} - Build ${VERSION_INFO.buildTime}`;
};
