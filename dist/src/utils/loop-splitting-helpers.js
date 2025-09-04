"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoopSplittingHelpers = void 0;
exports.createLoopSplittingHelpers = createLoopSplittingHelpers;
class LoopSplittingHelpers {
    constructor(config) {
        this.stagingSchema = config.stagingSchema;
        this.pgClient = config.pgClient;
        this.intersectionTolerance = config.intersectionTolerance ?? 2.0;
        // Safety check: never allow processing of public schema
        if (this.stagingSchema === 'public') {
            throw new Error('Loop splitting is not allowed on public schema. Use a staging schema instead.');
        }
    }
    /**
     * Intelligently split loop trails at intersections and apex points
     * This method now properly handles database transactions and original_trail_uuid relationships
     */
    async splitLoopTrails() {
        // Get a dedicated client for transaction management
        const client = await this.pgClient.connect();
        if (!client) {
            return {
                success: false,
                error: 'Failed to connect to database'
            };
        }
        try {
            console.log('🔄 Starting intelligent loop trail splitting...');
            // Start transaction
            await client.query('BEGIN');
            // Step 0: Deduplicate trails by geometry before processing
            const deduplicationResult = await this.deduplicateTrailsByGeometry(client);
            if (!deduplicationResult.success) {
                await client.query('ROLLBACK');
                return deduplicationResult;
            }
            // Step 1: Identify loop trails (self-intersecting)
            const loopTrailsResult = await this.identifyLoopTrails(client);
            if (!loopTrailsResult.success) {
                await client.query('ROLLBACK');
                return loopTrailsResult;
            }
            // Step 2: Find intersection points between loops and other trails
            const intersectionResult = await this.findLoopIntersections(client);
            if (!intersectionResult.success) {
                await client.query('ROLLBACK');
                return intersectionResult;
            }
            // Step 3: Find apex points for loops that only intersect once
            const apexResult = await this.findLoopApexPoints(client);
            if (!apexResult.success) {
                await client.query('ROLLBACK');
                return apexResult;
            }
            // Step 4: Split loops at both intersection and apex points
            const splitResult = await this.splitLoopsAtPoints(client);
            if (!splitResult.success) {
                await client.query('ROLLBACK');
                return splitResult;
            }
            // Step 5: Replace loop trails with split segments in a single atomic operation
            const replaceResult = await this.replaceLoopTrailsWithSegments(client);
            if (!replaceResult.success) {
                await client.query('ROLLBACK');
                return replaceResult;
            }
            // Commit the transaction
            await client.query('COMMIT');
            console.log('✅ Loop trail splitting completed successfully');
            return {
                success: true,
                loopCount: loopTrailsResult.loopCount,
                splitSegments: replaceResult.splitSegments,
                intersectionPoints: intersectionResult.intersectionPoints,
                apexPoints: apexResult.apexPoints
            };
        }
        catch (error) {
            // Rollback on error
            await client.query('ROLLBACK');
            console.error('❌ Loop trail splitting failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
        finally {
            // Release the client back to the pool
            client.release();
        }
    }
    /**
     * Deduplicate trails by geometry before processing
     */
    async deduplicateTrailsByGeometry(client) {
        try {
            console.log('🔄 Deduplicating trails by geometry...');
            // Create a temporary table with deduplicated trails
            await client.query(`
        CREATE TEMP TABLE deduplicated_trails AS
        SELECT DISTINCT ON (ST_AsText(geometry)) 
          id, app_uuid, original_trail_uuid, osm_id, name, trail_type, surface, difficulty,
          source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, geometry
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ORDER BY ST_AsText(geometry), id
      `);
            // Replace the original trails table with deduplicated data
            await client.query(`DELETE FROM ${this.stagingSchema}.trails`);
            await client.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          id, app_uuid, original_trail_uuid, osm_id, name, trail_type, surface, difficulty,
          source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, geometry
        )
        SELECT 
          id, app_uuid, original_trail_uuid, osm_id, name, trail_type, surface, difficulty,
          source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, geometry
        FROM deduplicated_trails
      `);
            const result = await client.query(`
        SELECT COUNT(*) as deduplicated_count FROM ${this.stagingSchema}.trails
      `);
            const deduplicatedCount = parseInt(result.rows[0].deduplicated_count);
            console.log(`✅ Deduplicated trails: ${deduplicatedCount} unique trails remaining`);
            return { success: true };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Identify loop trails (self-intersecting geometries)
     */
    async identifyLoopTrails(client) {
        try {
            // Create loop trails table
            await client.query(`
        DROP TABLE IF EXISTS ${this.stagingSchema}.loop_trails;
        CREATE TABLE ${this.stagingSchema}.loop_trails AS
        SELECT 
          app_uuid,
          name,
          geometry,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          trail_type,
          surface,
          difficulty,
          source_tags,
          osm_id,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          source
        FROM ${this.stagingSchema}.trails
        WHERE (
          NOT ST_IsSimple(ST_Force2D(geometry))  -- Use 2D geometry for loop detection
          OR ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) < 10  -- Start/end points within 10 meters
        )
          AND ST_IsValid(geometry)
          AND geometry IS NOT NULL
      `);
            const result = await client.query(`
        SELECT COUNT(*) as loop_count FROM ${this.stagingSchema}.loop_trails
      `);
            const loopCount = parseInt(result.rows[0].loop_count);
            console.log(`✅ Identified ${loopCount} loop trails`);
            return { success: true, loopCount };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Find intersection points between loop trails and other trails
     */
    async findLoopIntersections(client) {
        try {
            // Create intersection points table
            await client.query(`
        DROP TABLE IF EXISTS ${this.stagingSchema}.loop_intersections;
        CREATE TABLE ${this.stagingSchema}.loop_intersections (
          loop_uuid UUID,
          other_trail_uuid UUID,
          intersection_point GEOMETRY(POINT, 4326),
          intersection_point_3d GEOMETRY(POINTZ, 4326),
          loop_name TEXT,
          other_trail_name TEXT,
          distance_meters DOUBLE PRECISION
        )
      `);
            // Find intersections between loops and other trails
            await client.query(`
        INSERT INTO ${this.stagingSchema}.loop_intersections (
          loop_uuid, other_trail_uuid, intersection_point, intersection_point_3d,
          loop_name, other_trail_name, distance_meters
        )
        SELECT DISTINCT
          lt.app_uuid as loop_uuid,
          t.app_uuid as other_trail_uuid,
          ST_Force2D(ST_Centroid(ST_Intersection(ST_Force2D(lt.geometry), ST_Force2D(t.geometry)))) as intersection_point,
          ST_Force3D(ST_Centroid(ST_Intersection(lt.geometry, t.geometry))) as intersection_point_3d,
          lt.name as loop_name,
          t.name as other_trail_name,
          ST_Distance(lt.geometry::geography, t.geometry::geography) as distance_meters
        FROM ${this.stagingSchema}.loop_trails lt
        JOIN ${this.stagingSchema}.trails t ON lt.app_uuid != t.app_uuid
        WHERE ST_Intersects(ST_Force2D(lt.geometry), ST_Force2D(t.geometry))  -- Use 2D for intersection detection
          AND ST_GeometryType(ST_Intersection(ST_Force2D(lt.geometry), ST_Force2D(t.geometry))) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Distance(lt.geometry::geography, t.geometry::geography) <= $1
          AND ST_Length(lt.geometry::geography) > 5
          AND ST_Length(t.geometry::geography) > 5
      `, [this.intersectionTolerance]);
            const result = await client.query(`
        SELECT COUNT(*) as intersection_count FROM ${this.stagingSchema}.loop_intersections
      `);
            const intersectionCount = parseInt(result.rows[0].intersection_count);
            console.log(`✅ Found ${intersectionCount} intersection points between loops and other trails`);
            return { success: true, intersectionPoints: intersectionCount };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Find apex points for loops that only intersect once
     */
    async findLoopApexPoints(client) {
        try {
            // Create apex points table
            await client.query(`
        DROP TABLE IF EXISTS ${this.stagingSchema}.loop_apex_points;
        CREATE TABLE ${this.stagingSchema}.loop_apex_points (
          loop_uuid UUID,
          apex_point GEOMETRY(POINT, 4326),
          apex_point_3d GEOMETRY(POINTZ, 4326),
          loop_name TEXT,
          intersection_count INTEGER
        )
      `);
            // Find apex points for loops that only intersect once
            await client.query(`
        INSERT INTO ${this.stagingSchema}.loop_apex_points (
          loop_uuid, apex_point, apex_point_3d, loop_name, intersection_count
        )
        WITH loop_intersection_counts AS (
          SELECT 
            loop_uuid,
            COUNT(*) as intersection_count
          FROM ${this.stagingSchema}.loop_intersections
          GROUP BY loop_uuid
        ),
        single_intersection_loops AS (
          SELECT 
            lic.loop_uuid,
            lic.intersection_count,
            lt.name as loop_name,
            lt.geometry as loop_geometry
          FROM loop_intersection_counts lic
          JOIN ${this.stagingSchema}.loop_trails lt ON lic.loop_uuid = lt.app_uuid
          WHERE lic.intersection_count = 1
        )
        SELECT 
          sil.loop_uuid,
          ST_PointOnSurface(ST_Force2D(sil.loop_geometry)) as apex_point,
          ST_Force3D(ST_PointOnSurface(sil.loop_geometry)) as apex_point_3d,
          sil.loop_name,
          sil.intersection_count
        FROM single_intersection_loops sil
      `);
            const result = await client.query(`
        SELECT COUNT(*) as apex_count FROM ${this.stagingSchema}.loop_apex_points
      `);
            const apexCount = parseInt(result.rows[0].apex_count);
            console.log(`✅ Found ${apexCount} apex points for single-intersection loops`);
            return { success: true, apexPoints: apexCount };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Split loops at both intersection and apex points
     */
    async splitLoopsAtPoints(client) {
        try {
            // Create split segments table
            await client.query(`
        DROP TABLE IF EXISTS ${this.stagingSchema}.loop_split_segments;
        CREATE TABLE ${this.stagingSchema}.loop_split_segments (
          id SERIAL PRIMARY KEY,
          original_loop_uuid UUID,
          segment_number INTEGER,
          segment_name TEXT,
          geometry GEOMETRY(LINESTRING, 4326),
          geometry_3d GEOMETRY(LINESTRINGZ, 4326),
          length_km DOUBLE PRECISION,
          elevation_gain DOUBLE PRECISION,
          elevation_loss DOUBLE PRECISION,
          max_elevation DOUBLE PRECISION,
          min_elevation DOUBLE PRECISION,
          avg_elevation DOUBLE PRECISION,
          trail_type TEXT,
          surface TEXT,
          difficulty TEXT,
          source_tags TEXT,
          osm_id TEXT,
          bbox_min_lng DOUBLE PRECISION,
          bbox_max_lng DOUBLE PRECISION,
          bbox_min_lat DOUBLE PRECISION,
          bbox_max_lat DOUBLE PRECISION,
          split_type TEXT
        )
      `);
            // Split loops using geometric apex method - simpler and more reliable
            await client.query(`
        INSERT INTO ${this.stagingSchema}.loop_split_segments (
          original_loop_uuid, segment_number, segment_name, geometry, geometry_3d,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          trail_type, surface, difficulty, source_tags, osm_id,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, split_type
        )
        WITH loop_apex_split AS (
          -- For each loop trail, find the geometric apex (farthest point from start)
          SELECT 
            lt.app_uuid as original_loop_uuid,
            lt.name as original_name,
            lt.geometry as original_geometry_3d,
            -- Find the vertex that's farthest from the start point (geometric apex)
            (
              SELECT pt
              FROM (
                SELECT 
                  (ST_DumpPoints(lt.geometry)).geom as pt,
                  ST_Distance((ST_DumpPoints(lt.geometry)).geom, ST_StartPoint(lt.geometry)) as dist
              ) vertices
              ORDER BY dist DESC
              LIMIT 1
            ) as apex_point,
            lt.length_km,
            lt.elevation_gain,
            lt.elevation_loss,
            lt.max_elevation,
            lt.min_elevation,
            lt.avg_elevation,
            lt.trail_type,
            lt.surface,
            lt.difficulty,
            lt.source_tags,
            lt.osm_id,
            lt.bbox_min_lng,
            lt.bbox_max_lng,
            lt.bbox_min_lat,
            lt.bbox_max_lat
          FROM ${this.stagingSchema}.loop_trails lt
        ),
        split_geometries AS (
          -- Split each loop at its apex point
          SELECT 
            las.original_loop_uuid,
            las.original_name,
            las.original_geometry_3d,
            las.apex_point,
            -- Split the loop at the apex point using ST_Split
            ST_Split(las.original_geometry_3d, las.apex_point) as split_geom,
            las.length_km,
            las.elevation_gain,
            las.elevation_loss,
            las.max_elevation,
            las.min_elevation,
            las.avg_elevation,
            las.trail_type,
            las.surface,
            las.difficulty,
            las.source_tags,
            las.osm_id,
            las.bbox_min_lng,
            las.bbox_max_lng,
            las.bbox_min_lat,
            las.bbox_max_lat
          FROM loop_apex_split las
          WHERE las.apex_point IS NOT NULL
        ),
        split_segments AS (
          -- Dump the split geometry into individual LineString segments
          SELECT 
            sg.original_loop_uuid,
            ROW_NUMBER() OVER (PARTITION BY sg.original_loop_uuid ORDER BY ST_Length((ST_Dump(sg.split_geom)).geom) DESC) as segment_number,
            sg.original_name as segment_name,
            (ST_Dump(sg.split_geom)).geom as segment_geometry,
            sg.length_km,
            sg.elevation_gain,
            sg.elevation_loss,
            sg.max_elevation,
            sg.min_elevation,
            sg.avg_elevation,
            sg.trail_type,
            sg.surface,
            sg.difficulty,
            sg.source_tags,
            sg.osm_id,
            sg.bbox_min_lng,
            sg.bbox_max_lng,
            sg.bbox_min_lat,
            sg.bbox_max_lat
          FROM split_geometries sg
        )
        SELECT 
          original_loop_uuid,
          segment_number,
          segment_name,
          ST_Force2D(segment_geometry) as geometry,
          ST_Force3D(segment_geometry) as geometry_3d,
          ST_Length(segment_geometry::geography) / 1000 as length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          trail_type,
          surface,
          difficulty,
          source_tags,
          osm_id,
          ST_XMin(segment_geometry) as bbox_min_lng,
          ST_XMax(segment_geometry) as bbox_max_lng,
          ST_YMin(segment_geometry) as bbox_min_lat,
          ST_YMax(segment_geometry) as bbox_max_lat,
          'apex' as split_type
        FROM split_segments
        WHERE ST_GeometryType(segment_geometry) = 'ST_LineString'
          AND ST_Length(segment_geometry::geography) > 5  -- Filter out very short segments
      `);
            const result = await client.query(`
        SELECT COUNT(*) as segment_count FROM ${this.stagingSchema}.loop_split_segments
      `);
            const segmentCount = parseInt(result.rows[0].segment_count);
            console.log(`✅ Created ${segmentCount} split segments from loop trails`);
            return { success: true, splitSegments: segmentCount };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Replace loop trails with split segments in the main trails table
     * This method now properly handles the original_trail_uuid field and uses a single atomic operation
     */
    async replaceLoopTrailsWithSegments(client) {
        try {
            console.log('🔄 Replacing loop trails with split segments...');
            // First, ensure the original_trail_uuid column exists in the trails table
            await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = '${this.stagingSchema}' 
            AND table_name = 'trails' 
            AND column_name = 'original_trail_uuid'
          ) THEN
            ALTER TABLE ${this.stagingSchema}.trails ADD COLUMN original_trail_uuid TEXT;
          END IF;
        END $$;
      `);
            // Perform the replacement in a single atomic operation
            // This ensures that we insert the split segments with proper original_trail_uuid references
            // and then delete the original loop trails, all within the same transaction
            const replaceSql = `
        WITH inserted_segments AS (
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, original_trail_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
            max_elevation, min_elevation, avg_elevation, trail_type, surface, difficulty,
            source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
          )
          SELECT 
            gen_random_uuid() as app_uuid,  -- Generate unique UUID for each segment
            original_loop_uuid as original_trail_uuid,  -- Set to the actual loop trail's app_uuid
            segment_name as name,
            ST_Force3D(geometry) as geometry,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            trail_type,
            surface,
            difficulty,
            source_tags::JSONB,
            osm_id,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat
          FROM ${this.stagingSchema}.loop_split_segments
          RETURNING app_uuid, original_trail_uuid
        ),
        deleted_originals AS (
          -- Delete the original parent trails that were split
          DELETE FROM ${this.stagingSchema}.trails 
          WHERE app_uuid IN (
            SELECT original_loop_uuid FROM ${this.stagingSchema}.loop_split_segments
          )
          RETURNING app_uuid
        )
        SELECT COUNT(*) as inserted_count FROM inserted_segments;
      `;
            const result = await client.query(replaceSql);
            const insertedCount = parseInt(result.rows[0].inserted_count);
            console.log(`✅ Replaced loop trails with ${insertedCount} split segments`);
            return { success: true, splitSegments: insertedCount };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Get statistics about loop splitting
     */
    async getLoopSplittingStats() {
        try {
            const stats = await this.pgClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM ${this.stagingSchema}.loop_trails) as loop_count,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.loop_intersections) as intersection_count,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.loop_apex_points) as apex_count,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.loop_split_segments) as segment_count,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.trails WHERE app_uuid LIKE '%_segment_%') as replaced_count
      `);
            return stats.rows[0];
        }
        catch (error) {
            console.error('❌ Failed to get loop splitting stats:', error);
            return null;
        }
    }
}
exports.LoopSplittingHelpers = LoopSplittingHelpers;
function createLoopSplittingHelpers(stagingSchema, pgClient, intersectionTolerance) {
    return new LoopSplittingHelpers({
        stagingSchema,
        pgClient,
        intersectionTolerance
    });
}
//# sourceMappingURL=loop-splitting-helpers.js.map