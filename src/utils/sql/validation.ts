// SQL-based validation and bbox helpers for orchestrator
import { Client } from 'pg';

export async function validateStagingData(pgClient: Client, stagingSchema: string, region: string, regionBbox: any, verbose: boolean = false): Promise<any> {
  console.log('🔍 Validating critical staging data requirements...');
  // Calculate and display region bounding box
  const bbox = await calculateAndDisplayRegionBbox(pgClient, stagingSchema, region, verbose);
  // Essential validation checks
  const missingElevation = await pgClient.query(`
    SELECT COUNT(*) as count FROM ${stagingSchema}.trails
    WHERE elevation_gain IS NULL OR elevation_loss IS NULL 
       OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL
  `);
  const missingGeometry = await pgClient.query(`
    SELECT COUNT(*) as count FROM ${stagingSchema}.trails
    WHERE geometry IS NULL OR geometry_text IS NULL
  `);
  const invalidBbox = await pgClient.query(`
    SELECT COUNT(*) as count FROM ${stagingSchema}.trails
    WHERE bbox_min_lng IS NULL OR bbox_max_lng IS NULL 
       OR bbox_min_lat IS NULL OR bbox_max_lat IS NULL
       OR bbox_min_lng >= bbox_max_lng OR bbox_min_lat >= bbox_max_lat
  `);
  const duplicateUuids = await pgClient.query(`
    SELECT COUNT(*) as count FROM (
      SELECT app_uuid, COUNT(*) as cnt 
      FROM ${stagingSchema}.trails 
      GROUP BY app_uuid 
      HAVING COUNT(*) > 1
    ) as duplicates
  `);
  const totalTrailsResult = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
  const totalTrails = totalTrailsResult.rows[0].count;
  console.log(`📊 Staging validation results:`);
  console.log(`   - Total trails: ${totalTrails}`);
  console.log(`   - Missing elevation: ${missingElevation.rows[0].count}`);
  console.log(`   - Missing geometry: ${missingGeometry.rows[0].count}`);
  console.log(`   - Invalid bbox: ${invalidBbox.rows[0].count}`);
  console.log(`   - Duplicate UUIDs: ${duplicateUuids.rows[0].count}`);
  const totalIssues = missingElevation.rows[0].count + missingGeometry.rows[0].count + invalidBbox.rows[0].count + duplicateUuids.rows[0].count;
  if (totalIssues > 0) {
    console.error('\n❌ CRITICAL: Staging validation failed!');
    console.error('   Essential requirements not met:');
    if (missingElevation.rows[0].count > 0) {
      console.error(`   - ${missingElevation.rows[0].count} trails missing elevation data`);
    }
    if (missingGeometry.rows[0].count > 0) {
      console.error(`   - ${missingGeometry.rows[0].count} trails missing geometry data`);
    }
    if (invalidBbox.rows[0].count > 0) {
      console.error(`   - ${invalidBbox.rows[0].count} trails have invalid bounding boxes`);
    }
    if (duplicateUuids.rows[0].count > 0) {
      console.error(`   - ${duplicateUuids.rows[0].count} duplicate UUIDs found`);
    }
    console.error('\n💡 Fix source data in PostgreSQL before re-running export.');
    process.exit(1);
  }
  console.log('✅ Staging validation passed - all trails meet critical requirements');
  return bbox;
}

export async function calculateAndDisplayRegionBbox(pgClient: Client, stagingSchema: string, region: string, verbose: boolean = false): Promise<any> {
  console.log('🗺️  Calculating region bounding box...');
  const bboxResult = await pgClient.query(`
    SELECT 
      MIN(bbox_min_lng) as min_lng,
      MAX(bbox_max_lng) as max_lng,
      MIN(bbox_min_lat) as min_lat,
      MAX(bbox_max_lat) as max_lat,
      COUNT(*) as trail_count
    FROM ${stagingSchema}.trails
  `);
  if (bboxResult.rows.length > 0) {
    const bbox = bboxResult.rows[0];
    if (!bbox || bbox.min_lng == null || bbox.max_lng == null || bbox.min_lat == null || bbox.max_lat == null) {
      console.warn('⚠️  No valid bounding box found for region:', region);
      return null;
    }
    console.log(`📐 Region bounding box (${region}):`);
    console.log(`   - Longitude: ${bbox.min_lng.toFixed(6)}°W to ${bbox.max_lng.toFixed(6)}°W`);
    console.log(`   - Latitude:  ${bbox.min_lat.toFixed(6)}°N to ${bbox.max_lat.toFixed(6)}°N`);
    console.log(`   - Trail count: ${bbox.trail_count}`);
    const widthDegrees = Math.abs(bbox.max_lng - bbox.min_lng);
    const heightDegrees = Math.abs(bbox.max_lat - bbox.min_lat);
    const areaKm2 = widthDegrees * heightDegrees * 111 * 111;
    console.log(`   - Approximate area: ${areaKm2.toFixed(1)} km²`);
    if (verbose) {
      // Optionally log more details or update region config
    }
    return {
      minLng: bbox.min_lng,
      maxLng: bbox.max_lng,
      minLat: bbox.min_lat,
      maxLat: bbox.max_lat,
      trailCount: bbox.trail_count
    };
  } else {
    console.log('⚠️  No trails found in staging - cannot calculate bounding box');
    return null;
  }
} 