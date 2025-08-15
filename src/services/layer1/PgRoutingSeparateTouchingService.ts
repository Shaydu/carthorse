import { Pool } from 'pg';

export interface PgRoutingSeparateTouchingConfig {
  stagingSchema: string;
  pgClient: Pool;
  toleranceMeters?: number; // Tolerance in meters for trail separation
  simplifyTolerance?: number; // Geometry simplification tolerance
  verbose?: boolean;
}

export interface SeparateTouchingResult {
  success: boolean;
  originalTrails: number;
  splitTrails: number;
  totalSegments: number;
  error?: string;
}

export class PgRoutingSeparateTouchingService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: PgRoutingSeparateTouchingConfig;

  constructor(config: PgRoutingSeparateTouchingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = {
      toleranceMeters: 2.0, // Default 2 meters
      verbose: false,
      ...config
    };
  }

  private log(message: string) {
    if (this.config.verbose) {
      console.log(`[PgRoutingSeparateTouching] ${message}`);
    }
  }

  /**
   * Split trails using pgr_separateTouching function
   * This function splits trails that are within tolerance distance of each other
   */
  async separateTouchingTrails(): Promise<SeparateTouchingResult> {
    this.log('🔍 Separating touching trails using pgr_separateTouching...');
    
    const result: SeparateTouchingResult = {
      success: false,
      originalTrails: 0,
      splitTrails: 0,
      totalSegments: 0
    };

    try {
      // Step 1: Get original trail count
      const originalCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count
        FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry) 
          AND ST_GeometryType(geometry) = 'ST_LineString'
      `);
      result.originalTrails = parseInt(originalCountResult.rows[0].count);
      
      this.log(`📊 Original trails: ${result.originalTrails}`);

      // Step 2: Create temporary table for split results
      await this.createSplitResultsTable();

      // Step 3: Apply pgr_separateTouching and insert results
      const toleranceDegrees = this.config.toleranceMeters! / 111320; // Convert meters to degrees
      
      this.log(`🎯 Using tolerance: ${this.config.toleranceMeters}m (${toleranceDegrees} degrees)`);
      
      const splitResult = await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails_split_results (
          original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags,
          geometry, created_at
        )
        SELECT 
          t.id as original_id,
          st.sub_id,
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
          st.geom as geometry,
          NOW() as created_at
        FROM pgr_separateTouching(
          'SELECT id, ST_Force2D(geometry) as geom FROM ${this.stagingSchema}.trails WHERE ST_IsValid(geometry) AND ST_GeometryType(geometry) = ''ST_LineString''',
          $1
        ) st
        JOIN ${this.stagingSchema}.trails t ON st.id = t.id
        WHERE ST_GeometryType(st.geom) = 'ST_LineString'
          AND ST_Length(st.geom::geography) > 0
        ORDER BY st.id, st.sub_id
      `, [toleranceDegrees]);

      // Step 4: Get split results count
      const splitCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count
        FROM ${this.stagingSchema}.trails_split_results
      `);
      result.totalSegments = parseInt(splitCountResult.rows[0].count);
      
      // Step 5: Count unique original trails that were split
      const splitTrailsResult = await this.pgClient.query(`
        SELECT COUNT(DISTINCT original_id) as count
        FROM ${this.stagingSchema}.trails_split_results
        WHERE sub_id > 1
      `);
      result.splitTrails = parseInt(splitTrailsResult.rows[0].count);

      this.log(`✅ Separation complete:`);
      this.log(`   - Original trails: ${result.originalTrails}`);
      this.log(`   - Trails split: ${result.splitTrails}`);
      this.log(`   - Total segments: ${result.totalSegments}`);

      result.success = true;
      return result;

    } catch (error) {
      this.log(`❌ Error in separateTouchingTrails: ${error}`);
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Split trails and replace original trails in a single transaction
   * This ensures data consistency by handling both operations atomically
   */
  async separateTouchingTrailsAndReplace(): Promise<SeparateTouchingResult> {
    this.log('🔄 Separating touching trails and replacing in single transaction...');
    
    const result: SeparateTouchingResult = {
      success: false,
      originalTrails: 0,
      splitTrails: 0,
      totalSegments: 0
    };

    // Start transaction
    const client = await this.pgClient.connect();
    
    try {
      await client.query('BEGIN');

      // Step 1: Get original trail count
      const originalCountResult = await client.query(`
        SELECT COUNT(*) as count
        FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry) 
          AND ST_GeometryType(geometry) = 'ST_LineString'
      `);
      result.originalTrails = parseInt(originalCountResult.rows[0].count);
      
      this.log(`📊 Original trails: ${result.originalTrails}`);

      // Step 2: Clear and recreate temporary table for split results
      await client.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_split_results`);
      await this.createSplitResultsTableWithClient(client);

      // Step 3: Create a backup of original trails
      this.log('💾 Creating backup of original trails...');
      await client.query(`
        CREATE TABLE ${this.stagingSchema}.trails_backup AS 
        SELECT * FROM ${this.stagingSchema}.trails
      `);

      // Step 4: Apply pgr_separateTouching and insert results
      const toleranceDegrees = this.config.toleranceMeters! / 111320;
      
      this.log(`🎯 Using tolerance: ${this.config.toleranceMeters}m (${toleranceDegrees} degrees)`);
      
      // Step 4.5: Simplify geometries to avoid complex intersection errors
      this.log('🔧 Simplifying geometries before separateTouching...');
      await client.query(`
        UPDATE ${this.stagingSchema}.trails 
        SET geometry = ST_Simplify(geometry, 0.00001)  -- ~1 meter tolerance
        WHERE ST_IsValid(geometry) 
          AND ST_GeometryType(geometry) = 'ST_LineString'
          AND ST_NumPoints(geometry) > 2
      `);
      
      // Try with original tolerance first
      try {
        // First, insert all trails that were split by pgr_separateTouching
        await client.query(`
          INSERT INTO ${this.stagingSchema}.trails_split_results (
            original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags,
            geometry, created_at
          )
          SELECT 
            t.id as original_id,
            st.sub_id,
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
            st.geom as geometry,
            NOW() as created_at
          FROM pgr_separateTouching(
            'SELECT id, ST_Force2D(geometry) as geom FROM ${this.stagingSchema}.trails WHERE ST_IsValid(geometry) AND ST_GeometryType(geometry) = ''ST_LineString''',
            $1
          ) st
          JOIN ${this.stagingSchema}.trails t ON st.id = t.id
          WHERE ST_GeometryType(st.geom) = 'ST_LineString'
            AND ST_Length(st.geom::geography) > 0
          ORDER BY st.id, st.sub_id
        `, [toleranceDegrees]);
        
        // Then, insert all trails that were NOT split (preserve unsplit trails)
        await client.query(`
          INSERT INTO ${this.stagingSchema}.trails_split_results (
            original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags,
            geometry, created_at
          )
          SELECT 
            t.id as original_id,
            1 as sub_id,  -- Single segment for unsplit trails
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
            t.geometry,
            NOW() as created_at
          FROM ${this.stagingSchema}.trails_backup t
          WHERE t.id NOT IN (
            SELECT DISTINCT original_id 
            FROM ${this.stagingSchema}.trails_split_results
          )
          AND ST_IsValid(t.geometry) 
          AND ST_GeometryType(t.geometry) = 'ST_LineString'
          AND ST_Length(t.geometry::geography) > 0
        `);
        
        this.log(`✅ Successfully applied with original tolerance: ${this.config.toleranceMeters}m`);
      } catch (error) {
        // If original tolerance fails, try with a smaller tolerance
        this.log(`⚠️ Original tolerance failed, trying with smaller tolerance...`);
        const smallerToleranceDegrees = (this.config.toleranceMeters! * 0.5) / 111320;
        
        // First, insert all trails that were split by pgr_separateTouching
        await client.query(`
          INSERT INTO ${this.stagingSchema}.trails_split_results (
            original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags,
            geometry, created_at
          )
          SELECT 
            t.id as original_id,
            st.sub_id,
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
            st.geom as geometry,
            NOW() as created_at
          FROM pgr_separateTouching(
            'SELECT id, ST_Force2D(geometry) as geom FROM ${this.stagingSchema}.trails WHERE ST_IsValid(geometry) AND ST_GeometryType(geometry) = ''ST_LineString''',
            $1
          ) st
          JOIN ${this.stagingSchema}.trails t ON st.id = t.id
          WHERE ST_GeometryType(st.geom) = 'ST_LineString'
            AND ST_Length(st.geom::geography) > 0
          ORDER BY st.id, st.sub_id
        `, [smallerToleranceDegrees]);
        
        // Then, insert all trails that were NOT split (preserve unsplit trails)
        await client.query(`
          INSERT INTO ${this.stagingSchema}.trails_split_results (
            original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags,
            geometry, created_at
          )
          SELECT 
            t.id as original_id,
            1 as sub_id,  -- Single segment for unsplit trails
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
            t.geometry,
            NOW() as created_at
          FROM ${this.stagingSchema}.trails_backup t
          WHERE t.id NOT IN (
            SELECT DISTINCT original_id 
            FROM ${this.stagingSchema}.trails_split_results
          )
          AND ST_IsValid(t.geometry) 
          AND ST_GeometryType(t.geometry) = 'ST_LineString'
          AND ST_Length(t.geometry::geography) > 0
        `);
        
        this.log(`✅ Successfully applied with smaller tolerance: ${this.config.toleranceMeters! * 0.5}m`);
      }

      // Step 5: Get split results count
      const splitCountResult = await client.query(`
        SELECT COUNT(*) as count
        FROM ${this.stagingSchema}.trails_split_results
      `);
      result.totalSegments = parseInt(splitCountResult.rows[0].count);
      
      // Step 6: Count unique original trails that were split
      const splitTrailsResult = await client.query(`
        SELECT COUNT(DISTINCT original_id) as count
        FROM ${this.stagingSchema}.trails_split_results
        WHERE sub_id > 1
      `);
      result.splitTrails = parseInt(splitTrailsResult.rows[0].count);

      // Step 7: Replace original trails with split segments
      await client.query(`DELETE FROM ${this.stagingSchema}.trails`);
      
      await client.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          id, old_id, app_uuid, osm_id, name, region, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags,
          geometry
        )
        SELECT 
          nextval('${this.stagingSchema}.trails_id_seq') as id,
          original_id as old_id,
          gen_random_uuid()::text as app_uuid,
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
          ST_Force3D(geometry) as geometry
        FROM ${this.stagingSchema}.trails_split_results
        ORDER BY original_id, sub_id
      `);

      // Step 8: Clean up temporary tables (but keep trails_split_results for visualization)
      await client.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_backup`);
      // Note: trails_split_results is kept for visualization/debugging

      // Commit transaction
      await client.query('COMMIT');

      this.log(`✅ Transaction complete:`);
      this.log(`   - Original trails: ${result.originalTrails}`);
      this.log(`   - Trails split: ${result.splitTrails}`);
      this.log(`   - Total segments: ${result.totalSegments}`);

      result.success = true;
      return result;

    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      this.log(`❌ Error in separateTouchingTrailsAndReplace: ${error}`);
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Replace original trails with split segments
   */
  async replaceTrailsWithSplitSegments(): Promise<boolean> {
    this.log('🔄 Replacing original trails with split segments...');
    
    try {
      // Step 1: Clear original trails table
      await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.trails`);
      
      // Step 2: Insert split segments as new trails
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, osm_id, name, region, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags,
          geometry, created_at, updated_at
        )
        SELECT 
          gen_random_uuid() as app_uuid,
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
          geometry,
          created_at,
          NOW() as updated_at
        FROM ${this.stagingSchema}.trails_split_results
        ORDER BY original_id, sub_id
      `);

      // Step 3: Clean up temporary table
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails_split_results`);

      this.log('✅ Successfully replaced trails with split segments');
      return true;

    } catch (error) {
      this.log(`❌ Error replacing trails: ${error}`);
      return false;
    }
  }

  /**
   * Create temporary table for split results
   */
  private async createSplitResultsTable(): Promise<void> {
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.stagingSchema}.trails_split_results
    `);

    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails_split_results (
        original_id BIGINT,
        sub_id INTEGER,
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
        geometry GEOMETRY(LINESTRING, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes
    await this.pgClient.query(`
      CREATE INDEX idx_trails_split_results_original_id 
      ON ${this.stagingSchema}.trails_split_results(original_id)
    `);
    
    await this.pgClient.query(`
      CREATE INDEX idx_trails_split_results_geometry 
      ON ${this.stagingSchema}.trails_split_results USING GIST(geometry)
    `);
  }

  /**
   * Create temporary table for split results with a specific client (for transactions)
   */
  private async createSplitResultsTableWithClient(client: any): Promise<void> {
    await client.query(`
      DROP TABLE IF EXISTS ${this.stagingSchema}.trails_split_results
    `);

    await client.query(`
      CREATE TABLE ${this.stagingSchema}.trails_split_results (
        original_id BIGINT,
        sub_id INTEGER,
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
        geometry GEOMETRY(LINESTRING, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX idx_trails_split_results_original_id 
      ON ${this.stagingSchema}.trails_split_results(original_id)
    `);
    
    await client.query(`
      CREATE INDEX idx_trails_split_results_geometry 
      ON ${this.stagingSchema}.trails_split_results USING GIST(geometry)
    `);
  }

  /**
   * Get detailed split information for debugging
   */
  async getSplitDetails(): Promise<any[]> {
    const result = await this.pgClient.query(`
      SELECT 
        original_id,
        sub_id,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${this.stagingSchema}.trails_split_results
      ORDER BY original_id, sub_id
    `);
    
    return result.rows;
  }
}
