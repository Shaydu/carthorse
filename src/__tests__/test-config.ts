// Centralized test configuration
export const TEST_CONFIG = {
  // Database configuration for tests
  database: {
    host: process.env.TEST_PGHOST || process.env.PGHOST,
    port: process.env.TEST_PGPORT || process.env.PGPORT ? parseInt(process.env.TEST_PGPORT || process.env.PGPORT!) : undefined,
    database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
    password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
  },
  
  // Test limits and timeouts
  limits: {
    testLimit: process.env.CARTHORSE_TEST_LIMIT ? parseInt(process.env.CARTHORSE_TEST_LIMIT) : undefined,
    timeout: 120000, // 2 minutes
    elevationTimeout: 300000, // 5 minutes for elevation processing
  },
  
  // Test output configuration
  output: {
    testOutputDir: 'src/__tests__/test-output',
    sqliteTestDb: 'test-sqlite-export.db',
    elevationTestDb: 'test-elevation.db',
  },
  
  // Validation settings
  validation: {
    skipIncompleteTrails: true,
    validateGeometry: true,
    validateElevation: true,
  },
  
  // Export settings
  export: {
    simplifyTolerance: 0.001,
    intersectionTolerance: 2.0,
    maxSpatiaLiteDbSizeMB: 400,
    useSqlite: true,
  },
};

// Helper functions
export function isTestDatabaseConfigured(): boolean {
  return !!(TEST_CONFIG.database.host && TEST_CONFIG.database.port);
}

export function getTestDatabaseConfig() {
  return TEST_CONFIG.database;
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