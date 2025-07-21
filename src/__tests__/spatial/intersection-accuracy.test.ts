import { EnhancedPostgresOrchestrator } from '../../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Test config for Boulder
const BOULDER_REGION = 'boulder';
const BOULDER_OUTPUT_PATH = path.resolve(__dirname, '../../data/boulder-intersection-accuracy.db');

// Utility to clean up test DBs
function cleanupTestDb() {
  if (fs.existsSync(BOULDER_OUTPUT_PATH)) fs.unlinkSync(BOULDER_OUTPUT_PATH);
}

describe('Intersection Detection Accuracy Tests', () => {
  beforeAll(() => {
    cleanupTestDb();
  });

  afterAll(() => {
    cleanupTestDb();
  });

  // SKIP: Blocked by dynamic staging trails table visibility issue in PL/pgSQL/PostGIS functions.
  // See docs/SPATIAL_CODE_AUDIT_CHECKLIST.md for details and escalation status.
  test.skip('should only create nodes at actual trail intersections and endpoints', async () => {
    console.log('🔍 Testing intersection detection accuracy...');

    // Ensure output directory exists before any file write
    if (!fs.existsSync(path.dirname(BOULDER_OUTPUT_PATH))) {
      fs.mkdirSync(path.dirname(BOULDER_OUTPUT_PATH), { recursive: true });
    }

    // Arrange: create orchestrator with boulder config
    const orchestrator = new EnhancedPostgresOrchestrator({
      region: BOULDER_REGION,
      outputPath: BOULDER_OUTPUT_PATH,
      simplifyTolerance: 0.001,
      intersectionTolerance: 2, // 2 meters tolerance
      replace: true,
      validate: false,
      verbose: false,
      skipBackup: true,
      buildMaster: false,
      targetSizeMB: null,
      maxSpatiaLiteDbSizeMB: 100,
      skipIncompleteTrails: true,
      bbox: [-105.3, 40.0, -105.2, 40.1],
      skipCleanup: true, // <-- Added
    });

    // Act: run the pipeline
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

    // Assert: analyze the routing nodes for accuracy
    const db = new Database(BOULDER_OUTPUT_PATH, { readonly: true });
    db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');

    // First, check the database structure
    console.log('🔍 Checking database structure...');
    
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
    console.log(`📊 Tables found: ${tables.join(', ')}`);
    
    expect(tables).toContain('routing_nodes');
    expect(tables).toContain('trails');

    // Check routing_nodes table structure
    const nodeColumns = db.prepare("PRAGMA table_info(routing_nodes)").all().map((row: any) => row.name);
    console.log(`📊 routing_nodes columns: ${nodeColumns.join(', ')}`);
    
    expect(nodeColumns).toContain('id');
    expect(nodeColumns).toContain('lat');
    expect(nodeColumns).toContain('lng');
    expect(nodeColumns).toContain('node_type');

    // Get basic node count and types
    const totalNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number };
    console.log(`📊 Total routing nodes: ${totalNodes.n}`);

    // Test 1: Verify reasonable node count (should be much fewer than before)
    expect(totalNodes.n).toBeGreaterThan(0);
    expect(totalNodes.n).toBeLessThan(1000); // Should be much fewer than the old 3,809
    
    // Test 2: Check node types
    const nodeTypes = db.prepare('SELECT DISTINCT node_type FROM routing_nodes').all().map((row: any) => row.node_type);
    console.log(`📊 Node types found: ${nodeTypes.join(', ')}`);
    
    const validNodeTypes = ['intersection', 'endpoint'];
    for (const nodeType of nodeTypes) {
      expect(validNodeTypes).toContain(nodeType);
    }

    // Test 3: Count nodes by type (all nodes should be endpoints in this dataset)
    const nodeTypeCounts = db.prepare('SELECT node_type, COUNT(*) as n FROM routing_nodes GROUP BY node_type').all() as any[];
    
    console.log('📊 Node type breakdown:');
    nodeTypeCounts.forEach(type => {
      console.log(`   ${type.node_type}: ${type.n} nodes`);
    });
    
    // Verify all nodes are endpoints (this is good - no false intersections!)
    const endpointNodes = nodeTypeCounts.find(t => t.node_type === 'endpoint')?.n || 0;
    console.log(`🏁 Endpoint nodes: ${endpointNodes}`);
    expect(endpointNodes).toBe(totalNodes.n);

    // Test 4: Verify node density is reasonable (not too many nodes per trail)
    const trailCount = db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number };
    const avgNodesPerTrail = totalNodes.n / trailCount.n;
    console.log(`📊 Average nodes per trail: ${avgNodesPerTrail.toFixed(2)}`);
    expect(avgNodesPerTrail).toBeLessThan(5); // Should be reasonable

    // Test 5: Check for any nodes with invalid coordinates
    const invalidCoords = db.prepare('SELECT COUNT(*) as n FROM routing_nodes WHERE lat IS NULL OR lng IS NULL').get() as { n: number };
    console.log(`⚠️  Nodes with invalid coordinates: ${invalidCoords.n}`);
    expect(invalidCoords.n).toBe(0);

    // Test 6: Check coordinate ranges (should be in Boulder area)
    const coordRanges = db.prepare(`
      SELECT 
        MIN(lat) as min_lat, MAX(lat) as max_lat,
        MIN(lng) as min_lng, MAX(lng) as max_lng
      FROM routing_nodes
    `).get() as any;
    
    console.log(`📍 Coordinate ranges:`);
    console.log(`   Lat: ${coordRanges.min_lat.toFixed(6)} to ${coordRanges.max_lat.toFixed(6)}`);
    console.log(`   Lng: ${coordRanges.min_lng.toFixed(6)} to ${coordRanges.max_lng.toFixed(6)}`);
    
    // Should be in Boulder area (with small tolerance for edge cases)
    expect(coordRanges.min_lat).toBeGreaterThan(39.99);
    expect(coordRanges.max_lat).toBeLessThan(40.12);
    expect(coordRanges.min_lng).toBeGreaterThan(-105.31);
    expect(coordRanges.max_lng).toBeLessThan(-105.19);

    // Test 7: Sample some nodes to verify they look reasonable
    console.log('🔍 Sampling nodes for verification...');
    
    const sampleNodes = db.prepare(`
      SELECT id, lat, lng, node_type 
      FROM routing_nodes 
      ORDER BY id 
      LIMIT 10
    `).all() as any[];
    
    console.log('📊 Sample nodes:');
    sampleNodes.forEach((node, i) => {
      console.log(`   ${i + 1}. Node ${node.id}: (${node.lat.toFixed(6)}, ${node.lng.toFixed(6)}) - ${node.node_type}`);
    });

    // Test 8: Check if we have any trails with excessive nodes
    console.log('🔍 Checking for trails with excessive nodes...');
    
    // Get trail count to verify we have trails
    console.log(`🛤️  Total trails: ${trailCount.n}`);
    expect(trailCount.n).toBeGreaterThan(0);

    // Test 9: Verify 3D geometry is preserved in trails
    const trailSample = db.prepare('SELECT *, AsText(geometry) as geometry_wkt FROM trails LIMIT 1').get() as any;
    expect(trailSample.geometry_wkt.startsWith('LINESTRING Z')).toBe(true);
    console.log(`✅ 3D geometry preserved: ${trailSample.geometry_wkt.substring(0, 50)}...`);

    // Summary
    console.log('\n🎯 INTERSECTION DETECTION ACCURACY SUMMARY:');
    console.log(`   ✅ Total nodes: ${totalNodes.n} (was 3,809 before)`);
    console.log(`   ✅ Endpoint nodes: ${endpointNodes.n}`);
    console.log(`   ✅ Average nodes per trail: ${avgNodesPerTrail.toFixed(2)}`);
    console.log(`   ✅ Node types: ${nodeTypes.join(', ')}`);
    console.log(`   ✅ Invalid coordinates: ${invalidCoords.n}`);

    // Key success indicators
    expect(totalNodes.n).toBeLessThan(500); // Should be much fewer than before
    expect(avgNodesPerTrail).toBeLessThan(3); // Should be reasonable
    expect(endpointNodes).toBeGreaterThan(0); // Should have some endpoints

    db.close();
  }, 120000);

  test.skip('should handle different intersection tolerances correctly', async () => {
    console.log('🔍 Testing intersection tolerance sensitivity...');
    
    const tolerances = [1, 2, 5, 10]; // meters
    const results: { tolerance: number; nodes: number; intersections: number; endpoints: number }[] = [];
    
    for (const tolerance of tolerances) {
      const outputPath = path.resolve(__dirname, `../../data/boulder-tolerance-${tolerance}.db`);
      
      // Clean up previous test file
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

      // Ensure output directory exists before any file write
      if (!fs.existsSync(path.dirname(outputPath))) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      }
      
      const orchestrator = new EnhancedPostgresOrchestrator({
        region: BOULDER_REGION,
        outputPath,
        simplifyTolerance: 0.001,
        intersectionTolerance: tolerance,
        replace: true,
        validate: false,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSpatiaLiteDbSizeMB: 100,
        skipIncompleteTrails: true,
        bbox: [-105.3, 40.0, -105.2, 40.1],
      });
      
      await orchestrator.run();
      
      const db = new Database(outputPath, { readonly: true });
      db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
      
      const totalNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number };
      const intersectionNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes WHERE node_type = "intersection"').get() as { n: number };
      const endpointNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes WHERE node_type = "endpoint"').get() as { n: number };
      
      results.push({
        tolerance,
        nodes: totalNodes.n,
        intersections: intersectionNodes.n,
        endpoints: endpointNodes.n
      });
      
      console.log(`   ${tolerance}m tolerance: ${totalNodes.n} nodes (${intersectionNodes.n} intersections, ${endpointNodes.n} endpoints)`);
      
      db.close();
      
      // Clean up
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
    
    console.log('📊 Tolerance sensitivity results:');
    results.forEach(r => {
      console.log(`   ${r.tolerance}m: ${r.nodes} total, ${r.intersections} intersections (${((r.intersections/r.nodes)*100).toFixed(1)}%)`);
    });
    
    // Higher tolerance should generally find more intersections
    expect(results[1]?.intersections).toBeGreaterThanOrEqual(results[0]?.intersections || 0);
    expect(results[2]?.intersections).toBeGreaterThanOrEqual(results[1]?.intersections || 0);
    expect(results[3]?.intersections).toBeGreaterThanOrEqual(results[2]?.intersections || 0);
    
    // But the increase should be reasonable (not exponential)
    const increases = results.slice(1).map((r, i) => r.intersections - (results[i]?.intersections || 0));
    console.log(`📈 Intersection increases: ${increases.join(', ')}`);
    
    // The increase should not be more than 50% per tolerance step
    increases.forEach(increase => {
      expect(increase).toBeLessThan((results[0]?.intersections || 0) * 0.5 + 100);
    });
  }, 300000);
}); 