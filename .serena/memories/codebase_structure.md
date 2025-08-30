# Navidrome MCP Server - Codebase Structure

## Directory Structure
```
/
├── src/                    # TypeScript source code
│   ├── client/            # Navidrome API client
│   │   ├── auth-manager.ts    # JWT token management
│   │   ├── navidrome-client.ts # Main API client
│   │   ├── endpoints/         # API endpoint definitions
│   │   └── types/            # TypeScript type definitions
│   ├── tools/             # MCP tool implementations
│   │   ├── index.ts          # Tool registration
│   │   ├── test.ts           # Connection testing tools
│   │   └── library.ts        # Library management tools
│   ├── resources/         # MCP resource providers
│   │   └── index.ts          # Resource definitions and handlers
│   ├── utils/             # Utility functions
│   │   ├── logger.ts         # Logging utilities
│   │   └── cache.ts          # Caching utilities
│   ├── index.ts           # Main entry point
│   ├── config.ts          # Configuration management
│   └── capabilities.ts    # MCP server capabilities
├── tests/                 # Test files
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   └── mocks/            # Test mocks
├── docs/                 # Documentation
├── scripts/              # Build and utility scripts
└── dist/                 # Compiled JavaScript output
```

## Key Files
- `src/index.ts`: Main server entry point, initializes MCP server
- `src/config.ts`: Environment configuration with Zod validation
- `src/client/navidrome-client.ts`: Core API client for Navidrome
- `src/client/auth-manager.ts`: JWT token management and refresh
- `src/tools/index.ts`: MCP tools registration
- `src/resources/index.ts`: MCP resources registration
- `package.json`: Project metadata and scripts (uses pnpm)
- `tsconfig.json`: TypeScript configuration (strict mode)
- `eslint.config.js`: ESLint configuration
- `vitest.config.ts`: Test configuration
- `.prettierrc.json`: Code formatting configuration

## Architecture Patterns
- **Clean Architecture**: Separation between API client, MCP tools, and utilities
- **Type Safety**: Strict TypeScript with comprehensive type definitions
- **Error Handling**: Custom error classes with context preservation
- **Caching**: Intelligent caching to minimize API calls
- **Authentication**: Automatic JWT token refresh
- **Validation**: Zod schemas for all inputs and configuration