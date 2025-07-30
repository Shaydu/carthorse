// Centralized test configuration for Carthorse tests
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
    simplifyTolerance: 0.001,
    intersectionTolerance: 2.0,
    maxSqliteDbSizeMB: 400,
    useSqlite: true,
  },
  validation: {
    skipIncompleteTrails: true,
  },
  orchestrator: {
    region: 'boulder',
    simplifyTolerance: 0.001,
    intersectionTolerance: 2.0,
    replace: true,
    validate: false,
    verbose: true,
    skipBackup: true,
    buildMaster: false,
    targetSizeMB: null,
    maxSqliteDbSizeMB: 400,
    skipIncompleteTrails: true,
    useSqlite: true,
    skipCleanup: true,
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
  } else {
    console.log('⚠️  No test database configuration found');
  }
}