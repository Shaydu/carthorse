// Utility functions for environment and DB config/validation
import * as process from 'process';
import { getTestDbConfig } from '../database/connection';

export function getDbConfig() {
  return {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || '',
  };
}

export function validateTestEnvironment() {
  const isTestEnvironment = process.env.NODE_ENV === 'test' || 
                           process.env.JEST_WORKER_ID !== undefined ||
                           process.env.PGDATABASE === 'trail_master_db_test';

  if (isTestEnvironment) {
    const database = process.env.PGDATABASE || 'postgres';
    const user = process.env.PGUSER || 'postgres';
    if (database === 'trail_master_db' || database === 'postgres') {
      throw new Error(`❌ TEST SAFETY VIOLATION: Attempting to connect to production database '${database}' in test environment!`);
    }
    if (database !== 'trail_master_db_test') {
      console.warn(`⚠️  WARNING: Test environment using database '${database}' instead of 'trail_master_db_test'`);
    }
    if (user !== process.env.USER) {
      console.warn(`⚠️  WARNING: Test environment using user '${user}' instead of system user '${process.env.USER}'`);
    }
    console.log(`✅ Test environment validated: database=${database}, user=${user}`);
  }
} 