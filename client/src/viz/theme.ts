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
  return DARK;
}

// Category identity is stable: EXPENSE_CATEGORIES index -> series slot.
export function categoryColor(
  category: ExpenseCategory,
  theme: VizTheme,
): string {
  const idx = EXPENSE_CATEGORIES.indexOf(category);
  return theme.series[idx % theme.series.length];
}
