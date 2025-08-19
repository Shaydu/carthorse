#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function debugWaysNodedStructure() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Debugging ways_noded table structure...');
    
    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'ways_noded' 
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with ways_noded found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check the structure of ways_noded table
    console.log('\n📋 Checking ways_noded table structure...');
    
    const tableStructure = await pgClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'ways_noded'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log(`\n📊 ways_noded table structure:`);
    tableStructure.rows.forEach(column => {
      console.log(`  ${column.column_name}: ${column.data_type} (${column.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    
    // Check the structure of ways_noded_vertices_pgr table
    console.log('\n📋 Checking ways_noded_vertices_pgr table structure...');
    
    const verticesStructure = await pgClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log(`\n📊 ways_noded_vertices_pgr table structure:`);
    verticesStructure.rows.forEach(column => {
      console.log(`  ${column.column_name}: ${column.data_type} (${column.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    
    // Check how ways_noded relates to trails table
    console.log('\n🔗 Checking relationship between ways_noded and trails...');
    
    const sampleWays = await pgClient.query(`
      SELECT id, source, target, the_geom
      FROM ${stagingSchema}.ways_noded
      LIMIT 5
    `);
    
    console.log(`\n📊 Sample ways_noded entries:`);
    sampleWays.rows.forEach(way => {
      console.log(`  ${way.id}: ${way.source} → ${way.target}`);
    });
    
    // Check if there's a mapping table or if we need to join with trails
    console.log('\n🔗 Checking for trail mapping...');
    
    const mappingTables = await pgClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1 
        AND (table_name LIKE '%edge%' OR table_name LIKE '%export%' OR table_name LIKE '%routing%')
      ORDER BY table_name
    `, [stagingSchema]);
    
    console.log(`\n📊 Potential mapping tables:`);
    mappingTables.rows.forEach(table => {
      console.log(`  ${table.table_name}`);
    });
    
    // Check export_edges table which seems to be the mapping
    console.log('\n🔗 Checking export_edges table...');
    
    const exportEdgesStructure = await pgClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'export_edges'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log(`\n📊 export_edges table structure:`);
    exportEdgesStructure.rows.forEach(column => {
      console.log(`  ${column.column_name}: ${column.data_type} (${column.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    
    // Check how export_edges maps to ways_noded
    console.log('\n🔗 Checking export_edges to ways_noded mapping...');
    
    const mappingSample = await pgClient.query(`
      SELECT ee.id, ee.trail_name, ee.source, ee.target, wn.id as ways_noded_id, wn.source as wn_source, wn.target as wn_target
      FROM ${stagingSchema}.export_edges ee
      LEFT JOIN ${stagingSchema}.ways_noded wn ON ee.id = wn.id
      WHERE ee.trail_name ILIKE '%bear canyon%' OR ee.trail_name ILIKE '%fern canyon%'
      ORDER BY ee.trail_name, ee.id
      LIMIT 10
    `);
    
    console.log(`\n📊 Export edges to ways_noded mapping:`);
    mappingSample.rows.forEach(row => {
      console.log(`  ${row.id}: ${row.trail_name} (${row.source} → ${row.target}) -> ways_noded ${row.ways_noded_id} (${row.wn_source} → ${row.wn_target})`);
    });
    
    // Check if Bear Canyon and Fern Canyon are connected in ways_noded
    console.log('\n🔗 Checking Bear Canyon and Fern Canyon connection in ways_noded...');
    
    const bearCanyonWays = await pgClient.query(`
      SELECT wn.id, wn.source, wn.target, ee.trail_name
      FROM ${stagingSchema}.ways_noded wn
      JOIN ${stagingSchema}.export_edges ee ON wn.id = ee.id
      WHERE ee.trail_name ILIKE '%bear canyon%'
      ORDER BY ee.trail_name, wn.id
    `);
    
    const fernCanyonWays = await pgClient.query(`
      SELECT wn.id, wn.source, wn.target, ee.trail_name
      FROM ${stagingSchema}.ways_noded wn
      JOIN ${stagingSchema}.export_edges ee ON wn.id = ee.id
      WHERE ee.trail_name ILIKE '%fern canyon%'
      ORDER BY ee.trail_name, wn.id
    `);
    
    console.log(`\n🐻 Bear Canyon ways_noded entries (${bearCanyonWays.rows.length}):`);
    bearCanyonWays.rows.forEach(way => {
      console.log(`  ${way.id}: ${way.trail_name} (${way.source} → ${way.target})`);
    });
    
    console.log(`\n🌿 Fern Canyon ways_noded entries (${fernCanyonWays.rows.length}):`);
    fernCanyonWays.rows.forEach(way => {
      console.log(`  ${way.id}: ${way.trail_name} (${way.source} → ${way.target})`);
    });
    
    // Check for common nodes
    const bearCanyonNodes = bearCanyonWays.rows.map(w => [w.source, w.target]).flat();
    const fernCanyonNodes = fernCanyonWays.rows.map(w => [w.source, w.target]).flat();
    
    console.log(`\n🔗 Bear Canyon nodes: ${bearCanyonNodes.join(', ')}`);
    console.log(`🔗 Fern Canyon nodes: ${fernCanyonNodes.join(', ')}`);
    
    const commonNodes = bearCanyonNodes.filter(node => fernCanyonNodes.includes(node));
    console.log(`\n🔗 Common nodes between Bear Canyon and Fern Canyon: ${commonNodes.join(', ')}`);
    
    // Check if there are any connecting edges
    const connectingEdges = await pgClient.query(`
      SELECT wn.id, wn.source, wn.target, ee.trail_name
      FROM ${stagingSchema}.ways_noded wn
      JOIN ${stagingSchema}.export_edges ee ON wn.id = ee.id
      WHERE (wn.source = ANY($1) AND wn.target = ANY($2))
         OR (wn.source = ANY($2) AND wn.target = ANY($1))
      ORDER BY wn.id
    `, [bearCanyonNodes, fernCanyonNodes]);
    
    console.log(`\n🔗 Direct connecting edges (${connectingEdges.rows.length}):`);
    connectingEdges.rows.forEach(edge => {
      console.log(`  ${edge.id}: ${edge.source} → ${edge.target} (${edge.trail_name})`);
    });
    
  } catch (error) {
    console.error('❌ Error during ways_noded structure debug:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the debug script
debugWaysNodedStructure().catch(console.error);
