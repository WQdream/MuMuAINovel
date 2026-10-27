import type { ThemeConfig } from 'antd';
import { theme } from 'antd';
import type { ThemeMode } from './themeStorage';

export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;

const sharedToken: ThemeConfig['token'] = {
  colorPrimary: '#1F1F1B',
  borderRadius: 8,
  wireframe: false,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
};

const sharedComponents: ThemeConfig['components'] = {
  Button: {
    borderRadius: 8,
    controlHeight: 36,
  },
  Card: {
    borderRadiusLG: 12,
  },
  Tooltip: {
    colorBgSpotlight: sharedToken.colorPrimary,
  },
};

const lightThemeConfig: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    ...sharedToken,
    colorBgBase: '#F6F6F2',
    colorTextBase: '#2B2B2B',
    colorBgLayout: '#F6F6F2',
    colorBgContainer: '#FFFFFF',
    colorPrimaryBg: '#E9E8E1',
    colorPrimaryBgHover: '#DEDDD4',
    colorPrimaryBorder: '#CFCEC4',
    colorPrimaryBorderHover: '#B9B8AD',
  },
  components: {
    ...sharedComponents,
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: '#4A4A45',
      itemHoverColor: '#1F1F1B',
      itemHoverBg: 'rgba(31, 31, 27, 0.06)',
      itemSelectedBg: '#E9E8E1',
      itemSelectedColor: '#1F1F1B',
      itemActiveBg: '#DBDAD2',
      groupTitleColor: '#8C8C84',
    },
    Layout: {
      bodyBg: '#F6F6F2',
      headerBg: '#FFFFFF',
      siderBg: '#FFFFFF',
    },
  },
};

const darkThemeConfig: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...sharedToken,
    colorBgBase: '#141414',
    colorTextBase: '#f5f5f5',
    colorPrimaryBg: '#2A2A27',
    colorPrimaryBgHover: '#353530',
    colorPrimaryBorder: '#3D3D37',
    colorPrimaryBorderHover: '#4A4A43',
  },
  components: {
    ...sharedComponents,
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: 'rgba(245, 245, 245, 0.72)',
      itemHoverColor: '#F5F5F5',
      itemHoverBg: 'rgba(255, 255, 255, 0.08)',
      itemSelectedBg: 'rgba(246, 246, 242, 0.16)',
      itemSelectedColor: '#F6F6F2',
      itemActiveBg: 'rgba(255, 255, 255, 0.24)',
      groupTitleColor: 'rgba(245, 245, 245, 0.45)',
    },
    Layout: {
      bodyBg: '#0f1115',
      headerBg: '#141414',
      siderBg: '#141414',
    },
  },
};

export const getThemeConfig = (mode: ResolvedThemeMode): ThemeConfig => {
  return mode === 'dark' ? darkThemeConfig : lightThemeConfig;
};
