import { Client } from 'pg';
import { TEST_CONFIG, shouldSkipTest, logTestConfiguration } from '../config/test-config';

describe('Elevation Source Data Validation', () => {
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

  describe('Source Data Quality Check', () => {
    test('should identify trails with missing elevation data in source', async () => {
      console.log('🔍 Checking source data for missing elevation information...');
      
      // Find trails with completely missing elevation data - OPTIMIZED QUERY
      const missingElevation = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          region,
          osm_id,
          ST_NDims(geometry) as geometry_dimensions,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation
        FROM trails 
        WHERE elevation_gain IS NULL 
          AND elevation_loss IS NULL 
          AND max_elevation IS NULL 
          AND min_elevation IS NULL 
          AND avg_elevation IS NULL
        ORDER BY name
        LIMIT 10
      `);

      console.log(`❌ FOUND ${missingElevation.rows.length} trails with completely missing elevation data:`);
      for (const trail of missingElevation.rows) {
        console.log(`   - ${trail.name} (${trail.region}) - ${trail.geometry_dimensions}D geometry`);
      }

      // Find trails with partial elevation data - OPTIMIZED QUERY
      const partialElevation = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          region,
          osm_id,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          CASE 
            WHEN elevation_gain IS NULL THEN 'missing_gain'
            WHEN elevation_loss IS NULL THEN 'missing_loss'
            WHEN max_elevation IS NULL THEN 'missing_max'
            WHEN min_elevation IS NULL THEN 'missing_min'
            WHEN avg_elevation IS NULL THEN 'missing_avg'
            ELSE 'other'
          END as missing_field
        FROM trails 
        WHERE (elevation_gain IS NULL OR elevation_loss IS NULL 
               OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL)
          AND NOT (elevation_gain IS NULL AND elevation_loss IS NULL 
                   AND max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL)
        ORDER BY name
        LIMIT 10
      `);

      console.log(`⚠️  FOUND ${partialElevation.rows.length} trails with partial elevation data:`);
      for (const trail of partialElevation.rows) {
        console.log(`   - ${trail.name} (${trail.region}) - Missing: ${trail.missing_field}`);
      }

      // Find trails with invalid elevation values - OPTIMIZED QUERY
      const invalidElevation = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          region,
          osm_id,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          CASE 
            WHEN elevation_gain < 0 THEN 'negative_gain'
            WHEN elevation_loss < 0 THEN 'negative_loss'
            WHEN max_elevation < min_elevation THEN 'invalid_range'
            WHEN avg_elevation < min_elevation OR avg_elevation > max_elevation THEN 'invalid_avg'
            ELSE 'other'
          END as issue_type
        FROM trails 
        WHERE (elevation_gain < 0 OR elevation_loss < 0 
               OR (max_elevation IS NOT NULL AND min_elevation IS NOT NULL AND max_elevation < min_elevation)
               OR (avg_elevation IS NOT NULL AND max_elevation IS NOT NULL AND min_elevation IS NOT NULL 
                   AND (avg_elevation < min_elevation OR avg_elevation > max_elevation)))
        ORDER BY name
        LIMIT 10
      `);

      console.log(`🚨 FOUND ${invalidElevation.rows.length} trails with invalid elevation values:`);
      for (const trail of invalidElevation.rows) {
        console.log(`   - ${trail.name} (${trail.region}) - Issue: ${trail.issue_type}`);
      }

      // Find trails with 3D geometry but missing elevation data - OPTIMIZED QUERY
      const threeDMissingElevation = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          region,
          osm_id,
          ST_NDims(geometry) as geometry_dimensions,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation
        FROM trails 
        WHERE ST_NDims(geometry) = 3 
          AND (elevation_gain IS NULL OR elevation_gain = 0)
        ORDER BY name
        LIMIT 10
      `);

      console.log(`🔧 FOUND ${threeDMissingElevation.rows.length} trails with 3D geometry but missing elevation data:`);
      for (const trail of threeDMissingElevation.rows) {
        console.log(`   - ${trail.name} (${trail.region}) - 3D geometry but no elevation`);
      }

      // Log summary statistics - OPTIMIZED QUERY
      const summary = await pgClient.query(`
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN elevation_gain IS NULL AND elevation_loss IS NULL AND max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL THEN 1 END) as completely_missing,
          COUNT(CASE WHEN elevation_gain < 0 OR elevation_loss < 0 THEN 1 END) as negative_values,
          COUNT(CASE WHEN max_elevation IS NOT NULL AND min_elevation IS NOT NULL AND max_elevation < min_elevation THEN 1 END) as invalid_ranges,
          COUNT(CASE WHEN ST_NDims(geometry) = 3 AND (elevation_gain IS NULL OR elevation_gain = 0) THEN 1 END) as three_d_missing_elevation
        FROM trails
      `);

      const stats = summary.rows[0];
      console.log('\n📊 SOURCE DATA QUALITY SUMMARY:');
      console.log(`   Total trails: ${stats.total_trails}`);
      console.log(`   Completely missing elevation: ${stats.completely_missing} (${((stats.completely_missing / stats.total_trails) * 100).toFixed(1)}%)`);
      console.log(`   Negative elevation values: ${stats.negative_values}`);
      console.log(`   Invalid elevation ranges: ${stats.invalid_ranges}`);
      console.log(`   3D geometry missing elevation: ${stats.three_d_missing_elevation}`);

      // Fail the test if there are critical data quality issues
      const criticalIssues = Number(stats.completely_missing) + Number(stats.negative_values) + Number(stats.invalid_ranges);
      
      if (criticalIssues > 0) {
        console.log(`\n❌ CRITICAL: Found ${criticalIssues} trails with critical elevation data issues`);
        console.log('   These trails should be excluded from processing or fixed before proceeding');
        
        // Log specific trails to exclude
        const criticalTrails = await pgClient.query(`
          SELECT app_uuid, name, region
          FROM trails 
          WHERE (elevation_gain IS NULL AND elevation_loss IS NULL AND max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL)
             OR elevation_gain < 0 OR elevation_loss < 0
             OR (max_elevation IS NOT NULL AND min_elevation IS NOT NULL AND max_elevation < min_elevation)
          ORDER BY name
          LIMIT 20
        `);

        console.log('\n🚫 TRAILS TO EXCLUDE FROM PROCESSING:');
        for (const trail of criticalTrails.rows) {
          console.log(`   - ${trail.name} (${trail.app_uuid}) - ${trail.region}`);
        }
      } else {
        console.log('\n✅ No critical elevation data issues found');
      }

      // Assert that we don't have too many critical issues (allow some tolerance)
      expect(criticalIssues).toBeLessThanOrEqual(stats.total_trails * 0.1); // Allow up to 10% critical issues
    });

    test('should validate geometry quality for elevation processing', async () => {
      console.log('🔍 Checking geometry quality for elevation processing...');
      
      // Find trails with invalid geometry
      const invalidGeometry = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          region,
          ST_IsValid(geometry) as is_valid,
          ST_NDims(geometry) as dimensions,
          ST_NPoints(geometry) as point_count
        FROM trails 
        WHERE NOT ST_IsValid(geometry) OR ST_NPoints(geometry) < 2
        ORDER BY name
        LIMIT 10
      `);

      console.log(`❌ FOUND ${invalidGeometry.rows.length} trails with invalid geometry:`);
      for (const trail of invalidGeometry.rows) {
        console.log(`   - ${trail.name} (${trail.region}) - Valid: ${trail.is_valid}, Dims: ${trail.dimensions}, Points: ${trail.point_count}`);
      }

      // Find trails with insufficient geometry for elevation calculation
      const insufficientGeometry = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          region,
          ST_NDims(geometry) as dimensions,
          ST_NPoints(geometry) as point_count,
          ST_Length(geometry) as length_meters
        FROM trails 
        WHERE ST_NPoints(geometry) < 3 OR ST_Length(geometry) < 1
        ORDER BY name
        LIMIT 10
      `);

      console.log(`⚠️  FOUND ${insufficientGeometry.rows.length} trails with insufficient geometry for elevation calculation:`);
      for (const trail of insufficientGeometry.rows) {
        console.log(`   - ${trail.name} (${trail.region}) - Points: ${trail.point_count}, Length: ${trail.length_meters?.toFixed(1)}m`);
      }

      // Summary of geometry issues
      const geometrySummary = await pgClient.query(`
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN NOT ST_IsValid(geometry) THEN 1 END) as invalid_geometry,
          COUNT(CASE WHEN ST_NPoints(geometry) < 2 THEN 1 END) as insufficient_points,
          COUNT(CASE WHEN ST_NDims(geometry) = 2 THEN 1 END) as two_dimensional,
          COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as three_dimensional
        FROM trails
      `);

      const geomStats = geometrySummary.rows[0];
      console.log('\n📊 GEOMETRY QUALITY SUMMARY:');
      console.log(`   Total trails: ${geomStats.total_trails}`);
      console.log(`   Invalid geometry: ${geomStats.invalid_geometry}`);
      console.log(`   Insufficient points (<2): ${geomStats.insufficient_points}`);
      console.log(`   2D geometry: ${geomStats.two_dimensional}`);
      console.log(`   3D geometry: ${geomStats.three_dimensional}`);

      // Fail if there are too many geometry issues
      const geometryIssues = Number(geomStats.invalid_geometry) + Number(geomStats.insufficient_points);
      expect(geometryIssues).toBeLessThanOrEqual(Number(geomStats.total_trails) * 0.05); // Allow up to 5% geometry issues
    });

    test('should provide recommendations for data cleanup', async () => {
      console.log('💡 PROVIDING DATA CLEANUP RECOMMENDATIONS...');
      
      // Get comprehensive data quality metrics
      const qualityMetrics = await pgClient.query(`
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN elevation_gain IS NULL AND elevation_loss IS NULL AND max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL THEN 1 END) as missing_elevation,
          COUNT(CASE WHEN elevation_gain < 0 OR elevation_loss < 0 THEN 1 END) as negative_elevation,
          COUNT(CASE WHEN max_elevation < min_elevation THEN 1 END) as invalid_ranges,
          COUNT(CASE WHEN NOT ST_IsValid(geometry) THEN 1 END) as invalid_geometry,
          COUNT(CASE WHEN ST_NPoints(geometry) < 2 THEN 1 END) as insufficient_points,
          COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as three_d_geometry
        FROM trails
      `);

      const metrics = qualityMetrics.rows[0];
      const totalTrails = Number(metrics.total_trails);
      
      console.log('\n🔧 DATA CLEANUP RECOMMENDATIONS:');
      
      if (Number(metrics.missing_elevation) > 0) {
        const percentage = ((Number(metrics.missing_elevation) / totalTrails) * 100).toFixed(1);
        console.log(`   ❌ ${metrics.missing_elevation} trails (${percentage}%) have missing elevation data`);
        console.log('      → RECOMMENDATION: Exclude these trails from elevation processing');
        console.log('      → RECOMMENDATION: Run elevation calculation only on trails with 3D geometry');
      }
      
      if (Number(metrics.negative_elevation) > 0) {
        console.log(`   ❌ ${metrics.negative_elevation} trails have negative elevation values`);
        console.log('      → RECOMMENDATION: Fix or exclude these trails');
      }
      
      if (Number(metrics.invalid_ranges) > 0) {
        console.log(`   ❌ ${metrics.invalid_ranges} trails have invalid elevation ranges`);
        console.log('      → RECOMMENDATION: Recalculate elevation for these trails');
      }
      
      if (Number(metrics.invalid_geometry) > 0) {
        console.log(`   ❌ ${metrics.invalid_geometry} trails have invalid geometry`);
        console.log('      → RECOMMENDATION: Fix geometry or exclude these trails');
      }
      
      if (Number(metrics.insufficient_points) > 0) {
        console.log(`   ❌ ${metrics.insufficient_points} trails have insufficient geometry points`);
        console.log('      → RECOMMENDATION: Exclude these trails from processing');
      }
      
      if (Number(metrics.three_d_geometry) > 0) {
        const percentage = ((Number(metrics.three_d_geometry) / totalTrails) * 100).toFixed(1);
        console.log(`   ✅ ${metrics.three_d_geometry} trails (${percentage}%) have 3D geometry for elevation processing`);
        console.log('      → RECOMMENDATION: Use these trails for elevation calculation');
      }

      // Provide specific SQL for data cleanup
      console.log('\n📝 SUGGESTED DATA CLEANUP SQL:');
      console.log('   -- Exclude trails with critical issues:');
      console.log('   DELETE FROM trails WHERE');
      console.log('     elevation_gain < 0 OR elevation_loss < 0 OR');
      console.log('     (max_elevation IS NOT NULL AND min_elevation IS NOT NULL AND max_elevation < min_elevation) OR');
      console.log('     NOT ST_IsValid(geometry) OR ST_NPoints(geometry) < 2;');
      console.log('');
      console.log('   -- Process only trails with 3D geometry:');
      console.log('   SELECT * FROM trails WHERE ST_NDims(geometry) = 3;');
    });
  });
}); 