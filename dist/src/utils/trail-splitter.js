"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrailSplitter = void 0;
class TrailSplitter {
    constructor(pgClient, stagingSchema, config) {
        this.pgClient = pgClient;
        this.stagingSchema = stagingSchema;
        this.config = config;
    }
    /**
     * Perform comprehensive trail splitting at intersections
     */
    async splitTrails(sourceQuery, params) {
        console.log('🔍 Starting trail splitting...');
        // Step 1: Create temporary table for original trails
        console.log('🔄 Creating temporary table for original trails...');
        await this.pgClient.query(`
      CREATE TEMP TABLE temp_original_trails AS
      SELECT * FROM (${sourceQuery}) as source_trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
        const originalCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM temp_original_trails`);
        const originalCount = parseInt(originalCountResult.rows[0].count);
        console.log(`✅ Created temporary table with ${originalCount} original trails`);
        // Step 2: Delete original trails from staging schema
        console.log('🗑️ Deleting original trails...');
        await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.trails`);
        console.log('✅ Deleted original trails');
        // Step 3: Simple splitting using PostGIS functions
        console.log('🔄 Splitting trails at intersections...');
        const splitSql = `
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, name, region, trail_type, surface, difficulty,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry
      )
      WITH split_segments AS (
        SELECT 
          t.id,
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
          -- Generate unique app_uuid for each segment
          CASE 
            WHEN t.app_uuid IS NULL THEN 'unknown-' || t.id || '-' || ROW_NUMBER() OVER (ORDER BY t.id)
            ELSE t.app_uuid || '-' || ROW_NUMBER() OVER (PARTITION BY t.app_uuid ORDER BY t.id)
          END as app_uuid,
          -- Split geometry at nodes (intersections)
          dumped.geom as geometry
        FROM temp_original_trails t,
        LATERAL ST_Dump(ST_Node(t.geometry)) as dumped
        WHERE ST_IsValid(dumped.geom) 
          AND dumped.geom IS NOT NULL
          AND ST_NumPoints(dumped.geom) >= 2
          AND ST_Length(dumped.geom::geography) >= ${this.config.minTrailLengthMeters}
      )
      SELECT
        app_uuid,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        ST_XMin(geometry) as bbox_min_lng,
        ST_XMax(geometry) as bbox_max_lng,
        ST_YMin(geometry) as bbox_min_lat,
        ST_YMax(geometry) as bbox_max_lat,
        ST_Length(geometry::geography) / 1000.0 as length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        geometry
      FROM split_segments
    `;
        const splitResult = await this.pgClient.query(splitSql, []);
        const splitCount = splitResult.rowCount || 0;
        console.log(`✅ Splitting complete: ${splitCount} segments created`);
        // Step 4: Recreate spatial index
        console.log('🔧 Recreating spatial index...');
        await this.pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.stagingSchema}_trails_geometry 
      ON ${this.stagingSchema}.trails USING GIST (geometry)
    `);
        console.log('✅ Spatial index recreated');
        // Step 5: Calculate statistics
        const finalCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.trails`);
        const remainingIntersections = await this.pgClient.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
    `);
        // Clean up
        await this.pgClient.query(`DROP TABLE IF EXISTS temp_original_trails`);
        console.log(`📊 Final stats: ${finalCount.rows[0].count} segments, ${remainingIntersections.rows[0].intersection_count} remaining intersections`);
        return {
            iterations: 1,
            finalSegmentCount: parseInt(finalCount.rows[0].count),
            intersectionCount: parseInt(remainingIntersections.rows[0].intersection_count)
        };
    }
    /**
     * Check if there are any intersections between trails
     */
    async hasIntersections() {
        const lengthFilter = this.config.minTrailLengthMeters > 0 ?
            `AND ST_Length(t1.geometry::geography) > ${this.config.minTrailLengthMeters}
       AND ST_Length(t2.geometry::geography) > ${this.config.minTrailLengthMeters}` : '';
        const result = await this.pgClient.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        ${lengthFilter}
    `);
        return parseInt(result.rows[0].intersection_count) > 0;
    }
    /**
     * Get statistics about the current trail network
     */
    async getStatistics() {
        const statsResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        AVG(ST_Length(geometry::geography)) as avg_length,
        COUNT(*) FILTER (WHERE ST_Length(geometry::geography) > 0) as valid_trails
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
        const lengthFilter = this.config.minTrailLengthMeters > 0 ?
            `AND ST_Length(t1.geometry::geography) > ${this.config.minTrailLengthMeters}
       AND ST_Length(t2.geometry::geography) > ${this.config.minTrailLengthMeters}` : '';
        const intersectionResult = await this.pgClient.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        ${lengthFilter}
    `);
        return {
            totalTrails: parseInt(statsResult.rows[0].total_trails),
            intersectionCount: parseInt(intersectionResult.rows[0].intersection_count),
            averageTrailLength: parseFloat(statsResult.rows[0].avg_length) || 0
        };
    }
}
exports.TrailSplitter = TrailSplitter;
//# sourceMappingURL=trail-splitter.js.map