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
    // fixed, its suppression must be removed) — keeps suppressions honest over time.
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
      // — e.g. an intentional no-unnecessary-condition guard — must justify themselves).
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      // Type-aware ruleset — catches the mechanically-detectable defect classes the review
      // cycle was otherwise spending expensive LLM passes on (unsafe `any` flow, unnecessary
      // assertions/conditions, unsafe argument/return, etc.).
      ...typescript.configs['recommended-type-checked'].rules,

      // Targeted additions for finding-classes seen in review (not in recommended-type-checked):
      '@typescript-eslint/no-unnecessary-condition': 'error', // redundant !== null / always-truthy guards
      'unicorn/prefer-node-protocol': 'error',                // require node: prefix on builtin imports
      '@typescript-eslint/switch-exhaustiveness-check': 'error', // force every union/enum case (or default)
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error', // `x === true` → `x`
      'eqeqeq': ['error', 'always'],                          // ban ==/!= (AI sometimes introduces)

      // Type safety
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',

      // Dead code detection
      '@typescript-eslint/no-unused-expressions': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      
      // Async safety (critical for file I/O operations)
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      
      // Additional strictness
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      
      // Error handling
      'no-throw-literal': 'error',
      
      // General best practices
      'no-console': ['error', { allow: ['error', 'warn'] }], // console.log breaks MCP stdio
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'no-undef': 'off', // TypeScript handles this
    },
  },
  {
    // Config flows through the `Config` object, not env. Tools/services must not read
    // process.env directly (legit env reads live in config/, web/, utils/, services/playback).
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
    // Tests are AI-written too and feed the dead-code graph, but legitimately use `any`,
    // non-null assertions, etc. Type-aware via tsconfig.analysis.json (includes tests/).
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
      // Tests legitimately poke at `any`-typed mock objects; the no-unsafe-* family is
      // mock noise here (it stays enabled for src/, where `any` shouldn't appear).
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-undef': 'off', // TypeScript handles this; vitest globals aren't declared here
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', '**/*.js', '**/*.mjs', 'eslint.config.js', 'src/webui/public/', 'src/config-app/public/'],
  },
];
