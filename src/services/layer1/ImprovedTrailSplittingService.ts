import { Pool } from 'pg';

export interface TrailSplittingService2Config {
  stagingSchema: string;
  pgClient: Pool;
  toleranceMeters?: number;
  dedupToleranceMeters?: number;
  minSegmentLengthMeters?: number;
  ySplitToleranceMeters?: number;
  spurSnapToleranceMeters?: number;
  preserveOriginalTrails?: boolean;
}

export interface TrailSplittingService2Result {
  originalTrailCount: number;
  splitSegmentCount: number;
  intersectionPointsFound: number;
  duplicatePointsRemoved: number;
  ySplitsApplied: number;
  spurSnapsApplied: number;
  segmentsRemoved: number;
  success: boolean;
  error?: string;
}

export class TrailSplittingService2 {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: TrailSplittingService2Config;

  constructor(config: TrailSplittingService2Config) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = {
      toleranceMeters: 10, // ~10m for intersection detection
      dedupToleranceMeters: 0.1, // 0.1m for deduplication (1% of tolerance)
      minSegmentLengthMeters: 1.0,
      ySplitToleranceMeters: 10, // ~10m for Y-split detection
      spurSnapToleranceMeters: 3, // 3m for spur snapping
      preserveOriginalTrails: false,
      ...config
    };
  }

  /**
   * Main method to split trails at intersections using the improved workflow
   * This method ONLY operates on Layer 1 trails data in the staging schema
   */
  async splitTrailsAtIntersections(): Promise<TrailSplittingService2Result> {
    console.log('🔗 TRAIL SPLITTING SERVICE 2.0: Using enhanced workflow for Layer 1 trail processing...');
    
    const result: TrailSplittingService2Result = {
      originalTrailCount: 0,
      splitSegmentCount: 0,
      intersectionPointsFound: 0,
      duplicatePointsRemoved: 0,
      ySplitsApplied: 0,
      spurSnapsApplied: 0,
      segmentsRemoved: 0,
      success: false
    };

    try {
      // Step 1: Get initial trail count
      result.originalTrailCount = await this.getInitialTrailCount();
      console.log(`   📊 Initial trails: ${result.originalTrailCount}`);

      // Step 2: Create and deduplicate intersection points
      const intersectionStats = await this.createAndDeduplicateIntersectionPoints();
      result.intersectionPointsFound = intersectionStats.rawCount;
      result.duplicatePointsRemoved = intersectionStats.duplicatesRemoved;
      console.log(`   📊 Created ${result.intersectionPointsFound} raw intersection points`);
      console.log(`   📊 After deduplication: ${intersectionStats.dedupCount} intersection points`);
      console.log(`   📊 Removed ${result.duplicatePointsRemoved} duplicate points`);

      // Step 3: Split trails at T-intersection points
      const tSplitCount = await this.splitTrailsAtTIntersections();
      console.log(`   📊 T-split segments: ${tSplitCount}`);

      // Step 4: Apply Y-split detection and handling
      const ySplitStats = await this.applyYSplitDetection();
      result.ySplitsApplied = ySplitStats.appliedCount;
      console.log(`   📊 Y-split results:`);
      ySplitStats.breakdown.forEach(row => {
        console.log(`      ${row.split_type}: ${row.count} segments (avg distance: ${row.avg_distance_m?.toFixed(1)}m)`);
      });

      // Step 5: Apply spur snapping (third pass)
      const spurSnapStats = await this.applySpurSnapping();
      result.spurSnapsApplied = spurSnapStats.appliedCount;
      console.log(`   📊 Spur snapping results:`);
      spurSnapStats.breakdown.forEach(row => {
        console.log(`      ${row.split_type}: ${row.count} segments (avg distance: ${row.avg_distance_m?.toFixed(1)}m)`);
      });

      // Step 6: Create final trails table with metadata
      await this.createFinalTrailsTable();

      // Step 7: Create 3D geometry table for trail/route level data
      await this.create3DGeometryTable();

      // Step 8: Clean up temporary tables
      await this.cleanupTemporaryTables();

      // Step 9: Get final statistics
      result.splitSegmentCount = await this.getFinalTrailCount();
      result.segmentsRemoved = result.originalTrailCount - result.splitSegmentCount;

      // Step 10: Create spatial index
      await this.createSpatialIndex();

      result.success = true;
      
      console.log(`   ✅ Trail Splitting Service 2.0 complete:`);
      console.log(`      📊 Original trails: ${result.originalTrailCount}`);
      console.log(`      🔗 Split segments: ${result.splitSegmentCount}`);
      console.log(`      📍 Intersection points found: ${result.intersectionPointsFound}`);
      console.log(`      🗑️ Duplicate points removed: ${result.duplicatePointsRemoved}`);
      console.log(`      🔀 Y-splits applied: ${result.ySplitsApplied}`);
      console.log(`      🔗 Spur snaps applied: ${result.spurSnapsApplied}`);
      console.log(`      🗑️ Segments removed: ${result.segmentsRemoved}`);

      return result;

    } catch (error) {
      console.error('   ❌ Error during trail splitting:', error);
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Get initial trail count from staging schema
   */
  private async getInitialTrailCount(): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
    `);
    return parseInt(result.rows[0].count);
  }

  /**
   * Create intersection points with improved deduplication
   */
  private async createAndDeduplicateIntersectionPoints(): Promise<{
    rawCount: number;
    dedupCount: number;
    duplicatesRemoved: number;
  }> {
    console.log('   🔧 Step 1: Creating intersection points with improved deduplication...');
    
    const tolerance = this.config.toleranceMeters! / 111000; // Convert to degrees
    const dedupTolerance = this.config.dedupToleranceMeters! / 111000;
    
    console.log(`   📏 Using tolerance: ${this.config.toleranceMeters}m (~${Math.round(tolerance * 111000)}m)`);
    console.log(`   📏 Deduplication tolerance: ${this.config.dedupToleranceMeters}m (~${Math.round(dedupTolerance * 111000)}m)`);
    
    // Create intersection points table
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.t_intersections AS
      WITH exact_intersections AS (
        SELECT (ST_Dump(ST_Intersection(a.geometry, b.geometry))).geom AS geometry
        FROM ${this.stagingSchema}.trails a
        JOIN ${this.stagingSchema}.trails b ON a.id < b.id
        WHERE ST_Crosses(a.geometry, b.geometry)
      ),
      tolerance_intersections AS (
        SELECT ST_ClosestPoint(a.geometry, b.geometry) AS geometry
        FROM ${this.stagingSchema}.trails a
        JOIN ${this.stagingSchema}.trails b ON a.id < b.id
        WHERE ST_DWithin(a.geometry, b.geometry, ${tolerance})
          AND NOT ST_Crosses(a.geometry, b.geometry)
      ),
      endpoint_intersections AS (
        SELECT ST_ClosestPoint(a.geometry, ST_EndPoint(b.geometry)) AS geometry
        FROM ${this.stagingSchema}.trails a
        JOIN ${this.stagingSchema}.trails b ON a.id != b.id
        WHERE ST_DWithin(a.geometry, ST_EndPoint(b.geometry), ${tolerance})
          AND NOT ST_Intersects(a.geometry, ST_EndPoint(b.geometry))
        UNION
        SELECT ST_ClosestPoint(a.geometry, ST_StartPoint(b.geometry)) AS geometry
        FROM ${this.stagingSchema}.trails a
        JOIN ${this.stagingSchema}.trails b ON a.id != b.id
        WHERE ST_DWithin(a.geometry, ST_StartPoint(b.geometry), ${tolerance})
          AND NOT ST_Intersects(a.geometry, ST_StartPoint(b.geometry))
      ),
      all_intersection_points AS (
        SELECT geometry FROM exact_intersections WHERE ST_GeometryType(geometry) = 'ST_Point'
        UNION ALL
        SELECT geometry FROM tolerance_intersections WHERE ST_GeometryType(geometry) = 'ST_Point'
        UNION ALL
        SELECT geometry FROM endpoint_intersections WHERE ST_GeometryType(geometry) = 'ST_Point'
      )
      SELECT DISTINCT ST_ClosestPoint(t.geometry, ip.geometry) AS geometry
      FROM all_intersection_points ip
      JOIN ${this.stagingSchema}.trails t ON ST_DWithin(t.geometry, ip.geometry, ${tolerance})
    `);

    // Add ST_Node intersection points
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.t_intersections (geometry)
      WITH trail_pairs AS (
        SELECT 
          a.id as trail_a_id,
          a.name as trail_a_name,
          a.geometry as trail_a_geom,
          b.id as trail_b_id,
          b.name as trail_b_name,
          b.geometry as trail_b_geom
        FROM ${this.stagingSchema}.trails a
        JOIN ${this.stagingSchema}.trails b ON a.id < b.id
        WHERE ST_DWithin(a.geometry, b.geometry, ${tolerance})
      ),
      noded_intersections AS (
        SELECT 
          tp.trail_a_id,
          tp.trail_a_name,
          tp.trail_b_id,
          tp.trail_b_name,
          (ST_Dump(ST_Node(ST_UnaryUnion(ST_Collect(ARRAY[tp.trail_a_geom, tp.trail_b_geom]))))).geom AS intersection_point
        FROM trail_pairs tp
      ),
      valid_intersections AS (
        SELECT 
          trail_a_id,
          trail_a_name,
          trail_b_id,
          trail_b_name,
          intersection_point
        FROM noded_intersections
        WHERE ST_GeometryType(intersection_point) = 'ST_Point'
          AND ST_Intersects(intersection_point, (SELECT geometry FROM ${this.stagingSchema}.trails WHERE id = trail_a_id))
          AND ST_Intersects(intersection_point, (SELECT geometry FROM ${this.stagingSchema}.trails WHERE id = trail_b_id))
      )
      SELECT DISTINCT intersection_point AS geometry
      FROM valid_intersections
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.stagingSchema}.t_intersections existing
        WHERE ST_DWithin(existing.geometry, intersection_point, ${dedupTolerance})
      )
    `);

    // Count raw intersection points
    const rawIntersectionCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.t_intersections`);
    const rawCount = parseInt(rawIntersectionCount.rows[0].count);

    // Apply improved deduplication
    console.log('   🔧 Step 2: Applying improved deduplication...');
    
    // Create deduplicated intersection points
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.t_intersections_dedup AS
      SELECT DISTINCT ON (ST_SnapToGrid(geometry, ${dedupTolerance})) 
        geometry
      FROM ${this.stagingSchema}.t_intersections
      ORDER BY ST_SnapToGrid(geometry, ${dedupTolerance}), geometry
    `);
    
    await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.t_intersections`);
    await this.pgClient.query(`ALTER TABLE ${this.stagingSchema}.t_intersections_dedup RENAME TO t_intersections`);
    
    // Count deduplicated intersection points
    const dedupIntersectionCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.t_intersections`);
    const dedupCount = parseInt(dedupIntersectionCount.rows[0].count);
    const duplicatesRemoved = rawCount - dedupCount;

    return { rawCount, dedupCount, duplicatesRemoved };
  }

  /**
   * Split trails at T-intersection points
   */
  private async splitTrailsAtTIntersections(): Promise<number> {
    console.log('   🔧 Step 3: Splitting trails at intersection points...');
    
    const tolerance = this.config.toleranceMeters! / 111000;
    
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails_with_t_splits AS
      WITH trail_intersections AS (
        SELECT 
          t.id as trail_id,
          t.app_uuid as trail_app_uuid,
          t.name as trail_name,
          t.region,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation,
          t.bbox_min_lng,
          t.bbox_max_lng,
          t.bbox_min_lat,
          t.bbox_max_lat,
          t.source,
          t.source_tags,
          t.geometry as trail_geom,
          ARRAY_AGG(ti.geometry ORDER BY ST_LineLocatePoint(t.geometry, ti.geometry)) as intersection_points
        FROM ${this.stagingSchema}.trails t
        LEFT JOIN ${this.stagingSchema}.t_intersections ti ON ST_DWithin(t.geometry, ti.geometry, ${tolerance})
        GROUP BY t.id, t.app_uuid, t.name, t.region, t.trail_type, t.surface, t.difficulty, 
                 t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, 
                 t.avg_elevation, t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat, 
                 t.source, t.source_tags, t.geometry
        HAVING COUNT(ti.geometry) > 0
      ),
      split_segments AS (
        SELECT 
          ti.trail_id as orig_id,
          ti.trail_app_uuid,
          ti.trail_name,
          ti.region,
          ti.trail_type,
          ti.surface,
          ti.difficulty,
          ti.length_km,
          ti.elevation_gain,
          ti.elevation_loss,
          ti.max_elevation,
          ti.min_elevation,
          ti.avg_elevation,
          ti.bbox_min_lng,
          ti.bbox_max_lng,
          ti.bbox_min_lat,
          ti.bbox_max_lat,
          ti.source,
          ti.source_tags,
          CASE 
            WHEN array_length(ti.intersection_points, 1) = 1 THEN
              ARRAY[
                ST_LineSubstring(ti.trail_geom, 0, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1])),
                ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1]), 1)
              ]
            WHEN array_length(ti.intersection_points, 1) = 2 THEN
              ARRAY[
                ST_LineSubstring(ti.trail_geom, 0, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1])),
                ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1]), ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2])),
                ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2]), 1)
              ]
            WHEN array_length(ti.intersection_points, 1) = 3 THEN
              ARRAY[
                ST_LineSubstring(ti.trail_geom, 0, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1])),
                ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1]), ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2])),
                ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2]), ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[3])),
                ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[3]), 1)
              ]
            ELSE
              ARRAY[ti.trail_geom]
          END as segments,
          array_length(ti.intersection_points, 1) as point_count
        FROM trail_intersections ti
      ),
      unnest_segments AS (
        SELECT 
          orig_id,
          trail_app_uuid,
          trail_name,
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
          unnest(segments) as geometry,
          point_count
        FROM split_segments
      )
      SELECT 
        orig_id,
        trail_app_uuid,
        trail_name,
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
        geometry,
        point_count
      FROM unnest_segments
      WHERE ST_GeometryType(geometry) = 'ST_LineString'
        AND ST_Length(geometry::geography) > ${this.config.minSegmentLengthMeters}
    `);

    // Add non-intersecting trails back
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.trails_with_t_splits (
        orig_id, trail_app_uuid, trail_name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, geometry, point_count
      )
      SELECT 
        a.id AS orig_id,
        a.app_uuid,
        a.name,
        a.region,
        a.trail_type,
        a.surface,
        a.difficulty,
        a.length_km,
        a.elevation_gain,
        a.elevation_loss,
        a.max_elevation,
        a.min_elevation,
        a.avg_elevation,
        a.bbox_min_lng,
        a.bbox_max_lng,
        a.bbox_min_lat,
        a.bbox_max_lat,
        a.source,
        a.source_tags,
        a.geometry,
        0 as point_count
      FROM ${this.stagingSchema}.trails a
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.stagingSchema}.t_intersections ti
        WHERE ST_DWithin(a.geometry, ti.geometry, ${tolerance})
      )
    `);

    // Count T-split segments
    const tSplitCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_with_t_splits`);
    return parseInt(tSplitCount.rows[0].count);
  }

  /**
   * Apply Y-split detection and handling
   */
  private async applyYSplitDetection(): Promise<{
    appliedCount: number;
    breakdown: Array<{ split_type: string; count: string; avg_distance_m: number | null }>;
  }> {
    console.log('   🔧 Step 4: Y-split detection and handling...');
    
    const ySplitTolerance = this.config.ySplitToleranceMeters! / 111000;
    
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails_with_y_splits AS
      WITH y_intersections AS (
        SELECT 
          a.orig_id as trail_a_id,
          a.trail_app_uuid as trail_a_app_uuid,
          a.trail_name as trail_a_name,
          a.region as trail_a_region,
          a.trail_type as trail_a_trail_type,
          a.surface as trail_a_surface,
          a.difficulty as trail_a_difficulty,
          a.length_km as trail_a_length_km,
          a.elevation_gain as trail_a_elevation_gain,
          a.elevation_loss as trail_a_elevation_loss,
          a.max_elevation as trail_a_max_elevation,
          a.min_elevation as trail_a_min_elevation,
          a.avg_elevation as trail_a_avg_elevation,
          a.bbox_min_lng as trail_a_bbox_min_lng,
          a.bbox_max_lng as trail_a_bbox_max_lng,
          a.bbox_min_lat as trail_a_bbox_min_lat,
          a.bbox_max_lat as trail_a_bbox_max_lat,
          a.source as trail_a_source,
          a.source_tags as trail_a_source_tags,
          a.geometry as trail_a_geom,
          b.orig_id as trail_b_id,
          b.trail_app_uuid as trail_b_app_uuid,
          b.trail_name as trail_b_name,
          b.region as trail_b_region,
          b.trail_type as trail_b_trail_type,
          b.surface as trail_b_surface,
          b.difficulty as trail_b_difficulty,
          b.length_km as trail_b_length_km,
          b.elevation_gain as trail_b_elevation_gain,
          b.elevation_loss as trail_b_elevation_loss,
          b.max_elevation as trail_b_max_elevation,
          b.min_elevation as trail_b_min_elevation,
          b.avg_elevation as trail_b_avg_elevation,
          b.bbox_min_lng as trail_b_bbox_min_lng,
          b.bbox_max_lng as trail_b_bbox_max_lng,
          b.bbox_min_lat as trail_b_bbox_min_lat,
          b.bbox_max_lat as trail_b_bbox_max_lat,
          b.source as trail_b_source,
          b.source_tags as trail_b_source_tags,
          b.geometry as trail_b_geom,
          ST_Distance(ST_EndPoint(a.geometry), b.geometry) as distance_to_main,
          ST_ClosestPoint(b.geometry, ST_EndPoint(a.geometry)) as closest_point
        FROM ${this.stagingSchema}.trails_with_t_splits a
        JOIN ${this.stagingSchema}.trails_with_t_splits b ON a.orig_id != b.orig_id
        WHERE ST_Length(a.geometry::geography) < ST_Length(b.geometry::geography) * 0.8
          AND ST_DWithin(ST_EndPoint(a.geometry), b.geometry, ${ySplitTolerance})
          AND NOT ST_Intersects(ST_EndPoint(a.geometry), b.geometry)
          AND ST_Length(a.geometry::geography) > 10
      ),
      y_split_results AS (
        SELECT 
          trail_a_id,
          trail_a_app_uuid,
          trail_a_name,
          trail_a_region,
          trail_a_trail_type,
          trail_a_surface,
          trail_a_difficulty,
          trail_a_length_km,
          trail_a_elevation_gain,
          trail_a_elevation_loss,
          trail_a_max_elevation,
          trail_a_min_elevation,
          trail_a_avg_elevation,
          trail_a_bbox_min_lng,
          trail_a_bbox_max_lng,
          trail_a_bbox_min_lat,
          trail_a_bbox_max_lat,
          trail_a_source,
          trail_a_source_tags,
          ST_SetPoint(
            trail_a_geom, 
            ST_NPoints(trail_a_geom) - 1, 
            closest_point
          ) as snapped_trail_a_geom,
          trail_b_id,
          trail_b_app_uuid,
          trail_b_name,
          trail_b_region,
          trail_b_trail_type,
          trail_b_surface,
          trail_b_difficulty,
          trail_b_length_km,
          trail_b_elevation_gain,
          trail_b_elevation_loss,
          trail_b_max_elevation,
          trail_b_min_elevation,
          trail_b_avg_elevation,
          trail_b_bbox_min_lng,
          trail_b_bbox_max_lng,
          trail_b_bbox_min_lat,
          trail_b_bbox_max_lat,
          trail_b_source,
          trail_b_source_tags,
          (ST_Dump(ST_Split(trail_b_geom, closest_point))).geom as split_trail_b_geom,
          distance_to_main
        FROM y_intersections
        WHERE distance_to_main > 0.1
      )
      SELECT 
        trail_a_id as orig_id,
        trail_a_app_uuid as app_uuid,
        trail_a_name as name,
        trail_a_region as region,
        trail_a_trail_type as trail_type,
        trail_a_surface as surface,
        trail_a_difficulty as difficulty,
        trail_a_length_km as length_km,
        trail_a_elevation_gain as elevation_gain,
        trail_a_elevation_loss as elevation_loss,
        trail_a_max_elevation as max_elevation,
        trail_a_min_elevation as min_elevation,
        trail_a_avg_elevation as avg_elevation,
        trail_a_bbox_min_lng as bbox_min_lng,
        trail_a_bbox_max_lng as bbox_max_lng,
        trail_a_bbox_min_lat as bbox_min_lat,
        trail_a_bbox_max_lat as bbox_max_lat,
        trail_a_source as source,
        trail_a_source_tags as source_tags,
        snapped_trail_a_geom as geometry,
        'y_split_spur' as split_type,
        distance_to_main
      FROM y_split_results
      WHERE ST_GeometryType(snapped_trail_a_geom) = 'ST_LineString'
        AND ST_Length(snapped_trail_a_geom::geography) > 1
      
      UNION ALL
      
      SELECT 
        trail_b_id as orig_id,
        trail_b_app_uuid as app_uuid,
        trail_b_name as name,
        trail_b_region as region,
        trail_b_trail_type as trail_type,
        trail_b_surface as surface,
        trail_b_difficulty as difficulty,
        trail_b_length_km as length_km,
        trail_b_elevation_gain as elevation_gain,
        trail_b_elevation_loss as elevation_loss,
        trail_b_max_elevation as max_elevation,
        trail_b_min_elevation as min_elevation,
        trail_b_avg_elevation as avg_elevation,
        trail_b_bbox_min_lng as bbox_min_lng,
        trail_b_bbox_max_lng as bbox_max_lng,
        trail_b_bbox_min_lat as bbox_min_lat,
        trail_b_bbox_max_lat as bbox_max_lat,
        trail_b_source as source,
        trail_b_source_tags as source_tags,
        split_trail_b_geom as geometry,
        'y_split_main' as split_type,
        distance_to_main
      FROM y_split_results
      WHERE ST_GeometryType(split_trail_b_geom) = 'ST_LineString'
        AND ST_Length(split_trail_b_geom::geography) > 1
    `);

    // Add trails that weren't involved in Y-splitting
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.trails_with_y_splits (
        orig_id, app_uuid, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, geometry, split_type, distance_to_main
      )
      SELECT 
        t.orig_id,
        t.trail_app_uuid as app_uuid,
        t.trail_name as name,
        t.region,
        t.trail_type,
        t.surface,
        t.difficulty,
        t.length_km,
        t.elevation_gain,
        t.elevation_loss,
        t.max_elevation,
        t.min_elevation,
        t.avg_elevation,
        t.bbox_min_lng,
        t.bbox_max_lng,
        t.bbox_min_lat,
        t.bbox_max_lat,
        t.source,
        t.source_tags,
        t.geometry,
        'no_y_split' as split_type,
        0 as distance_to_main
      FROM ${this.stagingSchema}.trails_with_t_splits t
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.stagingSchema}.trails_with_y_splits s
        WHERE s.orig_id = t.orig_id
      )
    `);

    // Count Y-split results
    const ySplitCount = await this.pgClient.query(`
      SELECT 
        split_type,
        COUNT(*) as count,
        AVG(distance_to_main * 111000) as avg_distance_m
      FROM ${this.stagingSchema}.trails_with_y_splits
      GROUP BY split_type
      ORDER BY split_type
    `);
    
    let appliedCount = 0;
    ySplitCount.rows.forEach(row => {
      if (row.split_type === 'y_split_spur' || row.split_type === 'y_split_main') {
        appliedCount += parseInt(row.count);
      }
    });

    return {
      appliedCount,
      breakdown: ySplitCount.rows
    };
  }

  /**
   * Apply spur snapping (third pass)
   */
  private async applySpurSnapping(): Promise<{
    appliedCount: number;
    breakdown: Array<{ split_type: string; count: string; avg_distance_m: number | null }>;
  }> {
    console.log('   🔧 Step 5: Spur snapping (third pass)...');
    
    const spurSnapTolerance = this.config.spurSnapToleranceMeters! / 111000;
    
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails_with_spur_snapping AS
      WITH spur_candidates AS (
        SELECT 
          short.orig_id as spur_id,
          short.app_uuid as spur_app_uuid,
          short.name as spur_name,
          short.region as spur_region,
          short.trail_type as spur_trail_type,
          short.surface as spur_surface,
          short.difficulty as spur_difficulty,
          short.length_km as spur_length_km,
          short.elevation_gain as spur_elevation_gain,
          short.elevation_loss as spur_elevation_loss,
          short.max_elevation as spur_max_elevation,
          short.min_elevation as spur_min_elevation,
          short.avg_elevation as spur_avg_elevation,
          short.bbox_min_lng as spur_bbox_min_lng,
          short.bbox_max_lng as spur_bbox_max_lng,
          short.bbox_min_lat as spur_bbox_min_lat,
          short.bbox_max_lat as spur_bbox_max_lat,
          short.source as spur_source,
          short.source_tags as spur_source_tags,
          short.geometry as spur_geom,
          long.orig_id as main_id,
          long.app_uuid as main_app_uuid,
          long.name as main_name,
          long.region as main_region,
          long.trail_type as main_trail_type,
          long.surface as main_surface,
          long.difficulty as main_difficulty,
          long.length_km as main_length_km,
          long.elevation_gain as main_elevation_gain,
          long.elevation_loss as main_elevation_loss,
          long.max_elevation as main_max_elevation,
          long.min_elevation as main_min_elevation,
          long.avg_elevation as main_avg_elevation,
          long.bbox_min_lng as main_bbox_min_lng,
          long.bbox_max_lng as main_bbox_max_lng,
          long.bbox_min_lat as main_bbox_min_lat,
          long.bbox_max_lat as main_bbox_max_lat,
          long.source as main_source,
          long.source_tags as main_source_tags,
          long.geometry as main_geom,
          ST_Distance(ST_EndPoint(short.geometry), long.geometry) as distance_to_main
        FROM ${this.stagingSchema}.trails_with_y_splits short
        JOIN ${this.stagingSchema}.trails_with_y_splits long ON short.orig_id != long.orig_id
        WHERE ST_Length(short.geometry::geography) < ST_Length(long.geometry::geography) * 0.5
          AND ST_DWithin(ST_EndPoint(short.geometry), long.geometry, ${spurSnapTolerance})
          AND NOT ST_Intersects(ST_EndPoint(short.geometry), long.geometry)
      ),
      snapped_spurs AS (
        SELECT 
          spur_id,
          spur_app_uuid,
          spur_name,
          spur_region,
          spur_trail_type,
          spur_surface,
          spur_difficulty,
          spur_length_km,
          spur_elevation_gain,
          spur_elevation_loss,
          spur_max_elevation,
          spur_min_elevation,
          spur_avg_elevation,
          spur_bbox_min_lng,
          spur_bbox_max_lng,
          spur_bbox_min_lat,
          spur_bbox_max_lat,
          spur_source,
          spur_source_tags,
          ST_SetPoint(
            spur_geom, 
            ST_NPoints(spur_geom) - 1, 
            ST_ClosestPoint(main_geom, ST_EndPoint(spur_geom))
          ) as snapped_spur_geom,
          main_id,
          main_app_uuid,
          main_name,
          main_region,
          main_trail_type,
          main_surface,
          main_difficulty,
          main_length_km,
          main_elevation_gain,
          main_elevation_loss,
          main_max_elevation,
          main_min_elevation,
          main_avg_elevation,
          main_bbox_min_lng,
          main_bbox_max_lng,
          main_bbox_min_lat,
          main_bbox_max_lat,
          main_source,
          main_source_tags,
          (ST_Dump(ST_Split(main_geom, ST_ClosestPoint(main_geom, ST_EndPoint(spur_geom))))).geom as split_main_geom,
          distance_to_main
        FROM spur_candidates
        WHERE distance_to_main > 0.1
      )
      SELECT 
        spur_id as orig_id,
        spur_app_uuid as app_uuid,
        spur_name as name,
        spur_region as region,
        spur_trail_type as trail_type,
        spur_surface as surface,
        spur_difficulty as difficulty,
        spur_length_km as length_km,
        spur_elevation_gain as elevation_gain,
        spur_elevation_loss as elevation_loss,
        spur_max_elevation as max_elevation,
        spur_min_elevation as min_elevation,
        spur_avg_elevation as avg_elevation,
        spur_bbox_min_lng as bbox_min_lng,
        spur_bbox_max_lng as bbox_max_lng,
        spur_bbox_min_lat as bbox_min_lat,
        spur_bbox_max_lat as bbox_max_lat,
        spur_source as source,
        spur_source_tags as source_tags,
        snapped_spur_geom as geometry,
        'spur_snapped' as split_type,
        distance_to_main
      FROM snapped_spurs
      WHERE ST_GeometryType(snapped_spur_geom) = 'ST_LineString'
        AND ST_Length(snapped_spur_geom::geography) > 1
      
      UNION ALL
      
      SELECT 
        main_id as orig_id,
        main_app_uuid as app_uuid,
        main_name as name,
        main_region as region,
        main_trail_type as trail_type,
        main_surface as surface,
        main_difficulty as difficulty,
        main_length_km as length_km,
        main_elevation_gain as elevation_gain,
        main_elevation_loss as elevation_loss,
        main_max_elevation as max_elevation,
        main_min_elevation as min_elevation,
        main_avg_elevation as avg_elevation,
        main_bbox_min_lng as bbox_min_lng,
        main_bbox_max_lng as bbox_max_lng,
        main_bbox_min_lat as bbox_min_lat,
        main_bbox_max_lat as bbox_max_lat,
        main_source as source,
        main_source_tags as source_tags,
        split_main_geom as geometry,
        'main_split' as split_type,
        distance_to_main
      FROM snapped_spurs
      WHERE ST_GeometryType(split_main_geom) = 'ST_LineString'
        AND ST_Length(split_main_geom::geography) > 1
    `);

    // Add trails that weren't involved in spur snapping
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.trails_with_spur_snapping (
        orig_id, app_uuid, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, geometry, split_type, distance_to_main
      )
      SELECT 
        t.orig_id,
        t.app_uuid,
        t.name,
        t.region,
        t.trail_type,
        t.surface,
        t.difficulty,
        t.length_km,
        t.elevation_gain,
        t.elevation_loss,
        t.max_elevation,
        t.min_elevation,
        t.avg_elevation,
        t.bbox_min_lng,
        t.bbox_max_lng,
        t.bbox_min_lat,
        t.bbox_max_lat,
        t.source,
        t.source_tags,
        t.geometry,
        'no_spur' as split_type,
        0 as distance_to_main
      FROM ${this.stagingSchema}.trails_with_y_splits t
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.stagingSchema}.trails_with_spur_snapping s
        WHERE s.orig_id = t.orig_id
      )
    `);

    // Count spur snapping results
    const spurSnapCount = await this.pgClient.query(`
      SELECT 
        split_type,
        COUNT(*) as count,
        AVG(distance_to_main * 111000) as avg_distance_m
      FROM ${this.stagingSchema}.trails_with_spur_snapping
      GROUP BY split_type
      ORDER BY split_type
    `);
    
    let appliedCount = 0;
    spurSnapCount.rows.forEach(row => {
      if (row.split_type === 'spur_snapped' || row.split_type === 'main_split') {
        appliedCount += parseInt(row.count);
      }
    });

    return {
      appliedCount,
      breakdown: spurSnapCount.rows
    };
  }

  /**
   * Create final trails table with metadata
   */
  private async createFinalTrailsTable(): Promise<void> {
    console.log('   🔧 Step 6: Creating final trails table...');
    
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails_final AS
      SELECT 
        gen_random_uuid() as app_uuid,
        row_number() OVER () AS id,
        orig_id,
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
        split_type,
        distance_to_main,
        geometry
      FROM ${this.stagingSchema}.trails_with_spur_snapping
      WHERE ST_Length(geometry::geography) >= ${this.config.minSegmentLengthMeters}
    `);

    // Replace original trails table
    await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails`);
    await this.pgClient.query(`
      ALTER TABLE ${this.stagingSchema}.trails_final 
      RENAME TO trails
    `);
  }

  /**
   * Create 3D geometry table for trail/route level data
   */
  private async create3DGeometryTable(): Promise<void> {
    console.log('   🔧 Step 7: Creating 3D geometry table for trail/route data...');
    
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails_3d AS
      SELECT 
        ts.id,
        ts.orig_id,
        ts.name,
        ts.region,
        ts.trail_type,
        ts.surface,
        ts.difficulty,
        ts.length_km,
        ts.elevation_gain,
        ts.elevation_loss,
        ts.max_elevation,
        ts.min_elevation,
        ts.avg_elevation,
        ts.bbox_min_lng,
        ts.bbox_max_lng,
        ts.bbox_min_lat,
        ts.bbox_max_lat,
        ts.source,
        ts.source_tags,
        ts.split_type,
        ts.distance_to_main,
        -- Get the original 3D geometry from the trails table
        t.geometry as geom_3d
      FROM ${this.stagingSchema}.trails ts
      JOIN ${this.stagingSchema}.trails t ON ts.orig_id = t.orig_id
    `);
  }

  /**
   * Clean up temporary tables
   */
  private async cleanupTemporaryTables(): Promise<void> {
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.t_intersections`);
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_with_t_splits`);
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_with_y_splits`);
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_with_spur_snapping`);
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_final`);
  }

  /**
   * Get final trail count
   */
  private async getFinalTrailCount(): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
    `);
    return parseInt(result.rows[0].count);
  }

  /**
   * Create spatial index
   */
  private async createSpatialIndex(): Promise<void> {
    await this.pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_trails_geometry_improved 
      ON ${this.stagingSchema}.trails USING GIST(geometry)
    `);
  }

  /**
   * Get statistics about the split trail network
   */
  async getSplitStatistics(): Promise<any> {
    try {
      const statsResult = await this.pgClient.query(`
        SELECT 
          COUNT(*) as total_segments,
          COUNT(DISTINCT orig_id) as original_trails,
          AVG(length_km) as avg_length_km,
          MIN(length_km) as min_length_km,
          MAX(length_km) as max_length_km,
          SUM(length_km) as total_length_km,
          COUNT(CASE WHEN split_type != 'no_spur' THEN 1 END) as split_segments
        FROM ${this.stagingSchema}.trails
      `);

      return statsResult.rows[0];
    } catch (error) {
      console.error('Error getting split statistics:', error);
      return null;
    }
  }
}
