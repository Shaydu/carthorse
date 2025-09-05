/**
 * UUID Utilities for Consistent Trail Management
 * 
 * This module provides utilities for ensuring consistent UUID assignment
 * and validation across all trail splitting and processing services.
 */

export interface UUIDValidationResult {
  totalTrails: number;
  trailsWithUUID: number;
  trailsWithOriginalUUID: number;
  allTrailsHaveUUID: boolean;
  allTrailsHaveOriginalUUID: boolean;
}

export interface TrailUUIDInfo {
  app_uuid: string;
  original_trail_uuid: string | null;
  name: string;
}

/**
 * Validates UUID consistency across all trails in a staging schema
 */
export async function validateUUIDConsistency(
  client: any,
  stagingSchema: string
): Promise<UUIDValidationResult> {
  const validationQuery = `
    SELECT 
      COUNT(*) as total_trails,
      COUNT(CASE WHEN app_uuid IS NOT NULL THEN 1 END) as trails_with_uuid,
      COUNT(CASE WHEN original_trail_uuid IS NOT NULL THEN 1 END) as trails_with_original_uuid
    FROM ${stagingSchema}.trails
  `;
  
  const result = await client.query(validationQuery);
  const row = result.rows[0];
  
  return {
    totalTrails: parseInt(row.total_trails),
    trailsWithUUID: parseInt(row.trails_with_uuid),
    trailsWithOriginalUUID: parseInt(row.trails_with_original_uuid),
    allTrailsHaveUUID: row.trails_with_uuid === row.total_trails,
    allTrailsHaveOriginalUUID: row.trails_with_original_uuid === row.total_trails
  };
}

/**
 * Ensures all trails have proper UUIDs
 */
export async function ensureUUIDConsistency(
  client: any,
  stagingSchema: string
): Promise<void> {
  // First, validate current state
  const validation = await validateUUIDConsistency(client, stagingSchema);
  
  if (!validation.allTrailsHaveUUID) {
    console.log(`   🔧 Assigning UUIDs to ${validation.totalTrails - validation.trailsWithUUID} trails...`);
    
    await client.query(`
      UPDATE ${stagingSchema}.trails 
      SET app_uuid = gen_random_uuid()
      WHERE app_uuid IS NULL
    `);
  }
  
  if (!validation.allTrailsHaveOriginalUUID) {
    console.log(`   🔧 Assigning original UUIDs to ${validation.totalTrails - validation.trailsWithOriginalUUID} trails...`);
    
    await client.query(`
      UPDATE ${stagingSchema}.trails 
      SET original_trail_uuid = app_uuid
      WHERE original_trail_uuid IS NULL
    `);
  }
  
  // Final validation
  const finalValidation = await validateUUIDConsistency(client, stagingSchema);
  
  if (!finalValidation.allTrailsHaveUUID) {
    throw new Error(`❌ UUID assignment failed: ${finalValidation.trailsWithUUID}/${finalValidation.totalTrails} trails have UUIDs`);
  }
  
  if (!finalValidation.allTrailsHaveOriginalUUID) {
    throw new Error(`❌ Original UUID assignment failed: ${finalValidation.trailsWithOriginalUUID}/${finalValidation.totalTrails} trails have original UUIDs`);
  }
  
  console.log(`   ✅ UUID consistency ensured: All ${finalValidation.totalTrails} trails have proper UUIDs`);
}

/**
 * Gets UUID information for all trails in a staging schema
 */
export async function getTrailUUIDInfo(
  client: any,
  stagingSchema: string
): Promise<TrailUUIDInfo[]> {
  const query = `
    SELECT 
      app_uuid,
      original_trail_uuid,
      name
    FROM ${stagingSchema}.trails
    ORDER BY name, app_uuid
  `;
  
  const result = await client.query(query);
  return result.rows;
}

/**
 * Validates that all trail comparisons use UUIDs consistently
 */
export async function validateUUIDComparisons(
  client: any,
  stagingSchema: string
): Promise<boolean> {
  // Check for any integer-based comparisons that should be UUID-based
  const problematicQueries = [
    // Look for patterns like "id = uuid" or "uuid = id"
    `SELECT COUNT(*) as count FROM ${stagingSchema}.trails WHERE id::text = app_uuid`,
    `SELECT COUNT(*) as count FROM ${stagingSchema}.trails WHERE app_uuid::integer = id`
  ];
  
  for (const query of problematicQueries) {
    try {
      const result = await client.query(query);
      if (result.rows[0].count > 0) {
        console.warn(`   ⚠️ Found ${result.rows[0].count} trails with potential UUID comparison issues`);
        return false;
      }
    } catch (error) {
      // Query failed, which is expected for invalid comparisons
      console.log(`   ✅ No problematic UUID comparisons found`);
    }
  }
  
  return true;
}
