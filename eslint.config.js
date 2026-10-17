import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import unicorn from 'eslint-plugin-unicorn';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  prettier,
  {
    // Stale eslint-disable directives are a hard failure (e.g. once a lying type is
    // fixed, its suppression must go), since a stale disable would hide a later violation.
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        RequestInit: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      unicorn,
      '@eslint-community/eslint-comments': eslintComments,
    },
    rules: {
      // Every eslint-disable must carry a `-- <reason>` (last-resort suppressions
      // must state why they are needed).
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      // Type-aware rules catch unsafe `any` flow and unnecessary assertions without a review pass.
      ...typescript.configs['recommended-type-checked'].rules,

      // Rules that recommended-type-checked does not enable:
      '@typescript-eslint/no-unnecessary-condition': 'error',
      'unicorn/prefer-node-protocol': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      'eqeqeq': ['error', 'always'],

      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',

      '@typescript-eslint/no-unused-expressions': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      
      'no-throw-literal': 'error',
      
      'no-console': ['error', { allow: ['error', 'warn'] }], // console.log breaks MCP stdio
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'no-undef': 'off', // The TypeScript compiler reports undefined names.
    },
  },
  {
    // Tools and services receive configuration through the Config object, not env.
    // mpv-process.ts reads OS env such as PATH and XDG_RUNTIME_DIR, which is not configuration.
    files: ['src/tools/**/*.ts', 'src/services/**/*.ts'],
    ignores: ['src/services/playback/mpv-process.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Do not read process.env here — receive configuration through the Config object instead.',
        },
      ],
    },
  },
  {
    // tsconfig.json excludes tests/, so type-aware linting here uses tsconfig.analysis.json.
    files: ['tests/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.analysis.json',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      '@eslint-community/eslint-comments': eslintComments,
    },
    rules: {
      ...typescript.configs['recommended-type-checked'].rules,
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Mock objects are typed `any`, so the no-unsafe-* rules report only mock noise here.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-console': ['error', { allow: ['error', 'warn'] }],
      // TypeScript resolves names here, including the vitest globals that ESLint does not declare.
      'no-undef': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', '**/*.js', '**/*.mjs', 'eslint.config.js', 'src/webui/public/', 'src/config-app/public/'],
  },
];
