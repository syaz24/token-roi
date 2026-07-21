import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#08080C',
        panel: 'rgb(17 17 23 / <alpha-value>)',
        raised: 'rgb(23 23 30 / <alpha-value>)',
        hair: 'rgba(255,255,255,0.10)',
        hairStrong: 'rgba(255,255,255,0.16)',
        ink: '#F4F4F5',
        ink2: '#A1A1AA',
        ink3: '#71717A',
        pos: '#34D399',
        neg: '#F87171',
        warn: '#FBBF24',
        info: '#60A5FA',
        roi: '#A78BFA',
        alt1: '#22D3EE',
        alt2: '#FB923C',
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', '"SF Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
      },
      borderRadius: { panel: '10px' },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 18px 40px -24px rgba(0,0,0,0.9)',
      },
    },
  },
  plugins: [],
};

export default config;
