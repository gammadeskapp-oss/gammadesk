import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        term: {
          bg: '#05070b',
          panel: '#0a0e15',
          raised: '#0f141d',
          line: '#1a2230',
          edge: '#26303f',
          text: '#c8d6e5',
          dim: '#7b8b9f',
          faint: '#4d5a6b',
        },
        pos: {
          DEFAULT: '#22d3ee',
          soft: '#0e7490',
        },
        neg: {
          DEFAULT: '#ff3fb4',
          soft: '#9d1e6b',
        },
        flip: '#facc15',
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'JetBrains Mono',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
    },
  },
  plugins: [],
};

export default config;
