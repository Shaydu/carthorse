"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStagingSchemaSql = getStagingSchemaSql;
exports.getStagingIndexesSql = getStagingIndexesSql;
exports.getRouteRecommendationsTableSql = getRouteRecommendationsTableSql;
exports.getRouteTrailsTableSql = getRouteTrailsTableSql;
exports.getSchemaQualifiedPostgisFunctionsSql = getSchemaQualifiedPostgisFunctionsSql;
exports.getSpatialOptimizationFunctionsSql = getSpatialOptimizationFunctionsSql;
const spatial_optimization_1 = require("./spatial-optimization");
function getStagingSchemaSql(schemaName) {
    const dropTablesSql = [
        'trails',
        'trail_hashes',
        'trail_id_mapping',
        'intersection_points',
        'route_recommendations'
    ].map(table => `DROP TABLE IF EXISTS ${schemaName}.${table} CASCADE;`).join('\n');
    return `
    ${dropTablesSql}
    
    -- Staging trails table
    CREATE TABLE ${schemaName}.trails (
      id SERIAL PRIMARY KEY,
      app_uuid TEXT UNIQUE NOT NULL,
      osm_id TEXT,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      trail_type TEXT,
      surface TEXT,
      difficulty TEXT,
      source_tags JSONB,
      bbox_min_lng REAL,
      bbox_max_lng REAL,
      bbox_min_lat REAL,
      bbox_max_lat REAL,
      length_km REAL,
      elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
      elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
      max_elevation REAL,
      min_elevation REAL,
      avg_elevation REAL,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      geometry GEOMETRY(LINESTRINGZ, 4326),
      CONSTRAINT ${schemaName}_trails_3d_geometry CHECK (ST_NDims(geometry) = 3),
      CONSTRAINT ${schemaName}_trails_valid_geometry CHECK (ST_IsValid(geometry))
    );

    -- Trail hash cache table (uses app_uuid instead of foreign key to avoid drop issues)
    CREATE TABLE ${schemaName}.trail_hashes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_uuid TEXT NOT NULL, -- Changed from trail_id INTEGER to app_uuid TEXT
      geometry_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Trail ID mapping table (UUID ↔ Integer ID lookup for pgRouting boundary)
    CREATE TABLE ${schemaName}.trail_id_mapping (
      id SERIAL PRIMARY KEY,
      app_uuid TEXT UNIQUE NOT NULL, -- Original trail UUID
      trail_id INTEGER UNIQUE NOT NULL, -- pgRouting integer ID
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Intersection points table
    CREATE TABLE ${schemaName}.intersection_points (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      point GEOMETRY(POINT, 4326),
      point_3d GEOMETRY(POINTZ, 4326),
      connected_trail_ids TEXT[],
      connected_trail_names TEXT[],
      node_type TEXT,
      distance_meters REAL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Route recommendations table
    CREATE TABLE ${schemaName}.route_recommendations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      route_uuid TEXT UNIQUE NOT NULL,
      region TEXT NOT NULL,
      input_length_km REAL CHECK(input_length_km > 0),
      input_elevation_gain REAL,
      recommended_length_km REAL CHECK(recommended_length_km > 0),
      recommended_elevation_gain REAL,
      route_type TEXT,
      route_shape TEXT,
      trail_count INTEGER,
      route_score REAL,
      similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
      route_path JSONB,
      route_edges JSONB,
      route_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Route trails table (for trail composition of routes)
    CREATE TABLE ${schemaName}.route_trails (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      route_uuid TEXT NOT NULL,
      trail_id TEXT NOT NULL,
      trail_name TEXT NOT NULL,
      segment_order INTEGER NOT NULL,
      segment_distance_km REAL CHECK(segment_distance_km > 0),
      segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
      segment_elevation_loss REAL CHECK(segment_elevation_loss >= 0),
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- =============================================================================
    -- CORE SPATIAL INDEXES FOR PERFORMANCE
    -- =============================================================================
    -- Primary spatial index for trail geometries
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_geometry_gist 
    ON ${schemaName}.trails USING GIST(geometry);
    
    -- Spatial index for intersection points
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_intersection_points_gist 
    ON ${schemaName}.intersection_points USING GIST(point);
    
    -- =============================================================================
    -- COMPOSITE INDEXES FOR COMMON QUERY PATTERNS
    -- =============================================================================
    -- Route recommendations indexes
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_recommendations_region 
    ON ${schemaName}.route_recommendations(region);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_recommendations_score 
    ON ${schemaName}.route_recommendations(route_score);
    
    -- Trail filtering indexes
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_region_source 
    ON ${schemaName}.trails(region, source) WHERE region IS NOT NULL;
    
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_length_valid 
    ON ${schemaName}.trails USING btree (ST_Length(geometry::geography)) 
    WHERE ST_IsValid(geometry);
    
    -- Bounding box composite index for spatial filtering
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_bbox_composite 
    ON ${schemaName}.trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat) 
    WHERE bbox_min_lng IS NOT NULL;
    
    -- =============================================================================
    -- ADVANCED SPATIAL OPTIMIZATION INDEXES
    -- =============================================================================
    -- These indexes solve O(n²) CROSS JOIN performance issues in carthorse
    -- Expected Performance Gains:
    -- - 80-90% reduction in expensive spatial calculations
    -- - 10-50x faster spatial queries with proper indexing
    -- - 95%+ reduction in cross-join comparisons
    
    -- Index on trail start points for endpoint-to-endpoint distance calculations
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_start_points 
    ON ${schemaName}.trails USING GIST (ST_StartPoint(geometry));

    -- Index on trail end points for endpoint-to-endpoint distance calculations  
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_end_points 
    ON ${schemaName}.trails USING GIST (ST_EndPoint(geometry));

    -- Index on trail bounding boxes for fast intersection pre-filtering
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_envelope 
    ON ${schemaName}.trails USING GIST (ST_Envelope(geometry));
    
    -- Index for 3D geometry operations (elevation-aware queries)
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_3d_geometry 
    ON ${schemaName}.trails USING GIST (geometry) 
    WHERE ST_NDims(geometry) = 3;
  `;
}
function getStagingIndexesSql(schemaName) {
    return `
    -- Additional indexes for specific use cases
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_osm_id ON ${schemaName}.trails(osm_id);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_app_uuid ON ${schemaName}.trails(app_uuid);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_name ON ${schemaName}.trails(name);
    
    -- Indexes for trail_hashes table
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trail_hashes_app_uuid ON ${schemaName}.trail_hashes(app_uuid);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trail_hashes_geometry_hash ON ${schemaName}.trail_hashes(geometry_hash);
    
    -- Indexes for trail_id_mapping table
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trail_id_mapping_app_uuid ON ${schemaName}.trail_id_mapping(app_uuid);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trail_id_mapping_trail_id ON ${schemaName}.trail_id_mapping(trail_id);
    
    -- Indexes for route_trails table
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_trails_route_uuid ON ${schemaName}.route_trails(route_uuid);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_trails_trail_id ON ${schemaName}.route_trails(trail_id);
  `;
}
function getRouteRecommendationsTableSql(schemaName) {
    return `
    CREATE TABLE IF NOT EXISTS ${schemaName}.route_recommendations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      route_uuid TEXT UNIQUE NOT NULL,
      region TEXT NOT NULL,
      input_length_km REAL CHECK(input_length_km > 0),
      input_elevation_gain REAL,
      recommended_length_km REAL CHECK(recommended_length_km > 0),
      recommended_elevation_gain REAL,
      route_elevation_loss REAL,
      route_type TEXT,
      route_shape TEXT,
      trail_count INTEGER,
      route_trail_count INTEGER,
      route_gain_rate REAL,
      route_max_elevation REAL,
      route_min_elevation REAL,
      route_avg_elevation REAL,
      route_difficulty TEXT,
      route_estimated_time_hours REAL,
      route_connectivity_score REAL,
      route_score REAL,
      similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
      route_path JSONB,
      route_edges JSONB,
      input_distance_tolerance REAL,
      input_elevation_tolerance REAL,
      expires_at TIMESTAMP,
      usage_count INTEGER,
      complete_route_data JSONB,
      trail_connectivity_data JSONB,
      request_hash TEXT,
      route_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
}
function getRouteTrailsTableSql(schemaName) {
    return `
    CREATE TABLE IF NOT EXISTS ${schemaName}.route_trails (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      route_uuid TEXT NOT NULL,
      trail_id TEXT NOT NULL,
      trail_name TEXT NOT NULL,
      segment_order INTEGER NOT NULL,
      segment_distance_km REAL CHECK(segment_distance_km > 0),
      segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
      segment_elevation_loss REAL CHECK(segment_elevation_loss >= 0),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
}
function getSchemaQualifiedPostgisFunctionsSql(schemaName, functionsSql) {
    return functionsSql
        // Rewrite all function definitions to use the staging schema (including those explicitly in public schema)
        .replace(/CREATE OR REPLACE FUNCTION public\.detect_trail_intersections/g, `CREATE OR REPLACE FUNCTION ${schemaName}.detect_trail_intersections`)
        .replace(/CREATE OR REPLACE FUNCTION public\.build_routing_nodes/g, `CREATE OR REPLACE FUNCTION ${schemaName}.build_routing_nodes`)
        .replace(/CREATE OR REPLACE FUNCTION public\.build_routing_edges/g, `CREATE OR REPLACE FUNCTION ${schemaName}.build_routing_edges`)
        .replace(/CREATE OR REPLACE FUNCTION public\.get_intersection_stats/g, `CREATE OR REPLACE FUNCTION ${schemaName}.get_intersection_stats`)
        .replace(/CREATE OR REPLACE FUNCTION public\.validate_intersection_detection/g, `CREATE OR REPLACE FUNCTION ${schemaName}.validate_intersection_detection`)
        .replace(/CREATE OR REPLACE FUNCTION public\.validate_spatial_data_integrity/g, `CREATE OR REPLACE FUNCTION ${schemaName}.validate_spatial_data_integrity`)
        // Also handle functions without explicit schema (default to public)
        .replace(/CREATE OR REPLACE FUNCTION detect_trail_intersections/g, `CREATE OR REPLACE FUNCTION ${schemaName}.detect_trail_intersections`)
        .replace(/CREATE OR REPLACE FUNCTION build_routing_nodes/g, `CREATE OR REPLACE FUNCTION ${schemaName}.build_routing_nodes`)
        .replace(/CREATE OR REPLACE FUNCTION build_routing_edges/g, `CREATE OR REPLACE FUNCTION ${schemaName}.build_routing_edges`)
        .replace(/CREATE OR REPLACE FUNCTION get_intersection_stats/g, `CREATE OR REPLACE FUNCTION ${schemaName}.get_intersection_stats`)
        .replace(/CREATE OR REPLACE FUNCTION validate_intersection_detection/g, `CREATE OR REPLACE FUNCTION ${schemaName}.validate_intersection_detection`)
        .replace(/CREATE OR REPLACE FUNCTION validate_spatial_data_integrity/g, `CREATE OR REPLACE FUNCTION ${schemaName}.validate_spatial_data_integrity`)
        // Also replace any references to public schema functions within the function bodies
        .replace(/public\.detect_trail_intersections\(/g, `${schemaName}.detect_trail_intersections(`)
        .replace(/public\.build_routing_nodes\(/g, `${schemaName}.build_routing_nodes(`)
        .replace(/public\.build_routing_edges\(/g, `${schemaName}.build_routing_edges(`)
        .replace(/public\.get_intersection_stats\(/g, `${schemaName}.get_intersection_stats(`)
        .replace(/public\.validate_intersection_detection\(/g, `${schemaName}.validate_intersection_detection(`)
        .replace(/public\.validate_spatial_data_integrity\(/g, `${schemaName}.validate_spatial_data_integrity(`)
        // Also replace unqualified function calls within function bodies
        .replace(/detect_trail_intersections\(/g, `${schemaName}.detect_trail_intersections(`)
        .replace(/build_routing_nodes\(/g, `${schemaName}.build_routing_nodes(`)
        .replace(/build_routing_edges\(/g, `${schemaName}.build_routing_edges(`)
        .replace(/get_intersection_stats\(/g, `${schemaName}.get_intersection_stats(`)
        .replace(/validate_intersection_detection\(/g, `${schemaName}.validate_intersection_detection(`)
        .replace(/validate_spatial_data_integrity\(/g, `${schemaName}.validate_spatial_data_integrity(`);
}
/**
 * Get SQL for creating spatial optimization functions in a staging schema
 */
function getSpatialOptimizationFunctionsSql(schemaName) {
    const spatialOptimization = new spatial_optimization_1.SpatialOptimization({ stagingSchema: schemaName });
    return spatialOptimization.getAllOptimizationsSql();
}
//# sourceMappingURL=staging-schema.js.map