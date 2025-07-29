// Utility functions for environment and DB config/validation
import * as process from 'process';
import { getTestDbConfig } from '../database/connection';

export const env = {
  // Database configuration - no hardcoded fallbacks
  host: process.env.PGHOST,
  port: process.env.PGPORT ? parseInt(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  
  // Test database configuration - no hardcoded fallbacks
  testHost: process.env.TEST_PGHOST || process.env.PGHOST,
  testPort: process.env.TEST_PGPORT || process.env.PGPORT ? parseInt(process.env.TEST_PGPORT || process.env.PGPORT!) : undefined,
  testDatabase: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
  testUser: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
  testPassword: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
  
  // Environment
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Logging
  verbose: process.env.VERBOSE === 'true' || process.env.VERBOSE === '1',
  
  // Test configuration
  testLimit: process.env.CARTHORSE_TEST_LIMIT ? parseInt(process.env.CARTHORSE_TEST_LIMIT) : undefined,
};

// Backward compatibility function for orchestrator
export function getDbConfig() {
  return getTestDbConfig();
}

export function validateTestEnvironment() {
  const testConfig = getTestDbConfig();
  const requiredFields = ['host', 'port', 'database', 'user'];
  const missingFields = requiredFields.filter(field => !testConfig[field as keyof typeof testConfig]);
  
  if (missingFields.length > 0) {
    console.log(`❌ Missing required test environment variables: ${missingFields.join(', ')}`);
    console.log('   Please set the following environment variables:');
    console.log('   - TEST_PGHOST or PGHOST');
    console.log('   - TEST_PGPORT or PGPORT');
    console.log('   - TEST_PGDATABASE or PGDATABASE');
    console.log('   - TEST_PGUSER or PGUSER');
    return false;
  }
  
  return true;
} 