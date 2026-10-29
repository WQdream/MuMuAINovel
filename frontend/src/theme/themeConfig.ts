import type { ThemeConfig } from 'antd';
import { theme } from 'antd';
import type { ThemeMode } from './themeStorage';

export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;

const sharedToken: ThemeConfig['token'] = {
  colorPrimary: '#1B1A17',
  borderRadius: 2,
  borderRadiusLG: 4,
  borderRadiusSM: 2,
  wireframe: false,
  fontFamily: "'Avenir Next', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
  colorInfo: '#56636B',
  colorSuccess: '#55704F',
  colorWarning: '#A7803F',
  colorError: '#A4473A',
  boxShadow: '0 1px 2px rgba(20, 18, 14, 0.04), 0 18px 40px -18px rgba(20, 18, 14, 0.22)',
  boxShadowSecondary: '0 1px 2px rgba(20, 18, 14, 0.04), 0 18px 40px -18px rgba(20, 18, 14, 0.22)',
};

const sharedComponents: ThemeConfig['components'] = {
  Button: {
    borderRadius: 2,
    controlHeight: 36,
    fontWeight: 500,
    primaryShadow: 'none',
    defaultShadow: 'none',
    dangerShadow: 'none',
  },
  Card: {
    borderRadiusLG: 4,
  },
  Tabs: {
    inkBarColor: '#9C7A4B',
    titleFontSize: 14,
  },
  Tag: {
    borderRadiusSM: 2,
  },
  Tooltip: {
    colorBgSpotlight: '#1F1F1D',
  },
};

const lightThemeConfig: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    ...sharedToken,
    colorBgBase: '#F5F2EC',
    colorTextBase: '#1F1E1B',
    colorBgLayout: '#F5F2EC',
    colorBgContainer: '#FBFAF7',
    colorBorder: '#DCD5C8',
    colorBorderSecondary: '#E7E1D6',
    colorPrimaryBg: '#ECE7DE',
    colorPrimaryBgHover: '#E2DBCF',
    colorPrimaryBorder: '#CFC6B6',
    colorPrimaryBorderHover: '#B9AE9A',
    colorLink: '#7E6238',
    colorLinkHover: '#9C7A4B',
  },
  components: {
    ...sharedComponents,
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: '#5C574E',
      itemHoverColor: '#1B1A17',
      itemHoverBg: 'rgba(27, 26, 23, 0.04)',
      itemSelectedBg: 'rgba(156, 122, 75, 0.1)',
      itemSelectedColor: '#1B1A17',
      itemActiveBg: 'rgba(156, 122, 75, 0.14)',
      groupTitleColor: '#9A9387',
      itemBorderRadius: 2,
    },
    Layout: {
      bodyBg: '#F5F2EC',
      headerBg: '#FBFAF7',
      siderBg: '#FBFAF7',
    },
  },
};

const darkThemeConfig: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...sharedToken,
    colorPrimary: '#E9E3D6',
    colorPrimaryHover: '#F5F0E6',
    colorPrimaryActive: '#D3CBBB',
    colorTextLightSolid: '#141311',
    colorBgBase: '#121211',
    colorTextBase: '#ECE6DA',
    colorBgLayout: '#121211',
    colorBgContainer: '#1A1917',
    colorBorder: '#34312B',
    colorBorderSecondary: '#2A2824',
    colorPrimaryBg: '#25231F',
    colorPrimaryBgHover: '#2F2C27',
    colorPrimaryBorder: '#423E36',
    colorPrimaryBorderHover: '#554F45',
    colorInfo: '#8C9AA2',
    colorSuccess: '#7F9B78',
    colorWarning: '#C9A15E',
    colorError: '#C46A5B',
    colorLink: '#C9A96E',
    colorLinkHover: '#DCC08A',
  },
  components: {
    ...sharedComponents,
    Tabs: {
      inkBarColor: '#C9A96E',
      titleFontSize: 14,
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: 'rgba(236, 230, 218, 0.66)',
      itemHoverColor: '#F3EEE4',
      itemHoverBg: 'rgba(236, 230, 218, 0.05)',
      itemSelectedBg: 'rgba(201, 169, 110, 0.12)',
      itemSelectedColor: '#F3EEE4',
      itemActiveBg: 'rgba(201, 169, 110, 0.18)',
      groupTitleColor: 'rgba(236, 230, 218, 0.38)',
      itemBorderRadius: 2,
    },
    Layout: {
      bodyBg: '#121211',
      headerBg: '#1A1917',
      siderBg: '#1A1917',
    },
  },
};

export const getThemeConfig = (mode: ResolvedThemeMode): ThemeConfig => {
  return mode === 'dark' ? darkThemeConfig : lightThemeConfig;
};
