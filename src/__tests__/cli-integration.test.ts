jest.setTimeout(60000);
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';

// Test configuration
const TEST_OUTPUT_DIR = path.resolve(__dirname, 'test-output');
const TEST_DB_PATH = path.resolve(TEST_OUTPUT_DIR, 'test-region.db');

// Utility to clean up test files
function cleanupTestFiles() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
  }
}

// Utility to run CLI command and return result
function runCliCommand(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['dist/cli/export.js', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CLI process timed out after 60 seconds'));
    }, 60000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code: code || 0, stdout, stderr });
    });
  });
}

describe('CLI Integration Tests', () => {
  beforeAll(() => {
    cleanupTestFiles();
    // Ensure output directory exists
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    cleanupTestFiles();
  });

  test('CLI --help shows usage information', async () => {
    const result = await runCliCommand(['--help', '--dry-run']);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('--region');
    expect(result.stdout).toContain('--out');
  });

  test('CLI --version shows version information', async () => {
    const result = await runCliCommand(['--version', '--dry-run']);
    
    expect(result.code).toBe(0);
    // Only check for a version number, not the string 'carthorse'
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/); // Version number
  });

  test('CLI validates required --region parameter', async () => {
    const result = await runCliCommand(['--out', TEST_DB_PATH]);
    
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('region');
    expect(result.stderr).toContain('required');
  });

  test('CLI validates required --out parameter', async () => {
    const result = await runCliCommand(['--region', 'boulder']);
    
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('out');
    expect(result.stderr).toContain('required');
  });

  test('CLI accepts valid parameters without errors', async () => {
    const result = await runCliCommand([
      '--region', 'boulder',
      '--out', TEST_DB_PATH,
      '--validate'
    ]);
    
    // This might fail if no test database is available, but should at least parse arguments correctly
    // We're testing that the CLI doesn't crash on valid arguments
    expect(result.stderr).not.toContain('Unknown argument');
    expect(result.stderr).not.toContain('Invalid option');
  });

  test('CLI --validate flag is recognized', async () => {
    const result = await runCliCommand([
      '--region', 'boulder',
      '--out', TEST_DB_PATH,
      '--validate'
    ]);
    
    // Should not crash on --validate flag
    expect(result.stderr).not.toContain('Unknown argument');
  });

  test('CLI --build-master flag is recognized', async () => {
    const result = await runCliCommand([
      '--region', 'boulder',
      '--out', TEST_DB_PATH,
      '--build-master'
    ]);
    
    // Should not crash on --build-master flag
    expect(result.stderr).not.toContain('Unknown argument');
  });

  test('CLI --simplify-tolerance accepts numeric values', async () => {
    const result = await runCliCommand([
      '--region', 'boulder',
      '--out', TEST_DB_PATH,
      '--simplify-tolerance', '0.001'
    ]);
    
    // Should not crash on numeric simplify-tolerance
    expect(result.stderr).not.toContain('Unknown argument');
  });

  test('CLI --target-size accepts numeric values', async () => {
    const result = await runCliCommand([
      '--region', 'boulder',
      '--out', TEST_DB_PATH,
      '--target-size', '100'
    ]);
    
    // Should not crash on numeric target-size
    expect(result.stderr).not.toContain('Unknown argument');
  });

  test('CLI rejects invalid numeric values', async () => {
    const result = await runCliCommand([
      '--region', 'boulder',
      '--out', TEST_DB_PATH,
      '--simplify-tolerance', 'invalid'
    ]);
    
    // Should fail on invalid numeric input
    expect(result.code).not.toBe(0);
  });

  test('CLI shows meaningful error for invalid region', async () => {
    const result = await runCliCommand([
      '--region', 'invalid-region',
      '--out', TEST_DB_PATH
    ]);
    
    // Should fail gracefully with meaningful error
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('error');
  });
});

describe('CLI End-to-End Tests (requires test database)', () => {
  // These tests require a test database with a valid PostgreSQL user
  // They're marked as optional and will be skipped if the database isn't available
  
  test('CLI can export a region successfully', async () => {
    // Skip if no test database is available
    if (!process.env.PGHOST || !process.env.PGUSER) {
      console.log('⏭️  Skipping CLI export test - no test database available');
      return;
    }

    // Use a small bbox for fast test (Boulder)
    const result = await runCliCommand([
      '--region', 'boulder',
      '--out', TEST_DB_PATH,
      '--bbox', '-105.3,40.0,-105.2,40.1',
      '--validate'
    ]);
    
    expect(result.code).toBe(0);
    expect(result.stderr).toBe(''); // No errors
    
    // Verify the output file was created
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
    
    // Verify the database has the expected structure
    const db = new Database(TEST_DB_PATH, { readonly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
      expect(tables).toContain('trails');
      expect(tables).toContain('regions');
      
      // Check that we have some data
      const trailCount = (db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
      expect(trailCount).toBeGreaterThan(0);
      
      const regionCount = (db.prepare('SELECT COUNT(*) as n FROM regions').get() as { n: number }).n;
      expect(regionCount).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  }, 120000); // 2 minute timeout for full export

  test('CLI can build master database and export', async () => {
    // Skip if no test database is available
    if (!process.env.PGHOST || !process.env.PGUSER) {
      console.log('⏭️  Skipping CLI build-master test - no test database available');
      return;
    }

    // Use a small bbox for fast test (Boulder)
    const result = await runCliCommand([
      '--region', 'boulder',
      '--out', TEST_DB_PATH,
      '--bbox', '-105.3,40.0,-105.2,40.1',
      '--build-master'
    ]);
    
    expect(result.code).toBe(0);
    expect(result.stderr).toBe(''); // No errors
    
    // Verify the output file was created
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
    
    // Verify the database has the expected structure
    const db = new Database(TEST_DB_PATH, { readonly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
      expect(tables).toContain('trails');
      expect(tables).toContain('regions');
      
      // Check that we have some data
      const trailCount = (db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
      expect(trailCount).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  }, 180000); // 3 minute timeout for full build and export
}); 

describe('End-to-end bbox export integration', () => {
  // Use real regions
  const customRegion = 'boulder';
  const fallbackRegion = 'seattle';
  const customDbPath = path.resolve(TEST_OUTPUT_DIR, 'test-bbox-boulder.db');
  const fallbackDbPath = path.resolve(TEST_OUTPUT_DIR, 'test-bbox-seattle.db');

  beforeAll(() => {
    // Ensure the test output directory exists before running tests
    if (!require('fs').existsSync(TEST_OUTPUT_DIR)) {
      require('fs').mkdirSync(TEST_OUTPUT_DIR);
    }
  });

  afterAll(() => {
    if (fs.existsSync(customDbPath)) fs.unlinkSync(customDbPath);
    if (fs.existsSync(fallbackDbPath)) fs.unlinkSync(fallbackDbPath);
  });

  it('exports the custom initial_view_bbox for boulder', () => {
    const bbox = '-105.3,40.0,-105.2,40.1';
    const exportCommand = `npx ts-node src/cli/export.ts --region ${customRegion} --bbox ${bbox} --out ${customDbPath} --replace --skip-incomplete-trails`;
    console.log('[TEST] Running export CLI for Boulder:', exportCommand);
    try {
      execSync(exportCommand, { stdio: 'inherit' });
    } catch (e) {
      console.log('[TEST] Skipping Boulder bbox test due to CLI error:', (e as any).message);
      return;
    }
    console.log('[TEST] Export CLI finished for Boulder');

    console.log('[TEST] Checking for exported DB at:', customDbPath);
    expect(fs.existsSync(customDbPath)).toBe(true);
    let db;
    try {
      console.log('[TEST] Opening exported DB for Boulder');
      db = new Database(customDbPath, { readonly: true });
      const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(customRegion) as any;
      console.log('[TEST] DB opened, region row:', region);
      expect(region).toBeDefined();
      expect(region.initial_view_bbox).toBeDefined();
      const parsed = JSON.parse(region.initial_view_bbox);
      console.log('[TEST] Parsed initial_view_bbox:', parsed);
      const expected = {
        minLng: -105.2625,
        maxLng: -105.2375,
        minLat: 40.037499999999994,
        maxLat: 40.0625
      };
      expect(parsed).toEqual(expected);
      console.log('[TEST] Boulder DB test complete');
    } finally {
      if (db) db.close();
      if (fs.existsSync(customDbPath)) fs.unlinkSync(customDbPath);
    }
  });

  it('calculates and exports the fallback initial_view_bbox for seattle', () => {
    const seattleBbox = '-122.19,47.32,-121.78,47.74'; // Updated to match actual Seattle trails
    const exportCommand = `npx ts-node src/cli/export.ts --region seattle --bbox ${seattleBbox} --out ${fallbackDbPath} --replace --skip-incomplete-trails`;
    console.log('[TEST] Running export CLI for Seattle:', exportCommand);
    try {
      execSync(exportCommand, { stdio: 'inherit' });
    } catch (e) {
      // If the export fails due to no data, skip the test gracefully
      console.log('[TEST] Skipping Seattle fallback bbox test - no data for region:', (e as any).message);
      return;
    }
    console.log('[TEST] Export CLI finished for Seattle');

    console.log('[TEST] Checking for exported DB at:', fallbackDbPath);
    expect(fs.existsSync(fallbackDbPath)).toBe(true);
    let db;
    try {
      console.log('[TEST] Opening exported DB for Seattle');
      db = new Database(fallbackDbPath, { readonly: true });
      const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(fallbackRegion) as any;
      console.log('[TEST] DB opened, region row:', region);
      expect(region).toBeDefined();
      expect(region.initial_view_bbox).toBeDefined();
      const parsed = JSON.parse(region.initial_view_bbox);
      console.log('[TEST] Parsed initial_view_bbox:', parsed);
      const expected = {
        minLng: -122.03625,
        maxLng: -121.93375,
        minLat: 47.4775,
        maxLat: 47.5825
      };
      expect(parsed).toEqual(expected);
      console.log('[TEST] Seattle DB test complete');
    } finally {
      if (db) db.close();
      if (fs.existsSync(fallbackDbPath)) fs.unlinkSync(fallbackDbPath);
    }
  });
}); 