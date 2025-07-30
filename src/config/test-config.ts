// Centralized test configuration for Carthorse tests
import { GLOBAL_CONFIG, configHelpers } from './carthorse.global.config';

export const TEST_CONFIG = {
  database: {
    host: process.env.TEST_PGHOST || process.env.PGHOST,
    port: process.env.TEST_PGPORT || process.env.PGPORT ? parseInt(process.env.TEST_PGPORT || process.env.PGPORT!) : undefined,
    database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
    password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
  },
  limits: {
    timeout: 120000, // 2 minutes
    shortTimeout: 5000, // 5 seconds for quick tests
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
  }
};

export function isTestDatabaseConfigured(): boolean {
  return !!(TEST_CONFIG.database.host && TEST_CONFIG.database.port);
}

export function shouldSkipTest(reason?: string): boolean {
  if (!isTestDatabaseConfigured()) {
    console.log(`⏭️  Skipping test - no test database configured${reason ? `: ${reason}` : ''}`);
    return true;
  }
  return false;
}

export function logTestConfiguration(): void {
  if (isTestDatabaseConfigured()) {
    console.log(`🧪 Test configuration: ${TEST_CONFIG.database.database} on ${TEST_CONFIG.database.host}:${TEST_CONFIG.database.port}`);
    console.log(`📏 Elevation precision: ${TEST_CONFIG.export.elevationPrecision} decimal places`);
  } else {
    console.log('⚠️  No test database configuration found');
  }
}