#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Read YAML config files
function readYamlConfig(filePath) {
    try {
        const fileContents = fs.readFileSync(filePath, 'utf8');
        return yaml.load(fileContents);
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error.message);
        return null;
    }
}

// Extract relevant config values for SQL
function extractSqlConfigs(globalConfig, routeConfig) {
    return {
        // Spatial tolerances
        intersectionTolerance: globalConfig?.postgis?.processing?.defaultIntersectionTolerance || 1.0,
        edgeTolerance: globalConfig?.postgis?.processing?.defaultIntersectionTolerance || 1.0,
        simplifyTolerance: globalConfig?.postgis?.processing?.defaultSimplifyTolerance || 0.001,
        
        // Processing settings
        batchSize: globalConfig?.postgis?.processing?.defaultBatchSize || 1000,
        timeoutMs: globalConfig?.postgis?.processing?.defaultTimeoutMs || 30000,
        
        // Validation thresholds
        minTrailLengthMeters: globalConfig?.validation?.minTrailLengthMeters || 1,
        maxTrailLengthMeters: globalConfig?.validation?.maxTrailLengthMeters || 100000,
        minElevationMeters: globalConfig?.validation?.minElevationMeters || 0,
        maxElevationMeters: globalConfig?.validation?.maxElevationMeters || 9000,
        minCoordinatePoints: globalConfig?.validation?.minCoordinatePoints || 2,
        maxCoordinatePoints: globalConfig?.validation?.maxCoordinatePoints || 10000,
        
        // Route discovery settings
        maxRoutesPerBin: routeConfig?.discovery?.maxRoutesPerBin || 10,
        minRouteScore: routeConfig?.discovery?.minRouteScore || 0.7,
        minRouteDistanceKm: routeConfig?.discovery?.minRouteDistanceKm || 1.0,
        maxRouteDistanceKm: routeConfig?.discovery?.maxRouteDistanceKm || 10.0,
        minElevationGainMeters: routeConfig?.discovery?.minElevationGainMeters || 10,
        maxElevationGainMeters: routeConfig?.discovery?.maxElevationGainMeters || 5000,
        
        // Route scoring weights
        distanceWeight: routeConfig?.scoring?.distanceWeight || 0.4,
        elevationWeight: routeConfig?.scoring?.elevationWeight || 0.3,
        qualityWeight: routeConfig?.scoring?.qualityWeight || 0.3,
        
        // Cost weighting
        steepnessWeight: routeConfig?.costWeighting?.steepnessWeight || 2.0,
        routingDistanceWeight: routeConfig?.costWeighting?.distanceWeight || 0.5,
        
        // Route patterns (from route discovery config)
        routePatterns: [
            { name: 'Short Loop', distance: 5.0, elevation: 200.0, shape: 'loop', tolerance: 20.0 },
            { name: 'Medium Loop', distance: 10.0, elevation: 400.0, shape: 'loop', tolerance: 20.0 },
            { name: 'Long Loop', distance: 15.0, elevation: 600.0, shape: 'loop', tolerance: 20.0 },
            { name: 'Short Out-and-Back', distance: 8.0, elevation: 300.0, shape: 'out-and-back', tolerance: 20.0 },
            { name: 'Medium Out-and-Back', distance: 12.0, elevation: 500.0, shape: 'out-and-back', tolerance: 20.0 },
            { name: 'Long Out-and-Back', distance: 18.0, elevation: 700.0, shape: 'out-and-back', tolerance: 20.0 },
            { name: 'Short Point-to-Point', distance: 6.0, elevation: 250.0, shape: 'point-to-point', tolerance: 20.0 },
            { name: 'Medium Point-to-Point', distance: 12.0, elevation: 450.0, shape: 'point-to-point', tolerance: 20.0 },
            { name: 'Long Point-to-Point', distance: 20.0, elevation: 800.0, shape: 'point-to-point', tolerance: 20.0 }
        ]
    };
}

// Generate SQL with configurable values
function generateConfigurableSql(configs) {
    return `
-- =============================================================================
-- CONFIGURABLE SQL VALUES FROM YAML CONFIGS
-- =============================================================================
-- This file contains SQL functions and constants derived from carthorse.config.yaml
-- and route-discovery.config.yaml
-- =============================================================================

-- Configuration constants
CREATE OR REPLACE FUNCTION get_carthorse_config() RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        -- Spatial tolerances
        'intersection_tolerance', ${configs.intersectionTolerance},
        'edge_tolerance', ${configs.edgeTolerance},
        'simplify_tolerance', ${configs.simplifyTolerance},
        
        -- Processing settings
        'batch_size', ${configs.batchSize},
        'timeout_ms', ${configs.timeoutMs},
        
        -- Validation thresholds
        'min_trail_length_meters', ${configs.minTrailLengthMeters},
        'max_trail_length_meters', ${configs.maxTrailLengthMeters},
        'min_elevation_meters', ${configs.minElevationMeters},
        'max_elevation_meters', ${configs.maxElevationMeters},
        'min_coordinate_points', ${configs.minCoordinatePoints},
        'max_coordinate_points', ${configs.maxCoordinatePoints},
        
        -- Route discovery settings
        'max_routes_per_bin', ${configs.maxRoutesPerBin},
        'min_route_score', ${configs.minRouteScore},
        'min_route_distance_km', ${configs.minRouteDistanceKm},
        'max_route_distance_km', ${configs.maxRouteDistanceKm},
        'min_elevation_gain_meters', ${configs.minElevationGainMeters},
        'max_elevation_gain_meters', ${configs.maxElevationGainMeters},
        
        -- Route scoring weights
        'distance_weight', ${configs.distanceWeight},
        'elevation_weight', ${configs.elevationWeight},
        'quality_weight', ${configs.qualityWeight},
        
        -- Cost weighting
        'steepness_weight', ${configs.steepnessWeight},
        'routing_distance_weight', ${configs.routingDistanceWeight}
    );
END;
$$ LANGUAGE plpgsql;

-- Helper functions to get specific config values
CREATE OR REPLACE FUNCTION get_intersection_tolerance() RETURNS float AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'intersection_tolerance')::float;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_edge_tolerance() RETURNS float AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'edge_tolerance')::float;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_simplify_tolerance() RETURNS float AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'simplify_tolerance')::float;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_batch_size() RETURNS integer AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'batch_size')::integer;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_timeout_ms() RETURNS integer AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'timeout_ms')::integer;
END;
$$ LANGUAGE plpgsql;

-- Route discovery config functions
CREATE OR REPLACE FUNCTION get_max_routes_per_bin() RETURNS integer AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'max_routes_per_bin')::integer;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_min_route_score() RETURNS float AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'min_route_score')::float;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_route_distance_limits() RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        'min_km', (get_carthorse_config() ->> 'min_route_distance_km')::float,
        'max_km', (get_carthorse_config() ->> 'max_route_distance_km')::float
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_elevation_gain_limits() RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        'min_meters', (get_carthorse_config() ->> 'min_elevation_gain_meters')::float,
        'max_meters', (get_carthorse_config() ->> 'max_elevation_gain_meters')::float
    );
END;
$$ LANGUAGE plpgsql;

-- Route scoring functions
CREATE OR REPLACE FUNCTION get_scoring_weights() RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        'distance_weight', (get_carthorse_config() ->> 'distance_weight')::float,
        'elevation_weight', (get_carthorse_config() ->> 'elevation_weight')::float,
        'quality_weight', (get_carthorse_config() ->> 'quality_weight')::float
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_cost_weights() RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        'steepness_weight', (get_carthorse_config() ->> 'steepness_weight')::float,
        'distance_weight', (get_carthorse_config() ->> 'routing_distance_weight')::float
    );
END;
$$ LANGUAGE plpgsql;

-- Route pattern table for recommendations
CREATE TABLE IF NOT EXISTS route_patterns (
    id SERIAL PRIMARY KEY,
    pattern_name TEXT NOT NULL,
    target_distance_km FLOAT NOT NULL,
    target_elevation_gain FLOAT NOT NULL,
    route_shape TEXT NOT NULL,
    tolerance_percent FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default route patterns from config
INSERT INTO route_patterns (pattern_name, target_distance_km, target_elevation_gain, route_shape, tolerance_percent) VALUES
${configs.routePatterns.map(pattern => 
    `('${pattern.name}', ${pattern.distance}, ${pattern.elevation}, '${pattern.shape}', ${pattern.tolerance})`
).join(',\n')}
ON CONFLICT (pattern_name) DO NOTHING;

-- Function to get route patterns
CREATE OR REPLACE FUNCTION get_route_patterns() RETURNS TABLE(
    pattern_name text,
    target_distance_km float,
    target_elevation_gain float,
    route_shape text,
    tolerance_percent float
) AS $$
BEGIN
    RETURN QUERY SELECT 
        rp.pattern_name,
        rp.target_distance_km,
        rp.target_elevation_gain,
        rp.route_shape,
        rp.tolerance_percent
    FROM route_patterns rp
    ORDER BY rp.target_distance_km, rp.target_elevation_gain;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate route similarity score using config weights
CREATE OR REPLACE FUNCTION calculate_route_similarity_score(
    actual_distance_km float,
    target_distance_km float,
    actual_elevation_gain float,
    target_elevation_gain float
) RETURNS float AS $$
DECLARE
    weights json;
    distance_score float;
    elevation_score float;
BEGIN
    weights := get_scoring_weights();
    
    -- Calculate individual scores (0-1, where 1 is perfect match)
    distance_score := GREATEST(0, 1 - ABS(actual_distance_km - target_distance_km) / target_distance_km);
    elevation_score := GREATEST(0, 1 - ABS(actual_elevation_gain - target_elevation_gain) / target_elevation_gain);
    
    -- Return weighted average
    RETURN (weights ->> 'distance_weight')::float * distance_score + 
           (weights ->> 'elevation_weight')::float * elevation_score;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate route cost using config weights
CREATE OR REPLACE FUNCTION calculate_route_cost(
    steepness_m_per_km float,
    distance_km float
) RETURNS float AS $$
DECLARE
    weights json;
BEGIN
    weights := get_cost_weights();
    
    RETURN (steepness_m_per_km * (weights ->> 'steepness_weight')::float) + 
           (distance_km * (weights ->> 'distance_weight')::float);
END;
$$ LANGUAGE plpgsql;
`;
}

// Main execution
function main() {
    console.log('Reading YAML config files...');
    
    const globalConfig = readYamlConfig('carthorse.config.yaml');
    const routeConfig = readYamlConfig('route-discovery.config.yaml');
    
    if (!globalConfig || !routeConfig) {
        console.error('Failed to read config files');
        process.exit(1);
    }
    
    console.log('Extracting SQL configs...');
    const configs = extractSqlConfigs(globalConfig, routeConfig);
    
    console.log('Generating configurable SQL...');
    const sql = generateConfigurableSql(configs);
    
    const outputPath = 'sql/functions/carthorse-configurable-sql.sql';
    fs.writeFileSync(outputPath, sql);
    
    console.log(`✅ Generated configurable SQL: ${outputPath}`);
    console.log('📊 Config values extracted:');
    console.log(`  - Intersection tolerance: ${configs.intersectionTolerance}m`);
    console.log(`  - Edge tolerance: ${configs.edgeTolerance}m`);
    console.log(`  - Simplify tolerance: ${configs.simplifyTolerance}`);
    console.log(`  - Batch size: ${configs.batchSize}`);
    console.log(`  - Timeout: ${configs.timeoutMs}ms`);
    console.log(`  - Max routes per bin: ${configs.maxRoutesPerBin}`);
    console.log(`  - Min route score: ${configs.minRouteScore}`);
    console.log(`  - Route patterns: ${configs.routePatterns.length}`);
}

if (require.main === module) {
    main();
}

module.exports = { readYamlConfig, extractSqlConfigs, generateConfigurableSql }; 