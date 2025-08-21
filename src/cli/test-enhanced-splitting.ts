import { Command } from 'commander';
import { Pool } from 'pg';
import { EnhancedIntersectionSplittingService } from '../services/layer1/EnhancedIntersectionSplittingService';

const program = new Command();

program
  .name('test-enhanced-splitting')
  .description('Test enhanced intersection splitting with proper deduplication')
  .option('-s, --staging-schema <schema>', 'Staging schema to test', 'staging_boulder_test')
  .option('-r, --region <region>', 'Region to test', 'boulder')
  .option('-m, --min-length <meters>', 'Minimum trail length in meters', '5.0')
  .option('--dry-run', 'Show what would be done without making changes')
  .parse();

async function testEnhancedSplitting() {
  const options = program.opts();
  
  console.log('🧪 Testing Enhanced Intersection Splitting Service...');
  console.log(`   Staging Schema: ${options.stagingSchema}`);
  console.log(`   Region: ${options.region}`);
  console.log(`   Min Length: ${options.minLength}m`);
  console.log(`   Dry Run: ${options.dryRun ? 'Yes' : 'No'}`);
  
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'trail_master_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
  });
  
  try {
    // Check if staging schema exists
    const schemaExists = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.schemata 
        WHERE schema_name = $1
      )
    `, [options.stagingSchema]);
    
    if (!schemaExists.rows[0].exists) {
      console.error(`❌ Staging schema '${options.stagingSchema}' does not exist`);
      console.log('💡 Create a staging schema first using the main carthorse CLI');
      process.exit(1);
    }
    
    // Check if trails table exists
    const tableExists = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'trails'
      )
    `, [options.stagingSchema]);
    
    if (!tableExists.rows[0].exists) {
      console.error(`❌ Trails table does not exist in schema '${options.stagingSchema}'`);
      process.exit(1);
    }
    
    // Get initial state
    console.log('📊 Checking initial state...');
    const initialCount = await pool.query(`SELECT COUNT(*) as count FROM ${options.stagingSchema}.trails`);
    console.log(`   Initial trail count: ${initialCount.rows[0].count}`);
    
    // Check for trails with original_trail_uuid (already split)
    const alreadySplitCount = await pool.query(`
      SELECT COUNT(*) as count FROM ${options.stagingSchema}.trails 
      WHERE original_trail_uuid IS NOT NULL
    `);
    console.log(`   Already split trails: ${alreadySplitCount.rows[0].count}`);
    
    // Check for potential intersections
    const intersectionCount = await pool.query(`
      SELECT COUNT(*) as count FROM (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t2.app_uuid as trail2_uuid
        FROM ${options.stagingSchema}.trails t1
        JOIN ${options.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
      ) intersections
    `, [parseFloat(options.minLength)]);
    
    console.log(`   Potential intersections: ${intersectionCount.rows[0].count}`);
    
    if (intersectionCount.rows[0].count === 0) {
      console.log('✅ No intersections found - no splitting needed');
      return;
    }
    
    if (options.dryRun) {
      console.log('🔍 DRY RUN: Would apply enhanced intersection splitting');
      console.log(`   Would process ${intersectionCount.rows[0].count} potential intersections`);
      return;
    }
    
    // Apply enhanced intersection splitting
    console.log('🔗 Applying enhanced intersection splitting...');
    
    const splittingService = new EnhancedIntersectionSplittingService({
      stagingSchema: options.stagingSchema,
      pgClient: pool,
      minTrailLengthMeters: parseFloat(options.minLength)
    });
    
    const result = await splittingService.applyEnhancedIntersectionSplitting();
    
    console.log('📊 Splitting results:');
    console.log(`   Trails processed: ${result.trailsProcessed}`);
    console.log(`   Segments created: ${result.segmentsCreated}`);
    console.log(`   Intersections found: ${result.intersectionsFound}`);
    console.log(`   Original trails deleted: ${result.originalTrailsDeleted}`);
    
    // Check final state
    console.log('📊 Checking final state...');
    const finalCount = await pool.query(`SELECT COUNT(*) as count FROM ${options.stagingSchema}.trails`);
    console.log(`   Final trail count: ${finalCount.rows[0].count}`);
    
    const splitSegmentsCount = await pool.query(`
      SELECT COUNT(*) as count FROM ${options.stagingSchema}.trails 
      WHERE original_trail_uuid IS NOT NULL
    `);
    console.log(`   Split segments: ${splitSegmentsCount.rows[0].count}`);
    
    // Show some examples of split trails
    const splitExamples = await pool.query(`
      SELECT 
        app_uuid, 
        original_trail_uuid, 
        name, 
        ST_Length(geometry::geography) as length_meters
      FROM ${options.stagingSchema}.trails 
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
    
    console.log('✅ Enhanced intersection splitting test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the test
testEnhancedSplitting();
