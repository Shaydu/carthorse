jest.setTimeout(360000);
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

// Test configuration
const TEST_OUTPUT_DIR = path.resolve(__dirname, '../../data/test-cli-sqlite');
const TEST_DB_PATH = path.resolve(TEST_OUTPUT_DIR, 'test-cli-export.db');

// Utility to clean up test files
function cleanupTestFiles() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
  }
}

// Ensure output directory exists
if (!fs.existsSync(TEST_OUTPUT_DIR)) {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
}

// Helper function to run CLI commands
async function runCliCommand(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  console.log('[TEST] runCliCommand: Spawning CLI with args:', args);
  return new Promise((resolve) => {
    const child = spawn('npx', ['ts-node', 'src/cli/export.ts', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PGDATABASE: 'trail_master_db_test',
        PGUSER: 'tester',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      console.log('[TEST] runCliCommand: CLI process exited with code', code);
      resolve({
        code: code || 0,
        stdout,
        stderr,
      });
    });

    // Add timeout to prevent hanging
    setTimeout(() => {
      child.kill();
      console.log('[TEST] runCliCommand: CLI process killed due to timeout');
      resolve({
        code: -1,
        stdout,
        stderr: stderr + '\nProcess killed due to timeout',
      });
    }, 120000); // 2 minute timeout
  });
}

describe('CLI SQLite Migration Tests', () => {
  beforeAll(async () => {
    console.log('[TEST] beforeAll: Starting cleanup of test files');
    // Always delete the old export file before running
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
      console.log('[TEST] beforeAll: Deleted old export file');
    }
    // Run the CLI to generate a fresh export
    console.log('[TEST] beforeAll: Running CLI export for seattle region');
    try {
      const result = await runCliCommand([
        '--region', 'seattle',
        '--out', TEST_DB_PATH,
        '--replace',
        '--validate',
        '--verbose'
      ]);
      console.log('[TEST] beforeAll: CLI export finished with code', result.code);
      console.log('[TEST] beforeAll: CLI stdout:', result.stdout);
      console.log('[TEST] beforeAll: CLI stderr:', result.stderr);
      // Don't fail the test if CLI fails, just log it
      if (result.code !== 0) {
        console.log('[TEST] beforeAll: CLI export failed, but continuing with tests');
      }
    } catch (error) {
      console.log('[TEST] beforeAll: CLI export error:', error);
      // Don't fail the test if CLI fails, just log it
    }
  });

  afterAll(() => {
    cleanupTestFiles();
  });

  describe('CLI Export Tests', () => {
    test('CLI exports to SQLite database successfully', async () => {
      // Skip if no test database available
      if (!process.env.PGHOST || !process.env.PGUSER) {
        console.log('⏭️  Skipping CLI export test - no test database available');
        return;
      }

      // Use a small bbox for fast test
      const result = await runCliCommand([
        '--region', 'seattle',
        '--out', TEST_DB_PATH,
        '--bbox', '-105.3,40.0,-105.2,40.1',
        '--replace',
        '--skip-incomplete-trails'
      ]);

      expect(result.code).toBe(0);
      // Allow npm warnings about --bail flag
      expect(result.stderr).toMatch(/^(npm warn.*bail.*\n?)*$/); // Only npm warnings allowed

      // Verify the output file was created
      expect(fs.existsSync(TEST_DB_PATH)).toBe(true);

      // Always use the same output path variable as used for export
      const db = new Database(TEST_DB_PATH, { readonly: true });
      try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
          .map((row: any) => row.name);

        expect(tables).toContain('trails');
        expect(tables).toContain('routing_nodes');
        expect(tables).toContain('routing_edges');
        expect(tables).toContain('region_metadata');
        expect(tables).toContain('schema_version');

        // Check that we have some data
        const TRAILS_TABLE = process.env.CARTHORSE_TRAILS_TABLE || 'trails';
        const trailCount = db.prepare(`SELECT COUNT(*) as count FROM ${TRAILS_TABLE}`).get() as { count: number };
        expect(trailCount.count).toBeGreaterThan(0);

        const nodeCount = db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get() as { count: number };
        expect(nodeCount.count).toBeGreaterThan(0);

        const edgeCount = db.prepare('SELECT COUNT(*) as count FROM routing_edges').get() as { count: number };
        expect(edgeCount.count).toBeGreaterThan(0);

        console.log(`✅ CLI export complete: ${trailCount.count} trails, ${nodeCount.count} nodes, ${edgeCount.count} edges`);

        // Verify it's a plain SQLite database (not SpatiaLite)
        const trailsSchema = db.prepare("PRAGMA table_info(trails)").all();
        const trailsColumns = trailsSchema.map((col: any) => col.name);
        
        expect(trailsColumns).toContain('geojson');
        expect(trailsColumns).not.toContain('geometry'); // No SpatiaLite geometry column

      } finally {
        db.close();
      }
    }, 120000);

    test('CLI handles invalid arguments gracefully', async () => {
      const result = await runCliCommand([
        '--region', 'nonexistent-region',
        '--out', TEST_DB_PATH,
        '--replace'
      ]);

      // Should fail but not crash
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('error');
    }, 30000);

    test('CLI validates output path correctly', async () => {
      const invalidPath = '/invalid/path/that/does/not/exist/test.db';
      const result = await runCliCommand([
        '--region', 'seattle',
        '--out', invalidPath,
        '--bbox', '-105.3,40.0,-105.2,40.1',
        '--replace'
      ]);

      // Should fail due to invalid path
      expect(result.code).not.toBe(0);
    }, 30000);
  });

  describe('CLI Option Tests', () => {
    test('CLI respects --replace flag', async () => {
      // Skip if no test database available
      if (!process.env.PGHOST || !process.env.PGUSER) {
        console.log('⏭️  Skipping CLI replace test - no test database available');
        return;
      }

      // First export
      const result1 = await runCliCommand([
        '--region', 'seattle',
        '--out', TEST_DB_PATH,
        '--bbox', '-105.3,40.0,-105.2,40.1',
        '--replace',
        '--skip-incomplete-trails'
      ]);

      expect(result1.code).toBe(0);
      expect(fs.existsSync(TEST_DB_PATH)).toBe(true);

      // Get file modification time
      const stats1 = fs.statSync(TEST_DB_PATH);
      const mtime1 = stats1.mtime.getTime();

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Second export with --replace
      const result2 = await runCliCommand([
        '--region', 'seattle',
        '--out', TEST_DB_PATH,
        '--bbox', '-105.3,40.0,-105.2,40.1',
        '--replace',
        '--skip-incomplete-trails'
      ]);

      expect(result2.code).toBe(0);
      expect(fs.existsSync(TEST_DB_PATH)).toBe(true);

      // File should be newer (replaced)
      const stats2 = fs.statSync(TEST_DB_PATH);
      const mtime2 = stats2.mtime.getTime();

      expect(mtime2).toBeGreaterThan(mtime1);
    }, 180000);

    test('CLI respects --validate flag', async () => {
      // Skip if no test database available
      if (!process.env.PGHOST || !process.env.PGUSER) {
        console.log('⏭️  Skipping CLI validation test - no test database available');
        return;
      }

      const result = await runCliCommand([
        '--region', 'seattle',
        '--out', TEST_DB_PATH,
        '--bbox', '-105.3,40.0,-105.2,40.1',
        '--replace',
        '--validate',
        '--skip-incomplete-trails'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('validation'); // Should mention validation in output
    }, 120000);

    test('CLI respects --verbose flag', async () => {
      // Skip if no test database available
      if (!process.env.PGHOST || !process.env.PGUSER) {
        console.log('⏭️  Skipping CLI verbose test - no test database available');
        return;
      }

      const result = await runCliCommand([
        '--region', 'seattle',
        '--out', TEST_DB_PATH,
        '--bbox', '-105.3,40.0,-105.2,40.1',
        '--replace',
        '--verbose',
        '--skip-incomplete-trails'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('DDL'); // Should show DDL debug output
    }, 120000);
  });

  describe('CLI Error Handling Tests', () => {
    test('CLI handles missing required arguments', async () => {
      const result = await runCliCommand([
        '--out', TEST_DB_PATH
        // Missing --region
      ]);

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('error');
    }, 30000);

    test('CLI handles invalid bbox format', async () => {
      const result = await runCliCommand([
        '--region', 'seattle',
        '--out', TEST_DB_PATH,
        '--bbox', 'invalid-bbox-format',
        '--replace'
      ]);

      expect(result.code).not.toBe(0);
    }, 30000);

    test('CLI handles invalid tolerance values', async () => {
      const result = await runCliCommand([
        '--region', 'seattle',
        '--out', TEST_DB_PATH,
        '--bbox', '-105.3,40.0,-105.2,40.1',
        '--simplify-tolerance', 'invalid',
        '--replace'
      ]);

      expect(result.code).not.toBe(0);
    }, 30000);
  });

  describe('CLI Output Validation Tests', () => {
    test('CLI exports correct region metadata', async () => {
      // Skip if no test database available
      if (!process.env.PGHOST || !process.env.PGUSER) {
        console.log('⏭️  Skipping CLI metadata test - no test database available');
        return;
      }

      const result = await runCliCommand([
        '--region', 'seattle',
        '--out', TEST_DB_PATH,
        '--bbox', '-105.3,40.0,-105.2,40.1',
        '--replace',
        '--skip-incomplete-trails'
      ]);

      expect(result.code).toBe(0);

      const db = new Database(TEST_DB_PATH, { readonly: true });
      try {
        const regionMeta = db.prepare('SELECT * FROM region_metadata').get() as {
          region_name: string;
          bbox_min_lng: number;
          bbox_max_lng: number;
          bbox_min_lat: number;
          bbox_max_lat: number;
          trail_count: number;
          created_at: string;
        };
        expect(regionMeta.region_name).toBe('seattle');
        expect(regionMeta.bbox_min_lng).toBeCloseTo(-122.2, 1);
        expect(regionMeta.bbox_max_lng).toBeCloseTo(-121.84, 2);
        expect(regionMeta.bbox_min_lat).toBeCloseTo(47.47, 2);
        expect(regionMeta.bbox_max_lat).toBeCloseTo(47.66, 2);
        expect(regionMeta.trail_count).toBeGreaterThan(0);
        expect(regionMeta.created_at).toBeDefined();

        const schemaVersion = db.prepare('SELECT * FROM schema_version').get() as {
          version: number;
          description: string;
        };
        expect(schemaVersion.version).toBe(8);
        expect(schemaVersion.description).toContain('SQLite');
      } finally {
        db.close();
      }
    }, 120000);
  });
}); 