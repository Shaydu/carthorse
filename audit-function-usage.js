const fs = require('fs');
const path = require('path');

// List of all custom functions from our backup
const ALL_CUSTOM_FUNCTIONS = [
  // Routing Functions
  'generate_routing_nodes_native',
  'generate_routing_nodes_native_v2',
  'generate_routing_edges_native', 
  'generate_routing_edges_native_v2',
  
  // Route Recommendation Functions
  'generate_route_recommendations',
  'generate_route_recommendations_configurable',
  'generate_route_recommendations_adaptive',
  'generate_route_recommendations_large_dataset',
  'generate_simple_route_recommendations',
  'generate_route_name',
  
  // Route Finding Functions
  'find_routes_recursive',
  'find_routes_recursive_configurable',
  'find_routes_for_criteria',
  'find_routes_for_criteria_configurable',
  'find_routes_with_cost_configurable',
  'find_routes_spatial',
  'find_simple_loops_spatial',
  'find_out_and_back_spatial',
  'find_simple_routes_with_logging',
  
  // Calculation Functions
  'calculate_route_elevation_stats',
  'calculate_route_connectivity_score',
  'calculate_route_cost',
  'calculate_route_difficulty',
  'calculate_route_estimated_time',
  'calculate_route_gain_rate',
  'calculate_route_parametric_metrics',
  'calculate_route_similarity_score',
  'calculate_trail_stats',
  'recalculate_elevation_data',
  
  // Configuration Functions
  'get_batch_size',
  'get_carthorse_config',
  'get_cost_weights',
  'get_edge_tolerance',
  'get_elevation_gain_limits',
  'get_intersection_stats',
  'get_intersection_tolerance',
  'get_max_routes_per_bin',
  'get_min_route_score',
  'get_proj4_from_srid',
  'get_route_distance_limits',
  'get_route_patterns',
  'get_scoring_weights',
  'get_simplify_tolerance',
  'get_timeout_ms',
  'get_trails_with_geojson',
  
  // Validation Functions
  'validate_intersection_detection',
  'validate_spatial_data_integrity',
  'validate_trail_completeness',
  
  // Cleanup Functions
  'cleanup_orphaned_nodes',
  'cleanup_routing_graph',
  
  // Utility Functions
  'show_routing_summary',
  'prepare_routing_network',
  'auto_calculate_bbox',
  'auto_calculate_length',
  'find_srid',
  'generate_app_uuid'
];

// Functions we know are used based on our analysis
const USED_FUNCTIONS = [
  // Core orchestrator functions
  'generate_routing_nodes_native_v2',
  'generate_routing_edges_native_v2',
  'detect_trail_intersections',
  'copy_and_split_trails_to_staging_native_v3',
  
  // Route recommendations (when not skipped)
  'generate_route_recommendations',
  'generate_route_recommendations_configurable',
  'generate_route_recommendations_adaptive',
  
  // Validation functions
  'validate_intersection_detection',
  'validate_spatial_data_integrity',
  'validate_trail_completeness',
  
  // Configuration functions
  'get_intersection_tolerance',
  'get_edge_tolerance',
  'get_route_patterns',
  'get_min_route_score',
  'get_max_routes_per_bin',
  'get_elevation_gain_limits',
  'get_route_distance_limits',
  
  // Utility functions
  'show_routing_summary',
  'auto_calculate_bbox',
  'auto_calculate_length'
];

function auditFunctionUsage() {
  console.log('🔍 AUDITING CUSTOM FUNCTION USAGE');
  console.log('=====================================\n');
  
  // Categorize functions
  const usedFunctions = ALL_CUSTOM_FUNCTIONS.filter(f => USED_FUNCTIONS.includes(f));
  const unusedFunctions = ALL_CUSTOM_FUNCTIONS.filter(f => !USED_FUNCTIONS.includes(f));
  
  console.log(`📊 SUMMARY:`);
  console.log(`   Total custom functions: ${ALL_CUSTOM_FUNCTIONS.length}`);
  console.log(`   Used functions: ${usedFunctions.length}`);
  console.log(`   Unused functions: ${unusedFunctions.length}`);
  console.log(`   Usage rate: ${((usedFunctions.length / ALL_CUSTOM_FUNCTIONS.length) * 100).toFixed(1)}%\n`);
  
  console.log('✅ USED FUNCTIONS:');
  console.log('==================');
  usedFunctions.forEach(func => {
    console.log(`   ✅ ${func}`);
  });
  
  console.log('\n❌ UNUSED FUNCTIONS:');
  console.log('====================');
  
  // Categorize unused functions
  const unusedByCategory = {
    'Route Finding (Unused)': unusedFunctions.filter(f => f.startsWith('find_')),
    'Route Recommendations (Unused)': unusedFunctions.filter(f => f.startsWith('generate_route_') && !f.includes('routing_')),
    'Calculation Functions (Unused)': unusedFunctions.filter(f => f.startsWith('calculate_')),
    'Configuration Functions (Unused)': unusedFunctions.filter(f => f.startsWith('get_')),
    'Cleanup Functions (Unused)': unusedFunctions.filter(f => f.startsWith('cleanup_')),
    'Other Unused': unusedFunctions.filter(f => 
      !f.startsWith('find_') && 
      !f.startsWith('generate_route_') && 
      !f.startsWith('calculate_') && 
      !f.startsWith('get_') && 
      !f.startsWith('cleanup_')
    )
  };
  
  Object.entries(unusedByCategory).forEach(([category, functions]) => {
    if (functions.length > 0) {
      console.log(`\n   ${category}:`);
      functions.forEach(func => {
        console.log(`      ❌ ${func}`);
      });
    }
  });
  
  console.log('\n📋 ANALYSIS:');
  console.log('============');
  console.log('1. Core routing functions (v2) are actively used');
  console.log('2. Route recommendation functions are unused when --skip-route-recommendations is used');
  console.log('3. Many calculation and route-finding functions appear to be legacy/unused');
  console.log('4. Configuration functions are partially used');
  console.log('5. Cleanup functions are not called by orchestrator');
  
  console.log('\n💡 RECOMMENDATIONS:');
  console.log('===================');
  console.log('1. Keep all v2 routing functions (actively used)');
  console.log('2. Consider removing unused route-finding functions');
  console.log('3. Review calculation functions for potential future use');
  console.log('4. Cleanup functions may be useful for maintenance');
  console.log('5. Configuration functions should be kept for flexibility');
}

auditFunctionUsage(); 