import { EnhancedPostgresOrchestrator } from '../../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Test configuration
const TEST_REGIONS = ['boulder', 'seattle'];
const TEST_OUTPUT_DIR = path.resolve(__dirname, '../../data/test-sqlite-migration');
const TEST_TIMEOUT = 300000; // 5 minutes for full pipeline

// Define types for test assertions
interface TestTrail {
  id: number;
  app_uuid: string;
  osm_id: number;
  name: string;
  source: string;
  trail_type: string;
  surface: string;
  difficulty: string;
  coordinates: string;
  geojson: string;
  bbox: string;
  source_tags: string;
  bbox_min_lng: number;
  bbox_max_lng: number;
  bbox_min_lat: number;
  bbox_max_lat: number;
  length_km: number;
  elevation_gain: number;
  elevation_loss: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
  geometry_wkt: string;
  created_at: string;
  updated_at: string;
}
interface TestNode {
  id: number;
  coordinate_wkt: string;
  node_type: string;
  connected_trails: string;
  elevation: number;
  created_at: string;
  updated_at: string;
}
interface TestEdge {
  id: number;
  from_node_id: number;
  to_node_id: number;
  trail_id: number;
  trail_name: string;
  distance_km: number;
  elevation_gain: number;
  elevation_loss: number;
  is_bidirectional: number;
  geometry_wkt: string;
  created_at: string;
}

// Utility to clean up test files
function cleanupTestFiles() {
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
  }
}

// Ensure output directory exists
if (!fs.existsSync(TEST_OUTPUT_DIR)) {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
}

describe('SQLite Export Migration Tests', () => {
  let orchestrator: EnhancedPostgresOrchestrator | undefined;

  beforeAll(() => {
    cleanupTestFiles();
  });

  afterAll(async () => {
    try {
      if (orchestrator?.cleanupStaging) {
        await orchestrator.cleanupStaging();
      }
    } catch (e) {
      // Ignore cleanup errors
    }
    cleanupTestFiles();
  });

  describe('Full Pipeline Tests', () => {
    TEST_REGIONS.forEach(region => {
      const outputPath = path.join(TEST_OUTPUT_DIR, `${region}-sqlite-export.db`);
      
      test(`complete pipeline for ${region} region exports to SQLite correctly`, async () => {
        // Skip if no test database available
        if (!process.env.PGHOST || !process.env.PGUSER) {
          console.log(`⏭️  Skipping ${region} test - no test database available`);
          return;
        }

        // Arrange: create orchestrator with region config
        orchestrator = new EnhancedPostgresOrchestrator({
          region: region,
          outputPath: outputPath,
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
          bbox: region === 'boulder' 
            ? [-105.3, 40.0, -105.2, 40.1] 
            : [-122.19, 47.32, -121.78, 47.74],
          skipCleanup: true,
        });

        // Act: run the pipeline
        console.log(`🚀 Running SQLite export pipeline for ${region}...`);
        await orchestrator.run();

        // Assert: verify the SQLite database was created and has correct structure
        expect(fs.existsSync(outputPath)).toBe(true);
        
        const db = new Database(outputPath, { readonly: true });
        try {
          // Check that all required tables exist
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
            .map((row: any) => row.name);
          
          expect(tables).toContain('trails');
          expect(tables).toContain('routing_nodes');
          expect(tables).toContain('routing_edges');
          expect(tables).toContain('region_metadata');
          expect(tables).toContain('schema_version');

          // Verify table schemas (should be SQLite, not SpatiaLite)
          const trailsSchema = db.prepare("PRAGMA table_info(trails)").all();
          const nodesSchema = db.prepare("PRAGMA table_info(routing_nodes)").all();
          const edgesSchema = db.prepare("PRAGMA table_info(routing_edges)").all();

          // Check that geometry is stored as WKT text, not spatial columns
          const trailsColumns = trailsSchema.map((col: any) => col.name);
          const nodesColumns = nodesSchema.map((col: any) => col.name);
          const edgesColumns = edgesSchema.map((col: any) => col.name);

          expect(trailsColumns).toContain('geometry_wkt');
          expect(nodesColumns).toContain('coordinate_wkt');
          expect(edgesColumns).toContain('geometry_wkt');

          // Verify no SpatiaLite-specific columns exist
          expect(trailsColumns).not.toContain('geometry');
          expect(nodesColumns).not.toContain('coordinate');
          expect(edgesColumns).not.toContain('geometry');

          // Check that we have data
          const limit = process.env.CARTHORSE_TEST_LIMIT ? `LIMIT ${process.env.CARTHORSE_TEST_LIMIT}` : '';
          const trailCount = db.prepare(`SELECT COUNT(*) as count FROM (SELECT * FROM trails ${limit})`).get() as { count: number };
          const nodeCount = db.prepare(`SELECT COUNT(*) as count FROM (SELECT * FROM routing_nodes ${limit})`).get() as { count: number };
          const edgeCount = db.prepare(`SELECT COUNT(*) as count FROM (SELECT * FROM routing_edges ${limit})`).get() as { count: number };

          expect(trailCount.count).toBeGreaterThan(0);
          expect(nodeCount.count).toBeGreaterThan(0);
          expect(edgeCount.count).toBeGreaterThan(0);

          console.log(`✅ ${region} export complete: ${trailCount.count} trails, ${nodeCount.count} nodes, ${edgeCount.count} edges`);

          // Verify WKT data is present and valid
          const sampleTrail = db.prepare('SELECT * FROM trails LIMIT 1').get() as TestTrail;
          expect(sampleTrail.geometry_wkt).toBeDefined();
          expect(sampleTrail.geometry_wkt).toMatch(/^LINESTRING/);

          const sampleNode = db.prepare('SELECT * FROM routing_nodes LIMIT 1').get() as TestNode;
          expect(sampleNode.coordinate_wkt).toBeDefined();
          expect(sampleNode.coordinate_wkt).toMatch(/^POINT/);

          // Check file size is reasonable
          const stats = fs.statSync(outputPath);
          const fileSizeMB = stats.size / (1024 * 1024);
          expect(fileSizeMB).toBeGreaterThan(0.1); // At least 100KB
          expect(fileSizeMB).toBeLessThan(50); // Less than 50MB for test data

          console.log(`📊 ${region} database size: ${fileSizeMB.toFixed(2)} MB`);

        } finally {
          db.close();
        }

        // Clean up staging schema
        if (orchestrator?.cleanupStaging) {
          await orchestrator.cleanupStaging();
        }

      }, TEST_TIMEOUT);
    });
  });

  describe('Schema Validation Tests', () => {
    test('SQLite database has correct schema without SpatiaLite dependencies', async () => {
      // Skip if no test database available
      if (!process.env.PGHOST || !process.env.PGUSER) {
        console.log('⏭️  Skipping schema validation test - no test database available');
        return;
      }

      const outputPath = path.join(TEST_OUTPUT_DIR, 'schema-validation.db');
      
      orchestrator = new EnhancedPostgresOrchestrator({
        region: 'boulder',
        outputPath: outputPath,
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
        bbox: [-105.3, 40.0, -105.2, 40.1],
        skipCleanup: true,
      });

      await orchestrator.run();

      const db = new Database(outputPath, { readonly: true });
      try {
        // Verify no SpatiaLite extensions are loaded
        const extensions = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spatial_ref_sys'").all();
        expect(extensions).toHaveLength(0);

        // Verify tables have correct SQLite schema
        const trailsInfo = db.prepare("PRAGMA table_info(trails)").all();
        const expectedTrailsColumns = [
          'id', 'app_uuid', 'osm_id', 'name', 'source', 'trail_type', 'surface', 
          'difficulty', 'coordinates', 'geojson', 'bbox', 'source_tags',
          'bbox_min_lng', 'bbox_max_lng', 'bbox_min_lat', 'bbox_max_lat',
          'length_km', 'elevation_gain', 'elevation_loss', 'max_elevation', 
          'min_elevation', 'avg_elevation', 'geometry_wkt', 'created_at', 'updated_at'
        ];

        const actualTrailsColumns = trailsInfo.map((col: any) => col.name);
        expectedTrailsColumns.forEach(column => {
          expect(actualTrailsColumns).toContain(column);
        });

        // Verify WKT columns are TEXT type
        const geometryWktColumn = db.prepare("PRAGMA table_info(trails)").all().find((col: any) => col.name === 'geometry_wkt') as { type: string };
        expect(geometryWktColumn?.type).toBe('TEXT');

      } finally {
        db.close();
      }

      if (orchestrator?.cleanupStaging) {
        await orchestrator.cleanupStaging();
      }

    }, TEST_TIMEOUT);
  });

  describe('Data Integrity Tests', () => {
    test('exported data maintains spatial relationships and elevation data', async () => {
      // Skip if no test database available
      if (!process.env.PGHOST || !process.env.PGUSER) {
        console.log('⏭️  Skipping data integrity test - no test database available');
        return;
      }

      const outputPath = path.join(TEST_OUTPUT_DIR, 'data-integrity.db');
      
      orchestrator = new EnhancedPostgresOrchestrator({
        region: 'boulder',
        outputPath: outputPath,
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
        bbox: [-105.3, 40.0, -105.2, 40.1],
        skipCleanup: true,
      });

      await orchestrator.run();

      const db = new Database(outputPath, { readonly: true });
      try {
        // Check that elevation data is preserved
        const elevationData = db.prepare('SELECT elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation FROM trails LIMIT 1').get() as { elevation_gain: number; elevation_loss: number; max_elevation: number; min_elevation: number; avg_elevation: number };

        expect(elevationData.elevation_gain).toBeDefined();
        expect(elevationData.elevation_loss).toBeDefined();
        expect(elevationData.max_elevation).toBeDefined();
        expect(elevationData.min_elevation).toBeDefined();
        expect(elevationData.avg_elevation).toBeDefined();

        // Check that WKT geometry is 3D (contains Z coordinates)
        const sampleGeometry = db.prepare('SELECT geometry_wkt FROM trails LIMIT 1').get() as TestTrail;
        expect(sampleGeometry.geometry_wkt).toMatch(/LINESTRING Z/);

        // Check that routing nodes have proper connectivity
        const nodeTypes = db.prepare(`
          SELECT node_type, COUNT(*) as count 
          FROM routing_nodes 
          GROUP BY node_type
        `).all();

        expect(nodeTypes.length).toBeGreaterThan(0);
        nodeTypes.forEach((nodeType: any) => {
          expect(['intersection', 'endpoint']).toContain(nodeType.node_type);
          expect(nodeType.count).toBeGreaterThan(0);
        });

        // Check that routing edges connect valid nodes
        const edgeConnections = db.prepare('SELECT COUNT(*) as count FROM routing_edges').get() as { count: number };

        expect(edgeConnections.count).toBeGreaterThan(0);

      } finally {
        db.close();
      }

      if (orchestrator?.cleanupStaging) {
        await orchestrator.cleanupStaging();
      }

    }, TEST_TIMEOUT);
  });

  describe('Performance Tests', () => {
    test('SQLite export completes within reasonable time', async () => {
      // Skip if no test database available
      if (!process.env.PGHOST || !process.env.PGUSER) {
        console.log('⏭️  Skipping performance test - no test database available');
        return;
      }

      const outputPath = path.join(TEST_OUTPUT_DIR, 'performance-test.db');
      const startTime = Date.now();
      
      orchestrator = new EnhancedPostgresOrchestrator({
        region: 'boulder',
        outputPath: outputPath,
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
        bbox: [-105.3, 40.0, -105.2, 40.1],
        skipCleanup: true,
      });

      await orchestrator.run();

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000; // seconds

      console.log(`⏱️  SQLite export completed in ${duration.toFixed(2)} seconds`);

      // Should complete within 2 minutes for test data
      expect(duration).toBeLessThan(120);

      // Verify output was created
      expect(fs.existsSync(outputPath)).toBe(true);

      if (orchestrator?.cleanupStaging) {
        await orchestrator.cleanupStaging();
      }

    }, TEST_TIMEOUT);
  });
}); 