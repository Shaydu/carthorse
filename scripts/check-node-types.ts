#!/usr/bin/env npx ts-node

import { Pool } from 'pg';

async function checkNodeTypes() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: 'password'
  });

  try {
    // Create a small test
    const stagingSchema = `test_node_check_${Date.now()}`;
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Copy a few trails
    await pool.query(`
      CREATE TABLE ${stagingSchema}.trails AS
      SELECT * FROM public.trails 
      WHERE region = 'boulder' 
      AND geometry IS NOT NULL 
      AND ST_IsValid(geometry)
      AND ST_Intersects(geometry, ST_MakeEnvelope(-105.33917192801866, 39.95803339005218, -105.2681945500977, 40.0288146943966, 4326))
      LIMIT 20
    `);

    // Import and run pgRouting
    const { PgRoutingHelpers } = await import('./scripts/pgnodenetwork-refinement/pgrouting-helpers-1-meter-tolerance');
    const pgrouting = new PgRoutingHelpers({ stagingSchema, pgClient: pool });
    await pgrouting.createPgRoutingViews();

    // Check node types
    const nodeTypes = await pool.query(`
      SELECT 
        CASE 
          WHEN cnt = 1 THEN 'dead_end'
          WHEN cnt = 2 THEN 'simple_connection'
          WHEN cnt >= 3 THEN 'intersection'
          ELSE 'unknown'
        END as node_type,
        COUNT(*) as count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY node_type
      ORDER BY count DESC
    `);

    console.log('📊 Node Type Distribution:');
    nodeTypes.rows.forEach(row => {
      console.log(`   ${row.node_type}: ${row.count} nodes`);
    });

    // Clean up
    await pgrouting.cleanupViews();
    await pool.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

checkNodeTypes().catch(console.error); 