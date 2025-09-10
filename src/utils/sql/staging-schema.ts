// Helper for staging schema SQL DDL and PostGIS function loading
import * as fs from 'fs';
import * as path from 'path';

export function getRouteRecommendationsTableSql(schemaName: string): string {
  return `
    CREATE TABLE ${schemaName}.route_recommendations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      route_uuid TEXT UNIQUE NOT NULL,
      region TEXT NOT NULL,
      input_length_km REAL CHECK(input_length_km > 0),
      input_elevation_gain REAL,
      recommended_length_km REAL CHECK(recommended_length_km > 0),
      recommended_elevation_gain REAL,
      route_elevation_loss REAL CHECK(route_elevation_loss >= 0),
      route_score REAL CHECK(route_score >= 0 AND route_score <= 100),
      route_type TEXT CHECK(route_type IN ('out-and-back', 'loop', 'lollipop', 'point-to-point', 'unknown')),
      route_name TEXT,
      route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')),
      trail_count INTEGER CHECK(trail_count >= 1),
      route_path JSONB,
      route_edges JSONB,
      similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
      created_at TIMESTAMP DEFAULT NOW(),
      route_geometry GEOMETRY(MULTILINESTRINGZ, 4326),
      
      -- Additional fields from gainiac schema for enhanced functionality
      input_distance_tolerance REAL CHECK(input_distance_tolerance >= 0),
      input_elevation_tolerance REAL CHECK(input_elevation_tolerance >= 0),
      expires_at TIMESTAMP,
      usage_count INTEGER DEFAULT 0 CHECK(usage_count >= 0),
      complete_route_data JSONB,
      trail_connectivity_data JSONB,
      request_hash TEXT,
      
      -- NEW: Parametric search fields (calculated from route data)
      route_gain_rate REAL CHECK(route_gain_rate >= 0), -- meters per kilometer (calculated)
      route_trail_count INTEGER CHECK(route_trail_count > 0), -- number of unique trails in route (same as trail_count)
      route_max_elevation REAL, -- highest point on route (calculated from route_path)
      route_min_elevation REAL, -- lowest point on route (calculated from route_path)
      route_avg_elevation REAL, -- average elevation of route (calculated from route_path)
      route_difficulty TEXT CHECK(route_difficulty IN ('easy', 'moderate', 'hard', 'expert')), -- calculated from gain rate
      route_estimated_time_hours REAL CHECK(route_estimated_time_hours > 0), -- estimated hiking time
      route_connectivity_score REAL CHECK(route_connectivity_score >= 0 AND route_connectivity_score <= 1) -- how well trails connect
    );
  `;
}

export function getRouteTrailsTableSql(schemaName: string): string {
  return `
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
  `;
}

export function getStagingSchemaSql(schemaName: string): string {
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
      app_uuid UUID UNIQUE NOT NULL,
      original_trail_uuid TEXT,  -- Preserve original trail UUID for deduplication
      osm_id TEXT,
      name TEXT NOT NULL,
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

    -- Function to auto-calculate length from geometry
    CREATE OR REPLACE FUNCTION ${schemaName}.auto_calculate_length()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.geometry IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
        NEW.length_km := ST_Length(NEW.geometry, true) / 1000.0; -- Convert meters to kilometers
      END IF;
      
      RETURN NEW;
    END;
    $$;

    -- Trigger to auto-calculate length
    CREATE TRIGGER trigger_auto_calculate_length
      BEFORE INSERT OR UPDATE ON ${schemaName}.trails
      FOR EACH ROW
      EXECUTE FUNCTION ${schemaName}.auto_calculate_length();

    -- Trail hash cache table (uses app_uuid instead of foreign key to avoid drop issues)
    CREATE TABLE ${schemaName}.trail_hashes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_uuid UUID NOT NULL, -- Changed from trail_id INTEGER to app_uuid UUID
      geometry_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Trail ID mapping table (UUID ↔ Integer ID lookup for pgRouting boundary)
    CREATE TABLE ${schemaName}.trail_id_mapping (
      id SERIAL PRIMARY KEY,
      app_uuid UUID UNIQUE NOT NULL, -- Original trail UUID
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
    ${getRouteRecommendationsTableSql(schemaName)}

    -- Route trails table (for trail composition of routes)
    ${getRouteTrailsTableSql(schemaName)}

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_geometry ON ${schemaName}.trails USING GIST(geometry);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_intersection_points ON ${schemaName}.intersection_points USING GIST(intersection_point);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_recommendations_region ON ${schemaName}.route_recommendations(region);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_recommendations_score ON ${schemaName}.route_recommendations(route_score);
    
    -- Performance-critical indexes for Y-intersection detection and filtering
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_source ON ${schemaName}.trails(source);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_app_uuid ON ${schemaName}.trails(app_uuid);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_source_geom ON ${schemaName}.trails(source) INCLUDE (app_uuid, name, geometry);
  `;
}

export function getStagingIndexesSql(schemaName: string): string {
  return `
    -- Basic indexes
    CREATE INDEX IF NOT EXISTS idx_staging_trails_osm_id ON ${schemaName}.trails(osm_id);
    CREATE INDEX IF NOT EXISTS idx_staging_trails_bbox ON ${schemaName}.trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
    CREATE INDEX IF NOT EXISTS idx_staging_trails_geometry ON ${schemaName}.trails USING GIST(geometry);
    CREATE INDEX IF NOT EXISTS idx_staging_intersection_points_point ON ${schemaName}.intersection_points USING GIST(intersection_point);
    
    -- Performance-critical indexes for Y-intersection detection and filtering
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_source ON ${schemaName}.trails(source);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_app_uuid ON ${schemaName}.trails(app_uuid);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_source_geom ON ${schemaName}.trails(source) INCLUDE (app_uuid, name, geometry);
    
    -- Route recommendation indexes
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_recommendations_gain_rate ON ${schemaName}.route_recommendations(route_gain_rate);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_recommendations_difficulty ON ${schemaName}.route_recommendations(route_difficulty);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_route_recommendations_elevation_range ON ${schemaName}.route_recommendations(route_min_elevation, route_max_elevation);
  `;
}

/**
 * SQL to calculate and populate export fields in route_recommendations table
 */
export function getCalculateExportFieldsSql(schemaName: string): string {
  return `
    -- Calculate and populate v14 fields in route_recommendations table
    UPDATE ${schemaName}.route_recommendations 
    SET 
      -- Calculate route_gain_rate (meters per kilometer)
      route_gain_rate = CASE 
        WHEN recommended_length_km > 0 AND recommended_elevation_gain IS NOT NULL 
        THEN (recommended_elevation_gain / recommended_length_km) 
        ELSE 0 
      END,
      
      -- Set route_trail_count same as trail_count
      route_trail_count = COALESCE(trail_count, 1),
      
      -- Calculate elevation stats from route_path GeoJSON
      route_max_elevation = (
        SELECT MAX((coord->2)::REAL) 
        FROM jsonb_array_elements(
          CASE 
            WHEN pg_typeof(route_path) = 'jsonb'::regtype 
            THEN route_path->'coordinates'
            ELSE (route_path::jsonb)->'coordinates'
          END
        ) AS coord
        WHERE coord->2 IS NOT NULL AND (coord->2)::REAL > 0
      ),
      
      route_min_elevation = (
        SELECT MIN((coord->2)::REAL) 
        FROM jsonb_array_elements(
          CASE 
            WHEN pg_typeof(route_path) = 'jsonb'::regtype 
            THEN route_path->'coordinates'
            ELSE (route_path::jsonb)->'coordinates'
          END
        ) AS coord
        WHERE coord->2 IS NOT NULL AND (coord->2)::REAL > 0
      ),
      
      route_avg_elevation = (
        SELECT AVG((coord->2)::REAL) 
        FROM jsonb_array_elements(
          CASE 
            WHEN pg_typeof(route_path) = 'jsonb'::regtype 
            THEN route_path->'coordinates'
            ELSE (route_path::jsonb)->'coordinates'
          END
        ) AS coord
        WHERE coord->2 IS NOT NULL AND (coord->2)::REAL > 0
      ),
      
      -- Calculate route difficulty based on gain rate (ensure valid values only)
      route_difficulty = CASE 
        WHEN recommended_elevation_gain IS NULL OR recommended_length_km IS NULL OR recommended_length_km = 0 THEN 'easy'
        WHEN (recommended_elevation_gain / recommended_length_km) >= 150 THEN 'expert'
        WHEN (recommended_elevation_gain / recommended_length_km) >= 100 THEN 'hard'
        WHEN (recommended_elevation_gain / recommended_length_km) >= 50 THEN 'moderate'
        WHEN (recommended_elevation_gain / recommended_length_km) >= 0 THEN 'easy'
        ELSE 'easy' -- fallback for any edge cases
      END,
      
      -- Estimate hiking time (3-4 km/h average, adjusted for difficulty)
      route_estimated_time_hours = CASE 
        WHEN recommended_length_km IS NULL OR recommended_length_km <= 0 THEN 0
        WHEN recommended_elevation_gain IS NULL THEN (recommended_length_km / 4.0) -- Default to easy pace
        WHEN (recommended_elevation_gain / recommended_length_km) >= 150 THEN (recommended_length_km / 2.0) -- Expert: 2 km/h
        WHEN (recommended_elevation_gain / recommended_length_km) >= 100 THEN (recommended_length_km / 2.5) -- Hard: 2.5 km/h
        WHEN (recommended_elevation_gain / recommended_length_km) >= 50 THEN (recommended_length_km / 3.0) -- Moderate: 3 km/h
        ELSE (recommended_length_km / 4.0) -- Easy: 4 km/h
      END,
      
      -- Set connectivity score (no fallback - calculate from actual data)
      route_connectivity_score = route_connectivity_score,
      
      -- Set route_elevation_loss (no fallback - use actual calculated value)
      route_elevation_loss = route_elevation_loss
    WHERE route_gain_rate IS NULL OR route_trail_count IS NULL;
  `;
}

export function getSchemaQualifiedPostgisFunctionsSql(schemaName: string, functionsSql: string): string {
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
    .replace(/validate_spatial_data_integrity\(/g, `${schemaName}.validate_spatial_data_integrity(`)
    // Also replace PERFORM statements that call functions
    .replace(/PERFORM detect_trail_intersections\(/g, `PERFORM ${schemaName}.detect_trail_intersections(`)
    .replace(/PERFORM build_routing_nodes\(/g, `PERFORM ${schemaName}.build_routing_nodes(`)
    .replace(/PERFORM build_routing_edges\(/g, `PERFORM ${schemaName}.build_routing_edges(`)
    .replace(/PERFORM get_intersection_stats\(/g, `PERFORM ${schemaName}.get_intersection_stats(`)
    .replace(/PERFORM validate_intersection_detection\(/g, `PERFORM ${schemaName}.validate_intersection_detection(`)
    .replace(/PERFORM validate_spatial_data_integrity\(/g, `PERFORM ${schemaName}.validate_spatial_data_integrity(`)
    // Fix the specific issue with detect_trail_intersections being called with schema parameter
    // This prevents the double schema reference: schema.detect_trail_intersections(schema, ...)
    .replace(new RegExp(`FROM ${schemaName}\\.detect_trail_intersections\\(''%I'', ''%I'',`, 'g'), `FROM ${schemaName}.detect_trail_intersections(''%I'', ''%I'',`);
} 