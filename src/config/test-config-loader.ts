import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { GLOBAL_CONFIG, configHelpers } from './carthorse.global.config';

export interface TestDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export interface TestLimitsConfig {
  timeout: number;
  shortTimeout: number;
  maxTrails?: number;
  maxSqliteDbSizeMB?: number;
}

export interface TestExportConfig {
  simplifyTolerance: number;
  intersectionTolerance: number;
  maxSqliteDbSizeMB: number;
  useSqlite: boolean;
  elevationPrecision: number;
}

export interface TestValidationConfig {
  skipIncompleteTrails: boolean;
  skipValidation?: boolean;
  skipBboxValidation?: boolean;
  skipGeometryValidation?: boolean;
  skipTrailValidation?: boolean;
}

export interface TestOrchestratorConfig {
  region: string;
  simplifyTolerance: number;
  intersectionTolerance: number;
  replace: boolean;
  validate: boolean;
  verbose: boolean;
  skipBackup: boolean;
  buildMaster: boolean;
  targetSizeMB: number | null;
  maxSqliteDbSizeMB: number;
  skipIncompleteTrails: boolean;
  useSqlite: boolean;
  skipCleanup: boolean;
  targetSchemaVersion: number;
  elevationPrecision: number;
}

export interface TestConfig {
  database: TestDatabaseConfig;
  limits: TestLimitsConfig;
  export: TestExportConfig;
  validation: TestValidationConfig;
  orchestrator: TestOrchestratorConfig;
}

export class TestConfigLoader {
  private static instance: TestConfigLoader;
  private config: TestConfig | null = null;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.resolve(__dirname, '../../configs/test-config.yaml');
  }

  /**
   * Get singleton instance of TestConfigLoader
   */
  static getInstance(configPath?: string): TestConfigLoader {
    if (!TestConfigLoader.instance) {
      TestConfigLoader.instance = new TestConfigLoader(configPath);
    }
    return TestConfigLoader.instance;
  }

  /**
   * Load test configuration from YAML file
   */
  loadConfig(): TestConfig {
    if (this.config) {
      return this.config;
    }

    try {
      if (!fs.existsSync(this.configPath)) {
        console.warn(`⚠️  Test config file not found at ${this.configPath}, using defaults`);
        this.config = this.getDefaultConfig();
        return this.config;
      }

      const configFile = fs.readFileSync(this.configPath, 'utf8');
      const yamlConfig = yaml.load(configFile) as Partial<TestConfig>;
      
      this.config = this.mergeWithDefaults(yamlConfig);
      console.log(`✅ Loaded test configuration from ${this.configPath}`);
      
      return this.config;
    } catch (error) {
      console.warn(`⚠️  Failed to load test config from ${this.configPath}: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('Using default test configuration');
      this.config = this.getDefaultConfig();
      return this.config;
    }
  }

  /**
   * Get the current test configuration
   */
  getConfig(): TestConfig {
    return this.loadConfig();
  }

  /**
   * Check if test database is configured
   */
  isTestDatabaseConfigured(): boolean {
    const config = this.getConfig();
    return !!(config.database.host && config.database.port);
  }

  /**
   * Check if test should be skipped
   */
  shouldSkipTest(reason?: string): boolean {
    if (!this.isTestDatabaseConfigured()) {
      console.log(`⏭️  Skipping test - no test database configured${reason ? `: ${reason}` : ''}`);
      return true;
    }
    return false;
  }

  /**
   * Log current test configuration
   */
  logTestConfiguration(): void {
    const config = this.getConfig();
    if (this.isTestDatabaseConfigured()) {
      console.log(`🧪 Test configuration: ${config.database.database} on ${config.database.host}:${config.database.port}`);
      console.log(`📏 Elevation precision: ${config.export.elevationPrecision} decimal places`);
      console.log(`⏱️  Timeout: ${config.limits.timeout}ms`);
    } else {
      console.log('⚠️  No test database configuration found');
    }
  }

  /**
   * Get default test configuration
   */
  private getDefaultConfig(): TestConfig {
    return {
      database: {
        host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
        port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
        database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
        user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
        password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
        ssl: false,
      },
      limits: {
        timeout: 120000, // 2 minutes
        shortTimeout: 5000, // 5 seconds for quick tests
        maxTrails: 3, // Only test with 3 trails for speed
        maxSqliteDbSizeMB: 10, // Small size for testing
      },
      export: {
        simplifyTolerance: GLOBAL_CONFIG.export.defaultSimplifyTolerance,
        intersectionTolerance: GLOBAL_CONFIG.export.defaultIntersectionTolerance,
        maxSqliteDbSizeMB: GLOBAL_CONFIG.export.maxSqliteDbSizeMB,
        useSqlite: true,
        elevationPrecision: configHelpers.getElevationPrecision(),
      },
      validation: {
        skipIncompleteTrails: GLOBAL_CONFIG.validation.skipIncompleteTrails,
        skipValidation: false,
        skipBboxValidation: false,
        skipGeometryValidation: false,
        skipTrailValidation: false,
      },
      orchestrator: {
        region: 'boulder',
        simplifyTolerance: GLOBAL_CONFIG.export.defaultSimplifyTolerance,
        intersectionTolerance: GLOBAL_CONFIG.export.defaultIntersectionTolerance,
        replace: true,
        validate: false,
        verbose: true,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: GLOBAL_CONFIG.export.maxSqliteDbSizeMB,
        skipIncompleteTrails: GLOBAL_CONFIG.validation.skipIncompleteTrails,
        useSqlite: true,
        skipCleanup: true,
        targetSchemaVersion: 7,
        elevationPrecision: configHelpers.getElevationPrecision(),
      },
    };
  }

  /**
   * Merge YAML config with defaults
   */
  private mergeWithDefaults(yamlConfig: Partial<TestConfig>): TestConfig {
    const defaults = this.getDefaultConfig();
    
    return {
      database: { ...defaults.database, ...yamlConfig.database },
      limits: { ...defaults.limits, ...yamlConfig.limits },
      export: { ...defaults.export, ...yamlConfig.export },
      validation: { ...defaults.validation, ...yamlConfig.validation },
      orchestrator: { ...defaults.orchestrator, ...yamlConfig.orchestrator },
    };
  }

  /**
   * Reload configuration from file
   */
  reloadConfig(): TestConfig {
    this.config = null;
    return this.loadConfig();
  }
}

// Export singleton instance for backward compatibility
export const testConfigLoader = TestConfigLoader.getInstance();

// Export convenience functions for backward compatibility
export function getTestConfig(): TestConfig {
  return testConfigLoader.getConfig();
}

export function isTestDatabaseConfigured(): boolean {
  return testConfigLoader.isTestDatabaseConfigured();
}

export function shouldSkipTest(reason?: string): boolean {
  return testConfigLoader.shouldSkipTest(reason);
}

export function logTestConfiguration(): void {
  testConfigLoader.logTestConfiguration();
} 