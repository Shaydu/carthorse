"use strict";
// Helper for region data copy and validation SQL
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_BBOX_CONFIGS = void 0;
exports.getTestBbox = getTestBbox;
exports.getRegionDataCopySql = getRegionDataCopySql;
exports.validateRegionExistsSql = validateRegionExistsSql;
// Predefined bbox configurations for testing
exports.TEST_BBOX_CONFIGS = {
    boulder: {
        small: [-105.28932, 39.99233, -105.282906, 39.99881], // ~0.26 sq miles, ~10 trails
        medium: [-105.295, 39.99, -105.275, 40.01], // ~2.5 sq miles, ~33 trails  
        hogback_expanded: [-105.32, 40.04, -105.27, 40.10], // Expanded area around Hogback Ridge Trail (~8 trails)
        full: undefined // No bbox filter - entire region
    },
    seattle: {
        small: [-122.20, 47.55, -122.15, 47.60], // Small area in Seattle (~33 trails)
        medium: [-122.40, 47.55, -122.25, 47.70], // Medium area in Seattle
        full: undefined // No bbox filter - entire region
    }
};
function getTestBbox(region, size = 'full') {
    // Allow override via environment variable
    const envSize = process.env.CARTHORSE_TEST_BBOX_SIZE;
    const finalSize = envSize || size;
    const config = exports.TEST_BBOX_CONFIGS[region];
    if (!config) {
        console.warn(`No bbox config found for region: ${region}, using full region`);
        return undefined;
    }
    console.log(`🗺️ Using ${finalSize} bbox for region ${region}`);
    const bbox = config[finalSize];
    return bbox ? [...bbox] : undefined;
}
function getRegionDataCopySql(schemaName, region, bbox) {
    let sql = `
    INSERT INTO ${schemaName}.trails (
      app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
      elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      source, region, geometry, geometry_text, geometry_hash
    )
    SELECT 
      app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
      elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      source, region, geometry, 
      COALESCE(ST_AsText(geometry), '') as geometry_text,
      COALESCE(md5(ST_AsText(geometry)), md5('')) as geometry_hash
    FROM trails 
    WHERE region = $1 AND geometry IS NOT NULL
  `;
    // Add bbox filter if provided
    if (bbox) {
        sql += ` AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))`;
    }
    const params = [region];
    if (bbox) {
        params.push(...bbox);
    }
    return { sql, params };
}
function validateRegionExistsSql() {
    return `SELECT COUNT(*) as count FROM trails WHERE region = $1`;
}
//# sourceMappingURL=region-data.js.map