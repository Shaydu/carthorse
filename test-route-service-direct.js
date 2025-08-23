const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
});

async function testRouteService() {
  const stagingSchema = 'carthorse_1755961883651';
  
  try {
    console.log('🔍 Testing RouteGenerationOrchestratorService directly...\n');
    
    // Test the service configuration
    const config = {
      stagingSchema: stagingSchema,
      region: 'boulder',
      targetRoutesPerPattern: 100,
      minDistanceBetweenRoutes: 0,
      kspKValue: 25,
      generateKspRoutes: false,
      generateLoopRoutes: true, // This should be true
      generateP2PRoutes: false,
      includeP2PRoutesInOutput: false,
      useTrailheadsOnly: false,
      loopConfig: {
        useHawickCircuits: true,
        targetRoutesPerPattern: 50,
        elevationGainRateWeight: 0.7,
        distanceWeight: 0.3
      }
    };
    
    console.log('1. Service configuration:');
    console.log(`   - generateLoopRoutes: ${config.generateLoopRoutes}`);
    console.log(`   - stagingSchema: ${config.stagingSchema}`);
    console.log(`   - loopConfig.targetRoutesPerPattern: ${config.loopConfig.targetRoutesPerPattern}`);
    
    // Test if the ways_noded table exists
    console.log('\n2. Checking ways_noded table...');
    const waysNodedExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = 'ways_noded'
      )
    `, [stagingSchema]);
    
    console.log(`   - ways_noded exists: ${waysNodedExists.rows[0].exists}`);
    
    if (waysNodedExists.rows[0].exists) {
      const waysNodedCount = await pool.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
      `);
      console.log(`   - ways_noded count: ${waysNodedCount.rows[0].count}`);
    }
    
    // Test if the ways_noded_vertices_pgr table exists
    console.log('\n3. Checking ways_noded_vertices_pgr table...');
    const verticesExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = 'ways_noded_vertices_pgr'
      )
    `, [stagingSchema]);
    
    console.log(`   - ways_noded_vertices_pgr exists: ${verticesExists.rows[0].exists}`);
    
    if (verticesExists.rows[0].exists) {
      const verticesCount = await pool.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded_vertices_pgr
      `);
      console.log(`   - vertices count: ${verticesCount.rows[0].count}`);
    }
    
    // Test pgr_hawickcircuits directly
    console.log('\n4. Testing pgr_hawickcircuits directly...');
    try {
      const cycles = await pool.query(`
        SELECT COUNT(*) as cycle_count 
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, cost, reverse_cost 
           FROM ${stagingSchema}.ways_noded 
           WHERE source IS NOT NULL AND target IS NOT NULL AND cost >= 0.1 
           ORDER BY id'
        )
      `);
      console.log(`   - pgr_hawickcircuits cycles found: ${cycles.rows[0].cycle_count}`);
    } catch (error) {
      console.error(`   - pgr_hawickcircuits error: ${error.message}`);
    }
    
    // Test route patterns
    console.log('\n5. Testing route patterns...');
    const patterns = await pool.query(`
      SELECT pattern_name, target_distance_km, target_elevation_gain, tolerance_percent
      FROM public.route_patterns 
      WHERE route_shape = 'loop' 
      ORDER BY target_distance_km
    `);
    console.log(`   - Loop patterns found: ${patterns.rows.length}`);
    patterns.rows.forEach(p => console.log(`     - ${p.pattern_name}: ${p.target_distance_km}km ± ${p.tolerance_percent}%`));
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

testRouteService();
