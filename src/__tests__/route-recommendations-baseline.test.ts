import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Pool } from 'pg';
import { CarthorseOrchestrator } from '../orchestrator/CarthorseOrchestrator';
import { getDatabasePoolConfig } from '../utils/config-loader';

describe('Route Recommendations Baseline Test', () => {
  let pgClient: Pool;
  let orchestrator: CarthorseOrchestrator;
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
    stagingSchema = `test_baseline_${Date.now()}`;
    
    // Setup orchestrator with minimal configuration
    orchestrator = new CarthorseOrchestrator({
      region: 'boulder',
      outputPath: '/tmp/baseline-test-output.db',
      stagingSchema,
      verbose: true,
      skipValidation: false,
      useSplitTrails: true,
      minTrailLengthMeters: 100
    });
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

  describe('Current State Baseline', () => {
    it('should establish baseline for route recommendations before metadata fix', async () => {
      console.log('🔍 Establishing baseline for route recommendations...');
      
      // Step 1: Run the orchestrator to create the network
      console.log('📊 Step 1: Creating routing network...');
      await orchestrator.generateKspRoutes();
      
      // Step 2: Check edge mapping table coverage
      console.log('📊 Step 2: Checking edge mapping coverage...');
      const edgeMappingCoverage = await pgClient.query(`
        SELECT 
          COUNT(DISTINCT wn.id) as total_edges,
          COUNT(DISTINCT em.pg_id) as mapped_edges,
          COUNT(DISTINCT wn.id) - COUNT(DISTINCT em.pg_id) as unmapped_edges,
          ROUND(
            (COUNT(DISTINCT em.pg_id)::float / COUNT(DISTINCT wn.id)::float) * 100, 2
          ) as coverage_percent
        FROM ${stagingSchema}.ways_noded wn
        LEFT JOIN ${stagingSchema}.edge_mapping em ON wn.id = em.pg_id
      `);
      
      const coverage = edgeMappingCoverage.rows[0];
      console.log(`📊 Edge mapping coverage: ${coverage.mapped_edges}/${coverage.total_edges} edges mapped (${coverage.coverage_percent}%)`);
      
      // Step 3: Check route recommendations count
      console.log('📊 Step 3: Checking route recommendations...');
      const routeCount = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.route_recommendations
      `);
      
      const recommendationsCount = routeCount.rows[0].count;
      console.log(`📊 Route recommendations found: ${recommendationsCount}`);
      
      // Step 4: Check for trails without names
      console.log('📊 Step 4: Checking trails without names...');
      const trailsWithoutNames = await pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.trails 
        WHERE name IS NULL OR name = ''
      `);
      
      const unnamedTrailsCount = trailsWithoutNames.rows[0].count;
      console.log(`📊 Trails without names: ${unnamedTrailsCount}`);
      
      // Step 5: Check network connectivity
      console.log('📊 Step 5: Checking network connectivity...');
      const networkStats = await pgClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as total_nodes,
          (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as total_edges,
          (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE cnt = 0) as isolated_nodes,
          (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE cnt = 1) as leaf_nodes,
          (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE cnt >= 2) as connected_nodes
      `);
      
      const network = networkStats.rows[0];
      console.log(`📊 Network stats: ${network.total_nodes} nodes, ${network.total_edges} edges`);
      console.log(`📊 Node types: ${network.isolated_nodes} isolated, ${network.leaf_nodes} leaf, ${network.connected_nodes} connected`);
      
      // Step 6: Check if edge mapping table exists and has data
      console.log('📊 Step 6: Checking edge mapping table...');
      const edgeMappingExists = await pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'edge_mapping'
        )
      `, [stagingSchema]);
      
      const tableExists = edgeMappingExists.rows[0].exists;
      console.log(`📊 Edge mapping table exists: ${tableExists}`);
      
      if (tableExists) {
        const edgeMappingCount = await pgClient.query(`
          SELECT COUNT(*) as count FROM ${stagingSchema}.edge_mapping
        `);
        console.log(`📊 Edge mapping table has ${edgeMappingCount.rows[0].count} rows`);
        
        // Check for entries with null trail names
        const nullNamesCount = await pgClient.query(`
          SELECT COUNT(*) as count FROM ${stagingSchema}.edge_mapping WHERE trail_name IS NULL
        `);
        console.log(`📊 Edge mapping entries with null trail names: ${nullNamesCount.rows[0].count}`);
      }
      
      // Step 7: Test route generation query
      console.log('📊 Step 7: Testing route generation query...');
      try {
        const testRouteQuery = await pgClient.query(`
          SELECT 
            w.id,
            em.trail_name,
            em.app_uuid,
            w.length_km
          FROM ${stagingSchema}.ways_noded w
          LEFT JOIN ${stagingSchema}.edge_mapping em ON w.id = em.pg_id
          LIMIT 5
        `);
        
        console.log(`📊 Test route query returned ${testRouteQuery.rows.length} rows`);
        console.log('📊 Sample route data:', testRouteQuery.rows.slice(0, 2));
        
      } catch (error) {
        console.error('❌ Test route query failed:', error);
      }
      
      // Step 8: Establish baseline expectations
      console.log('\n📋 BASELINE EXPECTATIONS:');
      console.log(`   - Edge mapping coverage: ${coverage.coverage_percent}% (should be 100% after fix)`);
      console.log(`   - Route recommendations: ${recommendationsCount} (should be >0 after fix)`);
      console.log(`   - Trails without names: ${unnamedTrailsCount} (should be handled gracefully)`);
      console.log(`   - Network connectivity: ${network.connected_nodes}/${network.total_nodes} nodes connected`);
      
      // Step 9: Document the current issues
      console.log('\n🚨 CURRENT ISSUES IDENTIFIED:');
      
      if (coverage.unmapped_edges > 0) {
        console.log(`   ❌ ${coverage.unmapped_edges} edges missing from edge_mapping table`);
      }
      
      if (recommendationsCount === 0) {
        console.log('   ❌ No route recommendations generated');
      }
      
      if (unnamedTrailsCount > 0) {
        console.log(`   ⚠️  ${unnamedTrailsCount} trails without names may be excluded`);
      }
      
      // Step 10: Set expectations for after the fix
      console.log('\n✅ EXPECTED RESULTS AFTER FIX:');
      console.log('   - Edge mapping coverage should be 100%');
      console.log('   - Route recommendations should be >0');
      console.log('   - Trails without names should use fallback names');
      console.log('   - Route generation should not fail due to missing metadata');
      
      // Store baseline data for comparison
      const baseline = {
        edgeMappingCoverage: coverage.coverage_percent,
        routeRecommendationsCount: recommendationsCount,
        unnamedTrailsCount,
        networkStats: network,
        edgeMappingExists: tableExists
      };
      
      console.log('\n📊 BASELINE DATA:', JSON.stringify(baseline, null, 2));
      
      // Assertions for the current broken state
      expect(coverage.unmapped_edges).toBeGreaterThan(0);
      expect(recommendationsCount).toBe(0);
      expect(tableExists).toBe(true);
      
      console.log('\n✅ Baseline test completed - current broken state confirmed');
    }, 300000); // 5 minute timeout for full pipeline
  });
}); 