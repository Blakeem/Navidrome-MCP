/**
 * Runs a test body under a stubbed `process.platform`, so a platform branch runs on every CI host.
 */
export async function withPlatform<T>(platform: NodeJS.Platform, fn: () => T | Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    if (original !== undefined) Object.defineProperty(process, 'platform', original);
  }
}
