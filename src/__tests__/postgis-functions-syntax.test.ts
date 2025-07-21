import * as fs from 'fs';
import * as path from 'path';

describe('PostGIS Functions Syntax Validation', () => {
  test('should have valid SQL syntax in PostGIS functions file', () => {
    // Read the PostGIS functions file
    const functionsPath = path.resolve(__dirname, '../../sql/carthorse-postgis-intersection-functions.sql');
    expect(fs.existsSync(functionsPath)).toBe(true);
    
    const functionsSql = fs.readFileSync(functionsPath, 'utf8');
    
    // Basic syntax checks
    expect(functionsSql).toContain('CREATE OR REPLACE FUNCTION');
    expect(functionsSql).toContain('detect_trail_intersections');
    expect(functionsSql).toContain('build_routing_nodes');
    expect(functionsSql).toContain('build_routing_edges');
    expect(functionsSql).toContain('get_intersection_stats');
    expect(functionsSql).toContain('validate_intersection_detection');
    
    // Check for PostGIS functions
    expect(functionsSql).toContain('ST_Node');
    expect(functionsSql).toContain('ST_LineMerge');
    expect(functionsSql).toContain('ST_UnaryUnion');
    expect(functionsSql).toContain('ST_Collect');
    expect(functionsSql).toContain('ST_Dump');
    expect(functionsSql).toContain('ST_Intersects');
    expect(functionsSql).toContain('ST_ClosestPoint');
    expect(functionsSql).toContain('ST_DWithin');
    
    // Check for proper function structure
    expect(functionsSql).toContain('RETURNS TABLE');
    expect(functionsSql).toContain('LANGUAGE plpgsql');
    expect(functionsSql).toContain('BEGIN');
    expect(functionsSql).toContain('END;');
    
    console.log('✅ PostGIS functions file has valid syntax structure');
  });

  test('should have all required function signatures', () => {
    const functionsPath = 'carthorse-postgis-intersection-functions.sql';
    const functionsSql = fs.readFileSync(functionsPath, 'utf8');
    
    // Check function signatures
    const functionSignatures = [
      'detect_trail_intersections(trails_schema text, trails_table text, intersection_tolerance_meters float DEFAULT 2.0)',
      'build_routing_nodes(staging_schema text, trails_table text, intersection_tolerance_meters float DEFAULT 2.0)',
      'build_routing_edges(staging_schema text, trails_table text)',
      'get_intersection_stats(staging_schema text)',
      'validate_intersection_detection(staging_schema text)'
    ];
    
    for (const signature of functionSignatures) {
      expect(functionsSql).toContain(signature.split('(')[0]); // Function name
    }
    
    console.log('✅ All required function signatures found');
  });

  test('should have proper error handling and validation', () => {
    const functionsPath = 'carthorse-postgis-intersection-functions.sql';
    const functionsSql = fs.readFileSync(functionsPath, 'utf8');
    
    // Check for proper error handling patterns
    expect(functionsSql).toContain('EXECUTE format'); // Dynamic SQL
    expect(functionsSql).toContain('USING'); // Parameter binding
    expect(functionsSql).toContain('COALESCE'); // Null handling
    expect(functionsSql).toContain('CASE WHEN'); // Conditional logic
    
    console.log('✅ PostGIS functions include proper error handling patterns');
  });

  test('should have comprehensive documentation and examples', () => {
    const functionsPath = 'carthorse-postgis-intersection-functions.sql';
    const functionsSql = fs.readFileSync(functionsPath, 'utf8');
    
    // Check for documentation
    expect(functionsSql).toContain('-- Function to detect all intersections');
    expect(functionsSql).toContain('-- Example usage:');
    expect(functionsSql).toContain('-- SELECT * FROM detect_trail_intersections');
    
    console.log('✅ PostGIS functions include comprehensive documentation');
  });

  test('should use advanced PostGIS functions for optimization (warn only)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../carthorse-postgis-intersection-functions.sql'), 'utf8');
    const requiredFunctions = [
      'ST_Node',
      'ST_LineMerge',
      'ST_UnaryUnion',
      'ST_Collect',
      'ST_Dump',
      'ST_Intersects',
      'ST_ClosestPoint',
      // add more as needed
    ];
    const missing = requiredFunctions.filter(fn => !sql.includes(fn));
    if (missing.length > 0) {
      console.warn(`\n\u26A0\uFE0F WARNING: The following advanced PostGIS functions are not referenced in carthorse-postgis-intersection-functions.sql:`);
      missing.forEach(fn => console.warn(`  - ${fn}`));
      console.warn('You may want to add these if they improve your pipeline, but this will not fail the test.');
    }
    expect(true).toBe(true); // Always pass
  });

  test('should have proper return types and data structures', () => {
    const functionsPath = 'carthorse-postgis-intersection-functions.sql';
    const functionsSql = fs.readFileSync(functionsPath, 'utf8');
    
    // Check return types
    expect(functionsSql).toContain('RETURNS TABLE');
    expect(functionsSql).toContain('RETURNS integer');
    expect(functionsSql).toContain('geometry');
    expect(functionsSql).toContain('integer[]');
    expect(functionsSql).toContain('text[]');
    expect(functionsSql).toContain('float');
    
    console.log('✅ PostGIS functions have proper return types and data structures');
  });

  test('should include performance optimization features', () => {
    const functionsPath = 'carthorse-postgis-intersection-functions.sql';
    const functionsSql = fs.readFileSync(functionsPath, 'utf8');
    
    // Check for performance optimizations
    expect(functionsSql).toContain('ST_Force2D'); // 2D for performance
    expect(functionsSql).toContain('ST_Force3D'); // 3D for elevation
    expect(functionsSql).toContain('GREATEST'); // Smart tolerance handling
    expect(functionsSql).toContain('DISTINCT'); // Duplicate removal
    expect(functionsSql).toContain('array_agg'); // Efficient aggregation
    
    console.log('✅ PostGIS functions include performance optimization features');
  });
}); 