import { Client } from 'pg';
import { getTolerances } from '../config-loader';

export interface StagingConfig {
  stagingSchema: string;
  region: string;
  bbox?: [number, number, number, number];
}

export class StagingSqlHelpers {
  constructor(
    private pgClient: Client,
    private config: StagingConfig
  ) {}

  /**
   * Clear existing data in staging schema
   */
  async clearStagingData(): Promise<void> {
    await this.pgClient.query(`DELETE FROM ${this.config.stagingSchema}.trails`);
    await this.pgClient.query(`DELETE FROM ${this.config.stagingSchema}.intersection_points`);
  }

  /**
   * Get original trails from public schema with filters
   */
  async getOriginalTrails(bbox?: [number, number, number, number]): Promise<any[]> {
    const tolerances = getTolerances();
    const minTrailLengthMeters = tolerances.minTrailLengthMeters || 0.0;
    const trailLimit = process.env.CARTHORSE_TEST_LIMIT ? parseInt(process.env.CARTHORSE_TEST_LIMIT) : null;
    
    // Build bbox parameters if provided
    let bboxMinLng: number | null = null, bboxMinLat: number | null = null, bboxMaxLng: number | null = null, bboxMaxLat: number | null = null;
    
    if (bbox && bbox.length === 4) {
      [bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat] = bbox;
    }
    
    const queryParams: any[] = [this.config.region];

    // Build source query with filters
    let sourceQuery = `SELECT * FROM public.trails WHERE region = $1`;

    // Add bbox filter if provided
    if (bboxMinLng !== null && bboxMinLat !== null && bboxMaxLng !== null && bboxMaxLat !== null) {
      sourceQuery += ` AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))`;
      queryParams.push(bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat);
    }

    // Add limit
    if (trailLimit !== null) {
      sourceQuery += ` LIMIT $${queryParams.length + 1}`;
      queryParams.push(trailLimit);
    }

    const originalTrails = await this.pgClient.query(sourceQuery, queryParams);
    return originalTrails.rows;
  }

  /**
   * Check if a trail forms a loop
   */
  async checkTrailLoop(geometry: any): Promise<{ is_loop: boolean; start_end_distance: number }> {
    const result = await this.pgClient.query(`
      SELECT ST_DWithin(ST_StartPoint($1::geometry), ST_EndPoint($1::geometry), 10) as is_loop,
             ST_Distance(ST_StartPoint($1::geometry), ST_EndPoint($1::geometry)) as start_end_distance
    `, [geometry]);
    
    return result.rows[0];
  }

  /**
   * Split loop trail at intersection points
   */
  async splitLoopTrail(geometry: any, trailUuid: string): Promise<any[]> {
    const splitSegmentsSql = `
      WITH other_trail_intersections AS (
        SELECT 
          dumped.geom as intersection_point,
          ST_LineLocatePoint($1::geometry, dumped.geom) as split_ratio
        FROM public.trails t2,
        LATERAL ST_Dump(ST_Intersection($1::geometry, t2.geometry)) as dumped
        WHERE t2.app_uuid != $2
        AND ST_Intersects($1::geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection($1::geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_LineLocatePoint($1::geometry, dumped.geom) > 0.001 
        AND ST_LineLocatePoint($1::geometry, dumped.geom) < 0.999
        ORDER BY split_ratio
      ),
      split_segments AS (
        SELECT 
          ST_LineSubstring($1::geometry, 
            COALESCE(LAG(split_ratio) OVER (ORDER BY split_ratio), 0), 
            split_ratio) as segment_geometry,
          ST_Length(ST_LineSubstring($1::geometry, 
            COALESCE(LAG(split_ratio) OVER (ORDER BY split_ratio), 0), 
            split_ratio)) as segment_length
        FROM other_trail_intersections
        UNION ALL
        SELECT 
          ST_LineSubstring($1::geometry, 
            (SELECT MAX(split_ratio) FROM other_trail_intersections), 
            1) as segment_geometry,
          ST_Length(ST_LineSubstring($1::geometry, 
            (SELECT MAX(split_ratio) FROM other_trail_intersections), 
            1)) as segment_length
        WHERE (SELECT COUNT(*) FROM other_trail_intersections) > 0
      )
      SELECT segment_geometry, segment_length
      FROM split_segments
      WHERE ST_GeometryType(segment_geometry) = 'ST_LineString'
      AND ST_Length(segment_geometry) > 5
    `;
    
    const result = await this.pgClient.query(splitSegmentsSql, [geometry, trailUuid]);
    return result.rows;
  }

  /**
   * Insert trail into staging schema
   */
  async insertTrailToStaging(trailData: any): Promise<void> {
    const insertSql = `
      INSERT INTO ${this.config.stagingSchema}.trails (
        app_uuid, name, trail_type, surface, difficulty, length_km, 
        elevation_gain, elevation_loss, max_elevation, min_elevation, 
        avg_elevation, geometry, region, bbox_min_lng, bbox_max_lng, 
        bbox_min_lat, bbox_max_lat
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `;
    
    await this.pgClient.query(insertSql, [
      trailData.app_uuid,
      trailData.name,
      trailData.trail_type,
      trailData.surface,
      trailData.difficulty,
      trailData.length_km,
      trailData.elevation_gain,
      trailData.elevation_loss,
      trailData.max_elevation,
      trailData.min_elevation,
      trailData.avg_elevation,
      trailData.geometry,
      trailData.region,
      trailData.bbox_min_lng,
      trailData.bbox_max_lng,
      trailData.bbox_min_lat,
      trailData.bbox_max_lat
    ]);
  }

  /**
   * Copy region data to staging with loop splitting
   */
  async copyRegionDataToStaging(bbox?: [number, number, number, number]): Promise<void> {
    console.log('📋 Copying region data to staging...');
    
    // Clear existing data
    await this.clearStagingData();
    
    // Get original trails
    const originalTrails = await this.getOriginalTrails(bbox);
    console.log(`📋 Found ${originalTrails.length} original trails to process`);
    
    // Process each trail
    for (const trail of originalTrails) {
      // Check if this trail forms a loop
      const loopInfo = await this.checkTrailLoop(trail.geometry);
      
      if (loopInfo.is_loop && loopInfo.start_end_distance < 10) {
        console.log(`📍 Processing loop: ${trail.name} (start/end distance: ${loopInfo.start_end_distance.toFixed(2)}m)`);
        
        // Split loop at intersection points
        const splitSegments = await this.splitLoopTrail(trail.geometry, trail.app_uuid);
        
        if (splitSegments.length > 0) {
          console.log(`  ✂️ Split loop into ${splitSegments.length} segments`);
          
          // Insert split segments
          for (let i = 0; i < splitSegments.length; i++) {
            const segment = splitSegments[i];
            const segmentTrail = {
              ...trail,
              app_uuid: `${trail.app_uuid}_segment_${i + 1}`,
              name: `${trail.name} (Segment ${i + 1})`,
              geometry: segment.segment_geometry,
              length_km: segment.segment_length / 1000
            };
            
            await this.insertTrailToStaging(segmentTrail);
          }
        } else {
          // No intersections found, insert original trail
          await this.insertTrailToStaging(trail);
        }
      } else {
        // Not a loop, insert original trail
        await this.insertTrailToStaging(trail);
      }
    }
    
    // Get final count
    const finalCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.config.stagingSchema}.trails`);
    console.log(`✅ Copied ${finalCount.rows[0].count} trails to staging schema`);
  }

  /**
   * Create staging environment tables
   */
  async createStagingTables(): Promise<void> {
    // Create trails table
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        region TEXT,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL
      )
    `);

    // Create intersection_points table
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        trail1_uuid TEXT,
        trail2_uuid TEXT,
        intersection_point GEOMETRY(POINTZ, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create route_recommendations table
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.route_recommendations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        route_uuid TEXT,
        route_name TEXT,
        route_description TEXT,
        recommended_length_km REAL,
        recommended_elevation_gain REAL,
        route_path JSONB,
        route_edges JSONB,
        trail_count INTEGER,
        route_score INTEGER,
        similarity_score REAL,
        region TEXT,
        constituent_trails JSONB,
        edge_count INTEGER,
        unique_trail_count INTEGER,
        one_way_distance_km REAL,
        one_way_elevation_m REAL,
        out_and_back_distance_km REAL,
        out_and_back_elevation_m REAL,
        route_geometry GEOMETRY(LINESTRING, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }
} 