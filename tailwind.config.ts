import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /*
       * Every colour points at a CSS variable defined in globals.css, in the
       * `rgb(... / <alpha-value>)` form so opacity modifiers keep working.
       * Change the palette there, not here.
       */
      colors: {
        term: {
          bg: 'rgb(var(--c-bg) / <alpha-value>)',
          panel: 'rgb(var(--c-panel) / <alpha-value>)',
          raised: 'rgb(var(--c-raised) / <alpha-value>)',
          line: 'rgb(var(--c-line) / <alpha-value>)',
          edge: 'rgb(var(--c-edge) / <alpha-value>)',
          text: 'rgb(var(--c-text) / <alpha-value>)',
          dim: 'rgb(var(--c-dim) / <alpha-value>)',
          faint: 'rgb(var(--c-faint) / <alpha-value>)',
        },
        /** Brand amber: chrome, and the warm end of the gamma scale. */
        pos: 'rgb(var(--c-brand) / <alpha-value>)',
        /** Cool end of the gamma scale. */
        neg: 'rgb(var(--c-cool) / <alpha-value>)',
        /** Flip level, and caveat/warning text. Same amber as the brand. */
        flip: 'rgb(var(--c-brand) / <alpha-value>)',
        /** The gamma flip line on the strike profile — neither gamma colour. */
        level: 'rgb(var(--c-level) / <alpha-value>)',
        /**
         * Directional votes use their own green/red family, deliberately kept
         * apart from the cyan/magenta used for dealer exposure. The two mean
         * different things — bullish/bearish versus positive/negative gamma —
         * and sharing a palette would invite conflating them.
         */
        bull: 'rgb(var(--c-bull) / <alpha-value>)',
        bear: 'rgb(var(--c-bear) / <alpha-value>)',
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
