const { Pool } = require('pg');

// Database connection
const pgClient = new Pool({
  user: 'carthorse',
  host: 'localhost',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

async function testMultipointServiceDirect() {
  try {
    console.log('🔍 Testing MultipointIntersectionSplittingService directly on Foothills North Trail intersection...');
    
    // Import the service
    const { MultipointIntersectionSplittingService } = require('./dist/services/layer1/MultipointIntersectionSplittingService');
    
    // Create the service
    const service = new MultipointIntersectionSplittingService(pgClient, {
      stagingSchema: 'debug_1757184346845',
      toleranceMeters: 5.0,
      minTrailLengthMeters: 10.0,
      maxIntersectionPoints: 10,
      maxIterations: 5,
      verbose: true
    });
    
    // Get statistics before
    const statsBefore = await service.getIntersectionStatistics();
    console.log(`📊 Before: ${statsBefore.totalIntersections} intersections (${statsBefore.xIntersections} X-intersections, ${statsBefore.pIntersections} P-intersections)`);
    
    // Run the service
    const result = await service.splitMultipointIntersections();
    
    console.log(`📊 After: ${result.intersectionsProcessed} intersections processed, ${result.segmentsCreated} segments created`);
    
    if (result.success) {
      console.log('✅ Service completed successfully');
    } else {
      console.log('❌ Service failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testMultipointServiceDirect();
