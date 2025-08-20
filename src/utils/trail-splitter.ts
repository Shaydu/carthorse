import { Pool } from 'pg';

export interface TrailSplitterConfig {
  minTrailLengthMeters: number;
  verbose?: boolean; // Enable verbose logging
  enableDegree2Merging?: boolean; // Enable degree-2 chain merging
}

export interface TrailSplitResult {
  success: boolean;
  originalCount: number;
  splitCount: number;
  finalCount: number;
  shortSegmentsRemoved: number;
  mergedOverlaps: number;
}

export class TrailSplitter {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string,
    private config: TrailSplitterConfig
  ) {}

  /**
   * Main method to split trails at intersections and merge overlapping segments
   */
  async splitTrails(sourceQuery: string, params: any[]): Promise<TrailSplitResult> {
    console.log('🔍 Starting comprehensive trail splitting and merging...');
    console.log(`📊 Configuration:
   - Minimum trail length: ${this.config.minTrailLengthMeters}m
   - Staging schema: ${this.stagingSchema}`);
    
    try {
      // Step 1: Create temporary table for original trails
      const originalCount = await this.createTempTrailsTable(sourceQuery, params);
      
      // Step 2: Split trails at intersections
      const splitCount = await this.splitTrailsAtIntersections();
      
      // Step 3: Merge overlapping trail segments
      const mergedCount = await this.mergeOverlappingTrails();
      
      // Step 4: Merge colinear overlaps and degree-2 chains
      try {
        const finalCount = await this.mergeColinearOverlaps();
      } catch (error) {
        console.error('❌ Error in Step 4:', error);
        const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
        console.log(`✅ Continuing with ${finalCount.rows[0].count} segments remaining`);
      }
      
      // Step 5: Remove short segments
      const shortSegmentsRemoved = await this.removeShortSegments();
      
      const finalResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      const finalTrailCount = parseInt(finalResult.rows[0].count);
      
      return {
        success: true,
        originalCount,
        splitCount,
        finalCount: finalTrailCount,
        shortSegmentsRemoved,
        mergedOverlaps: originalCount - finalTrailCount
      };
      
    } catch (error) {
      console.error('❌ Trail splitting failed:', error);
      return {
        success: false,
        originalCount: 0,
        splitCount: 0,
        finalCount: 0,
        shortSegmentsRemoved: 0,
        mergedOverlaps: 0
      };
    }
  }

  /**
   * Step 1: Create temporary table for original trails
   */
  private async createTempTrailsTable(sourceQuery: string, params: any[]): Promise<number> {
    console.log('🔄 Step 1: Creating temporary table for original trails...');
    
    await this.pgClient.query(`
      CREATE TEMP TABLE temp_original_trails AS
      SELECT * FROM (${sourceQuery}) as source_trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    // Create spatial index for performance
    await this.pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_temp_original_trails_geometry 
      ON temp_original_trails USING GIST (geometry)
    `);
    
    const result = await this.pgClient.query(`SELECT COUNT(*) FROM temp_original_trails`);
    return parseInt(result.rows[0].count);
  }

  /**
   * Step 2: Split trails at intersections using ST_Node()
   */
  private async splitTrailsAtIntersections(): Promise<number> {
    console.log('🔄 Step 2: Splitting trails at intersections...');
    
    // Split trails using proper intersection detection in a single transaction
    const splitSql = `
      WITH all_geometries AS (
        -- Collect all trail geometries for intersection detection
        SELECT 
          app_uuid,
          name, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          geometry
        FROM temp_original_trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ),
      noded_geometries AS (
        -- Apply ST_Node to ALL geometries together to detect intersections
        SELECT ST_Node(ST_Collect(geometry)) as noded_geom
        FROM all_geometries
      ),
      split_segments AS (
        -- Extract individual segments from the noded geometry and preserve original trail info
        SELECT 
          t.app_uuid as original_trail_uuid,
          t.name, t.trail_type, t.surface, t.difficulty,
          t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
          dumped.geom as segment_geom,
          -- Count segments per original trail to determine if it was split
          COUNT(*) OVER (PARTITION BY t.app_uuid) as segment_count
        FROM all_geometries t,
        LATERAL ST_Dump((SELECT noded_geom FROM noded_geometries)) as dumped
        WHERE ST_IsValid(dumped.geom) 
          AND dumped.geom IS NOT NULL
          AND ST_NumPoints(dumped.geom) >= 2
          AND ST_StartPoint(dumped.geom) != ST_EndPoint(dumped.geom)
          AND ST_Intersects(t.geometry, dumped.geom)
      ),
      segments_to_insert AS (
        SELECT
          -- Generate new UUID only for segments that were actually split
          CASE 
            WHEN segment_count > 1 THEN gen_random_uuid()  -- Generate new UUID for split segments
            ELSE original_trail_uuid  -- Keep original UUID for unsplit trails
          END as app_uuid,
          original_trail_uuid,  -- Always preserve original trail UUID for metadata lookup
          name, trail_type, surface, difficulty,
          ST_XMin(segment_geom) as bbox_min_lng, ST_XMax(segment_geom) as bbox_max_lng,
          ST_YMin(segment_geom) as bbox_min_lat, ST_YMax(segment_geom) as bbox_max_lat,
          ST_Length(segment_geom::geography) / 1000.0 as length_km,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          segment_geom as geometry
        FROM split_segments
        ORDER BY name, ST_Length(segment_geom::geography) DESC
      ),
      -- Delete original trails that will be replaced by split segments
      deleted_originals AS (
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE app_uuid IN (
          SELECT DISTINCT original_trail_uuid 
          FROM split_segments 
          WHERE segment_count > 1
        )
        RETURNING app_uuid
      )
      -- Insert the split segments
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, original_trail_uuid, name, trail_type, surface, difficulty,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry
      )
      SELECT 
        app_uuid, original_trail_uuid, name, trail_type, surface, difficulty,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry
      FROM segments_to_insert;
    `;
    
    const result = await this.pgClient.query(splitSql);
    return result.rowCount || 0;
  }

  /**
   * Step 3: Merge overlapping trail segments
   */
  private async mergeOverlappingTrails(): Promise<number> {
    console.log('🔄 Step 3: Merging overlapping trail segments...');
    
    // Create temporary table with merged overlapping trails
    await this.pgClient.query(`
      CREATE TEMP TABLE merged_trails AS
      WITH       duplicate_groups AS (
        -- Find exact duplicates (identical geometries) from same original trail
        SELECT 
          t1.app_uuid as trail1_id,
          t1.original_trail_uuid as original_trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.original_trail_uuid as original_trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom,
          'duplicate' as overlap_type,
          NULL::double precision as overlap_length
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE t1.name = t2.name
          AND COALESCE(t1.original_trail_uuid, t1.app_uuid) = COALESCE(t2.original_trail_uuid, t2.app_uuid)  -- Same original trail
          AND ST_Equals(t1.geometry, t2.geometry)
      ),
      overlapping_groups AS (
        -- Find overlapping segments from same original trail
        SELECT 
          t1.app_uuid as trail1_id,
          t1.original_trail_uuid as original_trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.original_trail_uuid as original_trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom,
          'overlap' as overlap_type,
          ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE t1.name = t2.name
          AND COALESCE(t1.original_trail_uuid, t1.app_uuid) = COALESCE(t2.original_trail_uuid, t2.app_uuid)  -- Same original trail
          AND ST_Intersects(t1.geometry, t2.geometry)
          AND NOT ST_Equals(t1.geometry, t2.geometry)
          AND ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) > 10
      ),
      all_overlaps AS (
        SELECT * FROM duplicate_groups
        UNION ALL
        SELECT trail1_id, original_trail1_id, trail1_name, trail1_geom, trail2_id, original_trail2_id, trail2_name, trail2_geom, overlap_type, overlap_length
        FROM overlapping_groups
      ),
      merged_geometries AS (
        SELECT
          trail1_id, original_trail1_id, trail1_name,
          CASE
            WHEN overlap_type = 'duplicate' THEN trail1_geom
            ELSE ST_LineMerge(ST_Union(trail1_geom, trail2_geom))
          END as merged_geom,
          overlap_type
        FROM all_overlaps
        WHERE overlap_type = 'duplicate'
           OR (overlap_type = 'overlap' AND ST_IsValid(ST_LineMerge(ST_Union(trail1_geom, trail2_geom))))
      )
      SELECT 
        mg.trail1_id as app_uuid,
        mg.original_trail1_id as original_trail_uuid,
        mg.trail1_name as name,
        t.trail_type, t.surface, t.difficulty,
        ST_XMin(mg.merged_geom) as bbox_min_lng, ST_XMax(mg.merged_geom) as bbox_max_lng,
        ST_YMin(mg.merged_geom) as bbox_min_lat, ST_YMax(mg.merged_geom) as bbox_max_lat,
        ST_Length(mg.merged_geom::geography) / 1000.0 as length_km,
        t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
        mg.merged_geom as geometry
      FROM merged_geometries mg
      JOIN ${this.stagingSchema}.trails t ON t.app_uuid = mg.trail1_id;
    `);
    
    // Replace original trails with merged versions
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE app_uuid IN (SELECT app_uuid FROM merged_trails);
    `);
    
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, original_trail_uuid, name, trail_type, surface, difficulty,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry
      )
      SELECT 
        app_uuid, original_trail_uuid, name, trail_type, surface, difficulty,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry
      FROM merged_trails;
    `);
    
    // Get final count
    const result = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    return parseInt(result.rows[0].count);
  }

  /**
   * Step 4: Remove segments that are too short
   */
  private async removeShortSegments(): Promise<number> {
    // Debug: Check if our specific trail would be removed
    const debugCheck = await this.pgClient.query(`
      SELECT id, app_uuid, name, length_km, ST_Length(geometry::geography) as geom_length_meters
      FROM ${this.stagingSchema}.trails
      WHERE app_uuid = 'c39906d4-bfa3-4089-beb2-97b5d3caa38d' OR (name = 'Mesa Trail' AND length_km > 0.5 AND length_km < 0.6)
    `);
    
    if (debugCheck.rowCount && debugCheck.rowCount > 0) {
      console.log('🔍 DEBUG: Found our target trail before short segment removal:');
      debugCheck.rows.forEach((trail: any) => {
        console.log(`   - ${trail.name} (${trail.app_uuid}): ${trail.length_km}km, geom_length: ${trail.geom_length_meters}m, minTrailLengthMeters: ${this.config.minTrailLengthMeters}m`);
        if (trail.geom_length_meters < this.config.minTrailLengthMeters) {
          console.log(`   ⚠️ WARNING: This trail will be removed! geom_length (${trail.geom_length_meters}m) < minTrailLengthMeters (${this.config.minTrailLengthMeters}m)`);
        }
      });
    } else {
      console.log('🔍 DEBUG: Our target trail not found before short segment removal');
    }
    
    const result = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_Length(geometry::geography) < $1
    `, [this.config.minTrailLengthMeters]);
    
    console.log(`🔍 DEBUG: Removed ${result.rowCount} short segments (minTrailLengthMeters: ${this.config.minTrailLengthMeters}m)`);
    
    return result.rowCount || 0;
  }

  /**
   * Step 5: Get final trail count
   */
  private async getFinalTrailCount(): Promise<number> {
    const result = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.trails`);
    return parseInt(result.rows[0].count);
  }

  /**
   * Step 4: Merge colinear overlapping segments and degree-2 chains
   */
  private async mergeColinearOverlaps(): Promise<number> {
    console.log('🔄 Step 4: Merging colinear overlaps and degree-2 chains...');
    console.log('🔍 DEBUG: mergeColinearOverlaps function called!');
    
    // Check if degree-2 merging is enabled
    if (this.config.enableDegree2Merging === false) {
      console.log('⏭️ Degree-2 merging is disabled. Skipping colinear overlap merging.');
      const result = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      return parseInt(result.rows[0].count);
    }
    
    try {
      // Debug: Check total trails first
      const totalTrailsResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      console.log(`🔍 Total trails in table: ${totalTrailsResult.rows[0].count}`);
      
      // Debug: Check for overlapping segments before processing
      const debugOverlapsSql = `
        SELECT 
          t1.id as id1, 
          t2.id as id2,
          t1.name as name1,
          t2.name as name2,
          ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length,
          ST_Length(t1.geometry::geography) as length1,
          ST_Length(t2.geometry::geography) as length2
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) > 10  -- Overlap > 10m
          AND NOT ST_Equals(t1.geometry, t2.geometry)  -- Not identical
        ORDER BY overlap_length DESC
        LIMIT 10;
      `;
      
      const debugResult = await this.pgClient.query(debugOverlapsSql);
      console.log('🔍 Found overlapping segments:', debugResult.rows.length);
      debugResult.rows.forEach(row => {
        console.log(`   Edge ${row.id1} (${row.name1}) overlaps Edge ${row.id2} (${row.name2}) by ${row.overlap_length.toFixed(2)}m (${(row.overlap_length/row.length1*100).toFixed(1)}% of edge1, ${(row.overlap_length/row.length2*100).toFixed(1)}% of edge2)`);
      });
      
      if (debugResult.rows.length === 0) {
        console.log('⚠️  No overlapping segments found - skipping deduplication');
        return totalTrailsResult.rows[0].count;
      }
      
      // First, deduplicate overlapping segments by removing overlaps from one edge
      const deduplicateOverlapsSql = `
        WITH overlapping_segments AS (
          -- Find segments that have significant overlap
          SELECT 
            t1.id as id1, t1.geometry as geom1,
            t2.id as id2, t2.geometry as geom2,
            ST_Intersection(t1.geometry, t2.geometry) as overlap_geom,
            ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) > 10  -- Overlap > 10m
            AND NOT ST_Equals(t1.geometry, t2.geometry)  -- Not identical
        ),
        deduplicated_geometries AS (
          -- Remove overlap from the shorter edge (keep the longer one intact)
          SELECT 
            id1,
            CASE 
              WHEN ST_Length(geom1::geography) <= ST_Length(geom2::geography) THEN
                -- Remove overlap from the shorter edge
                ST_Difference(geom1, overlap_geom)
              ELSE geom1
            END as deduplicated_geom,
            overlap_length
          FROM overlapping_segments
          WHERE ST_IsValid(
            CASE 
              WHEN ST_Length(geom1::geography) <= ST_Length(geom2::geography) THEN
                ST_Difference(geom1, overlap_geom)
              ELSE geom1
            END
          )
        )
        UPDATE ${this.stagingSchema}.trails t
        SET 
          geometry = dg.deduplicated_geom,
          length_km = ST_Length(dg.deduplicated_geom::geography) / 1000.0,
          bbox_min_lng = ST_XMin(dg.deduplicated_geom),
          bbox_max_lng = ST_XMax(dg.deduplicated_geom),
          bbox_min_lat = ST_YMin(dg.deduplicated_geom),
          bbox_max_lat = ST_YMax(dg.deduplicated_geom)
        FROM deduplicated_geometries dg
        WHERE t.id = dg.id1;
      `;
      
      const dedupeResult = await this.pgClient.query(deduplicateOverlapsSql);
      console.log(`✅ Deduplicated ${dedupeResult.rowCount} overlapping segments`);
      
      // Now merge degree-2 chains by finding trails that connect end-to-end
      const mergeDegree2ChainsSql = `
        WITH degree2_connections AS (
          -- Find trails that connect end-to-end (potential degree-2 chains)
          SELECT 
            t1.id as trail1_id, t1.geometry as trail1_geom,
            t2.id as trail2_id, t2.geometry as trail2_geom,
            CASE
              -- End of t1 connects to start of t2
              WHEN ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) THEN 'end_to_start'
              -- End of t1 connects to end of t2  
              WHEN ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001) THEN 'end_to_end'
              -- Start of t1 connects to start of t2
              WHEN ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) THEN 'start_to_start'
              -- Start of t1 connects to end of t2
              WHEN ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001) THEN 'start_to_end'
            END as connection_type
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE (
            ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) OR
            ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001) OR
            ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) OR
            ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001)
          )
        ),
        chain_geometries AS (
          -- Merge the geometries of degree-2 chains
          SELECT 
            trail1_id,
            CASE
              WHEN connection_type = 'end_to_start' THEN ST_LineMerge(ST_Union(trail1_geom, trail2_geom))
              WHEN connection_type = 'end_to_end' THEN ST_LineMerge(ST_Union(trail1_geom, ST_Reverse(trail2_geom)))
              WHEN connection_type = 'start_to_start' THEN ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), trail2_geom))
              WHEN connection_type = 'start_to_end' THEN ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), ST_Reverse(trail2_geom)))
            END as chain_geom
          FROM degree2_connections
          WHERE ST_IsValid(
            CASE
              WHEN connection_type = 'end_to_start' THEN ST_LineMerge(ST_Union(trail1_geom, trail2_geom))
              WHEN connection_type = 'end_to_end' THEN ST_LineMerge(ST_Union(trail1_geom, ST_Reverse(trail2_geom)))
              WHEN connection_type = 'start_to_start' THEN ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), trail2_geom))
              WHEN connection_type = 'start_to_end' THEN ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), ST_Reverse(trail2_geom)))
            END
          )
        )
        UPDATE ${this.stagingSchema}.trails t
        SET 
          geometry = cg.chain_geom,
          length_km = ST_Length(cg.chain_geom::geography) / 1000.0,
          bbox_min_lng = ST_XMin(cg.chain_geom),
          bbox_max_lng = ST_XMax(cg.chain_geom),
          bbox_min_lat = ST_YMin(cg.chain_geom),
          bbox_max_lat = ST_YMax(cg.chain_geom)
        FROM chain_geometries cg
        WHERE t.id = cg.trail1_id;
      `;
      
      const mergeResult = await this.pgClient.query(mergeDegree2ChainsSql);
      console.log(`✅ Merged ${mergeResult.rowCount} degree-2 chains`);
      
      // Delete the second trail in each merged pair
      const deleteMergedTrailsSql = `
        DELETE FROM ${this.stagingSchema}.trails t1
        WHERE EXISTS (
          SELECT 1 FROM ${this.stagingSchema}.trails t2
          WHERE t1.id > t2.id
            AND (
              ST_DWithin(ST_EndPoint(t2.geometry), ST_StartPoint(t1.geometry), 0.001) OR
              ST_DWithin(ST_EndPoint(t2.geometry), ST_EndPoint(t1.geometry), 0.001) OR
              ST_DWithin(ST_StartPoint(t2.geometry), ST_StartPoint(t1.geometry), 0.001) OR
              ST_DWithin(ST_StartPoint(t2.geometry), ST_EndPoint(t1.geometry), 0.001)
            )
        );
      `;
      
      const deleteResult = await this.pgClient.query(deleteMergedTrailsSql);
      console.log(`✅ Deleted ${deleteResult.rowCount} merged duplicate trails`);
      
      // Final deduplication of identical geometries
      const finalDedupeSql = `
        DELETE FROM ${this.stagingSchema}.trails t1
        WHERE EXISTS (
          SELECT 1 FROM ${this.stagingSchema}.trails t2
          WHERE t1.id > t2.id
            AND ST_Equals(t1.geometry, t2.geometry)
        );
      `;
      
      const finalDedupeResult = await this.pgClient.query(finalDedupeSql);
      console.log(`✅ Final deduplication removed ${finalDedupeResult.rowCount} identical geometries`);
      
      // Get final count
      const result = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      return result.rows[0].count;
      
    } catch (error) {
      console.error('❌ Error in mergeColinearOverlaps:', error);
      // Return current count on error
      const result = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      return result.rows[0].count;
    }
  }


} 