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
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        osm_id TEXT,
        osm_type TEXT,
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        difficulty TEXT,
        surface_type TEXT,
        trail_type TEXT,
        source_tags JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        geometry GEOMETRY(POINTZ, 4326),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        // Create routing_edges table
        await client.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.routing_edges (
        id SERIAL PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        trail_id TEXT,
        trail_name TEXT,
        distance_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        geometry GEOMETRY(LINESTRINGZ, 4326),
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
        app_uuid, name, region, osm_id, osm_type, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, geometry,
        difficulty, surface_type, trail_type, source_tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, ST_GeomFromText($16), $17, $18, $19, $20)
    `;
        await client.query(query, [
            trailData.app_uuid,
            trailData.name,
            trailData.region,
            trailData.osm_id || null,
            trailData.osm_type || null,
            trailData.length_km || 0,
            trailData.elevation_gain || null,
            trailData.elevation_loss || null,
            trailData.max_elevation || null,
            trailData.min_elevation || null,
            trailData.avg_elevation || null,
            trailData.bbox_min_lng || null,
            trailData.bbox_max_lng || null,
            trailData.bbox_min_lat || null,
            trailData.bbox_max_lat || null,
            trailData.geometry || 'LINESTRING(-105.289304 39.994971, -105.2892954 39.9948598)',
            trailData.difficulty || 'moderate',
            trailData.surface_type || 'dirt',
            trailData.trail_type || 'hiking',
            trailData.source_tags ? JSON.stringify(trailData.source_tags) : JSON.stringify({ highway: 'path' })
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
// Helper to generate unique schema names
function generateTestSchemaName(prefix = 'test') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
//# sourceMappingURL=test-helpers.js.map