#!/usr/bin/env node

const { Pool } = require('pg');
const Database = require('better-sqlite3');

async function exportRoutingNodes() {
  // Database connections
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'carthorse',
    password: '',
    database: 'trail_master_db'
  });

  const sqliteDb = new Database('/Users/shaydu/dev/carthorse/test-output/boulder-nodes-fixed-test.db');

  try {
    // Get the most recent carthorse schema with routing nodes
    const schemaResult = await pgClient.query(`
      SELECT table_schema 
      FROM information_schema.tables 
      WHERE table_name = 'routing_nodes' 
        AND table_schema LIKE 'carthorse_%'
      ORDER BY table_schema DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.log('❌ No carthorse schema with routing_nodes found');
      return;
    }

    const schemaName = schemaResult.rows[0].table_schema;
    console.log(`📦 Using schema: ${schemaName}`);

    // Get routing nodes from PostgreSQL
    const nodesResult = await pgClient.query(`
      SELECT 
        id, 
        node_uuid, 
        lat, 
        lng, 
        COALESCE(elevation, 0) as elevation, 
        COALESCE(node_type, 'unknown') as node_type, 
        COALESCE(connected_trails::text, '0') as connected_trails
      FROM ${schemaName}.routing_nodes
      ORDER BY id
    `);

    console.log(`📊 Found ${nodesResult.rows.length} routing nodes`);

    if (nodesResult.rows.length === 0) {
      console.log('⚠️  No routing nodes found in the schema');
      return;
    }

    // Clear existing routing nodes in SQLite
    sqliteDb.prepare('DELETE FROM routing_nodes').run();
    console.log('🗑️  Cleared existing routing nodes from SQLite');

    // Insert nodes into SQLite
    const insertNodes = sqliteDb.prepare(`
      INSERT OR REPLACE INTO routing_nodes (
        id, node_uuid, lat, lng, elevation, node_type, connected_trails
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = sqliteDb.transaction((nodes) => {
      for (const node of nodes) {
        insertNodes.run(
          node.id,
          node.node_uuid,
          node.lat,
          node.lng,
          node.elevation,
          node.node_type,
          node.connected_trails
        );
      }
    });

    insertMany(nodesResult.rows);
    console.log(`✅ Exported ${nodesResult.rows.length} routing nodes to SQLite`);

    // Verify the export
    const count = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_nodes').get();
    console.log(`🔍 Verification: ${count.count} nodes in SQLite database`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
    sqliteDb.close();
  }
}

exportRoutingNodes().catch(console.error);
