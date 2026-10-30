import type { ThemeConfig } from 'antd';
import { theme } from 'antd';
import type { ThemeMode } from './themeStorage';
import { getEditorialPalette } from './themePalette';

export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;

const sharedToken: ThemeConfig['token'] = {
  borderRadius: 7,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  wireframe: false,
  fontFamily: "'Avenir Next', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
};

const createThemeConfig = (mode: ResolvedThemeMode): ThemeConfig => {
  const palette = getEditorialPalette(mode);
  const isDark = mode === 'dark';

  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      ...sharedToken,
      colorPrimary: palette.accent,
      colorPrimaryHover: palette.accentStrong,
      colorPrimaryActive: isDark ? '#BE9658' : '#744514',
      colorPrimaryBg: isDark ? 'rgba(211, 171, 107, 0.1)' : '#F5E7D2',
      colorPrimaryBgHover: isDark ? 'rgba(211, 171, 107, 0.15)' : '#EFDCC1',
      colorPrimaryBorder: isDark ? 'rgba(211, 171, 107, 0.32)' : '#D9BC8E',
      colorPrimaryBorderHover: isDark ? 'rgba(225, 195, 139, 0.5)' : '#C39A60',
      colorPrimaryText: palette.accent,
      colorPrimaryTextHover: palette.accentStrong,
      colorTextLightSolid: isDark ? '#1A130B' : '#FFF9F1',
      colorBgBase: palette.paper,
      colorTextBase: palette.ink,
      colorBgLayout: palette.paper,
      colorBgContainer: palette.surface,
      colorBgElevated: palette.surfaceRaised,
      colorBgSpotlight: palette.tooltip,
      colorText: palette.ink,
      colorTextSecondary: palette.muted,
      colorTextTertiary: palette.subtle,
      colorTextQuaternary: isDark ? '#685D4E' : '#B3A58F',
      colorBorder: palette.ruleStrong,
      colorBorderSecondary: palette.rule,
      colorFill: isDark ? 'rgba(236, 227, 212, 0.12)' : 'rgba(95, 73, 42, 0.11)',
      colorFillSecondary: isDark ? 'rgba(236, 227, 212, 0.08)' : 'rgba(95, 73, 42, 0.075)',
      colorFillTertiary: isDark ? 'rgba(236, 227, 212, 0.055)' : 'rgba(95, 73, 42, 0.052)',
      colorFillQuaternary: isDark ? 'rgba(236, 227, 212, 0.035)' : 'rgba(95, 73, 42, 0.034)',
      colorLink: palette.accent,
      colorLinkHover: palette.accentStrong,
      colorLinkActive: isDark ? '#BE9658' : '#744514',
      colorInfo: isDark ? '#91A6AF' : '#657981',
      colorSuccess: isDark ? '#86A47D' : '#587653',
      colorWarning: isDark ? '#D5AB65' : '#A97831',
      colorError: isDark ? '#D07A6B' : '#A84D41',
      boxShadow: palette.shadow,
      boxShadowSecondary: palette.shadow,
      controlOutline: palette.accentSoft,
    },
    components: {
      Button: {
        borderRadius: 7,
        controlHeight: 36,
        fontWeight: 500,
        primaryColor: isDark ? '#1A130B' : '#FFF9F1',
        solidTextColor: isDark ? '#1A130B' : '#FFF9F1',
        defaultColor: palette.muted,
        defaultBg: palette.surfaceRaised,
        defaultBorderColor: palette.ruleStrong,
        defaultHoverColor: palette.ink,
        defaultHoverBg: palette.surface,
        defaultHoverBorderColor: palette.accent,
        defaultActiveColor: palette.ink,
        defaultActiveBg: palette.surfaceMuted,
        defaultActiveBorderColor: palette.accentStrong,
        textTextColor: palette.muted,
        textTextHoverColor: palette.ink,
        textHoverBg: palette.accentFaint,
        linkHoverBg: 'transparent',
        primaryShadow: isDark
          ? '0 12px 24px -18px rgba(0, 0, 0, 0.9)'
          : '0 12px 24px -16px rgba(112, 68, 18, 0.62)',
        defaultShadow: 'none',
        dangerShadow: 'none',
      },
      Card: {
        headerBg: 'transparent',
        actionsBg: 'transparent',
        bodyPadding: 22,
        bodyPaddingSM: 16,
        headerPadding: 20,
        headerPaddingSM: 14,
        extraColor: palette.muted,
      },
      Input: {
        hoverBorderColor: palette.accent,
        activeBorderColor: palette.accent,
        activeShadow: `0 0 0 3px ${palette.accentSoft}`,
        hoverBg: palette.surfaceRaised,
        activeBg: palette.surfaceRaised,
        addonBg: palette.surfaceMuted,
      },
      Select: {
        selectorBg: palette.surfaceRaised,
        optionSelectedBg: palette.accentSoft,
        optionActiveBg: palette.accentFaint,
        optionSelectedColor: palette.ink,
        optionSelectedFontWeight: 500,
        hoverBorderColor: palette.accent,
        activeBorderColor: palette.accent,
        activeOutlineColor: palette.accentSoft,
      },
      Menu: {
        itemBg: 'transparent',
        subMenuItemBg: 'transparent',
        itemColor: palette.navMuted,
        itemHoverColor: palette.navText,
        itemHoverBg: palette.navHover,
        itemSelectedBg: palette.navSelected,
        itemSelectedColor: palette.navText,
        itemActiveBg: palette.navSelected,
        groupTitleColor: palette.navGroup,
        groupTitleFontSize: 10,
        itemBorderRadius: 8,
        itemMarginInline: 12,
        itemMarginBlock: 3,
        itemHeight: 40,
        activeBarWidth: 0,
        activeBarBorderWidth: 0,
      },
      Layout: {
        bodyBg: palette.paper,
        headerBg: palette.surface,
        siderBg: palette.nav,
      },
      Tabs: {
        inkBarColor: palette.accent,
        itemColor: palette.muted,
        itemHoverColor: palette.ink,
        itemSelectedColor: palette.ink,
        titleFontSize: 14,
        horizontalItemGutter: 28,
      },
      Tag: {
        defaultBg: palette.accentFaint,
        defaultColor: palette.muted,
        borderRadiusSM: 999,
      },
      Table: {
        headerBg: palette.surfaceMuted,
        headerColor: palette.muted,
        headerSplitColor: palette.rule,
        borderColor: palette.rule,
        rowHoverBg: palette.accentFaint,
        rowSelectedBg: palette.accentSoft,
        rowSelectedHoverBg: palette.accentSoft,
        headerBorderRadius: 8,
      },
      Modal: {
        contentBg: palette.surface,
        headerBg: palette.surface,
        footerBg: 'transparent',
        titleColor: palette.ink,
      },
    },
  };
};

export const getThemeConfig = (mode: ResolvedThemeMode): ThemeConfig => {
  return createThemeConfig(mode);
};
