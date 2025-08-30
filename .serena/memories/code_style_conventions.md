# Navidrome MCP Server - Code Style and Conventions

## TypeScript Configuration
- **Strict Mode**: Enabled with comprehensive strict checks
- **Target**: ES2022 with NodeNext module resolution
- **Additional Checks**: 
  - `noUnusedLocals` and `noUnusedParameters`
  - `noImplicitReturns` and `noFallthroughCasesInSwitch`
  - `noUncheckedIndexedAccess`
  - `exactOptionalPropertyTypes`
  - `noPropertyAccessFromIndexSignature`

## ESLint Rules
- **TypeScript Rules**: 
  - `explicit-function-return-type`: Required for all functions
  - `no-explicit-any`: Banned - use proper types
  - `no-unused-vars`: Error (with `_` prefix exception)
  - `consistent-type-imports`: Required
  - `no-non-null-assertion`: Banned
- **General Rules**:
  - `no-console`: Warning (except error/warn)
  - `prefer-const` and `no-var`: Required
  - `object-shorthand` and `prefer-template`: Required

## Prettier Configuration
- **Print Width**: 100 characters
- **Indentation**: 2 spaces (no tabs)
- **Quotes**: Single quotes for strings
- **Semicolons**: Always required
- **Trailing Commas**: ES5 style
- **Line Endings**: LF (Unix style)

## Naming Conventions
- **Files**: kebab-case (e.g., `navidrome-client.ts`)
- **Functions/Variables**: camelCase
- **Classes**: PascalCase
- **Constants**: UPPER_SNAKE_CASE
- **Types/Interfaces**: PascalCase
- **Private Properties**: Leading underscore (e.g., `_privateMethod`)

## Code Organization Patterns
- **Imports**: Type imports use `import type` syntax
- **Error Handling**: Custom error classes with meaningful messages
- **Configuration**: Zod schemas for validation
- **API Client**: Separated concerns with auth manager
- **Tools**: Each tool in separate file with clear responsibilities
- **Resources**: URI-based resource identification

## Documentation Requirements
- **License Headers**: AGPL-3.0 header in all source files
- **Function Comments**: JSDoc for public APIs
- **Type Definitions**: Comprehensive TypeScript types
- **README**: Comprehensive setup and usage documentation

## Security Practices
- **No Credentials in Code**: Use environment variables
- **No Logging Sensitive Data**: Redact passwords and tokens
- **Input Validation**: Zod schemas for all external inputs
- **Token Management**: Automatic refresh with secure storage