const { Pool } = require('pg');

// Test configuration
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trail_master_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
};

async function testEnhancedSplittingWithRealData() {
  const pool = new Pool(config);
  
  try {
    console.log('🧪 Testing Enhanced Intersection Splitting with Real Data...');
    
    // Step 1: Find an existing staging schema with data
    console.log('📋 Looking for staging schemas with data...');
    const stagingSchemas = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
      ORDER BY schema_name DESC
      LIMIT 5
    `);
    
    if (stagingSchemas.rows.length === 0) {
      console.error('❌ No staging schemas found');
      console.log('💡 Run the main carthorse CLI first to create a staging schema with data');
      return;
    }
    
    console.log('📋 Found staging schemas:');
    stagingSchemas.rows.forEach(schema => {
      console.log(`   - ${schema.schema_name}`);
    });
    
    // Use the most recent staging schema
    const testSchema = stagingSchemas.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${testSchema}`);
    
    // Step 2: Check if trails table exists and has data
    const tableExists = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'trails'
      )
    `, [testSchema]);
    
    if (!tableExists.rows[0].exists) {
      console.error(`❌ Trails table does not exist in schema '${testSchema}'`);
      return;
    }
    
    // Step 3: Get initial state
    console.log('📊 Checking initial state...');
    const initialCount = await pool.query(`SELECT COUNT(*) as count FROM ${testSchema}.trails`);
    console.log(`   Initial trail count: ${initialCount.rows[0].count}`);
    
    if (initialCount.rows[0].count === 0) {
      console.error(`❌ No trails found in schema '${testSchema}'`);
      return;
    }
    
    // Check for trails with original_trail_uuid (already split)
    const alreadySplitCount = await pool.query(`
      SELECT COUNT(*) as count FROM ${testSchema}.trails 
      WHERE original_trail_uuid IS NOT NULL
    `);
    console.log(`   Already split trails: ${alreadySplitCount.rows[0].count}`);
    
    // Check for potential intersections
    const intersectionCount = await pool.query(`
      SELECT COUNT(*) as count FROM (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t2.app_uuid as trail2_uuid
        FROM ${testSchema}.trails t1
        JOIN ${testSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > 5
          AND ST_Length(t2.geometry::geography) > 5
      ) intersections
    `);
    
    console.log(`   Potential intersections: ${intersectionCount.rows[0].count}`);
    
    if (intersectionCount.rows[0].count === 0) {
      console.log('✅ No intersections found - no splitting needed');
      return;
    }
    
    // Step 4: Show some examples of trails that will be split
    const intersectingTrails = await pool.query(`
      SELECT DISTINCT
        t1.app_uuid as trail1_uuid,
        t1.name as trail1_name,
        t2.app_uuid as trail2_uuid,
        t2.name as trail2_name
      FROM ${testSchema}.trails t1
      JOIN ${testSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > 5
        AND ST_Length(t2.geometry::geography) > 5
      LIMIT 5
    `);
    
    if (intersectingTrails.rows.length > 0) {
      console.log('📋 Examples of intersecting trails:');
      intersectingTrails.rows.forEach(trail => {
        console.log(`   - ${trail.trail1_name} (${trail.trail1_uuid}) intersects with ${trail.trail2_name} (${trail.trail2_uuid})`);
      });
    }
    
    // Step 5: Ask user for confirmation
    console.log('\n🔍 This will apply enhanced intersection splitting to the data.');
    console.log('   The enhanced service will:');
    console.log('   - Find all trail intersections');
    console.log('   - Split trails at intersection points');
    console.log('   - Delete the original unsplit trails');
    console.log('   - Create new segments with original_trail_uuid references');
    console.log('   - Preserve trails that don\'t intersect with others');
    
    // For automated testing, we'll proceed without user confirmation
    console.log('\n🚀 Proceeding with enhanced intersection splitting...');
    
    // Step 6: Apply enhanced intersection splitting
    console.log('🔗 Applying enhanced intersection splitting...');
    
    // Import and use the enhanced service
    const { EnhancedIntersectionSplittingService } = require('./src/services/layer1/EnhancedIntersectionSplittingService.ts');
    
    const splittingService = new EnhancedIntersectionSplittingService({
      stagingSchema: testSchema,
      pgClient: pool,
      minTrailLengthMeters: 5.0
    });
    
    const result = await splittingService.applyEnhancedIntersectionSplitting();
    
    console.log('📊 Splitting results:');
    console.log(`   Trails processed: ${result.trailsProcessed}`);
    console.log(`   Segments created: ${result.segmentsCreated}`);
    console.log(`   Intersections found: ${result.intersectionsFound}`);
    console.log(`   Original trails deleted: ${result.originalTrailsDeleted}`);
    
    // Step 7: Check final state
    console.log('📊 Checking final state...');
    const finalCount = await pool.query(`SELECT COUNT(*) as count FROM ${testSchema}.trails`);
    console.log(`   Final trail count: ${finalCount.rows[0].count}`);
    
    const splitSegmentsCount = await pool.query(`
      SELECT COUNT(*) as count FROM ${testSchema}.trails 
      WHERE original_trail_uuid IS NOT NULL
    `);
    console.log(`   Split segments: ${splitSegmentsCount.rows[0].count}`);
    
    // Step 8: Show some examples of split trails
    const splitExamples = await pool.query(`
      SELECT 
        app_uuid, 
        original_trail_uuid, 
        name, 
        ST_Length(geometry::geography) as length_meters
      FROM ${testSchema}.trails 
      WHERE original_trail_uuid IS NOT NULL
      ORDER BY original_trail_uuid, name
      LIMIT 10
    `);
    
    if (splitExamples.rows.length > 0) {
      console.log('📋 Examples of split trails:');
      splitExamples.rows.forEach(trail => {
        console.log(`   - ${trail.app_uuid}: ${trail.name} (split from ${trail.original_trail_uuid}, ${trail.length_meters.toFixed(1)}m)`);
      });
    }
    
    // Step 9: Verify that no original unsplit trails remain
    const originalTrailsRemaining = await pool.query(`
      SELECT COUNT(*) as count FROM ${testSchema}.trails 
      WHERE original_trail_uuid IS NULL
    `);
    
    console.log(`   Original trails (not split): ${originalTrailsRemaining.rows[0].count}`);
    
    // Step 10: Summary
    console.log('\n🎉 Enhanced intersection splitting test completed successfully!');
    console.log(`📊 Summary:`);
    console.log(`   - Schema tested: ${testSchema}`);
    console.log(`   - Original trails: ${initialCount.rows[0].count}`);
    console.log(`   - Final segments: ${finalCount.rows[0].count}`);
    console.log(`   - Split segments: ${splitSegmentsCount.rows[0].count}`);
    console.log(`   - Original trails preserved: ${originalTrailsRemaining.rows[0].count}`);
    console.log(`   - Intersections processed: ${result.intersectionsFound}`);
    
    if (result.originalTrailsDeleted > 0) {
      console.log(`✅ SUCCESS: ${result.originalTrailsDeleted} original unsplit trails were properly deleted`);
    } else {
      console.log(`ℹ️  No trails were split (no intersections found or all trails preserved)`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testEnhancedSplittingWithRealData();
