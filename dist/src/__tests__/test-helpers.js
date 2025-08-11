"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestSchema = createTestSchema;
exports.createTestTrailsTable = createTestTrailsTable;
exports.createTestRoutingTables = createTestRoutingTables;
exports.insertTestTrail = insertTestTrail;
exports.cleanupTestSchema = cleanupTestSchema;
exports.generateTestSchemaName = generateTestSchemaName;
// Test helper functions for database setup
async function createTestSchema(client, schemaName) {
    try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
        console.log(`✅ Created test schema: ${schemaName}`);
    }
    catch (error) {
        console.log(`⚠️  Failed to create schema ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function createTestTrailsTable(client, schemaName) {
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.trails (
        id SERIAL PRIMARY KEY,
        original_trail_id INTEGER,
        segment_number INTEGER,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,

        osm_id TEXT,
        elevation_gain REAL CHECK(elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss >= 0),
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        length_km REAL CHECK(length_km > 0),
        source TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        region TEXT DEFAULT 'boulder'
      )
    `);
        console.log(`✅ Created trails table in schema: ${schemaName}`);
    }
    catch (error) {
        console.log(`⚠️  Failed to create trails table in ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function createTestRoutingTables(client, schemaName) {
    try {
        // Create routing_nodes table
        await client.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_type TEXT NOT NULL,
        trail_id TEXT,
        trail_name TEXT,
        geometry GEOMETRY(POINT, 4326),
        elevation REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        // Create routing_edges table
        await client.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.routing_edges (
        id SERIAL PRIMARY KEY,
        source INTEGER NOT NULL,
        target INTEGER NOT NULL,
        trail_id TEXT,
        trail_name TEXT,
        distance_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        geometry GEOMETRY(LINESTRING, 4326),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        console.log(`✅ Created routing tables in schema: ${schemaName}`);
    }
    catch (error) {
        console.log(`⚠️  Failed to create routing tables in ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function insertTestTrail(client, schemaName, trailData) {
    try {
        const query = `
      INSERT INTO ${schemaName}.trails (
        app_uuid, name, region, trail_type, surface, difficulty,
        osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        length_km, source, geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, ST_GeomFromText($16), $17, $18, $19, $20)
    `;
        await client.query(query, [
            trailData.app_uuid,
            trailData.name,
            trailData.region || 'boulder',
            trailData.trail_type || null,
            trailData.surface || null,
            trailData.difficulty || null,
            trailData.osm_id || null,
            trailData.elevation_gain || null,
            trailData.elevation_loss || null,
            trailData.max_elevation || null,
            trailData.min_elevation || null,
            trailData.avg_elevation || null,
            trailData.length_km || 0,
            trailData.source || null,
            trailData.geometry || 'LINESTRING(-105.289304 39.994971 1800, -105.2892954 39.9948598 1900)',
            trailData.bbox_min_lng || null,
            trailData.bbox_max_lng || null,
            trailData.bbox_min_lat || null,
            trailData.bbox_max_lat || null
        ]);
        console.log(`✅ Inserted test trail: ${trailData.name}`);
    }
    catch (error) {
        console.log(`⚠️  Failed to insert test trail: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function cleanupTestSchema(client, schemaName) {
    try {
        await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
        console.log(`✅ Cleaned up test schema: ${schemaName}`);
    }
    catch (error) {
        console.log(`⚠️  Failed to cleanup schema ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function generateTestSchemaName(prefix = 'test') {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    return `${prefix}_${timestamp}_${randomSuffix}`;
}
// Add a simple test to make this file a valid test suite
describe('Test Helpers', () => {
    it('should generate test schema names', () => {
        const schemaName1 = generateTestSchemaName('test');
        const schemaName2 = generateTestSchemaName('test');
        expect(schemaName1).toMatch(/^test_\d+_[a-z0-9]+$/);
        expect(schemaName2).toMatch(/^test_\d+_[a-z0-9]+$/);
        expect(schemaName1).not.toBe(schemaName2);
    });
});
//# sourceMappingURL=test-helpers.js.map