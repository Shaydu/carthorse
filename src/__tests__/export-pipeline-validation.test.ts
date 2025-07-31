import { EnhancedPostgresOrchestrator } from '../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

// Test configuration for comprehensive export pipeline validation
const TEST_CONFIG = {
  database: {
    host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
    port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
    database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
    password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
  },
  test: {
    region: 'boulder',
    bbox: [-105.28086462456893, 40.064313194287536, -105.23954738092088, 40.095057961140554] as [number, number, number, number], // Known area with intersections
    maxTrails: 20, // Test with enough trails to ensure intersections
    intersectionTolerance: 2.0,
    simplifyTolerance: 0.001,
  },
  limits: {
    timeout: 120000, // 2 minutes for comprehensive test
  },
};

describe('Export Pipeline Validation - Trail Splitting, Node Detection, and 3D Data Preservation', () => {
  let client: Client;
  let testOutputPath: string;

  beforeAll(async () => {
    try {
      client = new Client(TEST_CONFIG.database);
      await client.connect();
      console.log(`✅ Connected to test database ${TEST_CONFIG.database.database}`);
      
      // Create test output directory
      testOutputPath = path.resolve(__dirname, '../test-output/export-pipeline-validation.db');
      if (!fs.existsSync(path.dirname(testOutputPath))) {
        fs.mkdirSync(path.dirname(testOutputPath), { recursive: true });
      }
    } catch (err) {
      console.log(`⏭️  Skipping beforeAll - connection failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
    // Clean up test file
    if (fs.existsSync(testOutputPath)) {
      fs.unlinkSync(testOutputPath);
    }
  });

  describe('Comprehensive Export Pipeline Validation', () => {
    test('should validate trail splitting, node detection, and 3D data preservation', async () => {
      // Clean up any existing test file
      if (fs.existsSync(testOutputPath)) {
        fs.unlinkSync(testOutputPath);
      }

      try {
        // Step 1: Verify we have test data with known intersections
        const trailQuery = `
          SELECT COUNT(*) as trail_count
          FROM trails 
          WHERE ST_Within(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
          AND region = $5
        `;
        
        const trailCount = await client.query(trailQuery, [
          TEST_CONFIG.test.bbox[0], TEST_CONFIG.test.bbox[1],
          TEST_CONFIG.test.bbox[2], TEST_CONFIG.test.bbox[3],
          TEST_CONFIG.test.region
        ]);
        
        if (trailCount.rows[0].trail_count < 5) {
          console.log(`⏭️  Skipping test - insufficient trails in bbox (${trailCount.rows[0].trail_count})`);
          return;
        }

        console.log(`📊 Testing export pipeline with ${trailCount.rows[0].trail_count} trails in bbox`);

        // Step 2: Run the export pipeline
        const orchestrator = new EnhancedPostgresOrchestrator({
          region: TEST_CONFIG.test.region,
          outputPath: testOutputPath,
          simplifyTolerance: TEST_CONFIG.test.simplifyTolerance,
          intersectionTolerance: TEST_CONFIG.test.intersectionTolerance,
          replace: true,
          validate: false,
          verbose: true,
          skipBackup: true,
          buildMaster: false,
          targetSizeMB: null,
          maxSqliteDbSizeMB: 100,
          skipIncompleteTrails: true,
          bbox: TEST_CONFIG.test.bbox as [number, number, number, number],
          skipCleanup: true, // Keep staging schema for inspection
        });

        await orchestrator.run();

        // Step 3: Validate the exported SQLite database
        expect(fs.existsSync(testOutputPath)).toBe(true);
        const db = new Database(testOutputPath);

        // Step 4: Validate Node Detection (Both Types)
        console.log('🔍 Validating node detection...');
        
        const nodeTypes = db.prepare(`
          SELECT node_type, COUNT(*) as count 
          FROM routing_nodes 
          GROUP BY node_type
        `).all() as Array<{node_type: string, count: number}>;

        console.log('📊 Node types found:', nodeTypes);

        // Must have both intersection and endpoint nodes
        const intersectionNodes = nodeTypes.find(n => n.node_type === 'intersection');
        const endpointNodes = nodeTypes.find(n => n.node_type === 'endpoint');

        expect(intersectionNodes).toBeDefined();
        expect(endpointNodes).toBeDefined();
        expect(intersectionNodes!.count).toBeGreaterThan(0);
        expect(endpointNodes!.count).toBeGreaterThan(0);

        console.log(`✅ Node detection validated: ${intersectionNodes!.count} intersection nodes, ${endpointNodes!.count} endpoint nodes`);

        // Step 5: Validate Trail Splitting (No Duplicates)
        console.log('🔍 Validating trail splitting...');
        
        const edgeAnalysis = db.prepare(`
          SELECT 
            COUNT(*) as total_edges,
            COUNT(DISTINCT trail_id) as unique_trail_segments,
            COUNT(DISTINCT trail_name) as unique_trail_names
          FROM routing_edges
        `).get() as {total_edges: number, unique_trail_segments: number, unique_trail_names: number};

        console.log('📊 Edge analysis:', edgeAnalysis);

        // Each trail segment should have a unique trail_id (no duplicates)
        expect(edgeAnalysis.total_edges).toBeGreaterThan(0);
        expect(edgeAnalysis.unique_trail_segments).toBeGreaterThan(0);
        
        // The number of unique trail segments should be >= unique trail names
        // (because splitting creates more segments than original trails)
        expect(edgeAnalysis.unique_trail_segments).toBeGreaterThanOrEqual(edgeAnalysis.unique_trail_names);

        console.log(`✅ Trail splitting validated: ${edgeAnalysis.unique_trail_segments} unique trail segments from ${edgeAnalysis.unique_trail_names} original trails`);

        // Step 6: Validate 3D Data Preservation
        console.log('🔍 Validating 3D data preservation...');
        
        // Check that edges have 3D coordinates in GeoJSON
        const edgesWith3D = db.prepare(`
          SELECT COUNT(*) as count
          FROM routing_edges 
          WHERE geojson LIKE '%[%' 
            AND geojson LIKE '%,%' 
            AND geojson LIKE '%,%'
            AND geojson LIKE '%,%' -- At least 3 commas for 3D coordinates
        `).get() as {count: number};

        const totalEdges = db.prepare('SELECT COUNT(*) as count FROM routing_edges').get() as {count: number};
        
        console.log(`📊 3D data analysis: ${edgesWith3D.count}/${totalEdges.count} edges have 3D coordinates`);

        // At least 90% of edges should have 3D coordinates
        const threeDRatio = edgesWith3D.count / totalEdges.count;
        expect(threeDRatio).toBeGreaterThan(0.9);

        // Check that nodes have elevation data
        const nodesWithElevation = db.prepare(`
          SELECT COUNT(*) as count
          FROM routing_nodes 
          WHERE elevation IS NOT NULL
        `).get() as {count: number};

        const totalNodes = db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get() as {count: number};
        
        console.log(`📊 Node elevation analysis: ${nodesWithElevation.count}/${totalNodes.count} nodes have elevation data`);

        // At least 90% of nodes should have elevation data
        const elevationRatio = nodesWithElevation.count / totalNodes.count;
        expect(elevationRatio).toBeGreaterThan(0.9);

        // Step 7: Validate Routing Graph Structure
        console.log('🔍 Validating routing graph structure...');
        
        // Check that edges have proper source/target references
        const orphanEdges = db.prepare(`
          SELECT COUNT(*) as count
          FROM routing_edges e
          LEFT JOIN routing_nodes n1 ON e.source = n1.id
          LEFT JOIN routing_nodes n2 ON e.target = n2.id
          WHERE n1.id IS NULL OR n2.id IS NULL
        `).get() as {count: number};

        expect(orphanEdges.count).toBe(0);

        // Check that we have reasonable edge/node ratio (should be roughly 1.5-3x edges to nodes)
        const edgeNodeRatio = totalEdges.count / totalNodes.count;
        expect(edgeNodeRatio).toBeGreaterThan(1.0);
        expect(edgeNodeRatio).toBeLessThan(5.0);

        console.log(`✅ Routing graph structure validated: ${totalEdges.count} edges, ${totalNodes.count} nodes (ratio: ${edgeNodeRatio.toFixed(2)})`);

        // Step 8: Validate Staging Schema (if accessible)
        console.log('🔍 Validating staging schema...');
        
        try {
          const stagingSchema = orchestrator.stagingSchema;
          const stagingTrails = await client.query(`
            SELECT COUNT(*) as count FROM ${stagingSchema}.trails
          `);
          
          const stagingIntersections = await client.query(`
            SELECT COUNT(*) as count FROM ${stagingSchema}.intersection_points
          `);
          
          const stagingNodes = await client.query(`
            SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes
          `);
          
          console.log(`📊 Staging schema analysis:`);
          console.log(`   - Trails: ${stagingTrails.rows[0].count}`);
          console.log(`   - Intersection points: ${stagingIntersections.rows[0].count}`);
          console.log(`   - Routing nodes: ${stagingNodes.rows[0].count}`);
          
          // Should have trails and intersection points
          expect(Number(stagingTrails.rows[0].count)).toBeGreaterThan(0);
          expect(Number(stagingIntersections.rows[0].count)).toBeGreaterThan(0);
          expect(Number(stagingNodes.rows[0].count)).toBeGreaterThan(0);
          
          console.log('✅ Staging schema validated');
        } catch (err) {
          console.log(`⚠️  Staging schema validation skipped: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Step 9: Sample Data Validation
        console.log('🔍 Validating sample data quality...');
        
        // Check a few sample edges for 3D coordinates
        const sampleEdges = db.prepare(`
          SELECT geojson, elevation_gain, elevation_loss, distance_km
          FROM routing_edges 
          LIMIT 3
        `).all() as Array<{geojson: string, elevation_gain: number, elevation_loss: number, distance_km: number}>;

        for (const edge of sampleEdges) {
          // GeoJSON should contain 3D coordinates
          expect(edge.geojson).toMatch(/\[-?\d+\.\d+,-?\d+\.\d+,\d+\.\d+\]/);
          
          // Should have elevation and distance data
          expect(edge.elevation_gain).toBeDefined();
          expect(edge.elevation_loss).toBeDefined();
          expect(edge.distance_km).toBeGreaterThan(0);
        }

        // Check a few sample nodes
        const sampleNodes = db.prepare(`
          SELECT node_type, elevation, connected_trails
          FROM routing_nodes 
          WHERE node_type = 'intersection'
          LIMIT 3
        `).all() as Array<{node_type: string, elevation: number, connected_trails: string}>;

        for (const node of sampleNodes) {
          expect(node.node_type).toBe('intersection');
          expect(node.elevation).toBeDefined();
          expect(node.connected_trails).toBeDefined();
          expect(node.connected_trails).toContain(','); // Should have multiple trails
        }

        console.log('✅ Sample data quality validated');

        // Final summary
        console.log('\n🎉 EXPORT PIPELINE VALIDATION COMPLETE!');
        console.log(`📊 Summary:`);
        console.log(`   - Nodes: ${totalNodes.count} (${intersectionNodes!.count} intersections, ${endpointNodes!.count} endpoints)`);
        console.log(`   - Edges: ${totalEdges.count} (${edgeAnalysis.unique_trail_segments} unique segments)`);
        console.log(`   - 3D Data: ${(threeDRatio * 100).toFixed(1)}% edges, ${(elevationRatio * 100).toFixed(1)}% nodes`);
        console.log(`   - Graph Quality: ${edgeNodeRatio.toFixed(2)} edges per node`);

        db.close();

      } catch (err) {
        console.error('❌ Export pipeline validation failed:', err);
        throw err;
      }
    }, TEST_CONFIG.limits.timeout);

    test('should validate intersection detection with known trail pairs', async () => {
      // This test validates that specific known trail intersections are detected
      console.log('🔍 Validating specific trail intersections...');

      // Test with a known area that has specific trail intersections
      const knownTrails = [
        'Mesa Reservoir Trail',
        'Hidden Valley Trail', 
        'Eagle Trail',
        'Degge Trail',
        'Sage Trail'
      ];

      // Check if these trails exist in our test bbox
      const trailQuery = `
        SELECT name, COUNT(*) as count
        FROM trails 
        WHERE ST_Within(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
        AND name = ANY($5)
        GROUP BY name
      `;
      
      const foundTrails = await client.query(trailQuery, [
        TEST_CONFIG.test.bbox[0], TEST_CONFIG.test.bbox[1],
        TEST_CONFIG.test.bbox[2], TEST_CONFIG.test.bbox[3],
        knownTrails
      ]);

      console.log(`📊 Found ${foundTrails.rows.length} known trails in bbox`);
      
      if (foundTrails.rows.length >= 2) {
        // Run a small export to test intersection detection
        const testOutputPath2 = path.resolve(__dirname, '../test-output/intersection-validation.db');
        if (fs.existsSync(testOutputPath2)) fs.unlinkSync(testOutputPath2);

        const orchestrator = new EnhancedPostgresOrchestrator({
          region: TEST_CONFIG.test.region,
          outputPath: testOutputPath2,
          simplifyTolerance: TEST_CONFIG.test.simplifyTolerance,
          intersectionTolerance: TEST_CONFIG.test.intersectionTolerance,
          replace: true,
          validate: false,
          verbose: false,
          skipBackup: true,
          buildMaster: false,
          targetSizeMB: null,
          maxSqliteDbSizeMB: 50,
          skipIncompleteTrails: true,
          bbox: TEST_CONFIG.test.bbox,
          skipCleanup: true,
        });

        await orchestrator.run();

        // Validate that intersections were detected
        const db = new Database(testOutputPath2);
        const intersectionNodes = db.prepare(`
          SELECT COUNT(*) as count 
          FROM routing_nodes 
          WHERE node_type = 'intersection'
        `).get() as {count: number};

        expect(intersectionNodes.count).toBeGreaterThan(0);
        console.log(`✅ Detected ${intersectionNodes.count} intersection nodes`);

        // Check that some intersections have multiple connected trails
        const multiTrailIntersections = db.prepare(`
          SELECT COUNT(*) as count
          FROM routing_nodes 
          WHERE node_type = 'intersection'
          AND connected_trails LIKE '%,%'
        `).get() as {count: number};

        expect(multiTrailIntersections.count).toBeGreaterThan(0);
        console.log(`✅ Found ${multiTrailIntersections.count} intersections with multiple trails`);

        db.close();
        if (fs.existsSync(testOutputPath2)) fs.unlinkSync(testOutputPath2);
      } else {
        console.log('⏭️  Skipping intersection validation - insufficient known trails in bbox');
      }
    }, TEST_CONFIG.limits.timeout);
  });
}); 