# Navidrome MCP Server - Essential Commands

## Package Management
**CRITICAL**: This project uses pnpm, NOT npm or yarn!

```bash
# Install dependencies
pnpm install

# Add new dependency
pnpm add <package-name>

# Add dev dependency  
pnpm add -D <package-name>
```

## Development Commands
```bash
# Development mode with hot reload
pnpm dev

# Build TypeScript to JavaScript
pnpm build

# Start production server
pnpm start

# Run in development with TypeScript directly
tsx src/index.ts
```

## Quality Assurance (MANDATORY)
These commands MUST be run and pass before any commit:

```bash
# Run all tests
pnpm test

# Run tests with UI
pnpm test:ui

# Run tests with coverage
pnpm test:coverage

# Lint TypeScript files (MUST have zero issues)
pnpm lint

# Auto-fix linting issues
pnpm lint:fix

# Type checking (MUST have zero errors)
pnpm typecheck

# Format code
pnpm format

# Check formatting
pnpm format:check
```

## MCP Testing Commands
```bash
# Build and test with MCP Inspector
pnpm build && pnpm inspector

# Test with development files (no build needed)
pnpm inspector:dev

# Manual CLI testing examples
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
npx @modelcontextprotocol/inspector --cli node dist/index.js --method resources/list
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/call --tool-name test_connection
```

## System Commands (Linux)
```bash
# File operations
ls -la          # List files with details
find . -name    # Find files by name
grep -r         # Search in files recursively
cd              # Change directory

# Git operations
git status      # Check repository status
git add .       # Stage all changes
git commit -m   # Commit with message
git push        # Push to remote
git pull        # Pull from remote

# Process management
ps aux          # List running processes
kill -9 <pid>   # Force kill process
```

## Environment Setup
```bash
# Copy example environment file
cp .env.example .env

# Edit environment variables
nano .env       # or use your preferred editor
```

## Testing Workflow
1. `pnpm build` - Build the project
2. `pnpm test` - Run all tests (must pass)
3. `pnpm lint` - Check code style (must be zero issues)  
4. `pnpm typecheck` - Verify types (must be zero errors)
5. `pnpm inspector` - Test MCP functionality