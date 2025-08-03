import { Client } from 'pg';

export interface TrailSplitterConfig {
  minTrailLengthMeters: number;
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
   * Perform comprehensive trail splitting at intersections
   */
  async splitTrails(sourceQuery: string, params: any[]): Promise<TrailSplitResult> {
    console.log('🔍 DEBUG: Starting comprehensive trail splitting...');
    
    // Step 1: Insert original trails into staging
    console.log('🔄 Step 1: Inserting original trails...');
    const insertOriginalSql = `
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        created_at, updated_at, geometry
      )
      SELECT 
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        created_at, updated_at, geometry
      FROM (${sourceQuery}) as source_trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `;
    
    const insertResult = await this.pgClient.query(insertOriginalSql);
    console.log(`✅ Inserted ${insertResult.rowCount} original trails`);
    
    // Step 2: Perform comprehensive splitting using ST_Node()
    console.log('🔄 Step 2: Performing comprehensive trail splitting...');
    const comprehensiveSplitSql = `
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
    
    const splitResult = await this.pgClient.query(comprehensiveSplitSql, [this.config.minTrailLengthMeters]);
    console.log(`✅ Comprehensive splitting complete: ${splitResult.rowCount} segments`);
    
    // Step 3: Delete original trails (now that we have the split segments)
    const deleteOriginalSql = `DELETE FROM ${this.stagingSchema}.trails WHERE created_at < NOW() - INTERVAL '1 second'`;
    await this.pgClient.query(deleteOriginalSql);
    console.log('🗑️ Deleted original trails');
    
    // Get final statistics
    const finalCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.trails`);
    const finalSegmentCount = parseInt(finalCountResult.rows[0].count);
    
    const intersectionCountResult = await this.pgClient.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
        AND ST_Length(t1.geometry::geography) > $1
        AND ST_Length(t2.geometry::geography) > $1
    `, [this.config.minTrailLengthMeters]);
    
    const finalIntersectionCount = parseInt(intersectionCountResult.rows[0].intersection_count);
    
    console.log(`✅ Trail splitting complete`);
    console.log(`📊 Final result: ${finalSegmentCount} segments, ${finalIntersectionCount} remaining intersections`);
    
    return {
      iterations: 1, // Single iteration now
      finalSegmentCount,
      intersectionCount: finalIntersectionCount
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