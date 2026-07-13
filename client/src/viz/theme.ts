import { EXPENSE_CATEGORIES, ExpenseCategory } from '@finance/shared';

export interface VizTheme {
  surface: string;
  ink: string;
  inkSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  series: string[];
}

// Validated palette (CVD-safe in this slot order — never reorder or cycle).
const LIGHT: VizTheme = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  inkSecondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  series: [
    '#2a78d6',
    '#1baf7a',
    '#eda100',
    '#008300',
    '#4a3aa7',
    '#e34948',
    '#e87ba4',
    '#eb6834',
  ],
};

const DARK: VizTheme = {
  surface: '#1a1a19',
  ink: '#ffffff',
  inkSecondary: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  series: [
    '#3987e5',
    '#199e70',
    '#c98500',
    '#008300',
    '#9085e9',
    '#e66767',
    '#d55181',
    '#d95926',
  ],
};

export function vizTheme(): VizTheme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? DARK
    : LIGHT;
}

// Category identity is stable: EXPENSE_CATEGORIES index -> series slot.
export function categoryColor(
  category: ExpenseCategory,
  theme: VizTheme,
): string {
  const idx = EXPENSE_CATEGORIES.indexOf(category);
  return theme.series[idx % theme.series.length];
}
