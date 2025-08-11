"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const sqlite_export_helpers_1 = require("../../utils/sqlite-export-helpers");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Test configuration - OPTIMIZED for speed
const TEST_CONFIG = {
    database: {
        host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
        port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
        database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
        user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
        password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
    },
    // LIGHTWEIGHT test config - no heavy processing
    test: {
        maxTrails: 5, // Only test with 5 trails for speed
        region: 'boulder',
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        maxSqliteDbSizeMB: 10, // Small size for testing
        useSqlite: true,
    },
    limits: {
        timeout: 30000, // 30 seconds max
    },
};
function shouldSkipTest(reason) {
    if (!process.env.TEST_PGHOST && !process.env.PGHOST) {
        console.log(`⏭️  Skipping test${reason ? ` - ${reason}` : ''} - no test database available`);
        return true;
    }
    return false;
}
function logTestConfiguration() {
    console.log(`🧪 Test configuration: ${TEST_CONFIG.database.database} on ${TEST_CONFIG.database.host}:${TEST_CONFIG.database.port}`);
}
// Test output configuration
const TEST_OUTPUT_DIR = path_1.default.join(__dirname, '../test-output');
const TEST_DB_PATH = path_1.default.join(TEST_OUTPUT_DIR, 'test-fast-export.sqlite');
// Ensure test output directory exists
if (!fs_1.default.existsSync(TEST_OUTPUT_DIR)) {
    fs_1.default.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
}
describe('SQLite Export Tests (Optimized)', () => {
    let client;
    beforeAll(async () => {
        logTestConfiguration();
        if (shouldSkipTest()) {
            return;
        }
        try {
            client = new pg_1.Client(TEST_CONFIG.database);
            await client.connect();
            console.log(`✅ Connected to test database ${TEST_CONFIG.database.database} on ${TEST_CONFIG.database.host}:${TEST_CONFIG.database.port}`);
        }
        catch (err) {
            console.log(`⏭️  Skipping beforeAll - connection failed: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
    });
    afterAll(async () => {
        if (client) {
            await client.end();
        }
    });
    describe('Fast SQLite Export', () => {
        test('should export a small subset of Boulder trails to SQLite', async () => {
            if (shouldSkipTest('Fast Boulder export test')) {
                return;
            }
            // Clean up any existing test file
            if (fs_1.default.existsSync(TEST_DB_PATH)) {
                fs_1.default.unlinkSync(TEST_DB_PATH);
            }
            try {
                // Get a small subset of trails for testing
                const trailQuery = `
          SELECT 
            app_uuid, osm_id, name, region, trail_type, surface, 
            ST_AsGeoJSON(geometry) as geojson,
            length_km, elevation_gain, elevation_loss, 
            max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
          FROM trails 
          WHERE region = $1 
          LIMIT $2
        `;
                const trails = await client.query(trailQuery, [TEST_CONFIG.test.region, TEST_CONFIG.test.maxTrails]);
                if (trails.rows.length === 0) {
                    console.log(`⏭️  Skipping test - no ${TEST_CONFIG.test.region} trails found`);
                    return;
                }
                console.log(`📊 Testing with ${trails.rows.length} trails from ${TEST_CONFIG.test.region}`);
                // Create SQLite database directly using the helper functions
                const db = new better_sqlite3_1.default(TEST_DB_PATH);
                // Create tables
                (0, sqlite_export_helpers_1.createSqliteTables)(db);
                // Insert trails
                for (const trail of trails.rows) {
                    (0, sqlite_export_helpers_1.insertTrails)(db, [trail]);
                }
                // Add region metadata using the proper helper function
                const regionMeta = {
                    region: TEST_CONFIG.test.region,
                    total_trails: trails.rows.length,
                    total_nodes: 0,
                    total_edges: 0,
                    total_routes: 0,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                (0, sqlite_export_helpers_1.insertRegionMetadata)(db, regionMeta);
                db.close();
                // Verify the output file was created
                expect(fs_1.default.existsSync(TEST_DB_PATH)).toBe(true);
                // Verify the database has the expected structure
                const verifyDb = new better_sqlite3_1.default(TEST_DB_PATH, { readonly: true });
                try {
                    const tables = verifyDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
                    expect(tables).toContain('trails');
                    expect(tables).toContain('region_metadata');
                    // Check that we have the expected data
                    const trailCount = verifyDb.prepare('SELECT COUNT(*) as n FROM trails').get().n;
                    expect(trailCount).toBe(trails.rows.length);
                    const regionMetadata = verifyDb.prepare('SELECT region, total_trails FROM region_metadata WHERE region = ?').get(TEST_CONFIG.test.region);
                    expect(regionMetadata.region).toBe(TEST_CONFIG.test.region);
                    expect(regionMetadata.total_trails).toBe(trails.rows.length);
                    console.log(`✅ Successfully exported ${trailCount} trails to SQLite for ${TEST_CONFIG.test.region} region`);
                }
                finally {
                    verifyDb.close();
                }
                // Clean up
                if (fs_1.default.existsSync(TEST_DB_PATH)) {
                    fs_1.default.unlinkSync(TEST_DB_PATH);
                }
            }
            catch (error) {
                console.log(`❌ Test failed: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }, TEST_CONFIG.limits.timeout);
        test('should handle empty region gracefully', async () => {
            if (shouldSkipTest('Empty region test')) {
                return;
            }
            // Clean up any existing test file
            if (fs_1.default.existsSync(TEST_DB_PATH)) {
                fs_1.default.unlinkSync(TEST_DB_PATH);
            }
            try {
                // Create SQLite database for empty region
                const db = new better_sqlite3_1.default(TEST_DB_PATH);
                (0, sqlite_export_helpers_1.createSqliteTables)(db);
                // Add region metadata for empty region using the proper helper function
                const emptyRegionMeta = {
                    region: 'empty_region',
                    total_trails: 0,
                    total_nodes: 0,
                    total_edges: 0,
                    total_routes: 0,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                (0, sqlite_export_helpers_1.insertRegionMetadata)(db, emptyRegionMeta);
                db.close();
                // Verify the database was created
                expect(fs_1.default.existsSync(TEST_DB_PATH)).toBe(true);
                // Verify empty database structure
                const verifyDb = new better_sqlite3_1.default(TEST_DB_PATH, { readonly: true });
                try {
                    const tables = verifyDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
                    expect(tables).toContain('trails');
                    expect(tables).toContain('region_metadata');
                    const trailCount = verifyDb.prepare('SELECT COUNT(*) as n FROM trails').get().n;
                    expect(trailCount).toBe(0);
                    console.log(`✅ Successfully created empty SQLite database`);
                }
                finally {
                    verifyDb.close();
                }
                // Clean up
                if (fs_1.default.existsSync(TEST_DB_PATH)) {
                    fs_1.default.unlinkSync(TEST_DB_PATH);
                }
            }
            catch (error) {
                console.log(`❌ Empty region test failed: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }, TEST_CONFIG.limits.timeout);
    });
});
//# sourceMappingURL=sqlite-export-test.js.map