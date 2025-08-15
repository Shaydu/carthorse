import { Pool } from 'pg';
import crypto from 'crypto';

export interface PostgisTIntersectionConfig {
  stagingSchema: string;
  pgClient: Pool;
  tIntersectionTolerance?: number; // Tolerance in meters for T-intersection detection
  verbose?: boolean;
}

export interface TIntersectionResult {
  success: boolean;
  tIntersectionsFound: number;
  trailsSplit: number;
  segmentsCreated: number;
  error?: string;
}

export class PostgisTIntersectionService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: PostgisTIntersectionConfig;

  constructor(config: PostgisTIntersectionConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = {
      tIntersectionTolerance: 3.0, // Default 3 meters
      verbose: false,
      ...config
    };
  }

  private log(message: string) {
    if (this.config.verbose) {
      console.log(`[PostgisTIntersection] ${message}`);
    }
  }

  /**
   * Detect and split T-intersections where trail endpoints touch/near the midpoint of other trails
   */
  async detectAndSplitTIntersections(): Promise<TIntersectionResult> {
    this.log('🔍 Detecting T-intersections (endpoint to midpoint touching)...');
    
    const result: TIntersectionResult = {
      success: false,
      tIntersectionsFound: 0,
      trailsSplit: 0,
      segmentsCreated: 0
    };

    try {
      // Step 1: Create trails_split table if it doesn't exist
      await this.createTrailsSplitTable();
      
      // Step 2: Detect T-intersections
      const tIntersections = await this.detectTIntersections();
      result.tIntersectionsFound = tIntersections.length;
      
      this.log(`📍 Found ${result.tIntersectionsFound} T-intersections`);
      
      if (tIntersections.length === 0) {
        result.success = true;
        return result;
      }

      // Step 3: Split trails at T-intersection points
      const splitResults = await this.splitTrailsAtTIntersections(tIntersections);
      result.trailsSplit = splitResults.trailsSplit;
      result.segmentsCreated = splitResults.segmentsCreated;

      result.success = true;
      this.log(`✅ T-intersection splitting complete: ${result.trailsSplit} trails split into ${result.segmentsCreated} segments`);
      
      return result;

    } catch (error) {
      this.log(`❌ Error in T-intersection detection/splitting: ${error}`);
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Create trails_split table structure
   */
  private async createTrailsSplitTable(): Promise<void> {
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.stagingSchema}.trails_split (
        app_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_uuid UUID,
        original_app_uuid UUID,
        segment_id INTEGER,
        osm_id TEXT,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        length_km NUMERIC,
        elevation_gain NUMERIC,
        elevation_loss NUMERIC,
        max_elevation NUMERIC,
        min_elevation NUMERIC,
        avg_elevation NUMERIC,
        bbox_min_lng NUMERIC,
        bbox_max_lng NUMERIC,
        bbox_min_lat NUMERIC,
        bbox_max_lat NUMERIC,
        source TEXT,
        source_tags JSONB,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes
    await this.pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_trails_split_geometry 
      ON ${this.stagingSchema}.trails_split USING GIST(geometry)
    `);
    
    await this.pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_trails_split_parent_uuid 
      ON ${this.stagingSchema}.trails_split(parent_uuid)
    `);
  }

  /**
   * Detect T-intersections where trail endpoints are near the midpoint of other trails
   */
  private async detectTIntersections(): Promise<any[]> {
    const tolerance = this.config.tIntersectionTolerance || 3.0;
    
    this.log(`🔍 Searching for T-intersections with tolerance: ${tolerance}m`);
    
    // First, let's check how many trails we have to work with
    const trailCountResult = await this.pgClient.query(`
      SELECT COUNT(*) as total_trails
      FROM ${this.stagingSchema}.trails
      WHERE ST_IsValid(geometry) 
        AND ST_GeometryType(geometry) = 'ST_LineString'
        AND ST_NumPoints(geometry) >= 2
    `);
    this.log(`📊 Total valid trails to analyze: ${trailCountResult.rows[0].total_trails}`);
    
    const result = await this.pgClient.query(`
      WITH trail_endpoints AS (
        -- Get start and end points of each trail
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          geometry
        FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry) 
          AND ST_GeometryType(geometry) = 'ST_LineString'
          AND ST_NumPoints(geometry) >= 2
      ),
      trail_midpoints AS (
        -- Get midpoint of each trail
        SELECT 
          app_uuid,
          name,
          ST_LineInterpolatePoint(geometry, 0.5) as midpoint,
          geometry
        FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry) 
          AND ST_GeometryType(geometry) = 'ST_LineString'
          AND ST_NumPoints(geometry) >= 2
      ),
      t_intersections AS (
        -- Find endpoints that are near midpoints of other trails
        SELECT DISTINCT
          te.app_uuid as endpoint_trail_uuid,
          te.name as endpoint_trail_name,
          tm.app_uuid as midpoint_trail_uuid,
          tm.name as midpoint_trail_name,
          CASE 
            WHEN ST_DWithin(te.start_point::geography, tm.midpoint::geography, $1) THEN te.start_point
            WHEN ST_DWithin(te.end_point::geography, tm.midpoint::geography, $1) THEN te.end_point
          END as touching_point,
          tm.midpoint as split_point,
          ST_Distance(
            CASE 
              WHEN ST_DWithin(te.start_point::geography, tm.midpoint::geography, $1) THEN te.start_point
              WHEN ST_DWithin(te.end_point::geography, tm.midpoint::geography, $1) THEN te.end_point
            END::geography, 
            tm.midpoint::geography
          ) as distance_meters
        FROM trail_endpoints te
        JOIN trail_midpoints tm ON te.app_uuid != tm.app_uuid
        WHERE (
          ST_DWithin(te.start_point::geography, tm.midpoint::geography, $1) OR
          ST_DWithin(te.end_point::geography, tm.midpoint::geography, $1)
        )
        AND ST_Distance(
          CASE 
            WHEN ST_DWithin(te.start_point::geography, tm.midpoint::geography, $1) THEN te.start_point
            WHEN ST_DWithin(te.end_point::geography, tm.midpoint::geography, $1) THEN te.end_point
          END::geography, 
          tm.midpoint::geography
        ) <= $1
      )
      SELECT 
        endpoint_trail_uuid,
        endpoint_trail_name,
        midpoint_trail_uuid,
        midpoint_trail_name,
        touching_point,
        split_point,
        distance_meters
      FROM t_intersections
      ORDER BY distance_meters ASC
    `, [tolerance]);

    this.log(`🔍 Found ${result.rows.length} T-intersections`);
    
    // Log the first few T-intersections for debugging
    if (result.rows.length > 0) {
      this.log(`📋 Sample T-intersections found:`);
      result.rows.slice(0, 3).forEach((row, index) => {
        this.log(`   ${index + 1}. ${row.endpoint_trail_name} endpoint → ${row.midpoint_trail_name} midpoint (${row.distance_meters.toFixed(2)}m)`);
      });
    }

    return result.rows;
  }

  /**
   * Split trails at T-intersection points
   */
  private async splitTrailsAtTIntersections(tIntersections: any[]): Promise<{trailsSplit: number, segmentsCreated: number}> {
    let trailsSplit = 0;
    let segmentsCreated = 0;

    for (const intersection of tIntersections) {
      const { midpoint_trail_uuid, split_point, distance_meters } = intersection;
      
      this.log(`🔗 Splitting trail ${intersection.midpoint_trail_name} at T-intersection (distance: ${distance_meters.toFixed(2)}m)`);
      
      try {
        // Split the trail at the intersection point
        const splitResult = await this.splitTrailAtPoint(midpoint_trail_uuid, split_point);
        
        if (splitResult.success) {
          trailsSplit++;
          segmentsCreated += splitResult.segmentsCreated;
          this.log(`✅ Split trail into ${splitResult.segmentsCreated} segments`);
        } else {
          this.log(`❌ Failed to split trail: ${splitResult.error}`);
        }
      } catch (error) {
        this.log(`❌ Error splitting trail: ${error}`);
      }
    }

    return { trailsSplit, segmentsCreated };
  }

  /**
   * Split a single trail at a specific point
   */
  private async splitTrailAtPoint(trailUuid: string, splitPoint: any): Promise<{success: boolean, segmentsCreated: number, error?: string}> {
    try {
      // Get the trail to split
      const trailResult = await this.pgClient.query(`
        SELECT * FROM ${this.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [trailUuid]);

      if (trailResult.rowCount === 0) {
        return { success: false, segmentsCreated: 0, error: 'Trail not found' };
      }

      const trail = trailResult.rows[0];

      // Split the trail at the point
      const splitResult = await this.pgClient.query(`
        WITH split_segments AS (
          SELECT 
            ST_LineSubstring(geometry, 0, ST_LineLocatePoint(geometry, $1)) as segment1,
            ST_LineSubstring(geometry, ST_LineLocatePoint(geometry, $1), 1) as segment2
          FROM ${this.stagingSchema}.trails
          WHERE app_uuid = $2
        )
        SELECT 
          segment1,
          segment2,
          ST_Length(segment1::geography) as length1,
          ST_Length(segment2::geography) as length2
        FROM split_segments
        WHERE ST_Length(segment1::geography) > 1 AND ST_Length(segment2::geography) > 1
      `, [splitPoint, trailUuid]);

      if (splitResult.rowCount === 0) {
        this.log(`⚠️ Split resulted in 0 valid segments for trail ${trailUuid}`);
        return { success: false, segmentsCreated: 0, error: 'Invalid split point or segments too short' };
      }

      const segments = splitResult.rows[0];
      let segmentsCreated = 0;
      
      this.log(`📏 Split segments: ${segments.length1?.toFixed(2) || 'null'}m and ${segments.length2?.toFixed(2) || 'null'}m`);

      // Insert first segment
      if (segments.segment1) {
        this.log(`➕ Inserting segment 1 (${segments.length1.toFixed(2)}m)`);
        await this.insertSplitSegment(trail, segments.segment1, segments.length1, 1);
        segmentsCreated++;
      } else {
        this.log(`⚠️ Segment 1 is null`);
      }

      // Insert second segment
      if (segments.segment2) {
        this.log(`➕ Inserting segment 2 (${segments.length2.toFixed(2)}m)`);
        await this.insertSplitSegment(trail, segments.segment2, segments.length2, 2);
        segmentsCreated++;
      } else {
        this.log(`⚠️ Segment 2 is null`);
      }

      // Remove original trail from trails table
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [trailUuid]);

      return { success: true, segmentsCreated };

    } catch (error) {
      return { 
        success: false, 
        segmentsCreated: 0, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Insert a split segment into trails_split table
   */
  private async insertSplitSegment(originalTrail: any, geometry: any, lengthMeters: number, segmentId: number): Promise<void> {
    const lengthKm = lengthMeters / 1000;
    const newUuid = crypto.randomUUID(); // Generate new UUID for this segment
    
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.trails_split (
        app_uuid,
        original_app_uuid,
        segment_id,
        osm_id,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        source,
        source_tags,
        geometry
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      )
    `, [
      newUuid, // app_uuid (new UUID for this segment)
      originalTrail.app_uuid, // original_app_uuid
      segmentId,
      originalTrail.osm_id,
      originalTrail.name,
      originalTrail.region,
      originalTrail.trail_type,
      originalTrail.surface,
      originalTrail.difficulty,
      lengthKm,
      originalTrail.elevation_gain,
      originalTrail.elevation_loss,
      originalTrail.max_elevation,
      originalTrail.min_elevation,
      originalTrail.avg_elevation,
      originalTrail.bbox_min_lng,
      originalTrail.bbox_max_lng,
      originalTrail.bbox_min_lat,
      originalTrail.bbox_max_lat,
      originalTrail.source,
      originalTrail.source_tags,
      geometry
    ]);
  }

  /**
   * Get statistics about the split trail network
   */
  async getSplitStatistics(): Promise<any> {
    try {
      const statsResult = await this.pgClient.query(`
        SELECT 
          COUNT(*) as total_segments,
          COUNT(DISTINCT parent_uuid) as original_trails,
          AVG(length_km) as avg_length_km,
          MIN(length_km) as min_length_km,
          MAX(length_km) as max_length_km,
          SUM(length_km) as total_length_km
        FROM ${this.stagingSchema}.trails_split
      `);

      return statsResult.rows[0];
    } catch (error) {
      this.log(`Error getting split statistics: ${error}`);
      return null;
    }
  }
}
