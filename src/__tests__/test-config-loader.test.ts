import { TestConfigLoader, getTestConfig, isTestDatabaseConfigured } from '../config/test-config-loader';
import * as fs from 'fs';
import * as path from 'path';

describe('TestConfigLoader', () => {
  const testConfigPath = path.resolve(__dirname, '../../configs/test-config.yaml');
  let originalConfigExists: boolean;

  beforeAll(() => {
    originalConfigExists = fs.existsSync(testConfigPath);
  });

  afterAll(() => {
    // Clean up any test files we created
    const testConfigPath = path.resolve(__dirname, '../../configs/test-config.yaml');
    if (fs.existsSync(testConfigPath) && !originalConfigExists) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe('getTestConfig', () => {
    test('should return a valid test configuration', () => {
      const config = getTestConfig();
      
      expect(config).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.limits).toBeDefined();
      expect(config.export).toBeDefined();
      expect(config.validation).toBeDefined();
      expect(config.orchestrator).toBeDefined();
      
      // Check database config
      expect(config.database.host).toBeDefined();
      expect(config.database.port).toBeDefined();
      expect(config.database.database).toBeDefined();
      expect(config.database.user).toBeDefined();
      
      // Check limits config
      expect(config.limits.timeout).toBeGreaterThan(0);
      expect(config.limits.shortTimeout).toBeGreaterThan(0);
      expect(config.limits.maxTrails).toBeGreaterThan(0);
      
      // Check export config
      expect(config.export.simplifyTolerance).toBeGreaterThan(0);
      expect(config.export.intersectionTolerance).toBeGreaterThan(0);
      expect(config.export.maxSqliteDbSizeMB).toBeGreaterThan(0);
      expect(typeof config.export.useSqlite).toBe('boolean');
      expect(config.export.elevationPrecision).toBeGreaterThanOrEqual(0);
      
      // Check validation config
      expect(typeof config.validation.skipIncompleteTrails).toBe('boolean');
      
      // Check orchestrator config
      expect(config.orchestrator.region).toBeDefined();
      expect(config.orchestrator.simplifyTolerance).toBeGreaterThan(0);
      expect(config.orchestrator.intersectionTolerance).toBeGreaterThan(0);
      expect(typeof config.orchestrator.replace).toBe('boolean');
      expect(typeof config.orchestrator.validate).toBe('boolean');
      expect(typeof config.orchestrator.verbose).toBe('boolean');
      expect(typeof config.orchestrator.skipBackup).toBe('boolean');
      expect(typeof config.orchestrator.buildMaster).toBe('boolean');
      expect(typeof config.orchestrator.skipIncompleteTrails).toBe('boolean');
      expect(typeof config.orchestrator.useSqlite).toBe('boolean');
      expect(typeof config.orchestrator.skipCleanup).toBe('boolean');
      expect(config.orchestrator.targetSchemaVersion).toBeGreaterThan(0);
      expect(config.orchestrator.elevationPrecision).toBeGreaterThanOrEqual(0);
    });

    test('should return consistent configuration across multiple calls', () => {
      const config1 = getTestConfig();
      const config2 = getTestConfig();
      
      expect(config1).toEqual(config2);
    });
  });

  describe('isTestDatabaseConfigured', () => {
    test('should return boolean value', () => {
      const isConfigured = isTestDatabaseConfigured();
      expect(typeof isConfigured).toBe('boolean');
    });
  });

  describe('TestConfigLoader singleton', () => {
    test('should return the same instance', () => {
      const loader1 = TestConfigLoader.getInstance();
      const loader2 = TestConfigLoader.getInstance();
      
      expect(loader1).toBe(loader2);
    });

    test('should load configuration correctly', () => {
      const loader = TestConfigLoader.getInstance();
      const config = loader.getConfig();
      
      expect(config).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.limits).toBeDefined();
    });

    test('should handle missing config file gracefully', () => {
      const nonExistentPath = '/non/existent/path.yaml';
      const loader = TestConfigLoader.getInstance(nonExistentPath);
      const config = loader.getConfig();
      
      // Should still return a valid config with defaults
      expect(config).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.limits).toBeDefined();
    });
  });

  describe('Configuration validation', () => {
    test('should have reasonable default values', () => {
      const config = getTestConfig();
      
      // Database should have reasonable defaults
      expect(config.database.host).toBeTruthy();
      expect(config.database.port).toBeGreaterThan(0);
      expect(config.database.database).toBeTruthy();
      expect(config.database.user).toBeTruthy();
      
      // Timeouts should be reasonable
      expect(config.limits.timeout).toBeGreaterThan(1000); // At least 1 second
      expect(config.limits.shortTimeout).toBeGreaterThan(100); // At least 100ms
      expect(config.limits.timeout).toBeGreaterThan(config.limits.shortTimeout);
      
      // Export settings should be reasonable
      expect(config.export.simplifyTolerance).toBeGreaterThan(0);
      expect(config.export.intersectionTolerance).toBeGreaterThan(0);
      expect(config.export.maxSqliteDbSizeMB).toBeGreaterThan(0);
      
      // Orchestrator settings should be reasonable
      expect(config.orchestrator.region).toBeTruthy();
      expect(config.orchestrator.targetSchemaVersion).toBeGreaterThan(0);
    });
  });
}); 