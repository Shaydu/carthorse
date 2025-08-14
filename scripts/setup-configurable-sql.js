#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Main setup function
function setupConfigurableSql() {
    console.log('🚀 Setting up configurable SQL system...\n');
    
    // Step 1: Generate configurable SQL
    console.log('📝 Step 1: Generating configurable SQL from YAML configs...');
    try {
        require('./generate-configurable-sql.js');
        console.log('✅ Configurable SQL generated successfully\n');
    } catch (error) {
        console.error('❌ Failed to generate configurable SQL:', error.message);
        process.exit(1);
    }
    
    // Step 2: Update existing SQL files
    console.log('🔧 Step 2: Updating existing SQL files with configurable values...');
    try {
        require('./update-sql-with-configs.js');
        console.log('✅ SQL files updated successfully\n');
    } catch (error) {
        console.error('❌ Failed to update SQL files:', error.message);
        process.exit(1);
    }
    
    // Step 3: Generate implementation instructions
    console.log('📋 Step 3: Generating implementation instructions...');
    generateImplementationInstructions();
    
    console.log('\n🎉 Setup complete! Your SQL is now configurable via YAML files.');
    console.log('\n📚 Next steps:');
    console.log('   1. Review the generated SQL files');
    console.log('   2. Test the configurable functions in your database');
    console.log('   3. Update your application code to use the new configurable functions');
    console.log('   4. Modify YAML configs as needed for your algorithms');
}

// Generate implementation instructions
function generateImplementationInstructions() {
    const instructions = `# Configurable SQL Implementation Guide

## Overview
This setup has made your SQL functions configurable by reading values from YAML config files instead of using hardcoded values.

## Files Created/Modified

### New Files:
- \`sql/functions/carthorse-configurable-sql.sql\` - Core configurable functions
- \`sql/functions/recursive-route-finding-configurable.sql\` - Configurable route finding
- \`scripts/generate-configurable-sql.js\` - YAML to SQL generator
- \`scripts/update-sql-with-configs.js\` - SQL file updater

### Modified Files:
- \`sql/functions/recursive-route-finding.sql\` - Updated with configurable values
- \`sql/schemas/carthorse-postgres-schema*.sql\` - Updated with configurable values

## Implementation Steps

### 1. Database Setup
Run the configurable SQL setup in your database:

\`\`\`sql
-- First, run the configurable SQL setup
\\i sql/functions/carthorse-configurable-sql.sql

-- Then run your existing schema files (they now use configurable values)
\\i sql/schemas/carthorse-consolidated-schema.sql
\\i sql/functions/recursive-route-finding.sql
\`\`\`

### 2. Test the Configuration
Verify the configurable functions work:

\`\`\`sql
-- Check if config is loaded
SELECT get_carthorse_config();

-- Test specific config values
SELECT get_intersection_tolerance();
SELECT get_max_routes_per_bin();
SELECT get_min_route_score();

-- Test route patterns
SELECT * FROM get_route_patterns();
\`\`\`

### 3. Update Your Application Code
Replace hardcoded values with configurable function calls:

\`\`\`typescript
// Before (hardcoded)
const tolerance = 1.0;
const batchSize = 1000;
const maxRoutes = 10;

// After (configurable)
const tolerance = await db.query('SELECT get_intersection_tolerance()');
const batchSize = await db.query('SELECT get_batch_size()');
const maxRoutes = await db.query('SELECT get_max_routes_per_bin()');
\`\`\`

### 4. Modify YAML Configs
Update the YAML files to tune your algorithms:

\`\`\`yaml
# configs/carthorse.config.yaml
postgis:
  processing:
    defaultIntersectionTolerance: 2.0  # Increase for more intersections
    defaultSimplifyTolerance: 0.002    # Increase for simpler geometries

# configs/layer3-routing.config.yaml
discovery:
  maxRoutesPerBin: 20        # More routes per bin
  minRouteScore: 0.8         # Higher quality threshold
  minRouteDistanceKm: 0.5    # Allow shorter routes
  maxRouteDistanceKm: 15.0   # Allow longer routes

scoring:
  distanceWeight: 0.5        # Weight distance more heavily
  elevationWeight: 0.3       # Weight elevation less
  qualityWeight: 0.2         # Weight quality less
\`\`\`

## Available Configurable Functions

### Core Configuration:
- \`get_carthorse_config()\` - Get all config as JSON
- \`get_intersection_tolerance()\` - Spatial intersection tolerance
- \`get_edge_tolerance()\` - Spatial edge tolerance
- \`get_simplify_tolerance()\` - Geometry simplification tolerance
- \`get_batch_size()\` - Processing batch size
- \`get_timeout_ms()\` - Processing timeout

### Route Discovery:
- \`get_max_routes_per_bin()\` - Maximum routes per bin
- \`get_min_route_score()\` - Minimum route quality score
- \`get_route_distance_limits()\` - Min/max route distances
- \`get_elevation_gain_limits()\` - Min/max elevation gains
- \`get_route_patterns()\` - Available route patterns

### Scoring and Cost:
- \`get_scoring_weights()\` - Route scoring weights
- \`get_cost_weights()\` - Route cost weights
- \`calculate_route_similarity_score()\` - Calculate route similarity
- \`calculate_route_cost()\` - Calculate route cost

## Validation Thresholds:
- \`get_carthorse_config() ->> 'min_trail_length_meters'\` - Minimum trail length
- \`get_carthorse_config() ->> 'max_trail_length_meters'\` - Maximum trail length
- \`get_carthorse_config() ->> 'min_elevation_meters'\` - Minimum elevation
- \`get_carthorse_config() ->> 'max_elevation_meters'\` - Maximum elevation
- \`get_carthorse_config() ->> 'min_coordinate_points'\` - Minimum coordinate points
- \`get_carthorse_config() ->> 'max_coordinate_points'\` - Maximum coordinate points

## Benefits

1. **Centralized Configuration**: All algorithm parameters in YAML files
2. **Environment-Specific Tuning**: Different configs for different regions
3. **Runtime Flexibility**: Change parameters without code changes
4. **Validation**: Built-in validation of config values
5. **Documentation**: Self-documenting configuration system

## Troubleshooting

### Common Issues:

1. **Config not loading**: Ensure YAML files are in the project root
2. **Function not found**: Run the configurable SQL setup first
3. **Invalid config values**: Check YAML syntax and value ranges
4. **Performance issues**: Adjust batch sizes and timeouts in config

### Debug Commands:

\`\`\`sql
-- Check if config is loaded
SELECT get_carthorse_config();

-- Test specific functions
SELECT get_intersection_tolerance(), get_batch_size(), get_max_routes_per_bin();

-- Validate route patterns
SELECT * FROM get_route_patterns();

-- Test scoring
SELECT calculate_route_similarity_score(5.0, 5.0, 200.0, 200.0);
\`\`\`

## Migration Notes

- Old hardcoded values are preserved as fallbacks
- New configurable functions are additive (don't break existing code)
- Gradually migrate from hardcoded to configurable values
- Test thoroughly in development before production deployment
`;

    fs.writeFileSync('CONFIGURABLE_SQL_IMPLEMENTATION.md', instructions);
    console.log('✅ Implementation guide created: CONFIGURABLE_SQL_IMPLEMENTATION.md');
}

// Main execution
if (require.main === module) {
    setupConfigurableSql();
}

module.exports = { setupConfigurableSql, generateImplementationInstructions }; 