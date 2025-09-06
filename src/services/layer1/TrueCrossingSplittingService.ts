import { Pool } from 'pg';

export interface TrueCrossingSplittingConfig {
  stagingSchema: string;
  pgClient: Pool;
  toleranceMeters?: number;
  minSegmentLengthMeters?: number;
  verbose?: boolean;
}

export interface TrueCrossingSplittingResult {
  success: boolean;
  crossingsFound: number;
  trailsSplit: number;
  segmentsCreated: number;
  processingTimeMs: number;
  error?: string;
}

export class TrueCrossingSplittingService {
  private config: TrueCrossingSplittingConfig;

  constructor(config: TrueCrossingSplittingConfig) {
    this.config = {
      toleranceMeters: 5.0,
      minSegmentLengthMeters: 5.0,
      verbose: false,
      ...config
    };
  }

  /**
   * Find and split all true trail crossings (X-intersections)
   * This creates degree-4 intersections by splitting both trails at crossing points
   */
  async splitTrueCrossings(): Promise<TrueCrossingSplittingResult> {
    const startTime = Date.now();
    
    try {
      if (this.config.verbose) {
        console.log('🔍 Starting true crossing detection and splitting...');
      }

      // Step 1: Find all true crossings using ST_Crosses
      const crossings = await this.findTrueCrossings();
      
      if (this.config.verbose) {
        console.log(`📍 Found ${crossings.length} true crossings`);
        crossings.forEach((crossing, i) => {
          console.log(`   ${i + 1}. ${crossing.trail1_name} × ${crossing.trail2_name} at [${crossing.intersection_point.coordinates[0].toFixed(6)}, ${crossing.intersection_point.coordinates[1].toFixed(6)}]`);
        });
      }

      let trailsSplit = 0;
      let segmentsCreated = 0;

      // Step 2: Split each crossing
      for (const crossing of crossings) {
        if (this.config.verbose) {
          console.log(`🔧 Processing crossing: ${crossing.trail1_name} × ${crossing.trail2_name}`);
        }

        const result = await this.splitCrossing(crossing);
        
        if (result.success) {
          trailsSplit += 2; // Both trails are split
          segmentsCreated += result.segmentsCreated;
          
          if (this.config.verbose) {
            console.log(`   ✅ Split both trails, created ${result.segmentsCreated} segments`);
          }
        } else {
          if (this.config.verbose) {
            console.log(`   ❌ Failed to split crossing: ${result.error}`);
          }
        }
      }

      const processingTime = Date.now() - startTime;

      if (this.config.verbose) {
        console.log(`✅ True crossing splitting completed:`);
        console.log(`   - Crossings found: ${crossings.length}`);
        console.log(`   - Trails split: ${trailsSplit}`);
        console.log(`   - Segments created: ${segmentsCreated}`);
        console.log(`   - Processing time: ${processingTime}ms`);
      }

      return {
        success: true,
        crossingsFound: crossings.length,
        trailsSplit,
        segmentsCreated,
        processingTimeMs: processingTime
      };

    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      console.error('❌ Error in true crossing splitting:', error);
      
      return {
        success: false,
        crossingsFound: 0,
        trailsSplit: 0,
        segmentsCreated: 0,
        processingTimeMs: processingTime,
        error: error.message
      };
    }
  }

  /**
   * Find all true crossings using ST_Crosses
   */
  private async findTrueCrossings(): Promise<any[]> {
    const query = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${this.config.stagingSchema}.trails t1
        CROSS JOIN ${this.config.stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid  -- Avoid duplicate pairs
          AND ST_Length(t1.geometry::geography) >= $1
          AND ST_Length(t2.geometry::geography) >= $1
          AND ST_IsValid(t1.geometry)
          AND ST_IsValid(t2.geometry)
          AND ST_Crosses(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))  -- True crossing detection
      ),
      intersection_points AS (
        SELECT 
          trail1_id,
          trail1_name,
          trail1_geom,
          trail2_id,
          trail2_name,
          trail2_geom,
          ST_Intersection(ST_Force2D(trail1_geom), ST_Force2D(trail2_geom)) as intersection_geom
        FROM trail_pairs
        WHERE ST_GeometryType(ST_Intersection(ST_Force2D(trail1_geom), ST_Force2D(trail2_geom))) = 'ST_Point'
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail1_geom,
        trail2_id,
        trail2_name,
        trail2_geom,
        ST_AsGeoJSON(intersection_geom) as intersection_point_json,
        ST_LineLocatePoint(ST_Force2D(trail1_geom), intersection_geom) as trail1_ratio,
        ST_LineLocatePoint(ST_Force2D(trail2_geom), intersection_geom) as trail2_ratio,
        ST_Length(ST_LineSubstring(ST_Force2D(trail1_geom), 0.0, ST_LineLocatePoint(ST_Force2D(trail1_geom), intersection_geom))) as trail1_distance_from_start,
        ST_Length(ST_LineSubstring(ST_Force2D(trail2_geom), 0.0, ST_LineLocatePoint(ST_Force2D(trail2_geom), intersection_geom))) as trail2_distance_from_start
      FROM intersection_points
      WHERE ST_LineLocatePoint(ST_Force2D(trail1_geom), intersection_geom) > 0.001 
        AND ST_LineLocatePoint(ST_Force2D(trail1_geom), intersection_geom) < 0.999  -- Not at endpoints
        AND ST_LineLocatePoint(ST_Force2D(trail2_geom), intersection_geom) > 0.001 
        AND ST_LineLocatePoint(ST_Force2D(trail2_geom), intersection_geom) < 0.999  -- Not at endpoints
      ORDER BY trail1_name, trail2_name
    `;

    const result = await this.config.pgClient.query(query, [this.config.minSegmentLengthMeters]);
    return result.rows;
  }

  /**
   * Split both trails at a crossing point
   */
  private async splitCrossing(crossing: any): Promise<{ success: boolean; segmentsCreated: number; error?: string }> {
    const client = await this.config.pgClient.connect();
    
    try {
      await client.query('BEGIN');

      // Parse intersection point
      const intersectionPoint = JSON.parse(crossing.intersection_point_json);
      
      // Split trail 1
      const trail1Result = await this.splitTrailAtPoint(
        client, 
        crossing.trail1_id, 
        crossing.trail1_name, 
        intersectionPoint, 
        crossing.trail1_ratio
      );
      
      if (!trail1Result.success) {
        await client.query('ROLLBACK');
        return { success: false, segmentsCreated: 0, error: `Trail1 split failed: ${trail1Result.error}` };
      }

      // Split trail 2
      const trail2Result = await this.splitTrailAtPoint(
        client, 
        crossing.trail2_id, 
        crossing.trail2_name, 
        intersectionPoint, 
        crossing.trail2_ratio
      );
      
      if (!trail2Result.success) {
        await client.query('ROLLBACK');
        return { success: false, segmentsCreated: 0, error: `Trail2 split failed: ${trail2Result.error}` };
      }

      await client.query('COMMIT');
      
      return { 
        success: true, 
        segmentsCreated: trail1Result.segmentsCreated + trail2Result.segmentsCreated 
      };

    } catch (error: any) {
      await client.query('ROLLBACK');
      return { success: false, segmentsCreated: 0, error: error.message };
    } finally {
      client.release();
    }
  }

  /**
   * Split a single trail at a specific point
   */
  private async splitTrailAtPoint(
    client: any, 
    trailId: string, 
    trailName: string, 
    splitPoint: any, 
    splitRatio: number
  ): Promise<{ success: boolean; segmentsCreated: number; error?: string }> {
    
    try {
      // Get the trail
      const trailQuery = `SELECT * FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1`;
      const trailResult = await client.query(trailQuery, [trailId]);
      
      if (trailResult.rows.length === 0) {
        return { success: false, segmentsCreated: 0, error: 'Trail not found' };
      }
      
      const trail = trailResult.rows[0];
      
      if (this.config.verbose) {
        console.log(`      🔍 Splitting ${trailName} at ratio ${splitRatio.toFixed(6)}`);
      }

      // Create two segments using ST_LineSubstring
      const splitQuery = `
        SELECT 
          ST_LineSubstring(geometry, 0.0, $2) as segment1,
          ST_LineSubstring(geometry, $2, 1.0) as segment2
        FROM ${this.config.stagingSchema}.trails 
        WHERE app_uuid = $1
      `;
      
      const splitResult = await client.query(splitQuery, [trailId, splitRatio]);
      
      if (splitResult.rows.length === 0) {
        return { success: false, segmentsCreated: 0, error: 'Failed to split trail geometry' };
      }
      
      const row = splitResult.rows[0];
      
      // Validate segment lengths
      const segment1Length = await client.query(`SELECT ST_Length($1::geography) as length`, [row.segment1]);
      const segment2Length = await client.query(`SELECT ST_Length($1::geography) as length`, [row.segment2]);
      
      const length1 = parseFloat(segment1Length.rows[0].length);
      const length2 = parseFloat(segment2Length.rows[0].length);
      
      if (length1 < (this.config.minSegmentLengthMeters || 5.0) || length2 < (this.config.minSegmentLengthMeters || 5.0)) {
        return { success: false, segmentsCreated: 0, error: 'Split segments too short' };
      }
      
      // Delete original trail
      await client.query(`DELETE FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1`, [trailId]);
      
      // Insert new segments
      let segmentsCreated = 0;
      
      if (length1 > 0) {
        await client.query(`
          INSERT INTO ${this.config.stagingSchema}.trails (
            app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7
          )
        `, [
          `${trailName} (Split 1)`,
          trail.trail_type,
          trail.surface,
          trail.difficulty,
          trail.source,
          row.segment1,
          length1 / 1000.0
        ]);
        segmentsCreated++;
      }
      
      if (length2 > 0) {
        await client.query(`
          INSERT INTO ${this.config.stagingSchema}.trails (
            app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7
          )
        `, [
          `${trailName} (Split 2)`,
          trail.trail_type,
          trail.surface,
          trail.difficulty,
          trail.source,
          row.segment2,
          length2 / 1000.0
        ]);
        segmentsCreated++;
      }
      
      if (this.config.verbose) {
        console.log(`      ✅ Created ${segmentsCreated} segments for ${trailName}`);
      }
      
      return { success: true, segmentsCreated };
      
    } catch (error: any) {
      return { success: false, segmentsCreated: 0, error: error.message };
    }
  }
}
