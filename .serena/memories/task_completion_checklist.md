# Navidrome MCP Server - Task Completion Checklist

## MANDATORY Quality Checks
**AFTER EVERY CODE CHANGE, YOU MUST:**

### 1. Test Suite (MUST PASS 100%)
```bash
pnpm test
```
- All tests must pass completely
- No skipped or failing tests allowed
- Fix any test failures before proceeding

### 2. Linting (ZERO ERRORS/WARNINGS)
```bash
pnpm lint
```
- Zero lint errors allowed
- Zero lint warnings allowed
- Use `pnpm lint:fix` for auto-fixable issues
- Manually fix remaining issues

### 3. Type Checking (ZERO TYPE ERRORS)
```bash
pnpm typecheck
```
- Zero TypeScript type errors allowed
- Fix all type mismatches and missing types
- Ensure strict type safety compliance

### 4. Code Formatting
```bash
pnpm format:check
```
- Code must be properly formatted
- Use `pnpm format` to auto-format if needed
- Ensure consistent styling across codebase

## Pre-Commit Requirements
Before any git commit, ensure:
- [ ] All tests pass (`pnpm test`)
- [ ] Zero lint issues (`pnpm lint`)
- [ ] Zero type errors (`pnpm typecheck`)
- [ ] Code is formatted (`pnpm format:check`)
- [ ] Build succeeds (`pnpm build`)

## MCP Functionality Testing
After code changes affecting MCP functionality:
```bash
# Build and test
pnpm build
pnpm inspector

# Test specific tools/resources
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
npx @modelcontextprotocol/inspector --cli node dist/index.js --method resources/list
```

## Code Quality Standards
- **Zero Tolerance Policy**: No lint errors, no warnings, no type errors
- **Clean Commits**: Every commit must pass all quality checks
- **No Placeholder Code**: Remove all TODOs and placeholder comments
- **Production Ready**: Every file must be production-quality
- **Test Coverage**: All new code must have corresponding tests

## Integration Testing
For API-related changes:
- Test against live Navidrome server (192.168.86.100:4533)
- Verify authentication and token refresh
- Test error handling and edge cases
- Validate response parsing and type safety

## Documentation Updates
When adding new features:
- Update tool descriptions for natural language usage
- Add examples to README if applicable
- Update type definitions and interfaces
- Maintain code comments and JSDoc

## Environment Verification
- Ensure `.env` file is properly configured
- Test with actual Navidrome server connection
- Verify all required environment variables are set
- Test both development and production builds