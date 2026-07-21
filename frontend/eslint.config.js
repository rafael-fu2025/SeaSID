// ESLint flat config for the SeaSID frontend.
//
// Run it from the frontend/ directory:
//
//   npm run lint            # report problems (validation gate)
//   npm run lint -- --fix   # apply the auto-fixable subset
//
// Rules stay close to the Vite + React baseline: ESLint's recommended set plus
// react-hooks. `no-unused-vars` ignores PascalCase / underscore-prefixed names
// so JSX component imports and intentional throwaways don't false-positive
// (ESLint core does not track JSX element names). TypeScript files (.ts/.tsx)
// layer on the typescript-eslint recommended rules.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const vitestGlobals = {
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  vi: 'readonly',
};

const noUnusedVars = [
  'error',
  {
    varsIgnorePattern: '^[A-Z_]',
    argsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
    ignoreRestSiblings: true,
  },
];

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },

  // ── JavaScript / JSX ──────────────────────────────────────────────────────
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': noUnusedVars,
    },
  },

  // ── TypeScript (.ts / .tsx) ───────────────────────────────────────────────
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': noUnusedVars,
    },
  },

  // ── Test files run under Vitest globals ───────────────────────────────────
  {
    files: ['**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: { globals: vitestGlobals },
  },
);
