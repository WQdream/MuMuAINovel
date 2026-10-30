export interface EditorialPalette {
  paper: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  ink: string;
  muted: string;
  subtle: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentFaint: string;
  gold: string;
  rule: string;
  ruleStrong: string;
  shadow: string;
  cardShadow: string;
  nav: string;
  navRaised: string;
  navText: string;
  navMuted: string;
  navGroup: string;
  navRule: string;
  navHover: string;
  navSelected: string;
  navSelectedBorder: string;
  navAccent: string;
  navControl: string;
  navControlActive: string;
  tooltip: string;
}

const lightPalette: EditorialPalette = {
  paper: '#F3EEE4',
  surface: '#FFFAF2',
  surfaceRaised: '#FFFCF7',
  surfaceMuted: '#F8EDDD',
  ink: '#30261A',
  muted: '#6A5944',
  subtle: '#98866D',
  accent: '#A56A29',
  accentStrong: '#88521B',
  accentSoft: 'rgba(165, 106, 41, 0.12)',
  accentFaint: 'rgba(165, 106, 41, 0.055)',
  gold: '#C49451',
  rule: '#E2D4BF',
  ruleStrong: '#D5C1A4',
  shadow: '0 1px 2px rgba(80, 55, 20, 0.04), 0 24px 60px -34px rgba(80, 55, 20, 0.34)',
  cardShadow: '0 1px 2px rgba(80, 55, 20, 0.045), 0 24px 56px -36px rgba(80, 55, 20, 0.38)',
  nav: '#ECE4D5',
  navRaised: '#F5EDDF',
  navText: '#382D21',
  navMuted: 'rgba(56, 45, 33, 0.72)',
  navGroup: '#897A64',
  navRule: 'rgba(102, 78, 42, 0.15)',
  navHover: 'rgba(124, 88, 42, 0.055)',
  navSelected: 'rgba(245, 224, 190, 0.82)',
  navSelectedBorder: 'rgba(156, 101, 39, 0.25)',
  navAccent: '#9A6224',
  navControl: 'rgba(86, 64, 34, 0.045)',
  navControlActive: 'rgba(255, 252, 245, 0.82)',
  tooltip: '#3A2D20',
};

const darkPalette: EditorialPalette = {
  paper: '#0E0C0A',
  surface: '#181512',
  surfaceRaised: '#1E1914',
  surfaceMuted: '#1D1915',
  ink: '#ECE3D4',
  muted: '#A99D8B',
  subtle: '#7F725F',
  accent: '#D3AB6B',
  accentStrong: '#E1C38B',
  accentSoft: 'rgba(211, 171, 107, 0.14)',
  accentFaint: 'rgba(211, 171, 107, 0.065)',
  gold: '#D3AB6B',
  rule: '#3A2E22',
  ruleStrong: '#4A3A2A',
  shadow: '0 1px 2px rgba(0, 0, 0, 0.26), 0 24px 60px -32px rgba(0, 0, 0, 0.82)',
  cardShadow: '0 1px 2px rgba(0, 0, 0, 0.28), 0 28px 64px -36px rgba(0, 0, 0, 0.94)',
  nav: '#0B0907',
  navRaised: '#15110D',
  navText: '#F2E9DA',
  navMuted: 'rgba(242, 233, 218, 0.68)',
  navGroup: 'rgba(242, 233, 218, 0.48)',
  navRule: 'rgba(214, 178, 116, 0.13)',
  navHover: 'rgba(242, 233, 218, 0.055)',
  navSelected: 'rgba(211, 171, 107, 0.12)',
  navSelectedBorder: 'rgba(211, 171, 107, 0.24)',
  navAccent: '#D3AB6B',
  navControl: 'rgba(242, 233, 218, 0.035)',
  navControlActive: 'rgba(242, 233, 218, 0.09)',
  tooltip: '#E1C38B',
};

export const getEditorialPalette = (mode: 'light' | 'dark'): EditorialPalette => {
  return mode === 'dark' ? darkPalette : lightPalette;
};
