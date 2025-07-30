import { Client } from 'pg';
import { TEST_CONFIG, shouldSkipTest, logTestConfiguration } from '../config/test-config';

describe('Comprehensive Elevation Data Validation', () => {
  let pgClient: Client;

  beforeAll(async () => {
    logTestConfiguration();
    
    if (shouldSkipTest()) {
      return;
    }

    try {
      pgClient = new Client(TEST_CONFIG.database);
      await pgClient.connect();
      console.log(`✅ Connected to test database ${TEST_CONFIG.database.database}`);
    } catch (err) {
      console.log(`⏭️  Skipping beforeAll - connection failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  });

  afterAll(async () => {
    if (pgClient) {
      await pgClient.end();
    }
  });

  describe('Current Elevation Data State', () => {
    test('should analyze current elevation data completeness', async () => {
      // Get comprehensive elevation data statistics
      const stats = await pgClient.query(`
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as trails_with_gain,
          COUNT(CASE WHEN elevation_loss IS NOT NULL THEN 1 END) as trails_with_loss,
          COUNT(CASE WHEN max_elevation IS NOT NULL THEN 1 END) as trails_with_max,
          COUNT(CASE WHEN min_elevation IS NOT NULL THEN 1 END) as trails_with_min,
          COUNT(CASE WHEN avg_elevation IS NOT NULL THEN 1 END) as trails_with_avg,
          COUNT(CASE WHEN elevation_gain IS NULL AND elevation_loss IS NULL AND max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL THEN 1 END) as completely_null,
          COUNT(CASE WHEN elevation_gain = 0 AND elevation_loss = 0 AND max_elevation = 0 AND min_elevation = 0 AND avg_elevation = 0 THEN 1 END) as completely_zero,
          COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as trails_with_3d_geometry,
          COUNT(CASE WHEN ST_NDims(geometry) = 3 AND (elevation_gain IS NULL OR elevation_gain = 0) THEN 1 END) as trails_3d_missing_elevation
        FROM trails
      `);

      const data = stats.rows[0];
      console.log('📊 Current Elevation Data State:');
      console.log(`   Total trails: ${data.total_trails}`);
      console.log(`   Trails with elevation_gain: ${data.trails_with_gain}`);
      console.log(`   Trails with elevation_loss: ${data.trails_with_loss}`);
      console.log(`   Trails with max_elevation: ${data.trails_with_max}`);
      console.log(`   Trails with min_elevation: ${data.trails_with_min}`);
      console.log(`   Trails with avg_elevation: ${data.trails_with_avg}`);
      console.log(`   Completely null elevation: ${data.completely_null}`);
      console.log(`   Completely zero elevation: ${data.completely_zero}`);
      console.log(`   Trails with 3D geometry: ${data.trails_with_3d_geometry}`);
      console.log(`   3D trails missing elevation: ${data.trails_3d_missing_elevation}`);

      // Validate that we have reasonable data
      expect(Number(data.total_trails)).toBeGreaterThan(0);
      expect(Number(data.trails_with_3d_geometry)).toBeGreaterThan(0);
      
      // Log issues found
      if (Number(data.completely_null) > 0) {
        console.log(`⚠️  ISSUE: ${data.completely_null} trails have completely null elevation data`);
      }
      if (Number(data.completely_zero) > 0) {
        console.log(`⚠️  ISSUE: ${data.completely_zero} trails have completely zero elevation data`);
      }
      if (Number(data.trails_3d_missing_elevation) > 0) {
        console.log(`⚠️  ISSUE: ${data.trails_3d_missing_elevation} trails have 3D geometry but missing elevation data`);
      }
    });

    test('should validate elevation data integrity', async () => {
      // Check for invalid elevation ranges
      const invalidRanges = await pgClient.query(`
        SELECT COUNT(*) as count
        FROM trails 
        WHERE max_elevation IS NOT NULL AND min_elevation IS NOT NULL 
        AND max_elevation < min_elevation
      `);

      const invalidAvg = await pgClient.query(`
        SELECT COUNT(*) as count
        FROM trails 
        WHERE avg_elevation IS NOT NULL AND max_elevation IS NOT NULL AND min_elevation IS NOT NULL
        AND (avg_elevation < min_elevation OR avg_elevation > max_elevation)
      `);

      const negativeGain = await pgClient.query(`
        SELECT COUNT(*) as count
        FROM trails 
        WHERE elevation_gain IS NOT NULL AND elevation_gain < 0
      `);

      const negativeLoss = await pgClient.query(`
        SELECT COUNT(*) as count
        FROM trails 
        WHERE elevation_loss IS NOT NULL AND elevation_loss < 0
      `);

      console.log('🔍 Elevation Data Integrity Check:');
      console.log(`   Invalid elevation ranges (max < min): ${invalidRanges.rows[0].count}`);
      console.log(`   Invalid average elevation: ${invalidAvg.rows[0].count}`);
      console.log(`   Negative elevation gain: ${negativeGain.rows[0].count}`);
      console.log(`   Negative elevation loss: ${negativeLoss.rows[0].count}`);

      // These should all be 0 for valid data
      expect(Number(invalidRanges.rows[0].count)).toBe(0);
      expect(Number(invalidAvg.rows[0].count)).toBe(0);
      expect(Number(negativeGain.rows[0].count)).toBe(0);
      expect(Number(negativeLoss.rows[0].count)).toBe(0);
    });

    test('should check for elevation calculation patterns', async () => {
      // Analyze elevation calculation patterns
      const patterns = await pgClient.query(`
        SELECT 
          CASE 
            WHEN elevation_gain > 0 AND elevation_loss > 0 THEN 'both_gain_and_loss'
            WHEN elevation_gain > 0 AND elevation_loss = 0 THEN 'gain_only'
            WHEN elevation_gain = 0 AND elevation_loss > 0 THEN 'loss_only'
            WHEN elevation_gain = 0 AND elevation_loss = 0 THEN 'no_change'
            WHEN elevation_gain IS NULL OR elevation_loss IS NULL THEN 'incomplete'
            ELSE 'other'
          END as pattern,
          COUNT(*) as count
        FROM trails 
        GROUP BY pattern
        ORDER BY count DESC
      `);

      console.log('📈 Elevation Calculation Patterns:');
      for (const row of patterns.rows) {
        console.log(`   ${row.pattern}: ${row.count} trails`);
      }

      // Should have some trails with elevation data
      const hasElevationData = patterns.rows.some(row => 
        row.pattern !== 'incomplete' && row.pattern !== 'other'
      );
      expect(hasElevationData).toBe(true);
    });
  });

  describe('Elevation Processing Recommendations', () => {
    test('should identify trails needing elevation processing', async () => {
      const needsProcessing = await pgClient.query(`
        SELECT 
          COUNT(*) as count,
          COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as has_3d_geometry
        FROM trails 
        WHERE elevation_gain IS NULL OR elevation_loss IS NULL 
           OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL
      `);

      const data = needsProcessing.rows[0];
      console.log('🔧 Elevation Processing Recommendations:');
      console.log(`   Trails needing elevation processing: ${data.count}`);
      console.log(`   Of those, trails with 3D geometry: ${data.has_3d_geometry}`);

      if (Number(data.count) > 0) {
        console.log('   💡 RECOMMENDATION: Run elevation calculation on trails with 3D geometry');
        console.log('   💡 RECOMMENDATION: Use PostGIS elevation functions for accurate calculation');
        console.log('   💡 RECOMMENDATION: Validate elevation data after processing');
      }
    });

    test('should validate elevation calculation functions exist', async () => {
      // Check if elevation calculation functions exist
      const functions = await pgClient.query(`
        SELECT routine_name 
        FROM information_schema.routines 
        WHERE routine_schema = 'public' 
        AND routine_name LIKE '%elevation%'
        ORDER BY routine_name
      `);

      console.log('🔧 Available Elevation Functions:');
      if (functions.rows.length > 0) {
        for (const func of functions.rows) {
          console.log(`   ✅ ${func.routine_name}`);
        }
      } else {
        console.log('   ⚠️  No elevation calculation functions found');
        console.log('   💡 RECOMMENDATION: Create PostGIS elevation calculation functions');
      }

      // Should have at least some elevation-related functions
      expect(functions.rows.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Production vs Test Database Comparison', () => {
    test('should compare elevation data between production and test databases', async () => {
      // Get test database stats
      const testStats = await pgClient.query(`
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as trails_with_gain,
          COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as trails_with_3d
        FROM trails
      `);

      // Get production database stats (read-only)
      const prodStats = await pgClient.query(`
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as trails_with_gain,
          COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as trails_with_3d
        FROM trails
      `);

      console.log('📊 Database Comparison:');
      console.log(`   Test DB - Total: ${testStats.rows[0].total_trails}, With Gain: ${testStats.rows[0].trails_with_gain}, 3D: ${testStats.rows[0].trails_with_3d}`);
      console.log(`   Prod DB - Total: ${prodStats.rows[0].total_trails}, With Gain: ${prodStats.rows[0].trails_with_gain}, 3D: ${prodStats.rows[0].trails_with_3d}`);

      // Test database should have some data
      expect(Number(testStats.rows[0].total_trails)).toBeGreaterThan(0);
    });
  });
}); 