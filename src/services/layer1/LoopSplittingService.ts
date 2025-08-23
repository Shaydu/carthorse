import { Pool, PoolClient } from 'pg';

export interface LoopSplittingConfig {
  stagingSchema: string;
  verbose?: boolean;
}

interface LoopSplittingResult {
  success: boolean;
  originalTrailCount: number;
  splitTrailCount: number;
  error?: string;
}

export class LoopSplittingService {
  private pgClient: Pool;
  private config: LoopSplittingConfig;

  constructor(pgClient: Pool, config: LoopSplittingConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Handle self-intersecting loops using multiple strategies
   * 1. Try ST_Split with ST_Intersection (for simple cases)
   * 2. Fallback to ST_SimplifyPreserveTopology (for complex cases)
   * 3. Use ST_Node for final cleanup
   */
  async handleSelfIntersectingLoops(): Promise<LoopSplittingResult> {
    const client = await this.pgClient.connect();
    
    try {
      await client.query('BEGIN');

      // Get count of trails before splitting
      const beforeCount = await client.query(`
        SELECT COUNT(*) as count 
        FROM ${this.config.stagingSchema}.trails 
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
      `);
      const originalTrailCount = parseInt(beforeCount.rows[0].count);

      // Find trails that are self-intersecting (ST_IsSimple(geometry) = false)
      const selfIntersectingTrails = await client.query(`
        SELECT 
          app_uuid,
          name,
          geometry,
          ST_NumPoints(geometry) as num_points,
          ST_GeometryType(ST_Intersection(geometry, geometry)) as intersection_type,
          ST_NumGeometries(ST_Intersection(geometry, geometry)) as intersection_count
        FROM ${this.config.stagingSchema}.trails
        WHERE NOT ST_IsSimple(geometry)
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
      `);

      if (selfIntersectingTrails.rows.length === 0) {
        console.log('      ✅ No self-intersecting trails found.');
        await client.query('COMMIT');
        return {
          success: true,
          originalTrailCount,
          splitTrailCount: originalTrailCount
        };
      }

      console.log(`      Found ${selfIntersectingTrails.rows.length} self-intersecting trails.`);

      let totalSplitSegments = 0;

      for (const trail of selfIntersectingTrails.rows) {
        if (this.config.verbose) {
          console.log(`      Processing self-intersecting trail: ${trail.name} (ID: ${trail.app_uuid})`);
          console.log(`        Points: ${trail.num_points}, Intersection Type: ${trail.intersection_type}, Count: ${trail.intersection_count}`);
        }

        try {
          let splitSegments: any[] = [];

          // Strategy 1: Try ST_Split with ST_Intersection (for simple cases)
          if (trail.intersection_type === 'ST_Point' || trail.intersection_count < 100) {
            splitSegments = await this.trySTSplitStrategy(client, trail);
          }

          // Strategy 2: If ST_Split fails, try ST_SimplifyPreserveTopology
          if (splitSegments.length === 0) {
            if (this.config.verbose) {
              console.log(`        ⚠️  ST_Split failed, trying ST_SimplifyPreserveTopology...`);
            }
            splitSegments = await this.trySimplifyStrategy(client, trail);
          }

          // Strategy 3: If simplification fails, try ST_Node
          if (splitSegments.length === 0) {
            if (this.config.verbose) {
              console.log(`        ⚠️  Simplification failed, trying ST_Node...`);
            }
            splitSegments = await this.trySTNodeStrategy(client, trail);
          }

          // Strategy 4: Final fallback - use original geometry but mark as processed
          if (splitSegments.length === 0) {
            if (this.config.verbose) {
              console.log(`        ⚠️  All strategies failed, keeping original geometry...`);
            }
            splitSegments = [{
              segment_geom: trail.geometry,
              segment_index: 1
            }];
          }

          if (splitSegments.length > 0) {
            // Delete the original trail
            await client.query(`
              DELETE FROM ${this.config.stagingSchema}.trails 
              WHERE app_uuid = $1
            `, [trail.app_uuid]);

            // Insert the split segments
            for (const segment of splitSegments) {
              if (segment.segment_geom && segment.segment_index) {
                await client.query(`
                  INSERT INTO ${this.config.stagingSchema}.trails (
                    app_uuid, name, trail_type, surface, difficulty, source_tags,
                    bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                    length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                    source, geometry
                  )
                  SELECT 
                    $1 as app_uuid,
                    $2 as name,
                    trail_type, surface, difficulty, source_tags,
                    bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                    ST_Length($3::geography) / 1000.0 as length_km,
                    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                    source, $3 as geometry
                  FROM ${this.config.stagingSchema}.trails 
                  WHERE app_uuid = $1
                  LIMIT 1
                `, [
                  `${trail.app_uuid}_segment_${segment.segment_index}`,
                  `${trail.name}_segment_${segment.segment_index}`,
                  segment.segment_geom
                ]);
              }
            }

            totalSplitSegments += splitSegments.length;
            if (this.config.verbose) {
              console.log(`        ✅ Split trail ${trail.name} into ${splitSegments.length} segments`);
            }
          }

        } catch (error: any) {
          if (this.config.verbose) {
            console.log(`        ❌ Error processing ${trail.name}: ${error.message}`);
          }
          // Continue with other trails even if one fails
        }
      }

      // Get count of trails after splitting
      const afterCount = await client.query(`
        SELECT COUNT(*) as count 
        FROM ${this.config.stagingSchema}.trails 
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
      `);
      const splitTrailCount = parseInt(afterCount.rows[0].count);

      await client.query('COMMIT');
      console.log(`      ✅ Self-intersecting loops handled. Created ${totalSplitSegments} split segments.`);
      console.log(`      📊 Trail count: ${originalTrailCount} → ${splitTrailCount}`);

      return {
        success: true,
        originalTrailCount,
        splitTrailCount
      };

    } catch (error: any) {
      await client.query('ROLLBACK');
      console.log(`   ❌ Database error during self-intersection handling: ${error.message}`);
      return {
        success: false,
        originalTrailCount: 0,
        splitTrailCount: 0,
        error: error.message
      };
    } finally {
      client.release();
    }
  }

  /**
   * Strategy 1: Try ST_Split with ST_Intersection (for simple cases)
   */
  private async trySTSplitStrategy(client: PoolClient, trail: any): Promise<any[]> {
    try {
      const splitQuery = `
        WITH loop_geometry AS (
          SELECT '${trail.app_uuid}' as trail_uuid, '${trail.name}' as name, ST_Force2D(geometry) as geom
          FROM ${this.config.stagingSchema}.trails 
          WHERE app_uuid = '${trail.app_uuid}'
        ),
        split_segments AS (
          SELECT 
            (ST_Dump(ST_Split(geom, ST_Intersection(geom, geom)))).geom as segment_geom,
            generate_series(1, ST_NumGeometries(ST_Split(geom, ST_Intersection(geom, geom)))) as segment_index
          FROM loop_geometry
        )
        SELECT 
          segment_geom,
          segment_index
        FROM split_segments
        WHERE ST_GeometryType(segment_geom) = 'ST_LineString'
          AND ST_NumPoints(segment_geom) > 1
      `;

      const splitResult = await client.query(splitQuery);
      return splitResult.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Strategy 2: Try ST_SimplifyPreserveTopology (for complex cases)
   */
  private async trySimplifyStrategy(client: PoolClient, trail: any): Promise<any[]> {
    try {
      const simplifyQuery = `
        SELECT 
          ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001)) as segment_geom,
          1 as segment_index
        FROM ${this.config.stagingSchema}.trails 
        WHERE app_uuid = $1
          AND ST_GeometryType(ST_SimplifyPreserveTopology(geometry, 0.00001)) = 'ST_LineString'
          AND ST_NumPoints(ST_SimplifyPreserveTopology(geometry, 0.00001)) > 1
      `;

      const simplifyResult = await client.query(simplifyQuery, [trail.app_uuid]);
      return simplifyResult.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Strategy 3: Try ST_Node (for very complex cases)
   */
  private async trySTNodeStrategy(client: PoolClient, trail: any): Promise<any[]> {
    try {
      const nodeQuery = `
        WITH noded_geometry AS (
          SELECT 
            (ST_Dump(ST_Node(ST_Force2D(geometry)))).geom as segment_geom,
            generate_series(1, ST_NumGeometries(ST_Node(ST_Force2D(geometry)))) as segment_index
          FROM ${this.config.stagingSchema}.trails 
          WHERE app_uuid = $1
        )
        SELECT 
          segment_geom,
          segment_index
        FROM noded_geometry
        WHERE ST_GeometryType(segment_geom) = 'ST_LineString'
          AND ST_NumPoints(segment_geom) > 1
      `;

      const nodeResult = await client.query(nodeQuery, [trail.app_uuid]);
      return nodeResult.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Validate that the splitting operation was successful
   */
  async validateSplitting(): Promise<{ isValid: boolean; nonSimpleCount: number; error?: string }> {
    try {
      const result = await this.pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${this.config.stagingSchema}.trails 
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
          AND NOT ST_IsSimple(geometry)
      `);

      const nonSimpleCount = parseInt(result.rows[0].count);

      return {
        isValid: nonSimpleCount === 0,
        nonSimpleCount
      };
    } catch (error: any) {
      return {
        isValid: false,
        nonSimpleCount: 0,
        error: error.message
      };
    }
  }
}
