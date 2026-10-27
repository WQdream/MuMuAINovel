/**
 * 文本模型服务商常量。
 *
 * 用户端「API 设置」与管理后台「API 配置」共用同一份定义，
 * 避免两处分别维护 provider 列表导致行为不一致。
 */
/**
 * MiMo 已从新建配置的可选项下线，仅保留运行时兼容识别，
 * 避免已有 xiaomi_mimo 配置在编辑时被当成普通 OpenAI 配置。
 */
export const builtInKeyProviders = ['xiaomi_mimo'];

export interface TextApiProvider {
  value: string;
  label: string;
  defaultUrl: string;
  defaultModel?: string;
}

export const textApiProviders: TextApiProvider[] = [
  { value: 'openai', label: 'OpenAI Compatible', defaultUrl: 'https://api.openai.com/v1' },
  { value: 'gemini', label: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta' },
];
