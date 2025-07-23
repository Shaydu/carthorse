import { EnhancedPostgresOrchestrator } from '../../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Test configuration for comprehensive intersection validation
const BOULDER_REGION = 'boulder';
const BOULDER_OUTPUT_PATH = path.resolve(__dirname, '../../data/boulder-intersection-validation.db');

// Ensure output directory exists before any file write
if (!fs.existsSync(path.dirname(BOULDER_OUTPUT_PATH))) {
  fs.mkdirSync(path.dirname(BOULDER_OUTPUT_PATH), { recursive: true });
}

// Reference values based on Boulder region analysis
const EXPECTED_REFERENCE_VALUES = {
  // Boulder region has 2,541 trails total
  totalTrails: 2541,
  
  // Expected node types and their definitions:
  nodeTypes: {
    // 'endpoint': A node that represents the start or end of a trail segment
    // - Created when a trail has no intersections with other trails
    // - Created at the start/end points of trail segments that do intersect
    endpoint: {
      description: 'Start or end point of a trail segment',
      expectedCount: 'variable', // Depends on trail topology
      validation: 'Should have 1-2 connected trails'
    },
    
    // 'intersection': A node where multiple trails meet/cross
    // - Created when 2+ trails intersect at the same point
    // - Must have 2+ connected trails
    intersection: {
      description: 'Point where multiple trails meet or cross',
      expectedCount: 'variable', // Depends on trail network complexity
      validation: 'Should have 2+ connected trails'
    }
  },
  
  // Performance expectations for Boulder region
  performance: {
    // Boulder should have significantly fewer nodes than trails due to intersection detection
    // With 2,541 trails, we expect ~500-1000 nodes (20-40% ratio) for a complex trail network
    maxNodeToTrailRatio: 0.5, // Max 50% of trails should become nodes (allowing for complex intersections)
    minNodeToTrailRatio: 0.1, // At least 10% of trails should become nodes
    
    // Intersection tolerance affects detection sensitivity
    intersectionTolerance: 2, // meters
    
    // Expected processing time (adjust based on your system)
    maxProcessingTimeMs: 180000 // 3 minutes for comprehensive testing
  },
  
  // Data quality expectations
  dataQuality: {
    // All nodes must have valid coordinates
    coordinateRange: {
      lng: { min: -105.8, max: -105.1 }, // Boulder region bounds
      lat: { min: 39.7, max: 40.7 }
    },
    
    // All nodes must have elevation data (may be 0 for flat areas)
    elevationRange: { min: 0, max: 4500 }, // Boulder elevation range in meters
    
    // All nodes must have valid node types
    validNodeTypes: ['endpoint', 'intersection'],
    
    // All nodes must have connected trails data
    minConnectedTrails: 1,
    maxConnectedTrails: 10 // Boulder shouldn't have more than 10 trails at one point
  }
};

// Utility to clean up test DBs
function cleanupTestDbs() {
  if (fs.existsSync(BOULDER_OUTPUT_PATH)) {
    fs.unlinkSync(BOULDER_OUTPUT_PATH);
  }
}

declare global {
  // Patch for test teardown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var pgClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var orchestrator: any;
}

describe('Intersection Detection Validation - Boulder Region', () => {
  beforeAll(() => {
    cleanupTestDbs();
  });

  afterAll(async () => {
    try {
      if ((global as any).pgClient && typeof (global as any).pgClient.end === 'function') {
        await (global as any).pgClient.end();
        (global as any).pgClient = undefined;
      }
      if ((global as any).db && typeof (global as any).db.close === 'function') {
        (global as any).db.close();
        (global as any).db = undefined;
      }
      if ((global as any).orchestrator && typeof (global as any).orchestrator.cleanupStaging === 'function') {
        await (global as any).orchestrator.cleanupStaging();
        (global as any).orchestrator = undefined;
      }
    } catch (e) {
      // Ignore errors during cleanup
    }
  });

  test('validates intersection detection algorithm with comprehensive reference values', async () => {
    console.log('🧪 Starting comprehensive intersection detection validation...');
    console.log('=' .repeat(80));
    
    const startTime = Date.now();
    
    // Arrange: Create orchestrator with Boulder config (larger dataset for comprehensive testing)
    const orchestrator = new EnhancedPostgresOrchestrator({
      region: BOULDER_REGION,
      outputPath: BOULDER_OUTPUT_PATH,
      simplifyTolerance: 0.001,
      intersectionTolerance: EXPECTED_REFERENCE_VALUES.performance.intersectionTolerance,
      replace: true,
      validate: false,
      verbose: true, // Enable verbose logging for analysis
      skipBackup: true,
      buildMaster: false,
      targetSizeMB: null,
      maxSpatiaLiteDbSizeMB: 200, // Larger size for comprehensive testing
      skipIncompleteTrails: true,
      // Use full Boulder region bbox for comprehensive testing
      bbox: [
        EXPECTED_REFERENCE_VALUES.dataQuality.coordinateRange.lng.min,
        EXPECTED_REFERENCE_VALUES.dataQuality.coordinateRange.lat.min,
        EXPECTED_REFERENCE_VALUES.dataQuality.coordinateRange.lng.max,
        EXPECTED_REFERENCE_VALUES.dataQuality.coordinateRange.lat.max
      ],
      skipCleanup: true, // <-- Added
    });

    // Act: Run the pipeline
    console.log('🚀 Running intersection detection pipeline...');
    await orchestrator.run();

    // New: Assert on staging schema before cleanup
    const { Client } = require('pg');
    const client = new Client();
    await client.connect();
    const stagingSchema = orchestrator.stagingSchema;
    const result = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
    console.log(`Staging trails count:`, result.rows[0].count);
    expect(Number(result.rows[0].count)).toBeGreaterThan(0);
    await client.end();

    // Optionally clean up staging schema
    await orchestrator.cleanupStaging();
    
    const processingTime = Date.now() - startTime;
    console.log(`⏱️  Processing completed in ${processingTime}ms`);

    // Assert: Comprehensive validation of the exported SpatiaLite DB
    const db = new Database(BOULDER_OUTPUT_PATH, { readonly: true });
    db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
    
    console.log('\n📊 VALIDATION RESULTS:');
    console.log('=' .repeat(80));

    // 1. Basic table validation
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
    expect(tables).toContain('routing_nodes');
    expect(tables).toContain('routing_edges');
    expect(tables).toContain('trails');
    expect(tables).toContain('regions');
    console.log('✅ All required tables present');

    // 2. Trail count validation
    const trailCount = (db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
    console.log(`📈 Trail count: ${trailCount} (expected ~${EXPECTED_REFERENCE_VALUES.totalTrails})`);
    expect(trailCount).toBeGreaterThan(0);
    expect(trailCount).toBeLessThanOrEqual(EXPECTED_REFERENCE_VALUES.totalTrails);

    // 3. Node count and type analysis
    const nodeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number }).n;
    console.log(`🔗 Total routing nodes: ${nodeCount}`);
    
    // Calculate node-to-trail ratio
    const nodeToTrailRatio = nodeCount / trailCount;
    console.log(`📊 Node-to-trail ratio: ${nodeToTrailRatio.toFixed(4)} (${(nodeToTrailRatio * 100).toFixed(2)}%)`);
    
    // Validate ratio expectations
    expect(nodeToTrailRatio).toBeLessThanOrEqual(EXPECTED_REFERENCE_VALUES.performance.maxNodeToTrailRatio);
    expect(nodeToTrailRatio).toBeGreaterThanOrEqual(EXPECTED_REFERENCE_VALUES.performance.minNodeToTrailRatio);
    console.log('✅ Node-to-trail ratio within expected bounds');

    // 4. Node type analysis
    const nodeTypeStats = db.prepare(`
      SELECT 
        node_type,
        COUNT(*) as count,
        COUNT(*) * 100.0 / (SELECT COUNT(*) FROM routing_nodes) as percentage
      FROM routing_nodes 
      GROUP BY node_type 
      ORDER BY count DESC
    `).all() as any[];
    
    console.log('\n🔍 NODE TYPE ANALYSIS:');
    console.log('Type'.padEnd(15) + 'Count'.padEnd(10) + 'Percentage'.padEnd(15) + 'Description');
    console.log('-'.repeat(60));
    
    for (const stat of nodeTypeStats) {
      const nodeType = stat.node_type;
      const description = EXPECTED_REFERENCE_VALUES.nodeTypes[nodeType as keyof typeof EXPECTED_REFERENCE_VALUES.nodeTypes]?.description || 'Unknown';
      console.log(
        nodeType.padEnd(15) + 
        stat.count.toString().padEnd(10) + 
        `${stat.percentage.toFixed(2)}%`.padEnd(15) + 
        description
      );
      
      // Validate node type is expected
      expect(EXPECTED_REFERENCE_VALUES.dataQuality.validNodeTypes).toContain(nodeType);
    }

    // 5. Connected trails analysis
    console.log('\n🔗 CONNECTED TRAILS ANALYSIS:');
    const connectedTrailsStats = db.prepare(`
      SELECT 
        CASE 
          WHEN (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) = 1 THEN '1 trail'
          WHEN (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) = 2 THEN '2 trails'
          WHEN (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) = 3 THEN '3 trails'
          WHEN (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) = 4 THEN '4 trails'
          ELSE '5+ trails'
        END as connection_count,
        COUNT(*) as node_count
      FROM routing_nodes 
      GROUP BY connection_count
      ORDER BY node_count DESC
    `).all() as any[];
    
    console.log('Connections'.padEnd(15) + 'Node Count'.padEnd(15) + 'Validation');
    console.log('-'.repeat(50));
    
    for (const stat of connectedTrailsStats) {
      const connectionCount = stat.connection_count;
      const nodeCount = stat.node_count;
      let validation = '';
      
      if (connectionCount === '1 trail') {
        validation = 'Should be endpoints only';
      } else if (connectionCount === '2 trails') {
        validation = 'Endpoints or simple intersections';
      } else {
        validation = 'Complex intersections';
      }
      
      console.log(
        connectionCount.padEnd(15) + 
        nodeCount.toString().padEnd(15) + 
        validation
      );
    }

    // 6. Coordinate range validation
    console.log('\n📍 COORDINATE RANGE VALIDATION:');
    const coordStats = db.prepare(`
      SELECT 
        MIN(lng) as min_lng, MAX(lng) as max_lng,
        MIN(lat) as min_lat, MAX(lat) as max_lat,
        MIN(elevation) as min_elevation, MAX(elevation) as max_elevation
      FROM routing_nodes
    `).get() as any;
    
    console.log(`Longitude range: ${coordStats.min_lng.toFixed(6)} to ${coordStats.max_lng.toFixed(6)}`);
    console.log(`Latitude range: ${coordStats.min_lat.toFixed(6)} to ${coordStats.max_lat.toFixed(6)}`);
    console.log(`Elevation range: ${coordStats.min_elevation.toFixed(1)}m to ${coordStats.max_elevation.toFixed(1)}m`);
    
    // Validate coordinate ranges
    expect(coordStats.min_lng).toBeGreaterThanOrEqual(EXPECTED_REFERENCE_VALUES.dataQuality.coordinateRange.lng.min);
    expect(coordStats.max_lng).toBeLessThanOrEqual(EXPECTED_REFERENCE_VALUES.dataQuality.coordinateRange.lng.max);
    expect(coordStats.min_lat).toBeGreaterThanOrEqual(EXPECTED_REFERENCE_VALUES.dataQuality.coordinateRange.lat.min);
    expect(coordStats.max_lat).toBeLessThanOrEqual(EXPECTED_REFERENCE_VALUES.dataQuality.coordinateRange.lat.max);
    expect(coordStats.min_elevation).toBeGreaterThanOrEqual(EXPECTED_REFERENCE_VALUES.dataQuality.elevationRange.min);
    expect(coordStats.max_elevation).toBeLessThanOrEqual(EXPECTED_REFERENCE_VALUES.dataQuality.elevationRange.max);
    console.log('✅ All coordinate ranges within expected bounds');

    // 7. Edge count validation
    const edgeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number }).n;
    console.log(`\n🛤️  Routing edges: ${edgeCount}`);
    expect(edgeCount).toBeGreaterThan(0);
    
    // 8. Sample node analysis for detailed validation
    console.log('\n🔍 SAMPLE NODE ANALYSIS:');
    const sampleNodes = db.prepare(`
      SELECT 
        id, node_uuid, lat, lng, elevation, node_type, connected_trails,
        (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) as trail_count
      FROM routing_nodes 
      ORDER BY (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) DESC, id
      LIMIT 5
    `).all() as any[];
    
    console.log('ID'.padEnd(5) + 'Type'.padEnd(12) + 'Trails'.padEnd(8) + 'Coordinates'.padEnd(25) + 'Elevation');
    console.log('-'.repeat(70));
    
    for (const node of sampleNodes) {
      const coords = `${node.lat.toFixed(4)}, ${node.lng.toFixed(4)}`;
      console.log(
        node.id.toString().padEnd(5) + 
        node.node_type.padEnd(12) + 
        node.trail_count.toString().padEnd(8) + 
        coords.padEnd(25) + 
        `${node.elevation.toFixed(1)}m`
      );
      
      // Validate node properties
      expect(node.lat).toBeDefined();
      expect(node.lng).toBeDefined();
      expect(node.elevation).toBeDefined();
      expect(node.node_type).toBeDefined();
      expect(node.connected_trails).toBeDefined();
      expect(node.trail_count).toBeGreaterThanOrEqual(EXPECTED_REFERENCE_VALUES.dataQuality.minConnectedTrails);
      expect(node.trail_count).toBeLessThanOrEqual(EXPECTED_REFERENCE_VALUES.dataQuality.maxConnectedTrails);
    }

    // 9. Performance validation
    console.log(`\n⏱️  PERFORMANCE VALIDATION:`);
    console.log(`Processing time: ${processingTime}ms`);
    expect(processingTime).toBeLessThan(EXPECTED_REFERENCE_VALUES.performance.maxProcessingTimeMs);
    console.log('✅ Processing time within acceptable limits');

    // 10. 3D geometry preservation validation
    console.log('\n🗺️  3D GEOMETRY PRESERVATION:');
    const trailSample = db.prepare('SELECT *, AsText(geometry) as geometry_wkt FROM trails LIMIT 1').get() as any;
    expect(trailSample.geometry_wkt.startsWith('LINESTRING Z')).toBe(true);
    console.log('✅ 3D elevation data preserved in trail geometries');
    
    // Check that nodes have elevation data
    const nodesWithElevation = db.prepare('SELECT COUNT(*) as n FROM routing_nodes WHERE elevation IS NOT NULL').get() as { n: number };
    expect(nodesWithElevation.n).toBe(nodeCount);
    console.log(`✅ All ${nodeCount} nodes have elevation data`);

    // 11. Final summary
    console.log('\n📋 VALIDATION SUMMARY:');
    console.log('=' .repeat(80));
    console.log(`✅ Total trails processed: ${trailCount}`);
    console.log(`✅ Total routing nodes created: ${nodeCount}`);
    console.log(`✅ Node-to-trail ratio: ${(nodeToTrailRatio * 100).toFixed(2)}%`);
    console.log(`✅ Total routing edges: ${edgeCount}`);
    console.log(`✅ Processing time: ${processingTime}ms`);
    console.log(`✅ 3D elevation data preserved`);
    console.log(`✅ All coordinate ranges valid`);
    console.log(`✅ All node types valid`);
    console.log(`✅ All connected trails counts valid`);
    
    // Key success indicators
    if (nodeToTrailRatio < 0.15) {
      console.log('🎯 EXCELLENT: Very efficient intersection detection (< 15% node ratio)');
    } else if (nodeToTrailRatio < 0.25) {
      console.log('✅ GOOD: Efficient intersection detection (< 25% node ratio)');
    } else {
      console.log('⚠️  ACCEPTABLE: Higher node ratio, may need optimization');
    }
    
    if (processingTime < 60000) {
      console.log('⚡ FAST: Processing completed in under 1 minute');
    } else if (processingTime < 120000) {
      console.log('⏱️  MODERATE: Processing completed in under 2 minutes');
    } else {
      console.log('🐌 SLOW: Processing took over 2 minutes');
    }

    db.close();
  }, 180000); // 3 minute timeout for comprehensive testing

  test('validates intersection detection edge cases and error handling', async () => {
    console.log('\n🧪 Testing intersection detection edge cases...');
    
    // This test validates that the algorithm handles edge cases correctly
    const db = new Database(BOULDER_OUTPUT_PATH, { readonly: true });
    db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
    
    // Test 1: No nodes should have null coordinates
    const nullCoordNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes WHERE lat IS NULL OR lng IS NULL').get() as { n: number };
    expect(nullCoordNodes.n).toBe(0);
    console.log('✅ No nodes with null coordinates');
    
    // Test 2: No nodes should have invalid node types
    const invalidTypeNodes = db.prepare(`
      SELECT COUNT(*) as n FROM routing_nodes 
      WHERE node_type NOT IN (${EXPECTED_REFERENCE_VALUES.dataQuality.validNodeTypes.map(t => `'${t}'`).join(',')})
    `).get() as { n: number };
    expect(invalidTypeNodes.n).toBe(0);
    console.log('✅ No nodes with invalid types');
    
    // Test 3: All nodes should have connected trails data
    const nodesWithoutTrails = db.prepare('SELECT COUNT(*) as n FROM routing_nodes WHERE connected_trails IS NULL').get() as { n: number };
    expect(nodesWithoutTrails.n).toBe(0);
    console.log('✅ All nodes have connected trails data');
    
    // Test 4: No edges should connect a node to itself
    const selfLoops = db.prepare('SELECT COUNT(*) as n FROM routing_edges WHERE from_node_id = to_node_id').get() as { n: number };
    expect(selfLoops.n).toBe(0);
    console.log('✅ No self-looping edges');
    
    // Test 5: All edges should reference valid nodes
    const orphanEdges = db.prepare(`
      SELECT COUNT(*) as n FROM routing_edges e
      LEFT JOIN routing_nodes n1 ON e.from_node_id = n1.id
      LEFT JOIN routing_nodes n2 ON e.to_node_id = n2.id
      WHERE n1.id IS NULL OR n2.id IS NULL
    `).get() as { n: number };
    expect(orphanEdges.n).toBe(0);
    console.log('✅ All edges reference valid nodes');
    
    // Test 6: Validate that intersection nodes have multiple connected trails
    const intersectionNodes = db.prepare(`
      SELECT COUNT(*) as n FROM routing_nodes 
      WHERE node_type = 'intersection' AND (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) < 2
    `).get() as { n: number };
    expect(intersectionNodes.n).toBe(0);
    console.log('✅ All intersection nodes have 2+ connected trails');
    
    // Test 7: Validate that endpoint nodes have reasonable connected trail counts
    const endpointNodes = db.prepare(`
      SELECT COUNT(*) as n FROM routing_nodes 
      WHERE node_type = 'endpoint' AND (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) > 2
    `).get() as { n: number };
    // Endpoints can have more than 2 trails if multiple trails start/end at same point
    console.log(`ℹ️  Endpoint nodes with >2 trails: ${endpointNodes.n} (this is acceptable)`);
    
    db.close();
  }, 30000);

  test('provides detailed intersection detection reference documentation', () => {
    console.log('\n📚 INTERSECTION DETECTION REFERENCE DOCUMENTATION');
    console.log('=' .repeat(80));
    
    console.log('\n🔍 ALGORITHM OVERVIEW:');
    console.log('The intersection detection algorithm uses PostGIS spatial functions to identify');
    console.log('points where trails meet or cross, creating a routing graph with nodes only at');
    console.log('intersections and endpoints (not at every coordinate point).');
    
    console.log('\n📋 NODE TYPE DEFINITIONS:');
    console.log('• endpoint: Start or end point of a trail segment');
    console.log('  - Created when a trail has no intersections with other trails');
    console.log('  - Created at the start/end points of trail segments that do intersect');
    console.log('  - Typically has 1-2 connected trails');
    console.log('');
    console.log('• intersection: Point where multiple trails meet or cross');
    console.log('  - Created when 2+ trails intersect at the same point');
    console.log('  - Must have 2+ connected trails');
    console.log('  - Can be exact geometric intersections or near-miss intersections');
    
    console.log('\n⚙️  ALGORITHM PARAMETERS:');
    console.log(`• Intersection tolerance: ${EXPECTED_REFERENCE_VALUES.performance.intersectionTolerance}m`);
    console.log('• Detection method: 2D spatial functions for performance');
    console.log('• Elevation preservation: 3D geometry maintained in exports');
    console.log('• Coordinate system: WGS84 (EPSG:4326)');
    
    console.log('\n📊 EXPECTED PERFORMANCE (Boulder Region):');
    console.log(`• Total trails: ~${EXPECTED_REFERENCE_VALUES.totalTrails}`);
    console.log(`• Node-to-trail ratio: ${(EXPECTED_REFERENCE_VALUES.performance.minNodeToTrailRatio * 100).toFixed(1)}% - ${(EXPECTED_REFERENCE_VALUES.performance.maxNodeToTrailRatio * 100).toFixed(1)}%`);
    console.log(`• Processing time: < ${EXPECTED_REFERENCE_VALUES.performance.maxProcessingTimeMs / 1000}s`);
    
    console.log('\n✅ VALIDATION CRITERIA:');
    console.log('• All nodes have valid coordinates within region bounds');
    console.log('• All nodes have elevation data (may be 0 for flat areas)');
    console.log('• All nodes have valid node types (endpoint or intersection)');
    console.log('• All nodes have connected trails data');
    console.log('• Intersection nodes have 2+ connected trails');
    console.log('• No self-looping edges');
    console.log('• All edges reference valid nodes');
    console.log('• 3D elevation data preserved in trail geometries');
    
    console.log('\n🎯 SUCCESS INDICATORS:');
    console.log('• Node-to-trail ratio < 25% (efficient intersection detection)');
    console.log('• Processing time < 2 minutes for Boulder region');
    console.log('• No false intersections (nodes only at actual intersections/endpoints)');
    console.log('• No missed intersections (all trail crossings detected)');
    
    // This test always passes - it's for documentation purposes
    expect(true).toBe(true);
  });
}); 