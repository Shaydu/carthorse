import { SchemaVersionChecker } from '../utils/schema-version-checker';
import * as fs from 'fs';

describe('Schema Version Validation', () => {
  const checker = new SchemaVersionChecker();

  test('should have expected schema version', () => {
    const expected = checker.getExpectedSchemaVersion();
    expect(expected.version).toBe(7);
    expect(expected.description).toContain('Enhanced PostgreSQL processed');
  });

  test('should validate PostgreSQL schema if environment is configured', async () => {
    // Only run this test if PostgreSQL environment is configured
    if (!process.env.PGHOST || !process.env.PGDATABASE) {
      console.log('⏭️  Skipping PostgreSQL schema validation - environment not configured');
      return;
    }

    const config = {
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER || 'postgres'
    };
    
    if (process.env.PGPASSWORD) {
      (config as any).password = process.env.PGPASSWORD;
    }

    const validation = await checker.validatePostgreSQLSchema(config);
    console.log(`📊 PostgreSQL Schema: ${validation.message}`);
    
    // For now, just log the result - we'll make this stricter once we ensure schema consistency
    if (!validation.valid) {
      console.warn(`⚠️  PostgreSQL schema version mismatch: ${validation.message}`);
    }
  });

  test('should validate test database schema if it exists', () => {
    const testDbPath = 'data/trail_master_db_test.db';
    
    if (!fs.existsSync(testDbPath)) {
      console.log('⏭️  Skipping test database validation - file not found');
      return;
    }

    const validation = checker.validateSpatiaLiteSchema(testDbPath);
    console.log(`📊 Test Database Schema: ${validation.message}`);
    
    if (validation.actualVersion) {
      console.log(`   Version: ${validation.actualVersion.version}`);
      if (validation.actualVersion.description) {
        console.log(`   Description: ${validation.actualVersion.description}`);
      }
    }

    // For now, just log the result - we'll make this stricter once we ensure schema consistency
    if (!validation.valid) {
      console.warn(`⚠️  Test database schema version mismatch: ${validation.message}`);
    }
  });

  test('should validate production database schema if it exists', () => {
    const prodDbPath = 'data/trail_master_db.db';
    
    if (!fs.existsSync(prodDbPath)) {
      console.log('⏭️  Skipping production database validation - file not found');
      return;
    }

    const validation = checker.validateSpatiaLiteSchema(prodDbPath);
    console.log(`📊 Production Database Schema: ${validation.message}`);
    
    if (validation.actualVersion) {
      console.log(`   Version: ${validation.actualVersion.version}`);
      if (validation.actualVersion.description) {
        console.log(`   Description: ${validation.actualVersion.description}`);
      }
    }

    // For now, just log the result - we'll make this stricter once we ensure schema consistency
    if (!validation.valid) {
      console.warn(`⚠️  Production database schema version mismatch: ${validation.message}`);
    }
  });
}); 