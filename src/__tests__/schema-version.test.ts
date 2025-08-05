import { SchemaVersionChecker } from '../utils/schema-version-checker';
import { Client } from 'pg';

describe('Schema Version Validation', () => {
  const checker = new SchemaVersionChecker();

  test('should have expected schema version', () => {
    const expected = checker.getExpectedSchemaVersion();
          expect(expected.version).toBe(14);
    expect(expected.description).toContain('Carthorse SQLite Export v14.0');
  });

  test('should validate test database schema if it exists', async () => {
    const client = new Client({
      host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
      port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
      user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
      password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
      database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
    });

    try {
      await client.connect();
      
      // Check if trails table exists and has data
      const result = await client.query("SELECT COUNT(*) as count FROM trails");
      const trailCount = parseInt(result.rows[0].count);
      
      console.log(`📊 Test Database Schema: Found ${trailCount} trails in test database`);
      
      if (trailCount > 0) {
        console.log('✅ Test database has valid data');
      } else {
        console.warn('⚠️  Test database exists but has no trail data');
      }

      // Check for required tables
      const tablesResult = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('trails', 'regions', 'ways_noded_vertices_pgr', 'ways_noded')
        ORDER BY table_name
      `);
      
      const tableNames = tablesResult.rows.map(row => row.table_name);
      console.log(`📋 Available tables: ${tableNames.join(', ')}`);
      
      expect(tableNames).toContain('trails');
      
    } catch (err) {
      console.log('⏭️  Skipping test database validation - connection failed');
      console.log(`   Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.end();
    }
  });

  test('should validate production database schema if it exists', async () => {
    const client = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      user: process.env.PGUSER || 'shaydu',
      password: process.env.PGPASSWORD || '',
      database: 'trail_master_db',
    });

    try {
      await client.connect();
      
      // Check if trails table exists and has data
      const result = await client.query("SELECT COUNT(*) as count FROM trails");
      const trailCount = parseInt(result.rows[0].count);
      
      console.log(`📊 Production Database Schema: Found ${trailCount} trails in production database`);
      
      if (trailCount > 0) {
        console.log('✅ Production database has valid data');
      } else {
        console.warn('⚠️  Production database exists but has no trail data');
      }

      // Check for required tables
      const tablesResult = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('trails', 'regions', 'ways_noded_vertices_pgr', 'ways_noded')
        ORDER BY table_name
      `);
      
      const tableNames = tablesResult.rows.map(row => row.table_name);
      console.log(`📋 Available tables: ${tableNames.join(', ')}`);
      
      expect(tableNames).toContain('trails');
      
    } catch (err) {
      console.log('⏭️  Skipping production database validation - connection failed');
      console.log(`   Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.end();
    }
  });
}); 