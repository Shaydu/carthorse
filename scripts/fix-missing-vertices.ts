#!/usr/bin/env ts-node

import { Pool } from 'pg';

const config = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
};

const stagingSchema = 'staging_boulder_1754318437837';

async function fixMissingVertices() {
  const pool = new Pool(config);
  
  try {
    console.log('🔧 Fixing missing vertices in pgRouting tables...');
    
    // Get all noded tables that might have missing vertices
    const nodedTablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1 
      AND table_name LIKE '%noded' 
      AND table_name NOT LIKE '%vertices%'
      ORDER BY table_name
    `, [stagingSchema]);
    
    console.log(`Found ${nodedTablesResult.rows.length} noded tables to process`);
    
    for (const row of nodedTablesResult.rows) {
      const nodedTableName = row.table_name;
      const baseTableName = nodedTableName.replace('_noded', '');
      const verticesTableName = `${baseTableName}_noded_vertices_pgr`;
      
      console.log(`\n📋 Processing ${nodedTableName}...`);
      
      // Check if source/target columns are NULL
      const nullCheckResult = await pool.query(`
        SELECT 
          COUNT(*) as total_edges,
          COUNT(CASE WHEN source IS NULL THEN 1 END) as null_source,
          COUNT(CASE WHEN target IS NULL THEN 1 END) as null_target
        FROM ${stagingSchema}.${nodedTableName}
      `);
      
      const stats = nullCheckResult.rows[0];
      console.log(`  Edges: ${stats.total_edges}, Null source: ${stats.null_source}, Null target: ${stats.null_target}`);
      
      if (stats.null_source > 0 || stats.null_target > 0) {
        console.log(`  ⚠️  Found ${stats.null_source} edges with NULL source/target - fixing...`);
        
        // Create vertices table if it doesn't exist
        const verticesExistResult = await pool.query(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = $1 AND table_name = $2
          )
        `, [stagingSchema, verticesTableName]);
        
        if (!verticesExistResult.rows[0].exists) {
          console.log(`  📝 Creating vertices table ${verticesTableName}...`);
          
          // Create vertices table with proper structure
          await pool.query(`
            CREATE TABLE ${stagingSchema}.${verticesTableName} (
              id BIGINT PRIMARY KEY,
              cnt INTEGER,
              chk INTEGER,
              ein INTEGER,
              eout INTEGER,
              the_geom GEOMETRY(Point, 4326)
            )
          `);
        }
        
        // Extract unique start and end points from edges
        console.log(`  🔍 Extracting vertices from edge geometries...`);
        
        const verticesResult = await pool.query(`
          WITH edge_vertices AS (
            SELECT 
              ROW_NUMBER() OVER (ORDER BY point_geom) as vertex_id,
              point_geom as the_geom,
              COUNT(*) as cnt
            FROM (
              SELECT ST_StartPoint(the_geom) as point_geom
              FROM ${stagingSchema}.${nodedTableName}
              WHERE the_geom IS NOT NULL
              UNION ALL
              SELECT ST_EndPoint(the_geom) as point_geom
              FROM ${stagingSchema}.${nodedTableName}
              WHERE the_geom IS NOT NULL
            ) all_points
            WHERE point_geom IS NOT NULL
            GROUP BY point_geom
          )
          SELECT vertex_id, the_geom, cnt
          FROM edge_vertices
          ORDER BY vertex_id
        `);
        
        console.log(`  📊 Found ${verticesResult.rows.length} unique vertices`);
        
        // Clear existing vertices and insert new ones
        await pool.query(`DELETE FROM ${stagingSchema}.${verticesTableName}`);
        
        for (const vertex of verticesResult.rows) {
          await pool.query(`
            INSERT INTO ${stagingSchema}.${verticesTableName} (id, the_geom, cnt, chk, ein, eout)
            VALUES ($1, $2, $3, 0, 0, 0)
          `, [vertex.vertex_id, vertex.the_geom, vertex.vertex_id]);
        }
        
        // Update source and target columns in the noded table
        console.log(`  🔄 Updating source/target columns in ${nodedTableName}...`);
        
        await pool.query(`
          UPDATE ${stagingSchema}.${nodedTableName}
          SET 
            source = (
              SELECT v.id 
              FROM ${stagingSchema}.${verticesTableName} v 
              WHERE ST_Equals(v.the_geom, ST_StartPoint(${stagingSchema}.${nodedTableName}.the_geom))
              LIMIT 1
            ),
            target = (
              SELECT v.id 
              FROM ${stagingSchema}.${verticesTableName} v 
              WHERE ST_Equals(v.the_geom, ST_EndPoint(${stagingSchema}.${nodedTableName}.the_geom))
              LIMIT 1
            )
          WHERE the_geom IS NOT NULL
        `);
        
        // Verify the fix
        const verifyResult = await pool.query(`
          SELECT 
            COUNT(*) as total_edges,
            COUNT(CASE WHEN source IS NULL THEN 1 END) as null_source,
            COUNT(CASE WHEN target IS NULL THEN 1 END) as null_target
          FROM ${stagingSchema}.${nodedTableName}
        `);
        
        const verifyStats = verifyResult.rows[0];
        console.log(`  ✅ After fix - Edges: ${verifyStats.total_edges}, Null source: ${verifyStats.null_source}, Null target: ${verifyStats.null_target}`);
        
        if (verifyStats.null_source === 0 && verifyStats.null_target === 0) {
          console.log(`  🎉 Successfully fixed ${nodedTableName}!`);
        } else {
          console.log(`  ⚠️  Still have ${verifyStats.null_source} null sources and ${verifyStats.null_target} null targets`);
        }
        
      } else {
        console.log(`  ✅ ${nodedTableName} already has proper source/target columns`);
      }
    }
    
    console.log('\n🎯 Fix complete! All noded tables should now have proper vertices and source/target columns.');
    
  } catch (error) {
    console.error('❌ Error fixing missing vertices:', error);
  } finally {
    await pool.end();
  }
}

// Run the fix
fixMissingVertices().catch(console.error); 