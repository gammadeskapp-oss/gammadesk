import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * Flat config. Next.js 16 removed `next lint`, so linting runs through the
 * ESLint CLI directly (`npm run lint`).
 */
const config = [
  {
    /*
     * `**` prefixes so build output is ignored wherever it sits, not only at
     * the repo root: the Claude harness checks other sessions out into
     * `.claude/worktrees/*`, each with its own generated `.next`, and a bare
     * `.next/**` matches none of them — so `eslint .` was linting tens of
     * thousands of lines of compiled turbopack chunks from other branches.
     */
    ignores: ['**/.next/**', '**/node_modules/**', '.claude/**', 'next-env.d.ts'],
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
