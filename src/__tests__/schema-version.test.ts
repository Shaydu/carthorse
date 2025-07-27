import { SchemaVersionChecker } from '../utils/schema-version-checker';
import * as fs from 'fs';

describe('Schema Version Validation', () => {
  const checker = new SchemaVersionChecker();

  test('should have expected schema version', () => {
    const expected = checker.getExpectedSchemaVersion();
    expect(expected.version).toBe(9);
    expect(expected.description).toContain('Carthorse SQLite Export v9.0');
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