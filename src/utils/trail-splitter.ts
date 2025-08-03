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
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        created_at, updated_at, geometry
      )
      SELECT 
        t.app_uuid, t.osm_id, t.name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
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
      -- Split each trail at its own intersection points (no CROSS JOIN)
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        created_at, updated_at, geometry
      )
      WITH all_trails AS (
        SELECT * FROM ${this.stagingSchema}.trails
      ),
      trail_intersections AS (
        -- For each trail, find all intersection points that affect it
        SELECT 
          t.app_uuid,
          t.osm_id,
          t.name,
          t.region,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.source_tags,
          t.bbox_min_lng,
          t.bbox_max_lng,
          t.bbox_min_lat,
          t.bbox_max_lat,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation,
          t.source,
          t.created_at,
          t.updated_at,
          t.geometry,
          ST_Collect(
            ARRAY(
              SELECT (ST_Dump(ST_Intersection(t.geometry, t2.geometry))).geom
              FROM all_trails t2
              WHERE t2.app_uuid != t.app_uuid
                AND ST_Intersects(t.geometry, t2.geometry)
                AND ST_GeometryType(ST_Intersection(t.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
                AND ST_Length(t.geometry::geography) > $1
                AND ST_Length(t2.geometry::geography) > $1
            )
          ) as intersection_points
        FROM all_trails t
      ),
      split_segments AS (
        -- Split each trail at its own intersection points
        SELECT
          t.app_uuid, t.osm_id, t.name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
          t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
          t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
          t.source, t.created_at, t.updated_at, t.geometry,
          dumped.geom as split_geometry,
          dumped.path[1] as segment_order
        FROM trail_intersections t,
        LATERAL ST_Dump(
          CASE 
            WHEN ST_NumGeometries(t.intersection_points) > 0 
            THEN ST_Split(t.geometry, t.intersection_points)
            ELSE t.geometry
          END
        ) as dumped
        WHERE ST_IsValid(dumped.geom) AND dumped.geom IS NOT NULL
      )
      SELECT
        gen_random_uuid() as app_uuid,
        osm_id, name, region, trail_type, surface, difficulty, source_tags,
        ST_XMin(split_geometry) as bbox_min_lng, ST_XMax(split_geometry) as bbox_max_lng,
        ST_YMin(split_geometry) as bbox_min_lat, ST_YMax(split_geometry) as bbox_max_lat,
        ST_Length(split_geometry::geography) / 1000.0 as length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        NOW() as created_at, NOW() as updated_at, split_geometry as geometry
      FROM split_segments
      WHERE ST_IsValid(split_geometry) AND split_geometry IS NOT NULL
    `;
    
    const splitResult = await this.pgClient.query(comprehensiveSplitSql, [this.config.minTrailLengthMeters]);
    console.log(`✅ Comprehensive splitting complete: ${splitResult.rowCount} segments created`);
    
    // Delete the original trails (now that we have the split segments)
    const deleteOriginalsSql = `DELETE FROM ${this.stagingSchema}.trails WHERE app_uuid IN (
      SELECT app_uuid FROM (${sourceQuery}) t
    )`;
    await this.pgClient.query(deleteOriginalsSql);
    console.log('🗑️ Deleted original trails');
    
    // Enhanced loop processing using sophisticated SQL approach
    await this.processLoopSegments();
    
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
        JOIN noded_trails t2 ON t1.app_uuid < t2.app_uuid
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

  /**
   * Realistic loop processing that respects actual trail intersections
   * Only splits loops where they actually intersect with other trails
   */
  async processLoopSegments(): Promise<void> {
    console.log('🔄 Processing loops with realistic intersection-based splitting...');
    
    const realisticLoopProcessingSql = `
      -- STEP 1: IDENTIFY CLOSED LOOP TRAILS
      DROP TABLE IF EXISTS ${this.stagingSchema}.closed_loops;
      CREATE TEMP TABLE closed_loops AS
      SELECT *
      FROM ${this.stagingSchema}.trails
      WHERE ST_IsClosed(geometry) = true
        AND ST_Length(geometry::geography) > $1;
      
      -- STEP 2: FIND REAL INTERSECTIONS WITH OTHER TRAILS
      DROP TABLE IF EXISTS ${this.stagingSchema}.loop_intersections;
      CREATE TEMP TABLE loop_intersections AS
      SELECT DISTINCT
        l.app_uuid as loop_uuid,
        l.name as loop_name,
        l.geometry as loop_geometry,
        ST_Intersection(l.geometry, t.geometry) as intersection_point,
        t.app_uuid as intersecting_trail_uuid,
        t.name as intersecting_trail_name
      FROM closed_loops l
      JOIN ${this.stagingSchema}.trails t ON (
        l.app_uuid != t.app_uuid 
        AND ST_Intersects(l.geometry, t.geometry)
        AND ST_GeometryType(ST_Intersection(l.geometry, t.geometry)) IN ('ST_Point', 'ST_MultiPoint')
      );
      
      -- STEP 3: SPLIT LOOPS ONLY AT REAL INTERSECTIONS
      DROP TABLE IF EXISTS ${this.stagingSchema}.split_loop_segments;
      CREATE TEMP TABLE split_loop_segments AS
      SELECT 
        l.loop_uuid,
        l.loop_name,
        dumped.geom as segment_geometry,
        dumped.path[1] as segment_order,
        COUNT(i.intersection_point) as intersection_count
      FROM loop_intersections l
      CROSS JOIN LATERAL ST_Dump(
        CASE 
          WHEN COUNT(i.intersection_point) OVER (PARTITION BY l.loop_uuid) > 0
          THEN ST_Split(l.loop_geometry, ST_Collect(i.intersection_point))
          ELSE l.loop_geometry
        END
      ) as dumped
      LEFT JOIN loop_intersections i ON l.loop_uuid = i.loop_uuid
      GROUP BY l.loop_uuid, l.loop_name, l.loop_geometry, dumped.geom, dumped.path[1]
      HAVING ST_IsValid(dumped.geom) 
        AND dumped.geom IS NOT NULL
        AND ST_Length(dumped.geom::geography) > 10; -- Filter out tiny segments
      
      -- STEP 4: INSERT SPLIT SEGMENTS BACK INTO TRAILS TABLE
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        created_at, updated_at, geometry
      )
      SELECT 
        s.loop_uuid || '_segment_' || s.segment_order as app_uuid,
        t.osm_id, s.loop_name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
        ST_XMin(s.segment_geometry) as bbox_min_lng, ST_XMax(s.segment_geometry) as bbox_max_lng,
        ST_YMin(s.segment_geometry) as bbox_min_lat, ST_YMax(s.segment_geometry) as bbox_max_lat,
        ST_Length(s.segment_geometry::geography) / 1000.0 as length_km,
        t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation, t.source,
        NOW() as created_at, NOW() as updated_at, s.segment_geometry as geometry
      FROM split_loop_segments s
      JOIN ${this.stagingSchema}.trails t ON s.loop_uuid = t.app_uuid;
      
      -- STEP 5: REMOVE ORIGINAL CLOSED LOOPS
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE app_uuid IN (SELECT DISTINCT loop_uuid FROM loop_intersections);
      
      -- STEP 6: UPDATE INTERSECTION POINTS TO INCLUDE LOOP SEGMENTS
      INSERT INTO ${this.stagingSchema}.intersection_points (
        point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
      )
      SELECT 
        ST_Force2D(i.intersection_point) as point,
        ST_Force3D(i.intersection_point) as point_3d,
        ARRAY[i.loop_uuid, i.intersecting_trail_uuid] as connected_trail_ids,
        ARRAY[i.loop_name, i.intersecting_trail_name] as connected_trail_names,
        'loop_intersection' as node_type,
        0.0 as distance_meters
      FROM loop_intersections i
      WHERE ST_IsValid(i.intersection_point) AND i.intersection_point IS NOT NULL;
    `;
    
    try {
      await this.pgClient.query(realisticLoopProcessingSql, [this.config.minTrailLengthMeters]);
      
      // Get statistics
      const statsResult = await this.pgClient.query(`
        SELECT 
          COUNT(DISTINCT loop_uuid) as loops_processed,
          COUNT(*) as segments_created,
          COUNT(DISTINCT intersection_point) as real_intersections
        FROM loop_intersections
      `);
      
      const loopStats = statsResult.rows[0];
      console.log(`✅ Realistic loop processing complete:`);
      console.log(`   🔄 Loops processed: ${loopStats.loops_processed}`);
      console.log(`   📊 Segments created: ${loopStats.segments_created}`);
      console.log(`   🔗 Real intersections: ${loopStats.real_intersections}`);
      
    } catch (error) {
      console.error('❌ Error processing loop segments:', error);
      throw error;
    }
  }
} 