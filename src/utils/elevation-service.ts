import { Client } from 'pg';
import { AtomicTrailInserter } from '../tools/carthorse-postgres-atomic-insert';
import { parseGeometryText } from './geometry-parser';

export interface ElevationData {
  elevation_gain: number;
  elevation_loss: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
  elevations: number[];
}

export interface ElevationValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  nullElevationCount: number;
  zeroElevationCount: number;
  invalidRangeCount: number;
  missing3DElevationCount: number;
}

export interface ElevationProcessingResult {
  processed: number;
  updated: number;
  failed: number;
  errors: string[];
}

/**
 * Convert database query result to number, handling string/number types
 */
function toNumber(value: string | number | null): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export class ElevationService {
  private pgClient: Client;
  private atomicInserter: AtomicTrailInserter;

  constructor(pgClient: Client) {
    this.pgClient = pgClient;
    this.atomicInserter = new AtomicTrailInserter(process.env.PGDATABASE || 'trail_master_db_test');
  }

  /**
   * Initialize elevation data for all trails (set to null by default)
   */
  async initializeElevationData(schemaName: string): Promise<void> {
    console.log('🗻 Initializing elevation data for all trails...');
    
    const updateSql = `
      UPDATE ${schemaName}.trails 
      SET 
        elevation_gain = NULL,
        elevation_loss = NULL,
        max_elevation = NULL,
        min_elevation = NULL,
        avg_elevation = NULL
      WHERE elevation_gain IS NOT NULL 
         OR elevation_loss IS NOT NULL 
         OR max_elevation IS NOT NULL 
         OR min_elevation IS NOT NULL 
         OR avg_elevation IS NOT NULL
    `;
    
    const result = await this.pgClient.query(updateSql);
    console.log(`✅ Reset elevation data for ${result.rowCount} trails to null`);
  }

  /**
   * Process elevation data for trails that need it
   * NO FALLBACKS - if elevation data cannot be calculated, the processing fails
   */
  async processMissingElevationData(schemaName: string): Promise<ElevationProcessingResult> {
    console.log('📈 Processing missing elevation data...');
    
    // Get trails that need elevation calculation
    const trailsNeedingElevation = await this.pgClient.query(`
      SELECT id, app_uuid, name, osm_id, ST_AsText(geometry) as geometry_text
      FROM ${schemaName}.trails
      WHERE elevation_gain IS NULL OR elevation_loss IS NULL 
         OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL
    `);
    
    if (trailsNeedingElevation.rows.length === 0) {
      console.log('✅ All trails already have elevation data');
      return { processed: 0, updated: 0, failed: 0, errors: [] };
    }
    
    console.log(`🎯 Processing ${trailsNeedingElevation.rows.length} trails that need elevation data...`);
    
    // Initialize atomic inserter for elevation calculation
    await this.atomicInserter.connect();
    
    let processed = 0;
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];
    
    for (const trail of trailsNeedingElevation.rows) {
      try {
        processed++;
        
        if (processed % 10 === 0) {
          console.log(`⏳ Progress: ${processed}/${trailsNeedingElevation.rows.length} trails processed`);
        }
        
        // Parse geometry to coordinates
        const coordinates = parseGeometryText(trail.geometry_text);
        if (coordinates.length === 0) {
          const error = `Failed to parse geometry for trail: ${trail.name} (${trail.osm_id})`;
          console.error(`❌ ${error}`);
          errors.push(error);
          failed++;
          continue;
        }
        
        // Calculate elevation data using atomic inserter (NO FALLBACKS)
        const elevationData = await this.atomicInserter.processTrailElevation(coordinates);
        
        // Update trail with elevation data
        await this.pgClient.query(`
          UPDATE ${schemaName}.trails 
          SET 
            elevation_gain = $1,
            elevation_loss = $2,
            max_elevation = $3,
            min_elevation = $4,
            avg_elevation = $5,
            updated_at = NOW()
          WHERE id = $6
        `, [
          elevationData.elevation_gain,
          elevationData.elevation_loss,
          elevationData.max_elevation,
          elevationData.min_elevation,
          elevationData.avg_elevation,
          trail.id
        ]);
        
        updated++;
        
      } catch (error) {
        const errorMsg = `Error processing trail ${trail.name}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        failed++;
      }
    }
    
    await this.atomicInserter.disconnect();
    
    console.log(`\n📊 Elevation processing complete:`);
    console.log(`   - Processed: ${processed} trails`);
    console.log(`   - Updated: ${updated} trails`);
    console.log(`   - Failed: ${failed} trails`);
    
    // CRITICAL: If any trails failed, throw an error
    if (failed > 0) {
      throw new Error(`Elevation processing failed for ${failed} trails. Export cannot proceed.`);
    }
    
    return { processed, updated, failed, errors };
  }

  /**
   * Validate elevation data integrity
   */
  async validateElevationData(schemaName: string): Promise<ElevationValidationResult> {
    console.log('🔍 Validating elevation data integrity...');
    
    const result: ElevationValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      nullElevationCount: 0,
      zeroElevationCount: 0,
      invalidRangeCount: 0,
      missing3DElevationCount: 0
    };
    
    // Check for trails with null elevation data (ERROR - should not be null)
    const nullElevationResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.trails
      WHERE elevation_gain IS NULL OR elevation_loss IS NULL 
         OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL
    `);
    
    result.nullElevationCount = toNumber(nullElevationResult.rows[0].count);
    
    if (result.nullElevationCount > 0) {
      const error = `${result.nullElevationCount} trails have null elevation data`;
      console.error(`❌ ELEVATION VALIDATION FAILED: ${error}`);
      console.error('   Null elevation values indicate missing or failed elevation calculation');
      result.errors.push(error);
      result.isValid = false;
    }
    
    // Check for trails with all zero elevation values (ERROR - indicates calculation failure)
    const zeroElevationResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.trails
      WHERE elevation_gain = 0 AND elevation_loss = 0 AND max_elevation = 0 AND min_elevation = 0 AND avg_elevation = 0
    `);
    
    result.zeroElevationCount = toNumber(zeroElevationResult.rows[0].count);
    
    if (result.zeroElevationCount > 0) {
      const error = `${result.zeroElevationCount} trails have zero elevation data`;
      console.error(`❌ ELEVATION VALIDATION FAILED: ${error}`);
      console.error('   This indicates elevation calculation failed for these trails');
      result.errors.push(error);
      result.isValid = false;
    }
    
    // Check for invalid elevation ranges
    const invalidRangeResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.trails
      WHERE max_elevation < min_elevation OR avg_elevation < min_elevation OR avg_elevation > max_elevation
    `);
    
    result.invalidRangeCount = toNumber(invalidRangeResult.rows[0].count);
    
    if (result.invalidRangeCount > 0) {
      const error = `${result.invalidRangeCount} trails have invalid elevation ranges`;
      console.error(`❌ ELEVATION VALIDATION FAILED: ${error}`);
      console.error('   max_elevation must be >= min_elevation, avg_elevation must be between min and max');
      result.errors.push(error);
      result.isValid = false;
    }
    
    // Check for 3D geometry with missing elevation
    const missing3DElevationResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.trails
      WHERE ST_NDims(geometry) = 3 AND (elevation_gain IS NULL OR elevation_gain = 0)
    `);
    
    result.missing3DElevationCount = toNumber(missing3DElevationResult.rows[0].count);
    
    if (result.missing3DElevationCount > 0) {
      const error = `${result.missing3DElevationCount} trails have 3D geometry but missing elevation data`;
      console.error(`❌ ELEVATION VALIDATION FAILED: ${error}`);
      console.error('   Trails with 3D geometry must have valid elevation data');
      result.errors.push(error);
      result.isValid = false;
    }
    
    if (result.isValid) {
      console.log('✅ Elevation data validation passed - all trails have complete elevation data');
    }
    
    return result;
  }

  /**
   * Get elevation statistics
   */
  async getElevationStats(schemaName: string): Promise<{
    total_trails: number;
    trails_with_elevation: number;
    trails_missing_elevation: number;
  }> {
    const stats = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN elevation_gain IS NOT NULL AND elevation_loss IS NOT NULL 
                   AND max_elevation IS NOT NULL AND min_elevation IS NOT NULL AND avg_elevation IS NOT NULL 
                   THEN 1 END) as trails_with_elevation,
        COUNT(CASE WHEN elevation_gain IS NULL OR elevation_loss IS NULL 
                   OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL 
                   THEN 1 END) as trails_missing_elevation
      FROM ${schemaName}.trails
    `);
    
    const row = stats.rows[0];
    return {
      total_trails: toNumber(row.total_trails),
      trails_with_elevation: toNumber(row.trails_with_elevation),
      trails_missing_elevation: toNumber(row.trails_missing_elevation)
    };
  }
}