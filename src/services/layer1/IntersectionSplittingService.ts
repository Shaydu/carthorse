import { Pool } from 'pg';

export class IntersectionSplittingService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {}

  /**
   * Splits targetTrail by splitterTrail using the EXACT logic from the prototype SQL test.
   * This replicates the successful prototype: snap both trails, find intersections, split both.
   * 
   * NEW: Added coordinate rounding preprocessing to match prototype 2 success
   */
  async splitTrailAtSplitter(targetTrailUuid: string, splitterTrailUuid: string): Promise<void> {
    console.log(`🔗 [DEBUG] Starting EXACT prototype splitting logic with coordinate rounding`);
    console.log(`🔗 [DEBUG] Target trail UUID: ${targetTrailUuid}`);
    console.log(`🔗 [DEBUG] Splitter trail UUID: ${splitterTrailUuid}`);

    await this.pgClient.query('BEGIN');
    try {
      // Step 1: Get both trails with full metadata
      console.log(`🔗 [DEBUG] Step 1: Fetching both trails...`);
      const targetResult = await this.pgClient.query(`
        SELECT 
          app_uuid, name, region, trail_type, surface, difficulty,
          osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          length_km, source, source_tags, geometry,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        FROM ${this.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [targetTrailUuid]);

      if (targetResult.rows.length === 0) {
        throw new Error(`Target trail not found: ${targetTrailUuid}`);
      }

      const splitterResult = await this.pgClient.query(`
        SELECT 
          app_uuid, name, region, trail_type, surface, difficulty,
          osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          length_km, source, source_tags, geometry,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        FROM ${this.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [splitterTrailUuid]);

      if (splitterResult.rows.length === 0) {
        throw new Error(`Splitter trail not found: ${splitterTrailUuid}`);
      }

      const targetTrail = targetResult.rows[0];
      const splitterTrail = splitterResult.rows[0];
      console.log(`🔗 [DEBUG] Target trail: ${targetTrail.name}`);
      console.log(`🔗 [DEBUG] Splitter trail: ${splitterTrail.name}`);

      const targetGeom = targetTrail.geometry;
      const splitterGeom = splitterTrail.geometry;

      // Step 1.5: NEW - Apply coordinate rounding/simplification (like prototype 2)
      console.log(`🔗 [DEBUG] Step 1.5: Applying coordinate rounding/simplification (prototype 2 method)...`);
      const simplifiedResult = await this.pgClient.query(`
        SELECT 
          ST_Simplify(ST_Force2D($1::geometry), 0.000001) AS target_simplified,
          ST_Simplify(ST_Force2D($2::geometry), 0.000001) AS splitter_simplified
      `, [targetGeom, splitterGeom]);

      const targetSimplified = simplifiedResult.rows[0].target_simplified;
      const splitterSimplified = simplifiedResult.rows[0].splitter_simplified;
      console.log(`🔗 [DEBUG] Coordinate simplification completed (tolerance: 0.000001)`);

      // Step 2: Snap both trails with 1e-6 tolerance (EXACTLY like prototype 1)
      console.log(`🔗 [DEBUG] Step 2: Snapping both trails with 1e-6 tolerance (prototype method)...`);
      const snappedResult = await this.pgClient.query(`
        SELECT 
          ST_Snap($1::geometry, $2::geometry, 1e-6) AS target_snapped,
          ST_Snap($2::geometry, $1::geometry, 1e-6) AS splitter_snapped
      `, [targetSimplified, splitterSimplified]);

      const targetSnapped = snappedResult.rows[0].target_snapped;
      const splitterSnapped = snappedResult.rows[0].splitter_snapped;
      console.log(`🔗 [DEBUG] Snapping completed successfully`);

      // Step 3: Get intersection points using ST_Intersection (EXACTLY like prototype)
      console.log(`🔗 [DEBUG] Step 3: Getting intersection points with ST_Intersection (prototype method)...`);
      const intersectionResult = await this.pgClient.query(`
        SELECT 
          (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt,
          ST_GeometryType((ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom) AS geom_type
      `, [targetSnapped, splitterSnapped]);

      console.log(`🔗 [DEBUG] Found ${intersectionResult.rows.length} intersection points`);

      if (intersectionResult.rows.length === 0) {
        console.log('❌ [DEBUG] No intersections detected. Nothing to split.');
        await this.pgClient.query('ROLLBACK');
        return;
      }

      // Log intersection details
      intersectionResult.rows.forEach((row, index) => {
        console.log(`🔗 [DEBUG] Intersection ${index + 1}: ${row.geom_type} - ${row.pt ? 'EXISTS' : 'NULL'}`);
      });

      // Step 4: Split BOTH trails at intersection points (EXACTLY like prototype)
      console.log(`🔗 [DEBUG] Step 4: Splitting BOTH trails at intersection points (prototype method)...`);
      
      // Extract a point from the intersection (handle both POINT and LINESTRING)
      const intersectionPoint = await this.pgClient.query(`
        SELECT 
          CASE 
            WHEN ST_GeometryType($1::geometry) = 'ST_Point' THEN $1::geometry
            WHEN ST_GeometryType($1::geometry) = 'ST_LineString' THEN ST_Centroid($1::geometry)
            ELSE ST_Centroid($1::geometry)
          END AS split_point
      `, [intersectionResult.rows[0].pt]);

      const splitPoint = intersectionPoint.rows[0].split_point;
      console.log(`🔗 [DEBUG] Using split point: ${intersectionResult.rows[0].geom_type}`);
      
      // Split target trail
      const splitTargetResult = await this.pgClient.query(`
        SELECT 
          (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS split_geom,
          ST_Length((ST_Dump(ST_Split($1::geometry, $2::geometry))).geom::geography) AS split_length_meters
        FROM (SELECT $3::geometry AS a_geom, $4::geometry AS pt) AS split_data
      `, [targetSnapped, splitPoint, targetSnapped, splitPoint]);

      // Split splitter trail
      const splitSplitterResult = await this.pgClient.query(`
        SELECT 
          (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS split_geom,
          ST_Length((ST_Dump(ST_Split($1::geometry, $2::geometry))).geom::geography) AS split_length_meters
        FROM (SELECT $3::geometry AS a_geom, $4::geometry AS pt) AS split_data
      `, [splitterSnapped, splitPoint, splitterSnapped, splitPoint]);

      console.log(`🔗 [DEBUG] Generated ${splitTargetResult.rows.length} target segments`);
      console.log(`🔗 [DEBUG] Generated ${splitSplitterResult.rows.length} splitter segments`);

      // Log segment details
      splitTargetResult.rows.forEach((row, index) => {
        console.log(`🔗 [DEBUG] Target segment ${index + 1}: ${row.split_length_meters.toFixed(2)}m`);
      });
      splitSplitterResult.rows.forEach((row, index) => {
        console.log(`🔗 [DEBUG] Splitter segment ${index + 1}: ${row.split_length_meters.toFixed(2)}m`);
      });

      // Step 5: Insert split target segments with new UUIDs
      console.log(`🔗 [DEBUG] Step 5: Inserting split target segments...`);
      for (const row of splitTargetResult.rows) {
        const splitGeom = row.split_geom;
        
        // Calculate new metadata for the split segment
        const segmentMetadata = await this.pgClient.query(`
          SELECT 
            ST_Length($1::geography) / 1000.0 as length_km,
            ST_XMin($1::geometry) as bbox_min_lng,
            ST_XMax($1::geometry) as bbox_max_lng,
            ST_YMin($1::geometry) as bbox_min_lat,
            ST_YMax($1::geometry) as bbox_max_lat
        `, [splitGeom]);

        const metadata = segmentMetadata.rows[0];
        console.log(`🔗 [DEBUG] Target segment: ${metadata.length_km.toFixed(4)} km`);

        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, region, trail_type, surface, difficulty,
            osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            length_km, source, source_tags, geometry,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
            $16, $17, $18, $19
          )
        `, [
          targetTrail.name,
          targetTrail.region,
          targetTrail.trail_type,
          targetTrail.surface,
          targetTrail.difficulty,
          targetTrail.osm_id,
          targetTrail.elevation_gain,
          targetTrail.elevation_loss,
          targetTrail.max_elevation,
          targetTrail.min_elevation,
          targetTrail.avg_elevation,
          metadata.length_km,
          targetTrail.source,
          targetTrail.source_tags,
          splitGeom,
          metadata.bbox_min_lng,
          metadata.bbox_max_lng,
          metadata.bbox_min_lat,
          metadata.bbox_max_lat
        ]);
      }

      // Step 6: Insert split splitter segments with new UUIDs
      console.log(`🔗 [DEBUG] Step 6: Inserting split splitter segments...`);
      for (const row of splitSplitterResult.rows) {
        const splitGeom = row.split_geom;
        
        // Calculate new metadata for the split segment
        const segmentMetadata = await this.pgClient.query(`
          SELECT 
            ST_Length($1::geography) / 1000.0 as length_km,
            ST_XMin($1::geometry) as bbox_min_lng,
            ST_XMax($1::geometry) as bbox_max_lng,
            ST_YMin($1::geometry) as bbox_min_lat,
            ST_YMax($1::geometry) as bbox_max_lat
        `, [splitGeom]);

        const metadata = segmentMetadata.rows[0];
        console.log(`🔗 [DEBUG] Splitter segment: ${metadata.length_km.toFixed(4)} km`);

        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, region, trail_type, surface, difficulty,
            osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            length_km, source, source_tags, geometry,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
            $16, $17, $18, $19
          )
        `, [
          splitterTrail.name,
          splitterTrail.region,
          splitterTrail.trail_type,
          splitterTrail.surface,
          splitterTrail.difficulty,
          splitterTrail.osm_id,
          splitterTrail.elevation_gain,
          splitterTrail.elevation_loss,
          splitterTrail.max_elevation,
          splitterTrail.min_elevation,
          splitterTrail.avg_elevation,
          metadata.length_km,
          splitterTrail.source,
          splitterTrail.source_tags,
          splitGeom,
          metadata.bbox_min_lng,
          metadata.bbox_max_lng,
          metadata.bbox_min_lat,
          metadata.bbox_max_lat
        ]);
      }

      // Step 7: Delete BOTH original trails
      console.log(`🔗 [DEBUG] Step 7: Deleting both original trails...`);
      const deleteTargetResult = await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails WHERE app_uuid = $1 RETURNING app_uuid
      `, [targetTrailUuid]);

      const deleteSplitterResult = await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails WHERE app_uuid = $1 RETURNING app_uuid
      `, [splitterTrailUuid]);

      console.log(`🔗 [DEBUG] Deleted target trail: ${deleteTargetResult.rows.length > 0 ? 'SUCCESS' : 'FAILED'}`);
      console.log(`🔗 [DEBUG] Deleted splitter trail: ${deleteSplitterResult.rows.length > 0 ? 'SUCCESS' : 'FAILED'}`);

      await this.pgClient.query('COMMIT');
      console.log(`✅ [DEBUG] Successfully split BOTH trails using EXACT prototype logic.`);
      console.log(`✅ [DEBUG] Target trail split into ${splitTargetResult.rows.length} segments`);
      console.log(`✅ [DEBUG] Splitter trail split into ${splitSplitterResult.rows.length} segments`);
      
    } catch (err) {
      await this.pgClient.query('ROLLBACK');
      console.error('❌ [DEBUG] Failed to split trails:', err);
      console.error('❌ [DEBUG] Error details:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * Split trails using the improved approach that was proven to work
   */
  async splitTrailWithSplitter(targetTrailUuid: string, splitterTrailUuid: string): Promise<void> {
    console.log(`🔗 Splitting target trail ${targetTrailUuid} using splitter ${splitterTrailUuid}...`);

    try {
      // Use the improved trail splitting function that was proven to work
      const result = await this.pgClient.query(`
        SELECT * FROM improved_trail_splitting($1, $2)
      `, [this.stagingSchema, 3.0]); // 3 meter tolerance as used in the working test
      
      const splitResult = result.rows[0];
      
      if (!splitResult.success) {
        throw new Error(`Improved trail splitting failed: ${splitResult.message}`);
      }
      
      console.log(`✅ Successfully split trails: ${splitResult.original_count} -> ${splitResult.split_count} segments`);
      console.log(`Message: ${splitResult.message}`);
      
    } catch (error) {
      console.error('❌ Failed to split trails:', error);
      throw error;
    }
  }
}