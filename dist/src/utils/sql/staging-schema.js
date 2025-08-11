"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStagingSchemaSql = getStagingSchemaSql;
exports.getStagingIndexesSql = getStagingIndexesSql;
exports.getSchemaQualifiedPostgisFunctionsSql = getSchemaQualifiedPostgisFunctionsSql;
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

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_geometry ON ${schemaName}.trails USING GIST(geometry);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_intersection_points ON ${schemaName}.intersection_points USING GIST(point);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_recommendations_region ON ${schemaName}.route_recommendations(region);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_recommendations_score ON ${schemaName}.route_recommendations(route_score);
  `;
}
function getStagingIndexesSql(schemaName) {
    return `
    CREATE INDEX IF NOT EXISTS idx_staging_trails_osm_id ON ${schemaName}.trails(osm_id);
    CREATE INDEX IF NOT EXISTS idx_staging_trails_bbox ON ${schemaName}.trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
    CREATE INDEX IF NOT EXISTS idx_staging_trails_geometry ON ${schemaName}.trails USING GIST(geometry);
    CREATE INDEX IF NOT EXISTS idx_staging_intersection_points_point ON ${schemaName}.intersection_points USING GIST(point);
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
//# sourceMappingURL=staging-schema.js.map