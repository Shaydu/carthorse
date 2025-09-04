import { Pool } from 'pg';

export interface CoordinateDeduplicationResult {
  success: boolean;
  trailsProcessed: number;
  duplicateCoordinatesRemoved: number;
  error?: string;
}

export interface CoordinateDeduplicationConfig {
  stagingSchema: string;
  minTrailLengthMeters: number;
  verbose?: boolean;
}

/**
 * Service to remove duplicate coordinates from trail geometries
 * This handles cases where trails have consecutive identical coordinates
 * which can cause issues in routing and splitting operations.
 */
export class CoordinateDeduplicationService {
  constructor(
    private pgClient: Pool,
    private config: CoordinateDeduplicationConfig
  ) {}

  /**
   * Remove duplicate coordinates from all trail geometries
   */
  async removeDuplicateCoordinates(): Promise<CoordinateDeduplicationResult> {
    console.log('🧹 Removing duplicate coordinates from trail geometries...');
    
    try {
      let trailsProcessed = 0;
      let duplicateCoordinatesRemoved = 0;

      // Get all trails with their geometries
      const trailsResult = await this.pgClient.query(`
        SELECT 
          app_uuid,
          name,
          geometry,
          ST_NPoints(geometry) as original_point_count
        FROM ${this.config.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) >= $1
        ORDER BY app_uuid
      `, [this.config.minTrailLengthMeters]);

      console.log(`   📊 Found ${trailsResult.rows.length} trails to process`);

      for (const trail of trailsResult.rows) {
        try {
          // Remove duplicate consecutive coordinates
          const cleanedResult = await this.pgClient.query(`
            WITH points AS (
              SELECT 
                (ST_DumpPoints($1)).path[1] as point_index,
                (ST_DumpPoints($1)).geom as point_geom
            ),
            unique_points AS (
              SELECT 
                point_geom,
                point_index,
                LAG(point_geom) OVER (ORDER BY point_index) as prev_point
              FROM points
            ),
            filtered_points AS (
              SELECT point_geom, point_index
              FROM unique_points
              WHERE prev_point IS NULL OR NOT ST_Equals(point_geom, prev_point)
            )
            SELECT 
              ST_MakeLine(point_geom ORDER BY point_index) as cleaned_geometry,
              COUNT(*) as final_point_count
            FROM filtered_points
          `, [trail.geometry]);

          if (cleanedResult.rows.length > 0) {
            const cleanedGeometry = cleanedResult.rows[0].cleaned_geometry;
            const finalPointCount = cleanedResult.rows[0].final_point_count;
            const originalPointCount = trail.original_point_count;
            
            // Only update if we actually removed duplicate coordinates
            if (finalPointCount < originalPointCount) {
              const duplicatesRemoved = originalPointCount - finalPointCount;
              
              // Validate the cleaned geometry using SQL query
              const validationResult = await this.pgClient.query(`
                SELECT 
                  ST_IsValid($1) as is_valid,
                  ST_Length($1::geography) as length_meters
              `, [cleanedGeometry]);
              
              const isValid = validationResult.rows[0].is_valid;
              const lengthMeters = validationResult.rows[0].length_meters;
              
              if (isValid && lengthMeters >= this.config.minTrailLengthMeters) {
                await this.pgClient.query(`
                  UPDATE ${this.config.stagingSchema}.trails
                  SET 
                    geometry = $1,
                    length_km = ST_Length($1::geography) / 1000.0,
                    bbox_min_lng = ST_XMin($1),
                    bbox_max_lng = ST_XMax($1),
                    bbox_min_lat = ST_YMin($1),
                    bbox_max_lat = ST_YMax($1)
                  WHERE app_uuid = $2
                `, [cleanedGeometry, trail.app_uuid]);

                trailsProcessed++;
                duplicateCoordinatesRemoved += duplicatesRemoved;
                
                if (this.config.verbose) {
                  console.log(`   ✅ ${trail.name}: removed ${duplicatesRemoved} duplicate coordinates (${originalPointCount} → ${finalPointCount} points)`);
                }
              } else {
                console.log(`   ⚠️ Skipping ${trail.name}: cleaned geometry is invalid or too short`);
              }
            } else {
              if (this.config.verbose) {
                console.log(`   ✅ ${trail.name}: no duplicate coordinates found`);
              }
            }
          }

        } catch (error) {
          console.error(`   ❌ Error processing trail ${trail.name}:`, error);
        }
      }

      console.log(`✅ Coordinate deduplication completed:`);
      console.log(`   - Trails processed: ${trailsProcessed}`);
      console.log(`   - Duplicate coordinates removed: ${duplicateCoordinatesRemoved}`);

      return {
        success: true,
        trailsProcessed,
        duplicateCoordinatesRemoved
      };

    } catch (error) {
      console.error('❌ Error in coordinate deduplication:', error);
      return {
        success: false,
        trailsProcessed: 0,
        duplicateCoordinatesRemoved: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
