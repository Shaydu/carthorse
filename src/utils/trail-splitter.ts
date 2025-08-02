import { Client } from 'pg';

export interface TrailSplitterConfig {
  minTrailLengthMeters: number;
  maxIterations: number;
}

export interface TrailSplitResult {
  iterations: number;
  finalSegmentCount: number;
  intersectionCount: number;
}

export class TrailSplitter {
  constructor(
    private pgClient: Client,
    private stagingSchema: string,
    private config: TrailSplitterConfig
  ) {}

  /**
   * Iteratively split trails at intersections until no more intersections exist
   */
  async splitTrails(sourceQuery: string, params: any[]): Promise<TrailSplitResult> {
    console.log('🔍 DEBUG: Starting iterative trail splitting...');
    
    // Step 1: Insert original trails into staging
    console.log('🔄 Step 1: Inserting original trails...');
    const insertOriginalSql = `
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        geometry, created_at, updated_at
      )
      SELECT * FROM (${sourceQuery}) t 
      WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
    `;
    
    const insertResult = await this.pgClient.query(insertOriginalSql, params);
    console.log('✅ Original trails inserted:', insertResult.rowCount, 'trails');
    
    // Step 2: Iterative splitting until no more intersections
    let iteration = 1;
    
    while (iteration <= this.config.maxIterations) {
      console.log(`🔄 Step ${iteration + 1}: Finding trails to split...`);
      
      // Find trails that have intersections with other trails
      const findTrailsToSplitSql = `
        SELECT DISTINCT t1.app_uuid as trail_uuid, t1.name as trail_name
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
        LIMIT 1
      `;
      
      const trailsToSplitResult = await this.pgClient.query(findTrailsToSplitSql, params);
      
      if (trailsToSplitResult.rows.length === 0) {
        console.log('✅ No more trails to split. Splitting complete.');
        break;
      }
      
      const trailToSplit = trailsToSplitResult.rows[0];
      console.log(`🔍 Splitting trail: ${trailToSplit.trail_name} (${trailToSplit.trail_uuid})`);
      
      // Split this specific trail at all its intersections
      const splitTrailSql = `
        WITH trail_to_split AS (
          SELECT * FROM ${this.stagingSchema}.trails 
          WHERE app_uuid = $2
        ),
        intersections AS (
          -- Find all intersection points for this trail
          SELECT DISTINCT
            dumped.geom as intersection_point
          FROM trail_to_split t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id,
          LATERAL ST_Dump(ST_Intersection(t1.geometry, t2.geometry)) as dumped
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t1.geometry::geography) > $1
            AND ST_Length(t2.geometry::geography) > $1
        ),
        split_segments AS (
          -- Split the trail at all intersection points
          SELECT
            t.id, t.app_uuid, t.osm_id, t.name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
            t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
            t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
            t.source, t.created_at, t.updated_at, t.geometry,
            dumped.geom as split_geometry,
            dumped.path[1] as segment_order
          FROM trail_to_split t
          LEFT JOIN intersections i ON ST_Intersects(t.geometry, i.intersection_point),
          LATERAL ST_Dump(
            CASE 
              WHEN i.intersection_point IS NOT NULL 
              THEN ST_Split(t.geometry, i.intersection_point)
              ELSE ST_Collect(t.geometry)
            END
          ) as dumped
          WHERE ST_IsValid(dumped.geom) AND dumped.geom IS NOT NULL
        )
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
          geometry, created_at, updated_at
        )
        SELECT
          gen_random_uuid() as app_uuid,
          osm_id, name, region, trail_type, surface, difficulty, source_tags,
          ST_XMin(split_geometry) as bbox_min_lng, ST_XMax(split_geometry) as bbox_max_lng,
          ST_YMin(split_geometry) as bbox_min_lat, ST_YMax(split_geometry) as bbox_max_lat,
          ST_Length(split_geometry::geography) / 1000.0 as length_km,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
          split_geometry as geometry, NOW() as created_at, NOW() as updated_at
        FROM split_segments
        WHERE ST_IsValid(split_geometry) AND split_geometry IS NOT NULL
      `;
      
      const splitResult = await this.pgClient.query(splitTrailSql, [...params, trailToSplit.trail_uuid]);
      console.log(`✅ Split trail into ${splitResult.rowCount} segments`);
      
      // Delete the original unsplit trail
      const deleteOriginalSql = `
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE app_uuid = $2
      `;
      
      const deleteResult = await this.pgClient.query(deleteOriginalSql, [...params, trailToSplit.trail_uuid]);
      console.log(`🗑️ Deleted original trail: ${trailToSplit.trail_name}`);
      
      iteration++;
    }
    
    // Get final statistics
    const finalCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.trails`);
    const finalSegmentCount = parseInt(finalCountResult.rows[0].count);
    
    const intersectionCountResult = await this.pgClient.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > $1
        AND ST_Length(t2.geometry::geography) > $1
    `, [this.config.minTrailLengthMeters]);
    
    const intersectionCount = parseInt(intersectionCountResult.rows[0].intersection_count);
    
    console.log(`✅ Iterative splitting complete after ${iteration} iterations`);
    console.log(`📊 Final result: ${finalSegmentCount} segments, ${intersectionCount} remaining intersections`);
    
    return {
      iterations: iteration,
      finalSegmentCount,
      intersectionCount
    };
  }

  /**
   * Check if there are any intersections between trails
   */
  async hasIntersections(): Promise<boolean> {
    const result = await this.pgClient.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > $1
        AND ST_Length(t2.geometry::geography) > $1
    `, [this.config.minTrailLengthMeters]);
    
    return parseInt(result.rows[0].intersection_count) > 0;
  }

  /**
   * Get statistics about the current trail network
   */
  async getStatistics(): Promise<{
    totalTrails: number;
    intersectionCount: number;
    averageTrailLength: number;
  }> {
    const statsResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        AVG(ST_Length(geometry::geography)) as avg_length,
        COUNT(*) FILTER (WHERE ST_Length(geometry::geography) > 0) as valid_trails
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    const intersectionResult = await this.pgClient.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > $1
        AND ST_Length(t2.geometry::geography) > $1
    `, [this.config.minTrailLengthMeters]);
    
    return {
      totalTrails: parseInt(statsResult.rows[0].total_trails),
      intersectionCount: parseInt(intersectionResult.rows[0].intersection_count),
      averageTrailLength: parseFloat(statsResult.rows[0].avg_length) || 0
    };
  }
} 