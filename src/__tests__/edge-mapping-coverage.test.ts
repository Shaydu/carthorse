import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';
import { PgRoutingHelpers } from '../utils/pgrouting-helpers';

describe('Edge Mapping Coverage Test', () => {
  let pgClient: Pool;
  let stagingSchema: string;

  beforeEach(async () => {
    // Setup PostgreSQL connection
    const dbConfig = getDatabasePoolConfig();
    pgClient = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password
    });

    // Create unique staging schema for this test
    stagingSchema = `test_edge_mapping_${Date.now()}`;
  });

  afterEach(async () => {
    // Cleanup staging schema
    try {
      await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    } catch (error) {
      console.warn('Failed to cleanup staging schema:', error);
    }
    
    await pgClient.end();
  });

  describe('Edge Mapping Coverage Analysis', () => {
    it('should identify edge mapping coverage issues', async () => {
      console.log('🔍 Analyzing edge mapping coverage issues...');
      
      // Step 1: Create staging schema and copy minimal trail data
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
      
      // Create trails table with some trails that have names and some that don't
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT UNIQUE NOT NULL,
          name TEXT,
          length_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          geometry GEOMETRY(LINESTRINGZ, 4326)
        )
      `);
      
      // Insert test trails - some with names, some without
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.trails (app_uuid, name, length_km, elevation_gain, elevation_loss, geometry) VALUES
        ('trail-1', 'Named Trail 1', 1.0, 50, 50, ST_GeomFromText('LINESTRING Z(-105.0 40.0 1800, -105.01 40.01 1850)', 4326)),
        ('trail-2', 'Named Trail 2', 1.5, 75, 75, ST_GeomFromText('LINESTRING Z(-105.01 40.01 1850, -105.02 40.02 1900)', 4326)),
        ('trail-3', NULL, 0.8, 30, 30, ST_GeomFromText('LINESTRING Z(-105.02 40.02 1900, -105.03 40.03 1930)', 4326)),
        ('trail-4', '', 1.2, 60, 60, ST_GeomFromText('LINESTRING Z(-105.03 40.03 1930, -105.04 40.04 1990)', 4326)),
        ('trail-5', 'Named Trail 5', 0.9, 45, 45, ST_GeomFromText('LINESTRING Z(-105.04 40.04 1990, -105.05 40.05 2035)', 4326))
      `);
      
      console.log('✅ Created test trails with mixed naming');
      
      // Step 2: Create pgRouting network
      const pgrouting = new PgRoutingHelpers({
        stagingSchema,
        pgClient
      });
      
      console.log('🔄 Creating pgRouting network...');
      const networkCreated = await pgrouting.createPgRoutingViews();
      
      if (!networkCreated) {
        throw new Error('Failed to create pgRouting network');
      }
      
      console.log('✅ pgRouting network created');
      
      // Step 3: Analyze edge mapping coverage
      console.log('📊 Analyzing edge mapping coverage...');
      
      // Check total edges in ways_noded
      const totalEdges = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
      `);
      
      // Check edges in edge_mapping
      const mappedEdges = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.edge_mapping
      `);
      
      // Check edges with trail names
      const edgesWithNames = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.edge_mapping WHERE trail_name IS NOT NULL
      `);
      
      // Check edges without trail names
      const edgesWithoutNames = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.edge_mapping WHERE trail_name IS NULL
      `);
      
      // Check trails without names in original data
      const trailsWithoutNames = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.trails WHERE name IS NULL OR name = ''
      `);
      
      const totalEdgesCount = totalEdges.rows[0].count;
      const mappedEdgesCount = mappedEdges.rows[0].count;
      const edgesWithNamesCount = edgesWithNames.rows[0].count;
      const edgesWithoutNamesCount = edgesWithoutNames.rows[0].count;
      const trailsWithoutNamesCount = trailsWithoutNames.rows[0].count;
      
      console.log(`📊 Total edges in ways_noded: ${totalEdgesCount}`);
      console.log(`📊 Edges in edge_mapping: ${mappedEdgesCount}`);
      console.log(`📊 Edges with trail names: ${edgesWithNamesCount}`);
      console.log(`📊 Edges without trail names: ${edgesWithoutNamesCount}`);
      console.log(`📊 Original trails without names: ${trailsWithoutNamesCount}`);
      
      // Step 4: Calculate coverage metrics
      const coveragePercent = totalEdgesCount > 0 ? (mappedEdgesCount / totalEdgesCount) * 100 : 0;
      const unmappedEdges = totalEdgesCount - mappedEdgesCount;
      
      console.log(`📊 Edge mapping coverage: ${coveragePercent.toFixed(2)}%`);
      console.log(`📊 Unmapped edges: ${unmappedEdges}`);
      
      // Step 5: Test the problematic query from route generation
      console.log('🔍 Testing route generation query...');
      
      try {
        const routeQuery = await pgClient.query(`
          SELECT 
            w.id,
            em.trail_name,
            em.app_uuid,
            w.length_km
          FROM ${stagingSchema}.ways_noded w
          JOIN ${stagingSchema}.edge_mapping em ON w.id = em.pg_id
          JOIN ${stagingSchema}.trails t ON em.app_uuid = t.app_uuid
          LIMIT 10
        `);
        
        console.log(`✅ Route query succeeded, returned ${routeQuery.rows.length} rows`);
        console.log('📊 Sample route data:', routeQuery.rows.slice(0, 3));
        
      } catch (error) {
        console.error('❌ Route query failed:', error);
      }
      
      // Step 6: Test the LEFT JOIN version (what we'll use in the fix)
      console.log('🔍 Testing LEFT JOIN route query...');
      
      try {
        const leftJoinQuery = await pgClient.query(`
          SELECT 
            w.id,
            COALESCE(em.trail_name, 'Unnamed Trail') as trail_name,
            COALESCE(em.app_uuid, 'unknown') as app_uuid,
            w.length_km
          FROM ${stagingSchema}.ways_noded w
          LEFT JOIN ${stagingSchema}.edge_mapping em ON w.id = em.pg_id
          LEFT JOIN ${stagingSchema}.trails t ON em.app_uuid = t.app_uuid
          LIMIT 10
        `);
        
        console.log(`✅ LEFT JOIN route query succeeded, returned ${leftJoinQuery.rows.length} rows`);
        console.log('📊 Sample LEFT JOIN route data:', leftJoinQuery.rows.slice(0, 3));
        
      } catch (error) {
        console.error('❌ LEFT JOIN route query failed:', error);
      }
      
      // Step 7: Document the issue
      console.log('\n🚨 ISSUE ANALYSIS:');
      
      if (unmappedEdges > 0) {
        console.log(`   ❌ ${unmappedEdges} edges are missing from edge_mapping table`);
        console.log(`   💡 This is caused by the WHERE t.name IS NOT NULL condition`);
      }
      
      if (edgesWithoutNamesCount > 0) {
        console.log(`   ⚠️  ${edgesWithoutNamesCount} edges have NULL trail names`);
        console.log(`   💡 These will cause issues in route generation`);
      }
      
      if (coveragePercent < 100) {
        console.log(`   ❌ Edge mapping coverage is only ${coveragePercent.toFixed(2)}%`);
        console.log(`   💡 Should be 100% for all edges to be routable`);
      }
      
      // Step 8: Set expectations for the fix
      console.log('\n✅ EXPECTED RESULTS AFTER FIX:');
      console.log('   - Edge mapping coverage should be 100%');
      console.log('   - All edges should have trail_name (with fallback)');
      console.log('   - Route generation queries should succeed');
      console.log('   - No edges should be excluded due to missing names');
      
      // Step 9: Assertions for current broken state
      expect(unmappedEdges).toBeGreaterThan(0);
      expect(coveragePercent).toBeLessThan(100);
      expect(trailsWithoutNamesCount).toBeGreaterThan(0);
      
      console.log('\n✅ Edge mapping coverage test completed - issue confirmed');
    }, 60000); // 1 minute timeout
  });
}); 