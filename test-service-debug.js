const { Pool } = require('pg');
// We'll test the service logic directly instead of importing

// Database connection
const pgClient = new Pool({
  user: 'carthorse',
  host: 'localhost',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

async function testServiceDebug() {
  try {
    console.log('🔍 Testing MultipointIntersectionSplittingService...');
    
    // Create the service
    const service = new MultipointIntersectionSplittingService(pgClient, {
      stagingSchema: 'staging',
      toleranceMeters: 5.0,
      minTrailLengthMeters: 10.0,
      maxIntersectionPoints: 10,
      maxIterations: 20,
      verbose: true
    });
    
    // Get statistics before
    const statsBefore = await service.getIntersectionStatistics();
    console.log(`📊 Before: ${statsBefore.totalIntersections} intersections found`);
    
    // Run the service
    const result = await service.splitMultipointIntersections();
    
    console.log(`\n📊 Results:`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Intersections processed: ${result.intersectionsProcessed}`);
    console.log(`   Segments created: ${result.segmentsCreated}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    // Check what's in staging after
    const trailsAfter = await pgClient.query(`
      SELECT app_uuid, name, ST_Length(geometry::geography) as length_m
      FROM staging.trails 
      ORDER BY name, length_m
    `);
    
    console.log(`\n📊 Trails in staging after processing:`);
    for (const trail of trailsAfter.rows) {
      console.log(`   - ${trail.name}: ${trail.app_uuid} (${parseFloat(trail.length_m).toFixed(1)}m)`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testServiceDebug();
