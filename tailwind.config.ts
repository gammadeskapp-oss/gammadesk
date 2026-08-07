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
        /**
         * Directional votes use their own green/red family, deliberately kept
         * apart from the cyan/magenta used for dealer exposure. The two mean
         * different things — bullish/bearish versus positive/negative gamma —
         * and sharing a palette would invite conflating them.
         */
        bull: {
          DEFAULT: '#34d399',
          dim: '#065f46',
        },
        bear: {
          DEFAULT: '#f43f5e',
          dim: '#7f1d3a',
        },
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
