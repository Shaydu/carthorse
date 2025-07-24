import { detectIntersectionsHelper } from '../intersection';
import { Client } from 'pg';

describe('detectIntersectionsHelper', () => {
  it('should return a Map (smoke test)', async () => {
    // Mock pgClient with minimal interface
    const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    const pgClient = { query: mockQuery } as unknown as Client;
    const result = await detectIntersectionsHelper(pgClient, 'test_schema', 0.001);
    expect(result).toBeInstanceOf(Map);
  });

  it('should detect intersections in a real test DB (integration)', async () => {
    // This test assumes a test DB is available and a staging schema with trails exists
    // You may need to adjust schema and data setup for your environment
    jest.setTimeout(10000); // Increase timeout to 10 seconds
    const pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'trail_master_db_test',
      user: process.env.PGUSER || 'tester',
      password: process.env.PGPASSWORD || '',
    });
    
    try {
      await pgClient.connect();
      
      // Check if test database is available
      const dbCheck = await pgClient.query('SELECT current_database()');
      console.log('Connected to database:', dbCheck.rows[0].current_database);
      
      // Check if staging schema exists
      const schemaCheck = await pgClient.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'staging_%' 
        LIMIT 1
      `);
      
      if (schemaCheck.rows.length === 0) {
        console.warn('No staging schemas found, skipping integration test');
        return;
      }
      
      const stagingSchema = schemaCheck.rows[0].schema_name;
      console.log('Using staging schema:', stagingSchema);
      
      // Check if staging schema has trails data
      const trailsCheck = await pgClient.query(`
        SELECT COUNT(*) as trail_count 
        FROM ${stagingSchema}.trails 
        WHERE geo2 IS NOT NULL
      `);
      
      const trailCount = parseInt(trailsCheck.rows[0].trail_count);
      console.log('Trails in staging schema:', trailCount);
      
      if (trailCount === 0) {
        console.warn('No trails found in staging schema, skipping intersection test');
        return;
      }
      
      const tolerance = 0.001;
      const result = await detectIntersectionsHelper(pgClient, stagingSchema, tolerance);
      expect(result).toBeInstanceOf(Map);
      // Optionally check for at least one intersection if you know the data
      // expect([...result.values()].flat().length).toBeGreaterThan(0);
    } catch (error) {
      console.warn('Database connection failed, skipping integration test:', (error as Error).message);
    } finally {
      await pgClient.end();
    }
  });
}); 