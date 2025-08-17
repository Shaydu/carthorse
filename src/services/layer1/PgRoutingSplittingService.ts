import { Pool } from 'pg';
import { IntersectionSplittingService } from './IntersectionSplittingService';

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
   * Main method to split trails at intersections using the split_lines_at_intersections function
   * This provides a more reliable approach to intersection splitting
   */
  async splitTrailsAtIntersections(): Promise<PgRoutingSplittingResult> {
    console.log('🔗 PGROUTING SPLITTING: Using split_lines_at_intersections function for reliable intersection splitting...');
    
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

      // Step 3: Create a temporary table with just the geometry for splitting
      console.log('   🔗 Step 1: Preparing trails for splitting...');
      
      // First, remove overlapping trails to prevent linear intersection errors
      console.log('   🔗 Step 1a: Removing overlapping trails to prevent linear intersection errors...');
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways AS
        SELECT 
          t1.id,
          t1.geometry as geom
        FROM ${this.stagingSchema}.trails t1
        WHERE ST_IsValid(t1.geometry) 
          AND ST_GeometryType(t1.geometry) = 'ST_LineString'
          AND ST_NumPoints(t1.geometry) >= 2
          AND NOT EXISTS (
            -- Remove trails that overlap with other trails (linear intersection)
            SELECT 1 FROM ${this.stagingSchema}.trails t2
            WHERE t1.id != t2.id
              AND ST_IsValid(t2.geometry)
              AND ST_GeometryType(t2.geometry) = 'ST_LineString'
              AND ST_NumPoints(t2.geometry) >= 2
              AND (
                -- Check for linear overlap (not just point intersection)
                ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) > 0
                AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) != 'ST_Point'
              )
              AND t1.id < t2.id  -- Keep the first trail, remove the second
          )
      `);

      // Step 4: Use the exact working prototype approach for intersection splitting
      console.log('   🔗 Step 2: Using exact working prototype approach for intersection splitting...');
      
      // Create a table with the trails we want to split
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_to_split AS
        SELECT 
          id,
          app_uuid,
          name,
          geom
        FROM ${this.stagingSchema}.ways
        WHERE ST_IsValid(geom) 
          AND ST_GeometryType(geom) = 'ST_LineString'
          AND ST_NumPoints(geom) >= 2
      `);

      // Step 4a: Snap geometries together first (like the prototype)
      console.log('   🔗 Step 2a: Snapping geometries together...');
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_snapped AS
        SELECT 
          a.id as a_id,
          a.app_uuid as a_app_uuid,
          a.name as a_name,
          ST_Snap(a.geom, b.geom, 1e-6) AS a_geom,
          b.id as b_id,
          b.app_uuid as b_app_uuid,
          b.name as b_name,
          ST_Snap(b.geom, a.geom, 1e-6) AS b_geom
        FROM ${this.stagingSchema}.trails_to_split a
        JOIN ${this.stagingSchema}.trails_to_split b ON a.id < b.id
        WHERE ST_Intersects(a.geom, b.geom)
          AND NOT ST_Equals(a.geom, b.geom)
      `);

      // Get intersection points between snapped trails (exact prototype approach)
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.intersection_points AS
        SELECT DISTINCT
          ST_Intersection(a_geom, b_geom) as intersection_geom
        FROM ${this.stagingSchema}.trails_snapped
        WHERE ST_GeometryType(ST_Intersection(a_geom, b_geom)) = 'ST_Point'
      `);

      // Split trails at intersection points using snapped geometries (exact prototype approach)
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.split_segments AS
        SELECT 
          s.a_id as original_id,
          s.a_app_uuid as app_uuid,
          s.a_name as name,
          (ST_Dump(ST_Split(s.a_geom, i.intersection_geom))).geom::geometry(LineString, ST_SRID(s.a_geom)) as geom
        FROM ${this.stagingSchema}.trails_snapped s
        CROSS JOIN ${this.stagingSchema}.intersection_points i
        WHERE ST_Intersects(s.a_geom, i.intersection_geom)
        
        UNION ALL
        
        SELECT 
          s.b_id as original_id,
          s.b_app_uuid as app_uuid,
          s.b_name as name,
          (ST_Dump(ST_Split(s.b_geom, i.intersection_geom))).geom::geometry(LineString, ST_SRID(s.b_geom)) as geom
        FROM ${this.stagingSchema}.trails_snapped s
        CROSS JOIN ${this.stagingSchema}.intersection_points i
        WHERE ST_Intersects(s.b_geom, i.intersection_geom)
      `);

      // Add segments that weren't split (no intersections)
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.split_segments (original_id, app_uuid, name, geom)
        SELECT 
          t.id,
          t.app_uuid,
          t.name,
          t.geom
        FROM ${this.stagingSchema}.trails_to_split t
        WHERE NOT EXISTS (
          SELECT 1 FROM ${this.stagingSchema}.trails_snapped s
          WHERE (s.a_id = t.id OR s.b_id = t.id)
        )
      `);

      // Create the final ways_split table
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways_split AS
        SELECT 
          row_number() OVER () as id,
          app_uuid,
          name,
          geom
        FROM ${this.stagingSchema}.split_segments
        WHERE ST_IsValid(geom) 
          AND ST_GeometryType(geom) = 'ST_LineString'
          AND ST_NumPoints(geom) >= 2
      `);

      // Step 6: Add source/target columns for pgRouting
      console.log('   🔗 Step 4: Adding source/target columns for pgRouting...');
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.ways_split ADD COLUMN source integer;
        ALTER TABLE ${this.stagingSchema}.ways_split ADD COLUMN target integer;
      `);

      // Step 7: Create topology using pgRouting
      console.log('   🔗 Step 5: Creating topology with pgRouting...');
      await this.pgClient.query(`
        SELECT pgr_createTopology('${this.stagingSchema}.ways_split', 0.00001, 'geom', 'id')
      `);

      // Step 8: Match split segments back to original trail properties
      console.log('   🔗 Step 6: Matching split segments to original trail properties...');
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_noded AS
        SELECT 
          gen_random_uuid() as app_uuid,
          s.id as segment_id,
          t.app_uuid as original_app_uuid,
          t.osm_id,
          t.name,
          t.region,
          t.trail_type,
          t.surface,
          t.difficulty,
          ST_Length(s.geom::geography) / 1000.0 as length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation,
          ST_XMin(s.geom) as bbox_min_lng,
          ST_XMax(s.geom) as bbox_max_lng,
          ST_YMin(s.geom) as bbox_min_lat,
          ST_YMax(s.geom) as bbox_max_lat,
          t.source,
          t.source_tags,
          s.geom as geometry,
          ST_Length(s.geom::geography) as segment_length_meters
        FROM ${this.stagingSchema}.ways_split s
        CROSS JOIN LATERAL (
          SELECT *
          FROM ${this.stagingSchema}.trails
          WHERE ST_Intersects(geometry, s.geom)
            AND ST_Length(ST_Intersection(geometry, s.geom)::geography) > 0
          ORDER BY ST_Length(ST_Intersection(geometry, s.geom)::geography) DESC
          LIMIT 1
        ) t
        WHERE ST_Length(s.geom::geography) >= ${this.config.minSegmentLengthMeters}
        ORDER BY t.app_uuid, segment_length_meters DESC
      `);

      // Step 7: Count intersection points found (segments that were split)
      const intersectionResult = await this.pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${this.stagingSchema}.trails_noded 
        WHERE segment_id > 1
      `);
      result.intersectionPointsFound = parseInt(intersectionResult.rows[0].count);

      // Step 8: Replace original trails table with split segments in a transaction
      // This ensures we atomically replace unsplit trails with their split segments
      await this.pgClient.query('BEGIN');
      
      try {
        // Create a new trails table with split segments
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_new AS
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
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            source,
            source_tags,
            geometry
          FROM ${this.stagingSchema}.trails_noded
        `);
        
        // Drop the old trails table and rename the new one
        await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails`);
        await this.pgClient.query(`ALTER TABLE ${this.stagingSchema}.trails_new RENAME TO trails`);
        
        // Create spatial index for performance
        await this.pgClient.query(`
          CREATE INDEX IF NOT EXISTS idx_trails_geometry_modern 
          ON ${this.stagingSchema}.trails USING GIST(geometry)
        `);
        
        await this.pgClient.query('COMMIT');
        console.log('   ✅ Transaction committed: Original trails replaced with split segments');
        
      } catch (error) {
        await this.pgClient.query('ROLLBACK');
        throw error;
      }

      // Step 9: Apply our focused intersection splitting for 3-way T-intersections
      console.log('🔗 Step 9: Applying focused 3-way T-intersection splitting...');
      const intersectionSplittingService = new IntersectionSplittingService(this.pgClient, this.stagingSchema);
      await intersectionSplittingService.splitTrailsAtIntersections();
      await intersectionSplittingService.cleanup();

      // Step 10: Clean up temporary tables
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_noded`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.ways`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.ways_split`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.ways_split_vertices_pgr`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_to_split`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_snapped`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.intersection_points`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.split_segments`);

      // Step 10: Get final statistics
      const finalCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      result.splitSegmentCount = parseInt(finalCountResult.rows[0].count);
      result.segmentsRemoved = result.originalTrailCount - result.splitSegmentCount;

      // Step 12: Spatial index already created in transaction

      result.success = true;
      
      console.log(`   ✅ Split lines at intersections complete:`);
      console.log(`      📊 Original trails: ${result.originalTrailCount}`);
      console.log(`      🔗 Split segments: ${result.splitSegmentCount}`);
      console.log(`      📍 Intersection points: ${result.intersectionPointsFound}`);
      console.log(`      🗑️ Segments removed: ${result.segmentsRemoved}`);

      return result;

    } catch (error) {
      console.error('   ❌ Error during split_lines_at_intersections:', error);
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

      // Step 10: Handle 3-way intersections (endpoint to midpoint) using our proven logic
      console.log('   🔗 Step 10: Handling 3-way intersections with simple_intersection_splitting...');
      const threeWayResult = await this.handleThreeWayIntersections();
      
      if (threeWayResult.success) {
        console.log(`   ✅ 3-way intersection handling complete: ${threeWayResult.intersectionPointsFound} intersections, ${threeWayResult.splitSegmentCount} segments created`);
        result.intersectionPointsFound += threeWayResult.intersectionPointsFound;
      } else {
        console.warn(`   ⚠️ 3-way intersection handling failed: ${threeWayResult.error}`);
      }

      // Step 11: Get final statistics
      const finalCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      result.splitSegmentCount = parseInt(finalCountResult.rows[0].count);
      result.segmentsRemoved = result.originalTrailCount - result.splitSegmentCount;

      // Step 12: Create spatial index
      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_trails_geometry_pgrouting 
        ON ${this.stagingSchema}.trails USING GIST(geometry)
      `);

      result.success = true;
      
      console.log(`   ✅ pgRouting splitting complete:`);
      console.log(`      📊 Original trails: ${result.originalTrailCount}`);
      console.log(`      🔗 Split segments: ${result.splitSegmentCount}`);
      console.log(`      🗑️ Segments removed: ${result.segmentsRemoved}`);
      console.log(`      🔗 3-way intersections handled: ${result.intersectionPointsFound}`);

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

  /**
   * Handle 3-way intersections (endpoint to midpoint) using our proven simple_intersection_splitting logic
   * This targets the specific case where one trail's endpoint meets another trail's midpoint
   */
  async handleThreeWayIntersections(): Promise<PgRoutingSplittingResult> {
    console.log('🔗 HANDLING 3-WAY INTERSECTIONS: Using simple_intersection_splitting for endpoint-to-midpoint intersections...');
    
    const result: PgRoutingSplittingResult = {
      originalTrailCount: 0,
      splitSegmentCount: 0,
      intersectionPointsFound: 0,
      segmentsRemoved: 0,
      success: false
    };

    try {
      // Get initial trail count
      const initialCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      result.originalTrailCount = parseInt(initialCountResult.rows[0].count);
      
      console.log(`   📊 Initial trails: ${result.originalTrailCount}`);

      // Call our proven simple_intersection_splitting function with correct tolerance
      const splittingResult = await this.pgClient.query(`
        SELECT * FROM simple_intersection_splitting($1, $2)
      `, [this.stagingSchema, this.config.intersectionTolerance || 2.0]);

      if (splittingResult.rows.length > 0) {
        const stats = splittingResult.rows[0];
        result.intersectionPointsFound = stats.intersection_count || 0;
        result.splitSegmentCount = stats.split_count || 0;
        result.success = stats.success || false;
        
        console.log(`   📊 3-way intersection splitting results:`);
        console.log(`      🔗 Intersections found: ${result.intersectionPointsFound}`);
        console.log(`      🔗 Split segments created: ${result.splitSegmentCount}`);
        console.log(`      ✅ Success: ${result.success}`);
        
        if (stats.message) {
          console.log(`      📝 Message: ${stats.message}`);
        }
      }

      // Get final count
      const finalCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      const finalCount = parseInt(finalCountResult.rows[0].count);
      result.segmentsRemoved = result.originalTrailCount - finalCount;

      return result;

    } catch (error) {
      console.error('   ❌ Error during 3-way intersection splitting:', error);
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }
}
