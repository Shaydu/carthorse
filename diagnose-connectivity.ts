#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function main() {
  console.log('🔍 Diagnosing connectivity between Fern Canyon, Bear Peak, and Bear Peak West Ridge...');
  
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    const stagingSchema = 'bear_canyon_test';
    
    // First, let's see what trails we have and their connectivity
    console.log('\n📋 All trails in the dataset:');
    const trailsResult = await pool.query(`
      SELECT DISTINCT trail_name, COUNT(*) as segment_count
      FROM ${stagingSchema}.ways_noded
      GROUP BY trail_name
      ORDER BY trail_name
    `);
    
    trailsResult.rows.forEach((row: any) => {
      console.log(`   ${row.trail_name}: ${row.segment_count} segments`);
    });
    
    // Look for Fern Canyon segments
    console.log('\n🌿 Fern Canyon segments:');
    const fernCanyonResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE trail_name LIKE '%Fern Canyon%'
      ORDER BY id
    `);
    
    fernCanyonResult.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.length_km.toFixed(3)}km)`);
    });
    
    // Look for Bear Peak segments
    console.log('\n🏔️ Bear Peak segments:');
    const bearPeakResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE trail_name LIKE '%Bear Peak%'
      ORDER BY id
    `);
    
    bearPeakResult.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.length_km.toFixed(3)}km)`);
    });
    
    // Look for Bear Peak West Ridge segments
    console.log('\n🏔️ Bear Peak West Ridge segments:');
    const bearPeakWestRidgeResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE trail_name LIKE '%Bear Peak West Ridge%'
      ORDER BY id
    `);
    
    bearPeakWestRidgeResult.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.length_km.toFixed(3)}km)`);
    });
    
    // Now let's check connectivity between these trails
    console.log('\n🔗 Connectivity Analysis:');
    
    // Get all nodes that connect Fern Canyon to other trails
    const fernCanyonNodesResult = await pool.query(`
      SELECT DISTINCT n.id, n.x as lng, n.y as lat, n.cnt as degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr n
      JOIN ${stagingSchema}.ways_noded e1 ON n.id = e1.source OR n.id = e1.target
      JOIN ${stagingSchema}.ways_noded e2 ON n.id = e2.source OR n.id = e2.target
      WHERE e1.trail_name LIKE '%Fern Canyon%'
        AND e2.trail_name NOT LIKE '%Fern Canyon%'
        AND e1.id != e2.id
      ORDER BY n.id
    `);
    
    console.log('🌿 Fern Canyon connection nodes:');
    fernCanyonNodesResult.rows.forEach((row: any) => {
      console.log(`   Node ${row.id}: (${row.lat}, ${row.lng}) - degree ${row.degree}`);
    });
    
    // Get all nodes that connect Bear Peak to other trails
    const bearPeakNodesResult = await pool.query(`
      SELECT DISTINCT n.id, n.x as lng, n.y as lat, n.cnt as degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr n
      JOIN ${stagingSchema}.ways_noded e1 ON n.id = e1.source OR n.id = e1.target
      JOIN ${stagingSchema}.ways_noded e2 ON n.id = e2.source OR n.id = e2.target
      WHERE e1.trail_name LIKE '%Bear Peak%'
        AND e2.trail_name NOT LIKE '%Bear Peak%'
        AND e1.id != e2.id
      ORDER BY n.id
    `);
    
    console.log('🏔️ Bear Peak connection nodes:');
    bearPeakNodesResult.rows.forEach((row: any) => {
      console.log(`   Node ${row.id}: (${row.lat}, ${row.lng}) - degree ${row.degree}`);
    });
    
    // Check if there are any nodes that connect all three trail types
    const allTrailsNodesResult = await pool.query(`
      SELECT DISTINCT n.id, n.x as lng, n.y as lat, n.cnt as degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr n
      JOIN ${stagingSchema}.ways_noded e1 ON n.id = e1.source OR n.id = e1.target
      JOIN ${stagingSchema}.ways_noded e2 ON n.id = e2.source OR n.id = e2.target
      JOIN ${stagingSchema}.ways_noded e3 ON n.id = e3.source OR n.id = e3.target
      WHERE e1.trail_name LIKE '%Fern Canyon%'
        AND e2.trail_name LIKE '%Bear Peak%'
        AND e3.trail_name LIKE '%Bear Peak West Ridge%'
        AND e1.id != e2.id AND e1.id != e3.id AND e2.id != e3.id
      ORDER BY n.id
    `);
    
    console.log('🔗 Nodes connecting all three trail types:');
    if (allTrailsNodesResult.rows.length > 0) {
      allTrailsNodesResult.rows.forEach((row: any) => {
        console.log(`   Node ${row.id}: (${row.lat}, ${row.lng}) - degree ${row.degree}`);
      });
    } else {
      console.log('   ❌ No nodes connect all three trail types directly');
    }
    
    // Let's try to find a path from Fern Canyon to Bear Peak West Ridge
    console.log('\n🛤️ Testing path from Fern Canyon to Bear Peak West Ridge:');
    
          // Get a Fern Canyon node
      const fernCanyonNodeResult = await pool.query(`
        SELECT DISTINCT n.id, n.x as lng, n.y as lat
        FROM ${stagingSchema}.ways_noded_vertices_pgr n
        JOIN ${stagingSchema}.ways_noded e ON n.id = e.source OR n.id = e.target
        WHERE e.trail_name LIKE '%Fern Canyon%'
        LIMIT 1
      `);
    
    if (fernCanyonNodeResult.rows.length > 0) {
      const fernNode = fernCanyonNodeResult.rows[0];
      console.log(`   Starting from Fern Canyon node ${fernNode.id} (${fernNode.lat}, ${fernNode.lng})`);
      
              // Get a Bear Peak West Ridge node
        const bearPeakWestRidgeNodeResult = await pool.query(`
          SELECT DISTINCT n.id, n.x as lng, n.y as lat
          FROM ${stagingSchema}.ways_noded_vertices_pgr n
          JOIN ${stagingSchema}.ways_noded e ON n.id = e.source OR n.id = e.target
          WHERE e.trail_name LIKE '%Bear Peak West Ridge%'
          LIMIT 1
        `);
      
      if (bearPeakWestRidgeNodeResult.rows.length > 0) {
        const bearNode = bearPeakWestRidgeNodeResult.rows[0];
        console.log(`   Target: Bear Peak West Ridge node ${bearNode.id} (${bearNode.lat}, ${bearNode.lng})`);
        
        // Try to find a path between them
        const pathResult = await pool.query(`
          SELECT * FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
            ${fernNode.id}, ${bearNode.id}, false
          )
        `);
        
        if (pathResult.rows.length > 0) {
          console.log(`   ✅ Path found with ${pathResult.rows.length} edges`);
          
          // Get the edges in the path
          const edgeIds = pathResult.rows.map((row: any) => row.edge);
          const edgesResult = await pool.query(`
            SELECT id, source, target, trail_name, length_km
            FROM ${stagingSchema}.ways_noded
            WHERE id = ANY($1::integer[])
            ORDER BY id
          `, [edgeIds]);
          
          console.log('   Path details:');
          edgesResult.rows.forEach((row: any) => {
            console.log(`     Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name})`);
          });
        } else {
          console.log(`   ❌ No path found between Fern Canyon and Bear Peak West Ridge`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error diagnosing connectivity:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
