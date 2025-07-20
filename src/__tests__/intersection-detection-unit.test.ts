import { EnhancedPostgresOrchestrator } from '../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Test config for unit tests
const TEST_REGION = 'test-unit';
const TEST_OUTPUT_PATH = path.resolve(__dirname, '../../data/test-unit-intersections.db');

// Utility to clean up test DBs
function cleanupTestDb() {
  if (fs.existsSync(TEST_OUTPUT_PATH)) fs.unlinkSync(TEST_OUTPUT_PATH);
}

describe('Intersection Detection - Unit Tests', () => {
  beforeAll(() => {
    cleanupTestDb();
  });

  afterAll(() => {
    cleanupTestDb();
  });

  describe('Algorithm Analysis', () => {
    test('should identify the core intersection detection problems', async () => {
      console.log('🔍 Analyzing current intersection detection algorithm...');
      
      const orchestrator = new EnhancedPostgresOrchestrator({
        region: 'boulder',
        outputPath: TEST_OUTPUT_PATH,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2,
        replace: true,
        validate: false,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSpatiaLiteDbSizeMB: 100,
        skipIncompleteTrails: true,
        bbox: [-105.3, 40.0, -105.2, 40.1], // Small test area
      });

      await orchestrator.run();

      // Analyze the results
      const db = new Database(TEST_OUTPUT_PATH, { readonly: true });
      db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');

      // Get routing node statistics
      const totalNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number };
      const intersectionNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes WHERE node_type = "intersection"').get() as { n: number };
      const endpointNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes WHERE node_type = "endpoint"').get() as { n: number };
      const trailCount = db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number };

      console.log('\n📊 INTERSECTION DETECTION ANALYSIS:');
      console.log(`   Total trails: ${trailCount.n}`);
      console.log(`   Total nodes: ${totalNodes.n}`);
      console.log(`   Intersection nodes: ${intersectionNodes.n}`);
      console.log(`   Endpoint nodes: ${endpointNodes.n}`);
      console.log(`   Intersection ratio: ${((intersectionNodes.n / totalNodes.n) * 100).toFixed(1)}%`);
      console.log(`   Average nodes per trail: ${(totalNodes.n / trailCount.n).toFixed(1)}`);

      // Check for the main problems
      const singleTrailNodes = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE json_array_length(connected_trails) = 1
      `).get() as { n: number };

      const falseIntersections = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE node_type = 'intersection' AND json_array_length(connected_trails) = 1
      `).get() as { n: number };

      const missedIntersections = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE node_type = 'endpoint' AND json_array_length(connected_trails) > 1
      `).get() as { n: number };

      console.log('\n🚨 PROBLEM ANALYSIS:');
      console.log(`   Single-trail nodes: ${singleTrailNodes.n} (${((singleTrailNodes.n / totalNodes.n) * 100).toFixed(1)}%)`);
      console.log(`   False intersections: ${falseIntersections.n}`);
      console.log(`   Missed intersections: ${missedIntersections.n}`);

      // Sample some nodes to understand the issue
      const nodeSample = db.prepare(`
        SELECT id, lat, lng, node_type, connected_trails, 
               json_array_length(connected_trails) as trail_count
        FROM routing_nodes 
        ORDER BY json_array_length(connected_trails) DESC 
        LIMIT 5
      `).all() as any[];

      console.log('\n🔎 TOP 5 NODES BY CONNECTED TRAILS:');
      nodeSample.forEach((node, i) => {
        console.log(`   ${i + 1}. Node ${node.id} (${node.lat.toFixed(6)}, ${node.lng.toFixed(6)}) - Type: ${node.node_type} - Trails: ${node.trail_count}`);
      });

      // Check if we're creating nodes for every coordinate point
      const coordinateNodes = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE json_array_length(connected_trails) = 1
      `).get() as { n: number };

      console.log('\n💡 DIAGNOSIS:');
      if (coordinateNodes.n > trailCount.n * 10) {
        console.log('   ❌ PROBLEM: Creating nodes for every coordinate point along trails');
        console.log('   💡 SOLUTION: Only create nodes at trail endpoints and actual intersections');
      } else {
        console.log('   ✅ Node creation looks reasonable');
      }

      if (falseIntersections.n > 0) {
        console.log('   ❌ PROBLEM: Nodes marked as intersections but only have 1 connected trail');
        console.log('   💡 SOLUTION: Fix node type classification logic');
      } else {
        console.log('   ✅ Node type classification looks correct');
      }

      if (missedIntersections.n > 0) {
        console.log('   ❌ PROBLEM: Nodes with multiple trails marked as endpoints');
        console.log('   💡 SOLUTION: Fix node type classification logic');
      } else {
        console.log('   ✅ No missed intersections detected');
      }

      // Expectations for a reasonable trail network
      expect(intersectionNodes.n).toBeLessThan(totalNodes.n * 0.2); // Should be less than 20% intersections
      expect(totalNodes.n).toBeLessThan(trailCount.n * 10); // Should be reasonable number of nodes per trail
      expect(falseIntersections.n).toBe(0); // No false intersections
      expect(missedIntersections.n).toBe(0); // No missed intersections

      db.close();
    }, 120000);

    test('should test intersection tolerance sensitivity', async () => {
      console.log('🔍 Testing intersection tolerance sensitivity...');
      
      const tolerances = [1, 5, 10, 20]; // meters
      const results: { tolerance: number; nodes: number; intersectionNodes: number; ratio: number }[] = [];

      for (const tolerance of tolerances) {
        const outputPath = TEST_OUTPUT_PATH + `.${tolerance}m`;
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

        const orchestrator = new EnhancedPostgresOrchestrator({
          region: 'boulder',
          outputPath: outputPath,
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
        const ratio = (intersectionNodes.n / totalNodes.n) * 100;

        results.push({
          tolerance,
          nodes: totalNodes.n,
          intersectionNodes: intersectionNodes.n,
          ratio
        });

        console.log(`   ${tolerance}m tolerance: ${totalNodes.n} nodes, ${intersectionNodes.n} intersections (${ratio.toFixed(1)}%)`);
        
        db.close();
        fs.unlinkSync(outputPath);
      }

      console.log('\n📊 TOLERANCE SENSITIVITY RESULTS:');
      results.forEach(r => {
        console.log(`   ${r.tolerance}m: ${r.nodes} nodes, ${r.intersectionNodes} intersections (${r.ratio.toFixed(1)}%)`);
      });

      // Higher tolerance should generally find more intersections
      expect(results[1]?.intersectionNodes).toBeGreaterThanOrEqual(results[0]?.intersectionNodes || 0);
      expect(results[2]?.intersectionNodes).toBeGreaterThanOrEqual(results[1]?.intersectionNodes || 0);
      expect(results[3]?.intersectionNodes).toBeGreaterThanOrEqual(results[2]?.intersectionNodes || 0);
    }, 300000);
  });

  describe('Algorithm Validation', () => {
    test('should validate that intersection detection is working correctly', async () => {
      console.log('🔍 Validating intersection detection correctness...');
      
      const orchestrator = new EnhancedPostgresOrchestrator({
        region: 'boulder',
        outputPath: TEST_OUTPUT_PATH,
        simplifyTolerance: 0.001,
        intersectionTolerance: 5, // 5 meters tolerance
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

      const db = new Database(TEST_OUTPUT_PATH, { readonly: true });
      db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');

      // Validate node classification
      const falseIntersections = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE node_type = 'intersection' AND json_array_length(connected_trails) = 1
      `).get() as { n: number };

      const missedIntersections = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE node_type = 'endpoint' AND json_array_length(connected_trails) > 1
      `).get() as { n: number };

      console.log(`✅ Validation Results:`);
      console.log(`   False intersections: ${falseIntersections.n}`);
      console.log(`   Missed intersections: ${missedIntersections.n}`);

      // These should be 0 for correct intersection detection
      expect(falseIntersections.n).toBe(0);
      expect(missedIntersections.n).toBe(0);

      db.close();
    }, 120000);
  });
}); 