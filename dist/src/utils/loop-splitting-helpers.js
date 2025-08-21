"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoopSplittingHelpers = void 0;
exports.createLoopSplittingHelpers = createLoopSplittingHelpers;
class LoopSplittingHelpers {
    constructor(config) {
        this.stagingSchema = config.stagingSchema;
        this.pgClient = config.pgClient;
        this.intersectionTolerance = config.intersectionTolerance ?? 2.0;
    }
    /**
     * Intelligently split loop trails at intersections and apex points
     * This method now properly handles database transactions and original_trail_uuid relationships
     */
    async splitLoopTrails() {
        // Get a dedicated client for transaction management
        const client = await this.pgClient.connect();
        try {
            console.log('🔄 Starting intelligent loop trail splitting...');
            // Start transaction
            await client.query('BEGIN');
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
          region,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          created_at,
          updated_at
        FROM ${this.stagingSchema}.trails
        WHERE NOT ST_IsSimple(geometry) 
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
          loop_uuid TEXT,
          other_trail_uuid TEXT,
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
          ST_Force2D(ST_Centroid(ST_Intersection(lt.geometry, t.geometry))) as intersection_point,
          ST_Force3D(ST_Centroid(ST_Intersection(lt.geometry, t.geometry))) as intersection_point_3d,
          lt.name as loop_name,
          t.name as other_trail_name,
          ST_Distance(lt.geometry::geography, t.geometry::geography) as distance_meters
        FROM ${this.stagingSchema}.loop_trails lt
        JOIN ${this.stagingSchema}.trails t ON lt.app_uuid != t.app_uuid
        WHERE ST_Intersects(lt.geometry, t.geometry)
          AND ST_GeometryType(ST_Intersection(lt.geometry, t.geometry)) IN ('ST_Point', 'ST_MultiPoint')
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
          loop_uuid TEXT,
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
          ST_PointOnSurface(sil.loop_geometry) as apex_point,
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
          original_loop_uuid TEXT,
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
          source_tags JSONB,
          osm_id TEXT,
          region TEXT,
          bbox_min_lng DOUBLE PRECISION,
          bbox_max_lng DOUBLE PRECISION,
          bbox_min_lat DOUBLE PRECISION,
          bbox_max_lat DOUBLE PRECISION,
          split_type TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
            // Split loops at intersection points
            await client.query(`
        INSERT INTO ${this.stagingSchema}.loop_split_segments (
          original_loop_uuid, segment_number, segment_name, geometry, geometry_3d,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          trail_type, surface, difficulty, source_tags, osm_id, region,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, split_type
        )
        WITH intersection_split_points AS (
          SELECT 
            loop_uuid,
            intersection_point,
            'intersection' as split_type
          FROM ${this.stagingSchema}.loop_intersections
        ),
        apex_split_points AS (
          SELECT 
            loop_uuid,
            apex_point as intersection_point,
            'apex' as split_type
          FROM ${this.stagingSchema}.loop_apex_points
        ),
        all_split_points AS (
          SELECT * FROM intersection_split_points
          UNION ALL
          SELECT * FROM apex_split_points
        ),
        split_segments AS (
          SELECT 
            lt.app_uuid as original_loop_uuid,
            lt.name as original_name,
            lt.geometry as original_geometry,
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
            lt.region,
            lt.bbox_min_lng,
            lt.bbox_max_lng,
            lt.bbox_min_lat,
            lt.bbox_max_lat,
            dumped.geom as segment_geometry,
            dumped.path[1] as segment_order,
            sp.split_type
          FROM ${this.stagingSchema}.loop_trails lt
          JOIN all_split_points sp ON lt.app_uuid = sp.loop_uuid
          CROSS JOIN LATERAL ST_Dump(ST_Split(lt.geometry, sp.intersection_point)) as dumped
        )
        SELECT 
          original_loop_uuid,
          segment_order as segment_number,
          original_name || ' (Segment ' || segment_order || ')' as segment_name,
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
          region,
          ST_XMin(segment_geometry) as bbox_min_lng,
          ST_XMax(segment_geometry) as bbox_max_lng,
          ST_YMin(segment_geometry) as bbox_min_lat,
          ST_YMax(segment_geometry) as bbox_max_lat,
          split_type
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
            WHERE table_schema = $1 
            AND table_name = 'trails' 
            AND column_name = 'original_trail_uuid'
          ) THEN
            ALTER TABLE ${this.stagingSchema}.trails ADD COLUMN original_trail_uuid TEXT;
          END IF;
        END $$;
      `, [this.stagingSchema]);
            // Perform the replacement in a single atomic operation
            // This ensures that we insert the split segments with proper original_trail_uuid references
            // and then delete the original loop trails, all within the same transaction
            const replaceSql = `
        WITH inserted_segments AS (
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, original_trail_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
            max_elevation, min_elevation, avg_elevation, trail_type, surface, difficulty,
            source_tags, osm_id, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
          )
          SELECT 
            original_loop_uuid || '_segment_' || segment_number as app_uuid,
            original_loop_uuid as original_trail_uuid,  -- Set the parent trail UUID
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
            source_tags,
            osm_id,
            region,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat
          FROM ${this.stagingSchema}.loop_split_segments
          RETURNING app_uuid, original_trail_uuid
        ),
        deleted_originals AS (
          DELETE FROM ${this.stagingSchema}.trails 
          WHERE app_uuid IN (
            SELECT DISTINCT original_trail_uuid 
            FROM inserted_segments 
            WHERE original_trail_uuid IS NOT NULL
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
     * Replace loop trails with split segments in the main trails table
     * @deprecated Use replaceLoopTrailsWithSegments(client) instead for proper transaction handling
     */
    async replaceLoopTrailsWithSegments() {
        console.warn('⚠️ This method is deprecated. Use splitLoopTrails() for proper transaction handling.');
        try {
            console.log('🔄 Replacing loop trails with split segments...');
            // Remove original loop trails
            await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE app_uuid IN (SELECT app_uuid FROM ${this.stagingSchema}.loop_trails)
      `);
            // Insert split segments as new trails, forcing geometry to 3D
            await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation, trail_type, surface, difficulty,
          source_tags, osm_id, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        )
        SELECT 
          original_loop_uuid || '_segment_' || segment_number as app_uuid,
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
          source_tags,
          osm_id,
          region,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat
        FROM ${this.stagingSchema}.loop_split_segments
      `);
            const result = await this.pgClient.query(`
        SELECT COUNT(*) as replaced_count FROM ${this.stagingSchema}.trails 
        WHERE app_uuid LIKE '%_segment_%'
      `);
            const replacedCount = parseInt(result.rows[0].replaced_count);
            console.log(`✅ Replaced loop trails with ${replacedCount} split segments`);
            return { success: true, splitSegments: replacedCount };
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