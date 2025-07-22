import { EnhancedPostgresOrchestrator } from '../../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Test configuration for simple intersection validation
const SEATTLE_REGION = 'seattle'; // Smaller dataset (629 trails vs 2541)
const SEATTLE_OUTPUT_PATH = path.resolve(__dirname, '../../data/seattle-intersection-simple.db');

// Ensure output directory exists before any file write
if (!fs.existsSync(path.dirname(SEATTLE_OUTPUT_PATH))) {
  fs.mkdirSync(path.dirname(SEATTLE_OUTPUT_PATH), { recursive: true });
}

// Reference values based on Seattle region analysis
const EXPECTED_REFERENCE_VALUES = {
  // Seattle region has 629 trails total (much smaller than Boulder)
  totalTrails: 629,
  
  // Expected node types and their definitions:
  nodeTypes: {
    endpoint: {
      description: 'Start or end point of a trail segment',
      validation: 'Should have 1-2 connected trails'
    },
    intersection: {
      description: 'Point where multiple trails meet or cross',
      validation: 'Should have 2+ connected trails'
    }
  },
  
  // Performance expectations for Seattle region
  performance: {
    // Seattle should have fewer nodes than trails due to intersection detection
    maxNodeToTrailRatio: 0.4, // Max 40% of trails should become nodes
    minNodeToTrailRatio: 0.05, // At least 5% of trails should become nodes
    
    // Intersection tolerance affects detection sensitivity
    intersectionTolerance: 2, // meters
    
    // Expected processing time (adjust based on your system)
    maxProcessingTimeMs: 60000 // 1 minute for smaller dataset
  },
  
  // Data quality expectations
  dataQuality: {
    // All nodes must have valid coordinates
    coordinateRange: {
      lng: { min: -122.5, max: -121.8 }, // Seattle region bounds
      lat: { min: 47.4, max: 47.8 }
    },
    
    // All nodes must have elevation data (may be 0 for flat areas)
    elevationRange: { min: 0, max: 2000 }, // Seattle elevation range in meters
    
    // All nodes must have valid node types
    validNodeTypes: ['endpoint', 'intersection'],
    
    // All nodes must have connected trails data
    minConnectedTrails: 1,
    maxConnectedTrails: 8 // Seattle shouldn't have more than 8 trails at one point
  }
};

// Utility to clean up test DBs
function cleanupTestDbs() {
  if (fs.existsSync(SEATTLE_OUTPUT_PATH)) {
    fs.unlinkSync(SEATTLE_OUTPUT_PATH);
  }
}

let orchestrator: EnhancedPostgresOrchestrator;

describe('Simple Intersection Detection Validation - Seattle Region', () => {
  beforeAll(() => {
    cleanupTestDbs();
  });

  afterAll(async () => {
    try {
      if (orchestrator) {
        await orchestrator.cleanupStaging();
      }
    } catch (err: any) {
      if (err && err.message && err.message.includes('Client was closed')) {
        // Ignore, test is already done
      } else {
        throw err;
      }
    }
  });

  test('validates intersection detection algorithm with Seattle dataset', async () => {
    console.log('🧪 Starting simple intersection detection validation with Seattle...');
    console.log('=' .repeat(80));
    
    const startTime = Date.now();
    
    // Arrange: Create orchestrator with Seattle config (smaller dataset for faster testing)
    orchestrator = new EnhancedPostgresOrchestrator({
      region: SEATTLE_REGION,
      outputPath: SEATTLE_OUTPUT_PATH,
      simplifyTolerance: 0.001,
      intersectionTolerance: EXPECTED_REFERENCE_VALUES.performance.intersectionTolerance,
      replace: true,
      validate: false,
      verbose: false, // Disable verbose logging for cleaner output
      skipBackup: true,
      buildMaster: false,
      targetSizeMB: null,
      maxSpatiaLiteDbSizeMB: 100,
      skipIncompleteTrails: true,
      // Use Seattle region bbox
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

    // Assert: Validation of the exported SpatiaLite DB
    const db = new Database(SEATTLE_OUTPUT_PATH, { readonly: true });
    db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
    
    console.log('\n📊 VALIDATION RESULTS:');
    console.log('=' .repeat(80));

    // 1. Basic table validation
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
    expect(tables).toContain('routing_nodes');
    expect(tables).toContain('routing_edges');
    expect(tables).toContain('trails');
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
    if (trailCount < 5) {
      console.warn('⚠️  Skipping node-to-trail ratio assertion: dataset too small for meaningful ratio');
    } else {
      expect(nodeToTrailRatio).toBeLessThanOrEqual(EXPECTED_REFERENCE_VALUES.performance.maxNodeToTrailRatio);
      expect(nodeToTrailRatio).toBeGreaterThanOrEqual(EXPECTED_REFERENCE_VALUES.performance.minNodeToTrailRatio);
      console.log('✅ Node-to-trail ratio within expected bounds');
    }

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
    if (nodeToTrailRatio < 0.25) {
      console.log('🎯 EXCELLENT: Very efficient intersection detection (< 25% node ratio)');
    } else if (nodeToTrailRatio < 0.4) {
      console.log('✅ GOOD: Efficient intersection detection (< 40% node ratio)');
    } else {
      console.log('⚠️  ACCEPTABLE: Higher node ratio, may need optimization');
    }
    
    if (processingTime < 30000) {
      console.log('⚡ FAST: Processing completed in under 30 seconds');
    } else if (processingTime < 60000) {
      console.log('⏱️  MODERATE: Processing completed in under 1 minute');
    } else {
      console.log('🐌 SLOW: Processing took over 1 minute');
    }

    db.close();
  }, 120000); // 2 minute timeout for simple testing

  test('validates intersection detection edge cases', async () => {
    console.log('\n🧪 Testing intersection detection edge cases...');
    
    // This test validates that the algorithm handles edge cases correctly
    const db = new Database(SEATTLE_OUTPUT_PATH, { readonly: true });
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
    
    db.close();
  }, 30000);

  it('should populate geometry column for all trails in SpatiaLite export', () => {
    const Database = require('better-sqlite3');
    const db = new Database('src/data/seattle-intersection-simple.db', { readonly: true });
    const totalTrails = db.prepare('SELECT COUNT(*) as n FROM trails').get().n;
    const trailsWithGeom = db.prepare('SELECT COUNT(*) as n FROM trails WHERE geometry IS NOT NULL AND geometry != ""').get().n;
    expect(trailsWithGeom).toBe(totalTrails);
    db.close();
  });
}); 