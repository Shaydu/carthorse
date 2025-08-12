import { Pool } from 'pg';

export interface TrailGapFixingConfig {
  minGapDistance: number; // meters
  maxGapDistance: number; // meters
  verbose?: boolean;
}

export interface TrailGapFixingResult {
  gapsFound: number;
  gapsFixed: number;
  errors: string[];
  success: boolean;
}

/**
 * Service for fixing gaps between trail endpoints by extending trails
 */
export class TrailGapFixingService {
  private pgClient: Pool;
  private stagingSchema: string;
  private config: TrailGapFixingConfig;

  constructor(
    pgClient: Pool, 
    stagingSchema: string, 
    config: TrailGapFixingConfig
  ) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
    this.config = config;
  }

  /**
   * Fix trail gaps by extending trails to meet nearby endpoints
   */
  async fixTrailGaps(): Promise<TrailGapFixingResult> {
    console.log(`🔗 TRAIL GAP FIXING SERVICE CALLED with config: min=${this.config.minGapDistance}m, max=${this.config.maxGapDistance}m, verbose=${this.config.verbose}`);
    
    const result: TrailGapFixingResult = {
      gapsFound: 0,
      gapsFixed: 0,
      errors: [],
      success: false
    };

    try {
      if (this.config.verbose) {
        console.log(`🔗 Fixing trail gaps between ${this.config.minGapDistance}m and ${this.config.maxGapDistance}m...`);
      }

      // Find all trail gaps in the specified range
      const gaps = await this.findTrailGaps();
      result.gapsFound = gaps.length;

      if (gaps.length === 0) {
        if (this.config.verbose) {
          console.log('✅ No gaps found in the specified range!');
        }
        result.success = true;
        return result;
      }

      if (this.config.verbose) {
        console.log(`Found ${gaps.length} gaps to process`);
      }

      // Process each gap
      const processedTrails = new Set<string>();
      
      for (const gap of gaps) {
        // Skip if we've already processed one of these trails
        if (processedTrails.has(gap.trail1_uuid) || processedTrails.has(gap.trail2_uuid)) {
          continue;
        }

        try {
          await this.fixSingleGap(gap);
          
          // Mark both trails as processed
          processedTrails.add(gap.trail1_uuid);
          processedTrails.add(gap.trail2_uuid);
          result.gapsFixed++;

          if (this.config.verbose) {
            console.log(`  ✅ Fixed gap: ${gap.trail1_name} → ${gap.trail2_name} (${gap.gap_distance.toFixed(2)}m)`);
          }

        } catch (error) {
          const errorMsg = `Error fixing gap between ${gap.trail1_name} and ${gap.trail2_name}: ${error instanceof Error ? error.message : String(error)}`;
          result.errors.push(errorMsg);
          
          if (this.config.verbose) {
            console.error(`  ❌ ${errorMsg}`);
          }
        }
      }

      // Recompute vertex degrees
      await this.recomputeVertexDegrees();

      result.success = true;

      if (this.config.verbose) {
        console.log(`✅ Fixed ${result.gapsFixed} trail gaps`);
      }

    } catch (error) {
      const errorMsg = `Error in trail gap fixing: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);
      
      if (this.config.verbose) {
        console.error(`❌ ${errorMsg}`);
      }
    }

    return result;
  }

  /**
   * Find all trail gaps within the specified distance range
   */
  private async findTrailGaps(): Promise<any[]> {
    const result = await this.pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          id,
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt,
          geometry
        FROM ${this.stagingSchema}.trails
      )
      SELECT 
        t1.id as trail1_id,
        t1.app_uuid as trail1_uuid,
        t1.name as trail1_name,
        t2.id as trail2_id,
        t2.app_uuid as trail2_uuid,
        t2.name as trail2_name,
        ST_Distance(t1.end_pt::geography, t2.start_pt::geography) as gap_distance,
        t1.end_pt as trail1_end,
        t2.start_pt as trail2_start
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.id != t2.id
        AND ST_Distance(t1.end_pt::geography, t2.start_pt::geography) >= $1
        AND ST_Distance(t1.end_pt::geography, t2.start_pt::geography) <= $2
      ORDER BY gap_distance ASC
    `, [this.config.minGapDistance, this.config.maxGapDistance]);

    return result.rows;
  }

  /**
   * Fix a single gap by extending trail2 to meet trail1
   */
  private async fixSingleGap(gap: any): Promise<void> {
    // Create connector geometry
    const connectorResult = await this.pgClient.query(`
      SELECT 
        ST_MakeLine($1::geometry, $2::geometry) as connector_geom,
        ST_Length(ST_MakeLine($1::geometry, $2::geometry)::geography) as connector_length
    `, [gap.trail1_end, gap.trail2_start]);

    const connector = connectorResult.rows[0];

    // Get the trail that will be extended (trail2)
    const trail2Result = await this.pgClient.query(`
      SELECT 
        geometry,
        ST_Length(geometry::geography) as current_length
      FROM ${this.stagingSchema}.trails 
      WHERE app_uuid = $1
    `, [gap.trail2_uuid]);

    const trail2 = trail2Result.rows[0];

    // Extend trail2 by prepending the connector
    const extendedResult = await this.pgClient.query(`
      SELECT 
        ST_LineMerge(ST_Union($1::geometry, $2::geometry)) as extended_geom,
        ST_Length(ST_LineMerge(ST_Union($1::geometry, $2::geometry))::geography) as extended_length
    `, [connector.connector_geom, trail2.geometry]);

    const extended = extendedResult.rows[0];

    // Update trail2's geometry
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET 
        geometry = $1::geometry,
        length_km = ST_Length($1::geometry::geography) / 1000.0,
        updated_at = NOW()
      WHERE app_uuid = $2
    `, [extended.extended_geom, gap.trail2_uuid]);

    // Update the routing edge for trail2
    const edgeResult = await this.pgClient.query(`
      SELECT id FROM ${this.stagingSchema}.ways_noded WHERE app_uuid = $1
    `, [gap.trail2_uuid]);

    if (edgeResult.rows.length > 0) {
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways_noded
        SET 
          the_geom = ST_Force2D($1::geometry),
          length_km = ST_Length(ST_Force2D($1::geometry)::geography) / 1000.0
        WHERE app_uuid = $2
      `, [extended.extended_geom, gap.trail2_uuid]);
    }
  }

  /**
   * Recompute vertex degrees in the routing network
   */
  private async recomputeVertexDegrees(): Promise<void> {
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
  }
}
