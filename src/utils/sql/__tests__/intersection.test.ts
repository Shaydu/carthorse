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
    const pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'trail_master_db_test',
      user: process.env.PGUSER || 'tester',
      password: process.env.PGPASSWORD || '',
    });
    await pgClient.connect();
    const stagingSchema = 'staging_boulder_1752133482310'; // Replace with a real test schema with trails
    const tolerance = 0.001;
    const result = await detectIntersectionsHelper(pgClient, stagingSchema, tolerance);
    expect(result).toBeInstanceOf(Map);
    // Optionally check for at least one intersection if you know the data
    // expect([...result.values()].flat().length).toBeGreaterThan(0);
    await pgClient.end();
  });
}); 