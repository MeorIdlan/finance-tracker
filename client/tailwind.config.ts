import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#16161a',
        surface: '#1a1a19',
        'surface-raised': '#232327',
        border: '#2c2c2f',
        muted: '#6b6b6f',
        ink: '#e8e8e6',
        accent: '#3987e5',
        danger: '#e66767',
        warning: '#c98500',
        success: '#199e70',
        series: {
          1: '#3987e5',
          2: '#199e70',
          3: '#c98500',
          4: '#008300',
          5: '#9085e9',
          6: '#e66767',
          7: '#d55181',
          8: '#d95926',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
