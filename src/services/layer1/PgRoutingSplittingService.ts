import { Pool } from 'pg';

export interface PgRoutingSplittingConfig {
  stagingSchema: string;
  pgClient: Pool;
  toleranceMeters?: number;
  minSegmentLengthMeters?: number;
  preserveOriginalTrails?: boolean;
  intersectionTolerance?: number; // Tolerance for intersection detection in meters (from layer1 config)
}

export interface PgRoutingSplittingResult {
  originalTrailCount: number;
  splitSegmentCount: number;
  intersectionPointsFound: number;
  segmentsRemoved: number;
  success: boolean;
  error?: string;
}

export class PgRoutingSplittingService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: PgRoutingSplittingConfig;

  constructor(config: PgRoutingSplittingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = {
      toleranceMeters: 0.00001, // ~1 meter in degrees
      minSegmentLengthMeters: 1.0,
      preserveOriginalTrails: false,
      intersectionTolerance: 2.0, // Default to 2.0 meters for intersection detection
      ...config
    };
  }

  /**
   * Main method to split trails at intersections using modern PostGIS ST_Node()
   * This replaces the deprecated pgr_nodeNetwork function with a more robust approach
   */
  async splitTrailsAtIntersections(): Promise<PgRoutingSplittingResult> {
    console.log('🔗 PGROUTING SPLITTING: Using modern PostGIS ST_Node() for automatic intersection splitting...');
    
    const result: PgRoutingSplittingResult = {
      originalTrailCount: 0,
      splitSegmentCount: 0,
      intersectionPointsFound: 0,
      segmentsRemoved: 0,
      success: false
    };

    try {
      // Step 1: Get initial trail count
      const initialCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      result.originalTrailCount = parseInt(initialCountResult.rows[0].count);
      
      console.log(`   📊 Initial trails: ${result.originalTrailCount}`);

      // Step 2: Create backup of original trails if preservation is requested
      if (this.config.preserveOriginalTrails) {
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_original AS 
          SELECT * FROM ${this.stagingSchema}.trails
        `);
        console.log('   💾 Created backup of original trails');
      }

      // Step 3: Use ST_Node to automatically split all trails at intersections
      console.log('   🔗 Step 1: Using ST_Node to detect and split at all intersections...');
      
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_noded AS
        WITH all_geometries AS (
          -- Collect all valid trail geometries
          SELECT 
            id,
            app_uuid,
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
          FROM ${this.stagingSchema}.trails
          WHERE ST_IsValid(geometry) 
            AND ST_GeometryType(geometry) = 'ST_LineString'
            AND ST_NumPoints(geometry) >= 2
        ),
        noded_geometries AS (
          -- Apply ST_Node to ALL geometries together to detect intersections
          -- Note: ST_Node doesn't accept tolerance parameter in this PostGIS version
          SELECT ST_Node(ST_Collect(geometry)) as noded_geom
          FROM all_geometries
        ),
        split_segments AS (
          -- Extract individual segments from the noded geometry
          SELECT 
            ROW_NUMBER() OVER () as segment_id,
            dumped.geom as segment_geometry
          FROM noded_geometries,
          LATERAL ST_Dump(noded_geom) as dumped
          WHERE ST_IsValid(dumped.geom) 
            AND dumped.geom IS NOT NULL
            AND ST_NumPoints(dumped.geom) >= 2
            AND ST_StartPoint(dumped.geom) != ST_EndPoint(dumped.geom)
        ),
        matched_segments AS (
          -- Match split segments back to original trail properties
          SELECT 
            s.segment_id,
            t.app_uuid as original_app_uuid,
            t.osm_id,
            t.name,
            t.region,
            t.trail_type,
            t.surface,
            t.difficulty,
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
            s.segment_geometry as geometry,
            ST_Length(s.segment_geometry::geography) as segment_length_meters,
            -- Find the best matching original trail for this segment
            ROW_NUMBER() OVER (
              PARTITION BY s.segment_id 
              ORDER BY ST_Length(ST_Intersection(t.geometry, s.segment_geometry)::geography) DESC
            ) as rn
          FROM all_geometries t
          CROSS JOIN split_segments s
          WHERE ST_Intersects(t.geometry, s.segment_geometry)
            AND ST_Length(ST_Intersection(t.geometry, s.segment_geometry)::geography) > 0
        )
        SELECT
          gen_random_uuid() as app_uuid,
          segment_id,
          original_app_uuid,
          osm_id,
          name,
          region,
          trail_type,
          surface,
          difficulty,
          segment_length_meters / 1000.0 as length_km,
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
          ST_XMin(geometry) as bbox_min_lng_new,
          ST_XMax(geometry) as bbox_max_lng_new,
          ST_YMin(geometry) as bbox_min_lat_new,
          ST_YMax(geometry) as bbox_max_lat_new
        FROM matched_segments
        WHERE rn = 1  -- Take the best match for each segment
          AND segment_length_meters >= ${this.config.minSegmentLengthMeters}
        ORDER BY original_app_uuid, segment_length_meters DESC
      `);

      // Step 4: Count intersection points found
      const intersectionResult = await this.pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${this.stagingSchema}.trails_noded 
        WHERE segment_id != 1
      `);
      result.intersectionPointsFound = parseInt(intersectionResult.rows[0].count);

      // Step 5: Replace original trails table with split segments
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails`);
      
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails AS
        SELECT 
          app_uuid,
          segment_id as id,
          original_app_uuid,
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
          bbox_min_lng_new as bbox_min_lng,
          bbox_max_lng_new as bbox_max_lng,
          bbox_min_lat_new as bbox_min_lat,
          bbox_max_lat_new as bbox_max_lat,
          source,
          source_tags,
          geometry
        FROM ${this.stagingSchema}.trails_noded
      `);

      // Step 6: Clean up temporary table
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_noded`);

      // Step 7: Get final statistics
      const finalCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      result.splitSegmentCount = parseInt(finalCountResult.rows[0].count);
      result.segmentsRemoved = result.originalTrailCount - result.splitSegmentCount;

      // Step 8: Create spatial index for performance
      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_trails_geometry_modern 
        ON ${this.stagingSchema}.trails USING GIST(geometry)
      `);

      result.success = true;
      
      console.log(`   ✅ Modern splitting complete:`);
      console.log(`      📊 Original trails: ${result.originalTrailCount}`);
      console.log(`      🔗 Split segments: ${result.splitSegmentCount}`);
      console.log(`      📍 Intersection points: ${result.intersectionPointsFound}`);
      console.log(`      🗑️ Segments removed: ${result.segmentsRemoved}`);

      return result;

    } catch (error) {
      console.error('   ❌ Error during modern trail splitting:', error);
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Alternative method using pgr_separateCrossing and custom touching intersection handling
   * (modern pgRouting functions that replace deprecated pgr_nodeNetwork)
   * 
   * FIXED: GeometryCollection error by normalizing intersection geometries before splitting
   * - Decomposes GeometryCollections into primitive geometries using ST_Dump
   * - Only uses POINT geometries for splitting to avoid GeometryCollection issues
   */
  async splitTrailsWithPgRouting(): Promise<PgRoutingSplittingResult> {
    console.log('🔗 PGROUTING SPLITTING: Using modern pgRouting functions (pgr_separateCrossing + pgr_separateTouching)...');
    
    const result: PgRoutingSplittingResult = {
      originalTrailCount: 0,
      splitSegmentCount: 0,
      intersectionPointsFound: 0,
      segmentsRemoved: 0,
      success: false
    };

    try {
      // Step 1: Get initial trail count
      const initialCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      result.originalTrailCount = parseInt(initialCountResult.rows[0].count);
      
      console.log(`   📊 Initial trails: ${result.originalTrailCount}`);

      // Step 2: Create temporary table with required columns for pgRouting
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_for_pgrouting AS
        SELECT 
          id,
          ST_Force2D(geometry) as geom
        FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry) 
          AND ST_GeometryType(geometry) = 'ST_LineString'
      `);

      // Step 3: Use pgr_separateCrossing for crossing intersections
      console.log('   🔗 Step 1: Using pgr_separateCrossing for crossing intersections...');
      
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_crossing_split AS
        SELECT id, sub_id, geom FROM pgr_separateCrossing(
          'SELECT id, geom FROM ${this.stagingSchema}.trails_for_pgrouting', 
          ${this.config.toleranceMeters}
        )
      `);

      // Step 4: Use custom implementation to handle GeometryCollection intersections properly
      console.log('   🔗 Step 2: Using custom touching intersection splitting (fixes GeometryCollection error)...');
      
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_touching_split AS
        WITH touching_intersections AS (
          -- Find all touching intersections between trails
          SELECT 
            e1.id as id1, 
            e2.id as id2, 
            e1.geom as g1, 
            e2.geom as g2,
            ST_Intersection(e1.geom, e2.geom) as intersection_geom
          FROM ${this.stagingSchema}.trails_for_pgrouting e1
          JOIN ${this.stagingSchema}.trails_for_pgrouting e2 ON e1.id != e2.id
          WHERE ST_DWithin(e1.geom, e2.geom, ${this.config.toleranceMeters})
            AND NOT (
              ST_StartPoint(e1.geom) = ST_StartPoint(e2.geom) 
              OR ST_StartPoint(e1.geom) = ST_EndPoint(e2.geom)
              OR ST_EndPoint(e1.geom) = ST_StartPoint(e2.geom) 
              OR ST_EndPoint(e1.geom) = ST_EndPoint(e2.geom)
            )
        ),
        normalized_intersections AS (
          -- Normalize intersection geometries: decompose GeometryCollections into primitive geometries
          SELECT 
            id1,
            id2,
            g1,
            g2,
            (ST_Dump(intersection_geom)).geom as intersection_point
          FROM touching_intersections
          WHERE ST_GeometryType(intersection_geom) IN ('ST_Point', 'ST_MultiPoint', 'ST_GeometryCollection')
        ),
        split_blades AS (
          -- Create split blades from normalized intersection points
          SELECT 
            id1,
            g1,
            ST_UnaryUnion(ST_Collect(intersection_point)) as blade
          FROM normalized_intersections
          WHERE ST_GeometryType(intersection_point) = 'ST_Point'
          GROUP BY id1, g1
        ),
        split_segments AS (
          -- Split trails at intersection points
          SELECT 
            ROW_NUMBER() OVER () as seq,
            sb.id1 as id,
            (ST_Dump(ST_Split(ST_Snap(sb.g1, sb.blade, ${this.config.toleranceMeters}), sb.blade))).*
          FROM split_blades sb
          WHERE ST_IsValid(sb.blade) AND NOT ST_IsEmpty(sb.blade)
        )
        SELECT 
          seq as sub_id,
          id,
          geom
        FROM split_segments
        WHERE ST_IsValid(geom) 
          AND ST_GeometryType(geom) = 'ST_LineString'
          AND ST_NumPoints(geom) >= 2
          AND ST_StartPoint(geom) != ST_EndPoint(geom)
      `);

      // Step 5: Combine both splitting results
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_combined_split AS
        SELECT id, sub_id, geom FROM ${this.stagingSchema}.trails_crossing_split
        UNION
        SELECT id, sub_id, geom FROM ${this.stagingSchema}.trails_touching_split
      `);

      // Step 6: Add original trails that weren't split
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails_combined_split (id, sub_id, geom)
        SELECT 
          t.id,
          1 as sub_id,
          t.geom
        FROM ${this.stagingSchema}.trails_for_pgrouting t
        WHERE t.id NOT IN (
          SELECT DISTINCT id FROM ${this.stagingSchema}.trails_combined_split
        )
      `);

      // Step 7: Create final trails table with metadata
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_pgrouting_split AS
        SELECT 
          gen_random_uuid() as app_uuid,
          cs.id,
          t.app_uuid as original_app_uuid,
          t.osm_id,
          t.name,
          t.region,
          t.trail_type,
          t.surface,
          t.difficulty,
          ST_Length(cs.geom::geography) / 1000.0 as length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation,
          ST_XMin(cs.geom) as bbox_min_lng,
          ST_XMax(cs.geom) as bbox_max_lng,
          ST_YMin(cs.geom) as bbox_min_lat,
          ST_YMax(cs.geom) as bbox_max_lat,
          t.source,
          t.source_tags,
          ST_Force3D(cs.geom) as geometry
        FROM ${this.stagingSchema}.trails_combined_split cs
        JOIN ${this.stagingSchema}.trails t ON cs.id = t.id
        WHERE ST_Length(cs.geom::geography) >= ${this.config.minSegmentLengthMeters}
      `);

      // Step 8: Replace original trails table
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails`);
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.trails_pgrouting_split 
        RENAME TO trails
      `);

      // Step 9: Clean up temporary tables
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_for_pgrouting`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_crossing_split`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_touching_split`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_combined_split`);

      // Step 10: Get final statistics
      const finalCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      result.splitSegmentCount = parseInt(finalCountResult.rows[0].count);
      result.segmentsRemoved = result.originalTrailCount - result.splitSegmentCount;

      // Step 11: Create spatial index
      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_trails_geometry_pgrouting 
        ON ${this.stagingSchema}.trails USING GIST(geometry)
      `);

      result.success = true;
      
      console.log(`   ✅ pgRouting splitting complete:`);
      console.log(`      📊 Original trails: ${result.originalTrailCount}`);
      console.log(`      🔗 Split segments: ${result.splitSegmentCount}`);
      console.log(`      🗑️ Segments removed: ${result.segmentsRemoved}`);

      return result;

    } catch (error) {
      console.error('   ❌ Error during pgRouting trail splitting:', error);
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Detect intersection points after splitting for analysis
   */
  async detectIntersectionPoints(): Promise<number> {
    console.log('🔍 Detecting intersection points after splitting...');
    
    try {
      // Clear existing intersection points
      await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.intersection_points`);

      // Detect intersection points between split segments
      const intersectionResult = await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.intersection_points (intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
          ST_Force2D(intersection_point) as intersection_point,
          ST_Force3D(intersection_point) as intersection_point_3d,
          ARRAY[t1_uuid, t2_uuid] as connected_trail_ids,
          ARRAY[t1_name, t2_name] as connected_trail_names,
          'intersection' as node_type,
          ${this.config.toleranceMeters} as distance_meters
        FROM (
          SELECT 
            (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point,
            t1.app_uuid as t1_uuid,
            t2.app_uuid as t2_uuid,
            t1.name as t1_name,
            t2.name as t2_name
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t1.geometry::geography) > ${this.config.minSegmentLengthMeters}
            AND ST_Length(t2.geometry::geography) > ${this.config.minSegmentLengthMeters}
        ) AS intersections
      `);

      const intersectionCount = intersectionResult.rowCount ?? 0;
      console.log(`   📍 Found ${intersectionCount} intersection points`);
      
      return intersectionCount;

    } catch (error) {
      console.error('   ❌ Error detecting intersection points:', error);
      return 0;
    }
  }

  /**
   * Get statistics about the split trail network
   */
  async getSplitStatistics(): Promise<any> {
    try {
      const statsResult = await this.pgClient.query(`
        SELECT 
          COUNT(*) as total_segments,
          COUNT(DISTINCT original_app_uuid) as original_trails,
          AVG(length_km) as avg_length_km,
          MIN(length_km) as min_length_km,
          MAX(length_km) as max_length_km,
          SUM(length_km) as total_length_km
        FROM ${this.stagingSchema}.trails
      `);

      return statsResult.rows[0];
    } catch (error) {
      console.error('Error getting split statistics:', error);
      return null;
    }
  }
}
