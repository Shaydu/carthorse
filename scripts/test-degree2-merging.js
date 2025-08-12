#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

async function testDegree2Merging() {
  try {
    const stagingSchema = 'carthorse_1754996780114';
    console.log(`Testing degree 2 merging in schema: ${stagingSchema}`);
    
    // Check current state
    const beforeResult = await pool.query(`
      SELECT COUNT(*) as edge_count FROM ${stagingSchema}.ways_noded
    `);
    console.log(`Before merging: ${beforeResult.rows[0].edge_count} edges`);
    
    // Check the specific edges we're interested in
    const specificEdges = await pool.query(`
      SELECT id, source, target, app_uuid, name, length_km 
      FROM ${stagingSchema}.ways_noded 
      WHERE id IN (2, 51, 3) 
      ORDER BY id
    `);
    console.log('\nSpecific edges before merging:');
    specificEdges.rows.forEach(edge => {
      console.log(`  Edge ${edge.id}: ${edge.source}→${edge.target}, app_uuid: ${edge.app_uuid || 'NULL'}, name: ${edge.name}, length: ${edge.length_km.toFixed(3)}km`);
    });
    
    // Check vertex degrees
    const vertexDegrees = await pool.query(`
      SELECT id, cnt as degree 
      FROM ${stagingSchema}.ways_noded_vertices_pgr 
      WHERE id IN (16, 18, 20, 21, 66) 
      ORDER BY id
    `);
    console.log('\nVertex degrees before merging:');
    vertexDegrees.rows.forEach(vertex => {
      console.log(`  Vertex ${vertex.id}: degree ${vertex.degree}`);
    });
    
    // Now let's manually call the degree 2 merging logic
    console.log('\n🔗 Starting degree 2 merging...');
    
    // Get the next available ID
    const maxIdResult = await pool.query(`
      SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM ${stagingSchema}.ways_noded
    `);
    const nextId = maxIdResult.rows[0].next_id;
    console.log(`Next available ID: ${nextId}`);
    
    // Recompute vertex degrees
    await pool.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    console.log('✅ Recomputed vertex degrees');
    
    // Find degree 2 chains
    const chainResult = await pool.query(`
      WITH RECURSIVE 
      vertex_degrees AS (
        SELECT 
          id as vertex_id,
          cnt as degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      
      trail_chains AS (
        SELECT 
          e.id as edge_id,
          e.source as start_vertex,
          e.target as current_vertex,
          ARRAY[e.id] as chain_edges,
          ARRAY[e.source, e.target] as chain_vertices,
          e.the_geom::geometry as chain_geom,
          e.length_km as total_length,
          e.elevation_gain as total_elevation_gain,
          e.elevation_loss as total_elevation_loss,
          e.name
        FROM ${stagingSchema}.ways_noded e
        WHERE e.source != e.target
        
        UNION ALL
        
        SELECT 
          next_e.id as edge_id,
          tc.start_vertex,
          CASE 
            WHEN next_e.source = tc.current_vertex THEN next_e.target
            ELSE next_e.source
          END as current_vertex,
          tc.chain_edges || next_e.id as chain_edges,
          tc.chain_vertices || CASE 
            WHEN next_e.source = tc.current_vertex THEN next_e.target
            ELSE next_e.source
          END as chain_vertices,
          (
            WITH merged AS (
              SELECT ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom)) as geom
            )
            SELECT 
              CASE 
                WHEN ST_GeometryType(geom) = 'ST_LineString' THEN geom
                ELSE ST_GeometryN(geom, 1)
              END
            FROM merged
          )::geometry as chain_geom,
          tc.total_length + next_e.length_km as total_length,
          tc.total_elevation_gain + next_e.elevation_gain as total_elevation_gain,
          tc.total_elevation_loss + next_e.elevation_loss as total_elevation_loss,
          tc.name
        FROM trail_chains tc
        JOIN ${stagingSchema}.ways_noded next_e ON 
          (next_e.source = tc.current_vertex OR next_e.target = tc.current_vertex)
        WHERE 
          next_e.id != ALL(tc.chain_edges)
          AND next_e.source != next_e.target
          AND (
            ST_DWithin(ST_EndPoint(tc.chain_geom), ST_StartPoint(next_e.the_geom), 0.001)
            OR ST_DWithin(ST_EndPoint(tc.chain_geom), ST_EndPoint(next_e.the_geom), 0.001)
            OR ST_DWithin(ST_StartPoint(tc.chain_geom), ST_StartPoint(next_e.the_geom), 0.001)
            OR ST_DWithin(ST_StartPoint(tc.chain_geom), ST_EndPoint(next_e.the_geom), 0.001)
          )
          AND array_length(tc.chain_edges, 1) < 20
      ),
      
      complete_chains AS (
        SELECT 
          start_vertex,
          current_vertex as end_vertex,
          chain_edges,
          chain_vertices,
          chain_geom,
          total_length,
          total_elevation_gain,
          total_elevation_loss,
          name,
          array_length(chain_edges, 1) as chain_length
        FROM trail_chains
        WHERE array_length(chain_edges, 1) > 1
      )
      
      SELECT 
        start_vertex,
        end_vertex,
        chain_edges,
        chain_length,
        total_length,
        name
      FROM complete_chains
      ORDER BY chain_length DESC, total_length DESC
    `);
    
    console.log(`\nFound ${chainResult.rows.length} chains to merge:`);
    chainResult.rows.forEach((chain, i) => {
      console.log(`  Chain ${i+1}: ${chain.start_vertex}→${chain.end_vertex}, ${chain.chain_length} edges, ${chain.total_length.toFixed(3)}km, edges: [${chain.chain_edges.join(', ')}]`);
    });
    
    if (chainResult.rows.length > 0) {
      console.log('\n🔗 Merging chains...');
      
      // Start a transaction
      await pool.query('BEGIN');
      
      try {
        // Insert merged edges
        for (let i = 0; i < chainResult.rows.length; i++) {
          const chain = chainResult.rows[i];
          const newId = nextId + i;
          
          await pool.query(`
            INSERT INTO ${stagingSchema}.ways_noded (
              id, source, target, the_geom, length_km, elevation_gain, elevation_loss,
              app_uuid, name, old_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `, [
            newId,
            chain.start_vertex,
            chain.end_vertex,
            chain.chain_geom,
            chain.total_length,
            chain.total_elevation_gain,
            chain.total_elevation_loss,
            `merged-degree2-chain-${chain.start_vertex}-${chain.end_vertex}-edges-${chain.chain_edges.join(',')}`,
            chain.name,
            null
          ]);
          
          console.log(`  ✅ Inserted merged edge ${newId}: ${chain.start_vertex}→${chain.end_vertex}`);
        }
        
        // Remove original edges
        const edgesToRemove = chainResult.rows.flatMap(chain => chain.chain_edges);
        const removeResult = await pool.query(`
          DELETE FROM ${stagingSchema}.ways_noded 
          WHERE id = ANY($1)
        `, [edgesToRemove]);
        
        console.log(`  ✅ Removed ${removeResult.rowCount} original edges`);
        
        // Commit transaction
        await pool.query('COMMIT');
        console.log('✅ Transaction committed');
        
      } catch (error) {
        await pool.query('ROLLBACK');
        console.error('❌ Transaction rolled back:', error);
        throw error;
      }
    } else {
      console.log('No chains found to merge');
    }
    
    // Check final state
    const afterResult = await pool.query(`
      SELECT COUNT(*) as edge_count FROM ${stagingSchema}.ways_noded
    `);
    console.log(`\nAfter merging: ${afterResult.rows[0].edge_count} edges`);
    
    // Check if our specific edges still exist
    const specificEdgesAfter = await pool.query(`
      SELECT id, source, target, app_uuid, name, length_km 
      FROM ${stagingSchema}.ways_noded 
      WHERE id IN (2, 51, 3) 
      ORDER BY id
    `);
    console.log('\nSpecific edges after merging:');
    if (specificEdgesAfter.rows.length === 0) {
      console.log('  All specific edges were merged!');
    } else {
      specificEdgesAfter.rows.forEach(edge => {
        console.log(`  Edge ${edge.id}: ${edge.source}→${edge.target}, app_uuid: ${edge.app_uuid || 'NULL'}, name: ${edge.name}, length: ${edge.length_km.toFixed(3)}km`);
      });
    }
    
  } catch (error) {
    console.error('Error testing degree 2 merging:', error);
  } finally {
    await pool.end();
  }
}

testDegree2Merging();
