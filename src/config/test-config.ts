// Centralized test configuration for Carthorse tests
// This file now uses the TestConfigLoader for YAML-based configuration
import { TestConfigLoader, TestConfig } from './test-config-loader';

// Get the test config loader instance
const testConfigLoader = TestConfigLoader.getInstance();

// Export the test configuration for backward compatibility
export const TEST_CONFIG: TestConfig = testConfigLoader.getConfig();

// Export convenience functions for backward compatibility
export function isTestDatabaseConfigured(): boolean {
  return testConfigLoader.isTestDatabaseConfigured();
}

export function shouldSkipTest(reason?: string): boolean {
  return testConfigLoader.shouldSkipTest(reason);
}

export function logTestConfiguration(): void {
  testConfigLoader.logTestConfiguration();
}

// Re-export types and loader for new usage
export { TestConfigLoader, getTestConfig } from './test-config-loader';
export type { TestConfig } from './test-config-loader';