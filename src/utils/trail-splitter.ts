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
    console.log('🔍 DEBUG: Starting comprehensive trail splitting...');
    
    // Step 1: Insert original trails into staging
    console.log('🔄 Step 1: Inserting original trails...');
    const insertOriginalSql = `
      INSERT INTO ${this.stagingSchema}.trails (
        id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        created_at, updated_at, geometry
      )
      SELECT 
        t.id, t.app_uuid, t.osm_id, t.name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
        t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
        t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation, t.source,
        t.created_at, t.updated_at, t.geometry
      FROM (${sourceQuery}) t 
      WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
    `;
    
    const insertResult = await this.pgClient.query(insertOriginalSql);
    console.log('✅ Original trails inserted:', insertResult.rowCount, 'trails');
    
    // Step 2: Comprehensive splitting using ST_Node() for better topology
    console.log('🔄 Step 2: Performing comprehensive trail splitting...');
    
    const comprehensiveSplitSql = `
      -- Find all intersection points and split trails at those points
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        created_at, updated_at, geometry
      )
      WITH all_trails AS (
        SELECT * FROM ${this.stagingSchema}.trails
      ),
      intersection_points AS (
        -- Find all intersection points between trails
        SELECT DISTINCT
          ST_Intersection(t1.geometry, t2.geometry) as intersection_point
        FROM all_trails t1
        JOIN all_trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
          AND ST_Length(t1.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
      ),
      split_segments AS (
        -- Split all trails at all intersection points
        SELECT
          t.id, t.app_uuid, t.osm_id, t.name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
          t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
          t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
          t.source, t.created_at, t.updated_at, t.geometry,
          dumped.geom as split_geometry,
          dumped.path[1] as segment_order
        FROM all_trails t
        CROSS JOIN intersection_points i,
        LATERAL ST_Dump(ST_Split(t.geometry, i.intersection_point)) as dumped
        WHERE ST_IsValid(dumped.geom) AND dumped.geom IS NOT NULL
      ),
      unsplit_trails AS (
        -- Keep trails that don't have any intersections
        SELECT
          t.id, t.app_uuid, t.osm_id, t.name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
          t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
          t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
          t.source, t.created_at, t.updated_at, t.geometry,
          t.geometry as split_geometry,
          1 as segment_order
        FROM all_trails t
        WHERE NOT EXISTS (
          SELECT 1 FROM intersection_points i WHERE ST_Intersects(t.geometry, i.intersection_point)
        )
      ),
      all_segments AS (
        SELECT * FROM split_segments
        UNION ALL
        SELECT * FROM unsplit_trails
      )
      SELECT
        gen_random_uuid() as app_uuid,
        osm_id, name, region, trail_type, surface, difficulty, source_tags,
        ST_XMin(split_geometry) as bbox_min_lng, ST_XMax(split_geometry) as bbox_max_lng,
        ST_YMin(split_geometry) as bbox_min_lat, ST_YMax(split_geometry) as bbox_max_lat,
        ST_Length(split_geometry::geography) / 1000.0 as length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        NOW() as created_at, NOW() as updated_at, split_geometry as geometry
      FROM all_segments
      WHERE ST_IsValid(split_geometry) AND split_geometry IS NOT NULL
    `;
    
    const splitResult = await this.pgClient.query(comprehensiveSplitSql, [this.config.minTrailLengthMeters]);
    console.log(`✅ Comprehensive splitting complete: ${splitResult.rowCount} segments created`);
    
    // Delete the original trails (now that we have the split segments)
    const deleteOriginalsSql = `DELETE FROM ${this.stagingSchema}.trails WHERE id IN (
      SELECT id FROM ${this.stagingSchema}.trails 
      WHERE app_uuid IN (SELECT app_uuid FROM (${sourceQuery}) t)
    )`;
    await this.pgClient.query(deleteOriginalsSql);
    console.log('🗑️ Deleted original trails');
    
    // Step 3: Iterative refinement if needed
    let iteration = 1;
    const maxRefinementIterations = 3;
    
    while (iteration <= maxRefinementIterations) {
      console.log(`🔄 Step ${iteration + 2}: Refinement iteration ${iteration}...`);
      
      // Check if there are still intersections (using same logic as detect_trail_intersections)
      const remainingIntersectionsSql = `
        WITH noded_trails AS (
          SELECT id, geometry, (ST_Dump(ST_Node(geometry))).geom as noded_geom
          FROM ${this.stagingSchema}.trails
          WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        )
        SELECT COUNT(*) as intersection_count
        FROM noded_trails t1
        JOIN noded_trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.noded_geom, t2.noded_geom)
          AND ST_GeometryType(ST_Intersection(t1.noded_geom, t2.noded_geom)) = 'ST_Point'
          AND ST_Length(t1.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
      `;
      
      const remainingResult = await this.pgClient.query(remainingIntersectionsSql, [this.config.minTrailLengthMeters]);
      const remainingIntersections = parseInt(remainingResult.rows[0].intersection_count);
      
      if (remainingIntersections === 0) {
        console.log('✅ No remaining intersections. Splitting complete.');
        break;
      }
      
      console.log(`🔍 Found ${remainingIntersections} remaining intersections, performing refinement...`);
      
      // Perform another comprehensive split using ST_Node()
      const refinementSql = `
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
          created_at, updated_at, geometry
        )
        SELECT
          gen_random_uuid() as app_uuid,
          osm_id, name, region, trail_type, surface, difficulty, source_tags,
          ST_XMin(dumped.geom) as bbox_min_lng, ST_XMax(dumped.geom) as bbox_max_lng,
          ST_YMin(dumped.geom) as bbox_min_lat, ST_YMax(dumped.geom) as bbox_max_lat,
          ST_Length(dumped.geom::geography) / 1000.0 as length_km,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
          NOW() as created_at, NOW() as updated_at, dumped.geom as geometry
        FROM ${this.stagingSchema}.trails t,
        LATERAL ST_Dump(ST_Node(t.geometry)) as dumped
        WHERE ST_IsValid(dumped.geom) 
          AND dumped.geom IS NOT NULL
          AND ST_Length(dumped.geom::geography) > $1
      `;
      
             const refinementResult = await this.pgClient.query(refinementSql, [this.config.minTrailLengthMeters]);
       console.log(`✅ Refinement iteration ${iteration} complete: ${refinementResult.rowCount} segments`);
       
       // Delete the current trails (now that we have the refined segments)
       const deleteCurrentSql = `DELETE FROM ${this.stagingSchema}.trails WHERE id NOT IN (
         SELECT id FROM ${this.stagingSchema}.trails ORDER BY id DESC LIMIT ${refinementResult.rowCount}
       )`;
       await this.pgClient.query(deleteCurrentSql);
       console.log('🗑️ Deleted current trails, kept refined segments');
      
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