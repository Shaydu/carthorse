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
      intersectionTolerance: 3.0, // Default to 3.0 meters for T-intersection detection (from layer1 config)
      ...config
    };
  }

  /**
   * Main method to split trails at intersections using comprehensive pgRouting approach
   * This method uses multiple pgRouting functions to catch ALL intersection types
   */
  async splitTrailsAtIntersections(): Promise<PgRoutingSplittingResult> {
    // Use the comprehensive method that splits at ALL intersections
    // This method ONLY operates on the trails table in the staging schema
    // It does NOT affect Layer 2 or Layer 3 data
    return this.splitTrailsAtAllIntersections();
  }

  /**
   * Alternative method using pgr_separateCrossing and pgr_separateTouching
   * (modern pgRouting functions that replace deprecated pgr_nodeNetwork)
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

      // Step 2: Merge short connector trails before homogenization
      console.log('   🔧 Step 1: Merging short connector trails to reduce problematic geometries...');
      
      // First, create a table with all valid trails
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_for_merging AS
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
          ST_Force2D(geometry) as geom
        FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry) 
          AND ST_GeometryType(geometry) IN ('ST_LineString', 'ST_GeometryCollection')
          AND ST_NumPoints(geometry) >= 2  -- Require at least 2 points
          AND ST_Length(geometry::geography) > 0  -- Must have some length
          AND ST_StartPoint(geometry) != ST_EndPoint(geometry)  -- No self-loops
      `);

      // Merge short connector trails that are close to each other
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_merged AS
        WITH short_trails AS (
          -- Identify short trails (< 5m) that are likely connectors
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
            geom,
            ST_Length(geom::geography) as length_meters,
            ST_StartPoint(geom) as start_point,
            ST_EndPoint(geom) as end_point
          FROM ${this.stagingSchema}.trails_for_merging
          WHERE ST_Length(geom::geography) < 5.0
            AND ST_NumPoints(geom) = 2
        ),
        merged_connectors AS (
          -- Merge short trails that share endpoints or are very close
          SELECT DISTINCT
            MIN(st1.id) as id,  -- Keep as integer to match UNION
            'merged_connector' as app_uuid,
            'merged' as osm_id,
            'Merged Connector Trail' as name,
            st1.region,
            'connector' as trail_type,
            st1.surface,
            st1.difficulty,
            AVG(st1.length_km) as length_km,
            SUM(st1.elevation_gain) as elevation_gain,
            SUM(st1.elevation_loss) as elevation_loss,
            MAX(st1.max_elevation) as max_elevation,
            MIN(st1.min_elevation) as min_elevation,
            AVG(st1.avg_elevation) as avg_elevation,
            MIN(st1.bbox_min_lng) as bbox_min_lng,
            MAX(st1.bbox_max_lng) as bbox_max_lng,
            MIN(st1.bbox_min_lat) as bbox_min_lat,
            MAX(st1.bbox_max_lat) as bbox_max_lat,
            'merged' as source,
            st1.source_tags,
            ST_LineMerge(ST_Collect(st1.geom)) as geom
          FROM short_trails st1
          JOIN short_trails st2 ON (
            st1.id != st2.id AND (
              ST_DWithin(st1.start_point, st2.start_point, 0.001) OR
              ST_DWithin(st1.start_point, st2.end_point, 0.001) OR
              ST_DWithin(st1.end_point, st2.start_point, 0.001) OR
              ST_DWithin(st1.end_point, st2.end_point, 0.001)
            )
          )
          GROUP BY st1.region, st1.surface, st1.difficulty, st1.source_tags
        ),
        remaining_trails AS (
          -- Keep trails that weren't merged (longer trails and isolated short trails)
          SELECT 
            t.id,
            t.app_uuid,
            t.osm_id,
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
            t.geom
          FROM ${this.stagingSchema}.trails_for_merging t
          WHERE NOT EXISTS (
            SELECT 1 FROM short_trails st
            WHERE st.id = t.id
          )
        )
        SELECT * FROM merged_connectors
        UNION ALL
        SELECT * FROM remaining_trails
      `);

      // Create final table for homogenization
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_for_homogenization AS
        SELECT * FROM ${this.stagingSchema}.trails_merged
      `);

      // Step 3: Apply ST_CollectionHomogenize to convert everything to simple LINESTRINGs
      console.log('   🔧 Step 2: Applying ST_CollectionHomogenize to convert to simple LINESTRINGs...');
      
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_homogenized AS
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
          -- Convert to simple LINESTRING using ST_CollectionHomogenize
          ST_CollectionHomogenize(geom) as geom
        FROM ${this.stagingSchema}.trails_for_homogenization
      `);

      // Step 3.5: Simplify overlapping trails to prevent linear intersection errors
      console.log('   🔧 Step 2.5: Simplifying overlapping trails to prevent linear intersections...');
      
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_merged_overlapping AS
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
          geom
        FROM ${this.stagingSchema}.trails_homogenized
        WHERE ST_IsValid(geom) 
          AND ST_GeometryType(geom) = 'ST_LineString'
          AND ST_NumPoints(geom) >= 2
          AND ST_Length(geom::geography) >= ${this.config.minSegmentLengthMeters}
      `);

      // Count how many trails were processed
      const homogenizedCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_homogenized
      `);
      const homogenizedCount = parseInt(homogenizedCountResult.rows[0].count);
      const removedCount = result.originalTrailCount - homogenizedCount;
      
      console.log(`   📊 After homogenization: ${homogenizedCount} trails (removed ${removedCount} problematic trails)`);

      if (homogenizedCount === 0) {
        console.log('   ⚠️ No valid trails found after homogenization, creating empty result');
        result.success = true;
        result.splitSegmentCount = 0;
        result.segmentsRemoved = result.originalTrailCount;
        return result;
      }

      // Step 4: Create pgRouting table from merged overlapping geometries
      console.log('   🔧 Step 3: Creating pgRouting table from merged overlapping geometries...');
      
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_for_pgrouting AS
        SELECT 
          id,
          geom
        FROM ${this.stagingSchema}.trails_merged_overlapping
        WHERE ST_IsValid(geom) 
          AND ST_GeometryType(geom) = 'ST_LineString'
          AND ST_NumPoints(geom) >= 2  -- Require at least 2 points
          AND ST_Length(geom::geography) >= ${this.config.minSegmentLengthMeters}  -- Filter by minimum length
      `);

      // Check if we have any valid trails after filtering
      const validTrailsResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_for_pgrouting
      `);
      const validTrailsCount = parseInt(validTrailsResult.rows[0].count);
      
      if (validTrailsCount === 0) {
        console.log('   ⚠️ No valid trails found after pgRouting filtering, creating empty result');
        result.success = true;
        result.splitSegmentCount = 0;
        result.segmentsRemoved = result.originalTrailCount;
        return result;
      }
      
      console.log(`   📊 Valid trails for pgRouting processing: ${validTrailsCount}`);

      // Step 4: Use pgr_separateCrossing for crossing intersections
      console.log('   🔗 Step 2: Using pgr_separateCrossing for crossing intersections...');
      
      try {
                await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_crossing_split AS
          SELECT id, sub_id, geom FROM pgr_separateCrossing(
            'SELECT id, geom FROM ${this.stagingSchema}.trails_for_pgrouting',
            ${(this.config.intersectionTolerance || 3.0) / 111320.0}
          )
        `);
      } catch (error) {
        console.log('   ⚠️ pgr_separateCrossing failed, creating empty crossing split table');
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_crossing_split (
            id BIGINT,
            sub_id INTEGER,
            geom GEOMETRY(LINESTRING, 4326)
          )
        `);
      }

      // Step 5: Use pgr_separateTouching for touching/endpoint connections
      console.log('   🔗 Step 3: Using pgr_separateTouching for touching intersections...');
      
      try {
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_touching_split AS
          SELECT id, sub_id, geom FROM pgr_separateTouching(
            'SELECT id, geom FROM ${this.stagingSchema}.trails_for_pgrouting', 
            ${(this.config.intersectionTolerance || 3.0) / 111320.0}
          )
          WHERE ST_GeometryType(geom) = 'ST_LineString'
        `);
      } catch (error) {
        console.log('   ⚠️ pgr_separateTouching failed due to linear intersections, creating empty touching split table');
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_touching_split (
            id BIGINT,
            sub_id INTEGER,
            geom GEOMETRY(LINESTRING, 4326)
          )
        `);
      }

      // Step 6: Combine both splitting results
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_combined_split AS
        SELECT id, sub_id, geom FROM ${this.stagingSchema}.trails_crossing_split
        UNION
        SELECT id, sub_id, geom FROM ${this.stagingSchema}.trails_touching_split
      `);

      // Step 7: Add original trails that weren't split
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

      // Step 8: Create final trails table with metadata
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
        JOIN ${this.stagingSchema}.trails_merged_overlapping t ON cs.id = t.id
        WHERE ST_Length(cs.geom::geography) >= ${this.config.minSegmentLengthMeters}
      `);

      // Step 9: Replace original trails table
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails`);
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.trails_pgrouting_split 
        RENAME TO trails
      `);

      // Step 10: Clean up temporary tables
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_for_merging`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_merged`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_for_homogenization`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_homogenized`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_merged_overlapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_for_pgrouting`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_crossing_split`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_touching_split`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_combined_split`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_pgrouting_split`);

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

      return result;

    } catch (error) {
      console.error('   ❌ Error during pgRouting trail splitting:', error);
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Comprehensive method to split trails at ALL intersections using multiple pgRouting functions
   * This method uses pgr_separateCrossing, pgr_separateTouching, and pgr_nodeNetwork to catch all intersection types
   * 
   * IMPORTANT: This method ONLY operates on Layer 1 trails data in the staging schema.
   * It does NOT affect Layer 2 or Layer 3 data - only the trails table is modified.
   */
  async splitTrailsAtAllIntersections(): Promise<PgRoutingSplittingResult> {
    console.log('🔗 PGROUTING SPLITTING: Using comprehensive pgRouting approach to split at ALL intersections (Layer 1 trails only)...');
    
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

      // Step 2: Prepare trails for pgRouting processing
      console.log('   🔧 Step 1: Preparing trails for comprehensive intersection splitting...');
      
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_for_all_splitting AS
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
          ST_Force2D(geometry) as geom
        FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry) 
          AND ST_GeometryType(geometry) IN ('ST_LineString', 'ST_GeometryCollection')
          AND ST_NumPoints(geometry) >= 2
          AND ST_Length(geometry::geography) > 0
          AND ST_StartPoint(geometry) != ST_EndPoint(geometry)
      `);

      // Step 3: Apply ST_CollectionHomogenize to convert everything to LINESTRINGs
      console.log('   🔧 Step 2: Homogenizing geometries to LINESTRINGs...');
      
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_homogenized_all AS
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
          ST_CollectionHomogenize(geom) as geom
        FROM ${this.stagingSchema}.trails_for_all_splitting
        WHERE ST_IsValid(geom)
      `);

      // Step 4: Create pgRouting table
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_pgrouting_all AS
        SELECT 
          id,
          geom
        FROM ${this.stagingSchema}.trails_homogenized_all
        WHERE ST_IsValid(geom) 
          AND ST_GeometryType(geom) = 'ST_LineString'
          AND ST_NumPoints(geom) >= 2
          AND ST_Length(geom::geography) >= ${this.config.minSegmentLengthMeters}
      `);

      const validTrailsResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_pgrouting_all
      `);
      const validTrailsCount = parseInt(validTrailsResult.rows[0].count);
      
      if (validTrailsCount === 0) {
        console.log('   ⚠️ No valid trails found for pgRouting processing');
        result.success = true;
        result.splitSegmentCount = 0;
        result.segmentsRemoved = result.originalTrailCount;
        return result;
      }
      
      console.log(`   📊 Valid trails for comprehensive splitting: ${validTrailsCount}`);

      // Step 5: Use pgr_separateCrossing for crossing intersections
      console.log('   🔗 Step 3: Using pgr_separateCrossing for crossing intersections...');
      
      try {
                await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_crossing_all AS
          SELECT id, sub_id, geom FROM pgr_separateCrossing(
            'SELECT id, geom FROM ${this.stagingSchema}.trails_pgrouting_all',
            ${(this.config.intersectionTolerance || 3.0) / 111320.0}
          )
        `);
        console.log('   ✅ pgr_separateCrossing completed successfully');
      } catch (error) {
        console.log('   ⚠️ pgr_separateCrossing failed, using original geometries');
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_crossing_all AS
          SELECT id, 1 as sub_id, geom FROM ${this.stagingSchema}.trails_pgrouting_all
        `);
      }

      // Step 6: Use pgr_separateTouching for touching intersections
      console.log('   🔗 Step 4: Using pgr_separateTouching for touching intersections...');
      
      try {
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_touching_all AS
          SELECT id, sub_id, geom FROM pgr_separateTouching(
            'SELECT id, geom FROM ${this.stagingSchema}.trails_pgrouting_all', 
            ${(this.config.intersectionTolerance || 3.0) / 111320.0}
          )
          WHERE ST_GeometryType(geom) = 'ST_LineString'
        `);
        console.log('   ✅ pgr_separateTouching completed successfully');
      } catch (error) {
        console.log('   ⚠️ pgr_separateTouching failed, trying custom touching detection...');
        // Try custom touching detection as fallback
        await this.detectTouchingIntersections();
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_touching_all AS
          SELECT id, sub_id, geom FROM ${this.stagingSchema}.trails_touching_custom
        `);
      }

      // Step 7: Use pgr_nodeNetwork for comprehensive node-based splitting (if available)
      console.log('   🔗 Step 5: Using pgr_nodeNetwork for comprehensive node-based splitting...');
      
      try {
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_noded_all AS
          SELECT id, sub_id, geom FROM pgr_nodeNetwork(
            'SELECT id, geom FROM ${this.stagingSchema}.trails_pgrouting_all', 
            ${(this.config.intersectionTolerance || 3.0) / 111320.0},
            'geom',
            'id'
          )
        `);
        console.log('   ✅ pgr_nodeNetwork completed successfully');
      } catch (error) {
        console.log('   ⚠️ pgr_nodeNetwork not available, using crossing results');
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_noded_all AS
          SELECT id, sub_id, geom FROM ${this.stagingSchema}.trails_crossing_all
        `);
      }

      // Step 8: Combine all splitting results and remove duplicates
      console.log('   🔗 Step 6: Combining all splitting results...');
      
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_all_combined AS
        WITH all_splits AS (
          SELECT id, sub_id, geom FROM ${this.stagingSchema}.trails_crossing_all
          UNION
          SELECT id, sub_id, geom FROM ${this.stagingSchema}.trails_touching_all
          UNION
          SELECT id, sub_id, geom FROM ${this.stagingSchema}.trails_noded_all
        ),
        deduplicated AS (
          SELECT DISTINCT
            id,
            sub_id,
            geom,
            ST_Length(geom::geography) as length_meters
          FROM all_splits
          WHERE ST_IsValid(geom) 
            AND ST_GeometryType(geom) = 'ST_LineString'
            AND ST_NumPoints(geom) >= 2
            AND ST_Length(geom::geography) >= ${this.config.minSegmentLengthMeters}
        )
        SELECT 
          id,
          sub_id,
          geom,
          length_meters
        FROM deduplicated
        ORDER BY id, length_meters DESC
      `);

      // Step 9: Add original trails that weren't split
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails_all_combined (id, sub_id, geom, length_meters)
        SELECT 
          t.id,
          1 as sub_id,
          t.geom,
          ST_Length(t.geom::geography) as length_meters
        FROM ${this.stagingSchema}.trails_pgrouting_all t
        WHERE t.id NOT IN (
          SELECT DISTINCT id FROM ${this.stagingSchema}.trails_all_combined
        )
      `);

      // Step 10: Create final trails table with metadata
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_final_all_split AS
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
          cs.length_meters / 1000.0 as length_km,
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
        FROM ${this.stagingSchema}.trails_all_combined cs
        JOIN ${this.stagingSchema}.trails_homogenized_all t ON cs.id = t.id
        WHERE cs.length_meters >= ${this.config.minSegmentLengthMeters}
      `);

      // Step 11: Replace original trails table
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails`);
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.trails_final_all_split 
        RENAME TO trails
      `);

      // Step 12: Clean up temporary tables
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_for_all_splitting`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_homogenized_all`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_pgrouting_all`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_crossing_all`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_touching_all`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_noded_all`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_all_combined`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_final_all_split`);

      // Step 13: Get final statistics
      const finalCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      result.splitSegmentCount = parseInt(finalCountResult.rows[0].count);
      result.segmentsRemoved = result.originalTrailCount - result.splitSegmentCount;

      // Step 14: Create spatial index
      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_trails_geometry_all_intersections 
        ON ${this.stagingSchema}.trails USING GIST(geometry)
      `);

      result.success = true;
      
      console.log(`   ✅ Comprehensive intersection splitting complete:`);
      console.log(`      📊 Original trails: ${result.originalTrailCount}`);
      console.log(`      🔗 Split segments: ${result.splitSegmentCount}`);
      console.log(`      🗑️ Segments removed: ${result.segmentsRemoved}`);

      return result;

    } catch (error) {
      console.error('   ❌ Error during comprehensive intersection splitting:', error);
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Detect intersection points after splitting for analysis
   * Note: This method now preserves existing T and Y intersections instead of overwriting them
   */
  async detectIntersectionPoints(): Promise<number> {
    console.log('🔍 Detecting true intersection points after splitting (preserving T/Y intersections)...');
    
    try {
      // Backup existing T and Y intersections
      const existingIntersections = await this.pgClient.query(`
        SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
        FROM ${this.stagingSchema}.intersection_points 
        WHERE node_type IN ('t_intersection', 'y_intersection')
      `);
      
      console.log(`   💾 Preserving ${existingIntersections.rowCount} existing T/Y intersections`);

      // Clear existing intersection points
      await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.intersection_points`);

      // Detect true intersection points between split segments
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

      // Restore T and Y intersections
      if (existingIntersections.rowCount && existingIntersections.rowCount > 0) {
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.intersection_points (intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
          SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
          FROM (VALUES ${existingIntersections.rows.map((_, i) => `($${i*6+1}, $${i*6+2}, $${i*6+3}, $${i*6+4}, $${i*6+5}, $${i*6+6})`).join(', ')})
          AS t(intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        `, existingIntersections.rows.flatMap(row => [
          row.intersection_point, row.intersection_point_3d, row.connected_trail_ids, 
          row.connected_trail_names, row.node_type, row.distance_meters
        ]));
      }

      const totalIntersections = (intersectionResult.rowCount ?? 0) + (existingIntersections.rowCount ?? 0);
      console.log(`   📍 Found ${intersectionResult.rowCount ?? 0} true intersections + ${existingIntersections.rowCount ?? 0} preserved T/Y intersections = ${totalIntersections} total`);
      
      return totalIntersections;

    } catch (error) {
      console.error('   ❌ Error detecting intersection points:', error);
      return 0;
    }
  }

  /**
   * Custom method to detect and split trails at touching intersections
   * This works even when pgr_separateTouching fails
   */
  async detectTouchingIntersections(): Promise<void> {
    console.log('   🔗 Custom touching intersection detection...');
    
    // Use the T-intersection tolerance from layer1 config (default 3 meters)
    const touchingTolerance = (this.config.intersectionTolerance || 3.0) / 111320.0; // Convert meters to degrees
    console.log(`   📏 Using T-intersection tolerance: ${this.config.intersectionTolerance || 3.0}m`);
    
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails_touching_custom AS
      WITH touching_pairs AS (
        -- Find pairs of trails that touch or are very close
        SELECT DISTINCT
          t1.id as trail1_id,
          t2.id as trail2_id,
          ST_Intersection(t1.geom, t2.geom) as intersection_point
        FROM ${this.stagingSchema}.trails_pgrouting_all t1
        JOIN ${this.stagingSchema}.trails_pgrouting_all t2 ON (
          t1.id < t2.id 
          AND ST_DWithin(t1.geom, t2.geom, ${touchingTolerance})
          AND ST_Intersects(t1.geom, t2.geom)
        )
        WHERE ST_GeometryType(ST_Intersection(t1.geom, t2.geom)) = 'ST_Point'
      ),
      split_segments AS (
        -- Split trails at intersection points
        SELECT 
          t.id,
          ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY ST_Distance(ST_StartPoint(t.geom), tp.intersection_point)) as sub_id,
          CASE 
            WHEN ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY ST_Distance(ST_StartPoint(t.geom), tp.intersection_point)) = 1 
            THEN ST_LineSubstring(t.geom, 0, ST_LineLocatePoint(t.geom, tp.intersection_point))
            ELSE ST_LineSubstring(t.geom, ST_LineLocatePoint(t.geom, tp.intersection_point), 1)
          END as geom
        FROM ${this.stagingSchema}.trails_pgrouting_all t
        JOIN touching_pairs tp ON (t.id = tp.trail1_id OR t.id = tp.trail2_id)
        WHERE ST_LineLocatePoint(t.geom, tp.intersection_point) > 0.01 
          AND ST_LineLocatePoint(t.geom, tp.intersection_point) < 0.99
      )
      SELECT 
        id,
        sub_id,
        geom
      FROM split_segments
      WHERE ST_IsValid(geom) 
        AND ST_GeometryType(geom) = 'ST_LineString'
        AND ST_NumPoints(geom) >= 2
        AND ST_Length(geom::geography) >= ${this.config.minSegmentLengthMeters}
    `);
    
    // Count how many touching intersections were found
    const touchingCountResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_touching_custom
    `);
    const touchingCount = parseInt(touchingCountResult.rows[0].count);
    console.log(`   📊 Custom touching detection found ${touchingCount} split segments`);
  }

  /**
   * Split trails at T-intersection points (where trail endpoints are close to other trails)
   * FIXED: Now detects T-intersections first, then splits trails at those points
   */
  private async splitTrailsAtTIntersections(): Promise<void> {
    console.log('   🔗 Splitting trails at T-intersection points...');
    
    try {
      // Step 1: Detect T-intersections first (don't rely on empty intersection_points table)
      const toleranceMeters = this.config.intersectionTolerance ?? 3.0;
      console.log(`   📏 Using T-intersection tolerance: ${toleranceMeters}m`);
      
      const tIntersectionResult = await this.pgClient.query(`
        WITH all_trails AS (
          SELECT app_uuid, name, geometry 
          FROM ${this.stagingSchema}.trails 
          WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        t_intersections AS (
          -- T-intersections: where any point on one trail is close to any point on another trail
          SELECT 
            ST_Force2D(ST_ClosestPoint(t2.geometry::geometry, ST_ClosestPoint(t1.geometry::geometry, t2.geometry::geometry))) as intersection_point,
            ST_Force3D(ST_ClosestPoint(t2.geometry::geometry, ST_ClosestPoint(t1.geometry::geometry, t2.geometry::geometry))) as intersection_point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters
          FROM all_trails t1
          JOIN all_trails t2 ON t1.app_uuid != t2.app_uuid
          WHERE ST_DWithin(t1.geometry::geography, t2.geometry::geography, $1)
            AND ST_Distance(t1.geometry::geography, t2.geometry::geography) > 0
            AND ST_Distance(t1.geometry::geography, t2.geometry::geography) <= $1
        )
        SELECT 
          intersection_point,
          intersection_point_3d,
          connected_trail_ids,
          connected_trail_names,
          distance_meters
        FROM t_intersections
        WHERE array_length(connected_trail_ids, 1) > 1
        ORDER BY distance_meters ASC
      `, [toleranceMeters]);
      
      console.log(`   📍 Found ${tIntersectionResult.rowCount} T-intersection points to process`);
      
      if (tIntersectionResult.rowCount === 0) {
        console.log('   ⏭️ No T-intersection points found - skipping T-intersection splitting');
        return;
      }
      
      // Step 2: For each T-intersection, split the trail that the endpoint is close to
      let splitCount = 0;
      for (const intersection of tIntersectionResult.rows) {
        const point = intersection.intersection_point;
        const connectedTrailIds = intersection.connected_trail_ids;
        const distance = intersection.distance_meters;
        
        console.log(`   🔍 Processing T-intersection: ${intersection.connected_trail_names.join(' ↔ ')} (distance: ${distance.toFixed(3)}m)`);
        
        // Find the trail that should be split (the one that the endpoint is close to)
        const trailToSplitResult = await this.pgClient.query(`
          SELECT 
            id, app_uuid, name, geometry,
            ST_Distance(geometry::geography, $1::geography) as distance_to_point
          FROM ${this.stagingSchema}.trails 
          WHERE app_uuid = ANY($2)
          ORDER BY ST_Distance(geometry::geography, $1::geography)
          LIMIT 1
        `, [point, connectedTrailIds]);
        
        if (trailToSplitResult.rowCount === 0) {
          console.log(`   ⚠️ No trail found to split for intersection with trails: ${intersection.connected_trail_names.join(', ')}`);
          continue;
        }
        
        const trailToSplit = trailToSplitResult.rows[0];
        
        console.log(`   🔍 Attempting to split trail "${trailToSplit.name}" (distance: ${trailToSplit.distance_to_point.toFixed(3)}m) at point: ${point}`);
        
        // Split the trail at the T-intersection point by creating two new segments and deleting the original
        const splitResult = await this.pgClient.query(`
          WITH split_segments AS (
            SELECT 
              ST_LineSubstring(geometry, 0, ST_LineLocatePoint(geometry, ST_Force2D($1))) as segment1,
              ST_LineSubstring(geometry, ST_LineLocatePoint(geometry, ST_Force2D($1)), 1) as segment2
            FROM ${this.stagingSchema}.trails 
            WHERE id = $2
          ),
          insert_new_segments AS (
            INSERT INTO ${this.stagingSchema}.trails (
              app_uuid, original_app_uuid, name, trail_type, surface_type, difficulty, 
              length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, 
              avg_elevation, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, 
              color, stroke, geometry, created_at, updated_at
            )
            SELECT 
              gen_random_uuid(), $3, $4, trail_type, surface_type, difficulty,
              ST_Length(segment1::geography) / 1000, elevation_gain, elevation_loss, max_elevation, min_elevation,
              avg_elevation, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              color, stroke, segment1, NOW(), NOW()
            FROM split_segments, ${this.stagingSchema}.trails
            WHERE id = $2 AND ST_Length(segment1) > 0
            UNION ALL
            SELECT 
              gen_random_uuid(), $3, $4, trail_type, surface_type, difficulty,
              ST_Length(segment2::geography) / 1000, elevation_gain, elevation_loss, max_elevation, min_elevation,
              avg_elevation, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              color, stroke, segment2, NOW(), NOW()
            FROM split_segments, ${this.stagingSchema}.trails
            WHERE id = $2 AND ST_Length(segment2) > 0
            RETURNING id
          )
          DELETE FROM ${this.stagingSchema}.trails 
          WHERE id = $2
          RETURNING (SELECT count(*) FROM insert_new_segments) as segments_created
        `, [point, trailToSplit.id, trailToSplit.app_uuid, trailToSplit.name]);
        
        if (splitResult.rowCount && splitResult.rowCount > 0) {
          console.log(`   ✅ Successfully split trail "${trailToSplit.name}" into ${splitResult.rowCount} segments`);
          splitCount++;
        } else {
          console.log(`   ❌ Failed to split trail "${trailToSplit.name}"`);
        }
      }
      
      console.log(`   📊 T-intersection splitting complete: ${splitCount}/${tIntersectionResult.rowCount} trails split successfully`);
      
    } catch (error) {
      console.error('   ❌ Error splitting trails at T-intersections:', error);
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
