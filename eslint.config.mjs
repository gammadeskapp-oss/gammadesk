import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * Flat config. Next.js 16 removed `next lint`, so linting runs through the
 * ESLint CLI directly (`npm run lint`).
 */
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  ...coreWebVitals,
  ...typescript,
  {
    // The verification harness is intentionally dependency-free ES5-style
    // JavaScript so it runs on any Node version, including one too old to
    // build the app itself.
    files: ['scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { console: 'readonly', process: 'readonly' },
    },
    rules: {
      'no-var': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

export default config;
