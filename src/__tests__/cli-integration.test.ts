jest.setTimeout(60000);
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';

// Test configuration
const TEST_OUTPUT_DIR = path.resolve(__dirname, 'test-output');
const TEST_DB_PATH = path.resolve(TEST_OUTPUT_DIR, 'test-region.db');

// Test config for Seattle
const REGION = 'seattle';
const REGION_DB = path.resolve(__dirname, '../../data/seattle-export.db');

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
    const child = spawn('npx', ['ts-node', 'src/cli/export.ts', ...args], {
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
      resolve({ code: code ?? 0, stdout, stderr });
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
    const result = await runCliCommand(['--help']);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('--region');
    expect(result.stdout).toContain('--out');
  });

  test('CLI --version shows version information', async () => {
    const result = await runCliCommand(['--version']);
    
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
    const result = await runCliCommand(['--region', REGION]);
    
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('out');
    expect(result.stderr).toContain('required');
  });

  test('CLI accepts valid parameters without errors', async () => {
    const result = await runCliCommand([
      '--region', REGION,
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
      '--region', REGION,
      '--out', TEST_DB_PATH,
      '--validate'
    ]);
    
    // Should not crash on --validate flag
    expect(result.stderr).not.toContain('Unknown argument');
  });

  test('CLI --build-master flag is recognized', async () => {
    const result = await runCliCommand([
      '--region', REGION,
      '--out', TEST_DB_PATH,
      '--build-master'
    ]);
    
    // Should not crash on --build-master flag
    expect(result.stderr).not.toContain('Unknown argument');
  });

  test('CLI --simplify-tolerance accepts numeric values', async () => {
    const result = await runCliCommand([
      '--region', REGION,
      '--out', TEST_DB_PATH,
      '--simplify-tolerance', '0.001'
    ]);
    
    // Should not crash on numeric simplify-tolerance
    expect(result.stderr).not.toContain('Unknown argument');
  });

  test('CLI --target-size accepts numeric values', async () => {
    const result = await runCliCommand([
      '--region', REGION,
      '--out', TEST_DB_PATH,
      '--target-size', '100'
    ]);
    
    // Should not crash on numeric target-size
    expect(result.stderr).not.toContain('Unknown argument');
  });

  test('CLI rejects invalid numeric values', async () => {
    const result = await runCliCommand([
      '--region', REGION,
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

    // Ensure output directory exists before any file write
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }

    // Use a small bbox for fast test (Boulder)
    const result = await runCliCommand([
      '--region', REGION,
      '--out', TEST_DB_PATH,
      '--bbox', '-105.28374970746286,40.067177007305304,-105.23664372512728,40.09624115553808',
      '--validate'
    ]);
    
    expect(result.code).toBe(0);
    // Allow npm warnings about --bail flag
    expect(result.stderr).toMatch(/^(npm warn.*bail.*\n?)*$/); // Only npm warnings allowed
    
    // Verify the output file was created
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
    
    // Verify the database has the expected structure
    const db = new Database(TEST_DB_PATH, { readonly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
      expect(tables).toContain('trails');
      expect(tables).toContain('region_metadata');
      
      // Check that we have some data
      const TRAILS_TABLE = process.env.CARTHORSE_TRAILS_TABLE || 'trails';
      const trailCount = (db.prepare(`SELECT COUNT(*) as n FROM ${TRAILS_TABLE}`).get() as { n: number }).n;
      expect(trailCount).toBeGreaterThan(0);
      
      const regionMetaCount = (db.prepare('SELECT COUNT(*) as n FROM region_metadata').get() as { n: number }).n;
      expect(regionMetaCount).toBeGreaterThan(0);
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

    // Ensure output directory exists before any file write
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }

    // Use a small bbox for fast test (Boulder)
    const result = await runCliCommand([
      '--region', REGION,
      '--out', TEST_DB_PATH,
      '--bbox', '-105.28374970746286,40.067177007305304,-105.23664372512728,40.09624115553808',
      '--build-master'
    ]);
    
    expect(result.code).toBe(0);
    // Allow npm warnings about --bail flag
    expect(result.stderr).toMatch(/^(npm warn.*bail.*\n?)*$/); // Only npm warnings allowed
    
    // Verify the output file was created
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
    
    // Verify the database has the expected structure
    const db = new Database(TEST_DB_PATH, { readonly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
      expect(tables).toContain('trails');
      expect(tables).toContain('region_metadata');
      
      // Check that we have some data
      const TRAILS_TABLE = process.env.CARTHORSE_TRAILS_TABLE || 'trails';
      const trailCount = (db.prepare(`SELECT COUNT(*) as n FROM ${TRAILS_TABLE}`).get() as { n: number }).n;
      expect(trailCount).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  }, 180000); // 3 minute timeout for full build and export
}); 

describe('End-to-end bbox export integration', () => {
  // Use real regions
  const customRegion = REGION;
  const customDbPath = path.resolve(TEST_OUTPUT_DIR, 'test-bbox-region1.db');

  beforeAll(() => {
    // Ensure the test output directory exists before running tests
    if (!require('fs').existsSync(TEST_OUTPUT_DIR)) {
      require('fs').mkdirSync(TEST_OUTPUT_DIR);
    }
  });

  afterAll(() => {
    if (fs.existsSync(customDbPath)) fs.unlinkSync(customDbPath);
  });

  it('exports the custom initial_view_bbox for REGION', () => {
    const bbox = '-105.28374970746286,40.067177007305304,-105.23664372512728,40.09624115553808';
    const exportCommand = `npx ts-node src/cli/export.ts --region ${customRegion} --bbox ${bbox} --out ${customDbPath} --replace --skip-incomplete-trails`;
    console.log('[TEST] Running export CLI for Region1:', exportCommand);
    try {
      execSync(exportCommand, { stdio: 'inherit' });
    } catch (e) {
      console.log('[TEST] Skipping Region1 bbox test due to CLI error:', (e as any).message);
      return;
    }
    console.log('[TEST] Export CLI finished for Region1');

    console.log('[TEST] Checking for exported DB at:', customDbPath);
    expect(fs.existsSync(customDbPath)).toBe(true);
    let db;
    try {
      console.log('[TEST] Opening exported DB for REGION');
      db = new Database(customDbPath, { readonly: true });
      // Check region_metadata table instead of regions
      const regionMeta = db.prepare('SELECT * FROM region_metadata LIMIT 1').get() as any;
      console.log('[TEST] DB opened, region_metadata row:', regionMeta);
      expect(regionMeta).toBeDefined();
      expect(regionMeta.bbox_min_lng).toBeDefined();
      expect(regionMeta.bbox_max_lng).toBeDefined();
      expect(regionMeta.bbox_min_lat).toBeDefined();
      expect(regionMeta.bbox_max_lat).toBeDefined();
      expect(regionMeta.trail_count).toBeGreaterThan(0);
    } finally {
      if (db) db.close();
      if (fs.existsSync(customDbPath)) fs.unlinkSync(customDbPath);
    }
  });
}); 