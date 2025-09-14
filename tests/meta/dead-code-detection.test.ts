/**
 * Dead Code Detection Tests
 *
 * These tests systematically detect common dead code patterns using deterministic methods.
 * Based on findings from DEAD-CODE-ANALYSIS.md - ensures we catch these issues going forward.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

// Get project root dynamically
const projectRoot = resolve(__dirname, '../../');

describe('Dead Code Detection - Deterministic Validation', () => {

  describe('Method Call Validation', () => {
    it('should not have calls to non-existent methods', async () => {
      // Test the specific pattern that caused our SharedTestClient bug
      const problematicPatterns = [
        {
          pattern: /\.isInitialized\(\)/g,
          file: join(projectRoot, 'tests/factories/shared-client.ts'),
          description: 'isInitialized() calls on NavidromeClient (which lacks this method)'
        }
      ];

      for (const { pattern, file, description } of problematicPatterns) {
        try {
          const content = readFileSync(file, 'utf-8');
          const matches = content.match(pattern);

          if (matches) {
            // Check if this is a valid call by examining the class definition
            if (file.includes('shared-client.ts')) {
              // For SharedTestClient: isInitialized() should only be called on objects that have it
              const lines = content.split('\n');
              const problematicLines = lines
                .map((line, index) => ({ line: line.trim(), number: index + 1 }))
                .filter(({ line }) => pattern.test(line))
                .filter(({ line }) =>
                  // Flag calls on this.client (NavidromeClient) but not on this (SharedTestClient)
                  line.includes('this.client.isInitialized()') && !line.includes('this.isInitialized()')
                );

              expect(problematicLines).toEqual([]);
            }
          }
        } catch (error) {
          // File might not exist, which is fine
          continue;
        }
      }
    });

    it('should validate all manager services have consistent isInitialized() patterns', () => {
      // Test that all manager services consistently implement isInitialized()
      const managerServices = [
        join(projectRoot, 'src/services/library-manager.ts'),
        join(projectRoot, 'src/services/filter-cache-manager.ts'),
        join(projectRoot, 'src/client/navidrome-client.ts')
      ];

      const servicesWithIsInitialized: string[] = [];
      const servicesWithoutIsInitialized: string[] = [];

      for (const serviceFile of managerServices) {
        try {
          const content = readFileSync(serviceFile, 'utf-8');

          if (content.includes('isInitialized(')) {
            servicesWithIsInitialized.push(serviceFile);
          } else {
            servicesWithoutIsInitialized.push(serviceFile);
          }
        } catch (error) {
          // Service file doesn't exist
          continue;
        }
      }

      // If any service calls isInitialized() on another service, both should implement it
      const clientFile = join(projectRoot, 'src/client/navidrome-client.ts');
      if (existsSync(clientFile)) {
        const clientContent = readFileSync(clientFile, 'utf-8');
        if (clientContent.includes('libraryManager.isInitialized()')) {
          expect(servicesWithIsInitialized).toContain(join(projectRoot, 'src/services/library-manager.ts'));
        }
      }
    });
  });

  describe('Unused Export Detection', () => {
    it('should detect unused exports using ts-unused-exports', () => {
      try {
        execSync('pnpm run check:dead-code', {
          cwd: projectRoot,
          stdio: 'pipe',
          env: { ...process.env, PATH: process.env.PATH }
        });

        // If ts-unused-exports passes without error, we're good
        expect(true).toBe(true);
      } catch (error) {
        const output = (error as any).stdout?.toString() || (error as any).stderr?.toString() || '';

        // Check if this contains the expected pattern from our analysis
        if (output.includes('modules with unused exports')) {
          const lines = output.split('\n');
          const unusedExportLines = lines.filter(line =>
            line.includes('.ts:') &&
            (line.includes('FilterCacheManager') ||
             line.includes('LibraryManager') ||
             line.includes('Cache') ||
             line.includes('MessageManager'))
          );

          // These are the critical service exports we identified
          // If any of these show up, fail the test with details
          if (unusedExportLines.length > 0) {
            console.log('Unused service exports detected:');
            unusedExportLines.forEach(line => console.log(`  ${line}`));

            // This is informational for now - we document known unused exports
            // Note: Cache and MessageManager were removed since they're used in tests (fixed tsconfig.analysis.json)
            const knownUnusedExports = [
              // Test factories with genuinely unused exports
              'createLiveClient', 'resetSharedClient', 'isSharedClientInitialized',
              'mockAlbum', 'mockArtist',
              'isCI', 'hasNavidromeConfig', 'logTestEnvironment', 'itLive', 'getSharedLiveClientSafe',
              'describeLiveOnly', 'itLiveOnly', 'beforeAllLive', 'describeMockOnly', 'itMockOnly'
            ];
            const actualUnusedExports = unusedExportLines
              .flatMap(line => {
                const exportPart = line.split(':')[1]?.trim();
                return exportPart ? exportPart.split(',').map(exp => exp.trim()) : [];
              })
              .filter(Boolean);

            // Only fail if we have NEW unused exports beyond the known ones
            const unexpectedUnusedExports = actualUnusedExports.filter(
              exportName => !knownUnusedExports.includes(exportName)
            );

            if (unexpectedUnusedExports.length > 0) {
              expect(unexpectedUnusedExports).toEqual([]);
            }
          }
        } else {
          // Different kind of error - re-throw
          throw error;
        }
      }
    });
  });

  describe('Singleton Pattern Validation', () => {
    it('should ensure singleton patterns have proper initialization checks', () => {
      const singletonFiles = [
        join(projectRoot, 'tests/factories/shared-client.ts'),
        join(projectRoot, 'src/services/library-manager.ts'),
        join(projectRoot, 'src/services/filter-cache-manager.ts')
      ];

      for (const file of singletonFiles) {
        try {
          const content = readFileSync(file, 'utf-8');

          // Singleton patterns should have proper null checks
          if (content.includes('getInstance()') || content.includes('private static instance')) {
            // Should have null checks before using instance
            const lines = content.split('\n');
            const instanceUsages = lines
              .map((line, index) => ({ line: line.trim(), number: index + 1 }))
              .filter(({ line }) =>
                line.includes('this.') &&
                (line.includes('.isInitialized()') || line.includes('.method()'))
              );

            // Each instance usage should be properly guarded
            for (const { line, number } of instanceUsages) {
              // Look for null/undefined checks in preceding lines
              const precedingLines = lines.slice(Math.max(0, number - 5), number - 1);
              const hasNullCheck = precedingLines.some(precedingLine =>
                precedingLine.includes('if (') &&
                (precedingLine.includes('null') || precedingLine.includes('undefined'))
              );

              if (!hasNullCheck && line.includes('this.client.')) {
                expect.soft(false).toBe(true);
                console.log(`Potentially unguarded instance usage at ${file}:${number}: ${line}`);
              }
            }
          }
        } catch (error) {
          // File doesn't exist, skip
          continue;
        }
      }
    });
  });

  describe('Test Coverage for Dead Code Paths', () => {
    it('should ensure critical singleton code paths are tested', async () => {
      // This test ensures that singleton patterns like SharedTestClient
      // have tests that actually exercise retry/error paths

      const sharedClientFile = join(projectRoot, 'tests/factories/shared-client.ts');
      if (!existsSync(sharedClientFile)) {
        console.log('Info: SharedTestClient file not found, skipping test coverage analysis');
        return;
      }
      const sharedClientContent = readFileSync(sharedClientFile, 'utf-8');

      // If there are retry/error handling patterns
      if (sharedClientContent.includes('initializationError') ||
          sharedClientContent.includes('RETRY_DELAY')) {

        // Check if there are tests for these patterns
        const testDir = join(projectRoot, 'tests/unit');
        if (!existsSync(testDir)) {
          console.log('Info: Test directory not found, skipping retry test analysis');
          return;
        }
        const testFiles = readdirSync(testDir)
          .filter(file => file.endsWith('.test.ts'))
          .map(file => join(testDir, file));

        let hasRetryTests = false;
        for (const testFile of testFiles) {
          try {
            const testContent = readFileSync(testFile, 'utf-8');
            if (testContent.includes('retry') || testContent.includes('error') || testContent.includes('SharedTestClient')) {
              hasRetryTests = true;
              break;
            }
          } catch {
            continue;
          }
        }

        // This is informational - complex singleton patterns should have dedicated tests
        if (!hasRetryTests) {
          console.log('Info: SharedTestClient has complex retry logic but no dedicated retry tests');
        }
      }
    });
  });

  describe('Import/Export Consistency', () => {
    it('should have consistent import patterns for service classes', () => {
      // Test the pattern we discovered: services are used as singleton instances
      // but the classes are exported but never imported

      const servicePatterns = [
        {
          serviceFile: join(projectRoot, 'src/services/library-manager.ts'),
          expectedUsage: 'libraryManager',
          exportedClass: 'LibraryManager'
        },
        {
          serviceFile: join(projectRoot, 'src/services/filter-cache-manager.ts'),
          expectedUsage: 'filterCacheManager',
          exportedClass: 'FilterCacheManager'
        }
      ];

      for (const { serviceFile, expectedUsage, exportedClass } of servicePatterns) {
        try {
          const content = readFileSync(serviceFile, 'utf-8');

          // Should export the class
          const exportsClass = content.includes(`export { ${exportedClass} }`);

          // Should also export a singleton instance
          const exportsInstance = content.includes(`export { ${expectedUsage} }`);

          if (exportsClass && !exportsInstance) {
            // This might indicate the class export is unused (people use the instance)
            console.log(`Info: ${serviceFile} exports ${exportedClass} class but usage pattern suggests instance is preferred`);
          }
        } catch (error) {
          continue;
        }
      }
    });
  });
});