#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

async function testHigherTolerances() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: 'carthorse',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('🔧 Testing higher tolerances for Bear Canyon Loop...\n');

    // Test different tolerance values
    const tolerances = [
      { degrees: 0.0001, meters: 11.1 },
      { degrees: 0.001, meters: 111 },
      { degrees: 0.01, meters: 1110 },
      { degrees: 0.05, meters: 5550 },
      { degrees: 0.1, meters: 11100 }
    ];

    for (const tolerance of tolerances) {
      console.log(`\n🧪 Testing tolerance: ${tolerance.degrees} degrees (${tolerance.meters}m)`);
      
      const stagingSchema = `staging_tolerance_test_${Date.now()}`;
      
      try {
        // Create staging schema
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);

        // Copy Boulder trails
        await client.query(`
          CREATE TABLE ${stagingSchema}.trails AS 
          SELECT * FROM public.trails 
          WHERE ST_Intersects(
            geometry, 
            ST_MakeEnvelope(-105.3, 39.9, -105.2, 40.0, 4326)
          )
        `);

        // Create routing edges
        await client.query(`
          CREATE TABLE ${stagingSchema}.routing_edges AS
          SELECT 
            id,
            app_uuid,
            name,
            trail_type,
            length_km,
            elevation_gain,
            elevation_loss,
            ST_SimplifyPreserveTopology(ST_Force2D(geometry), 0.0001) as geom
          FROM ${stagingSchema}.trails
          WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND length_km > 0
        `);

        // Add topology columns
        await client.query(`
          ALTER TABLE ${stagingSchema}.routing_edges 
          ADD COLUMN source INTEGER,
          ADD COLUMN target INTEGER
        `);

        // Create topology
        const topologyResult = await client.query(`
          SELECT pgr_createTopology('${stagingSchema}.routing_edges', ${tolerance.degrees}, 'geom', 'id')
        `);

        if (topologyResult.rows[0].pgr_createtopology === 'OK') {
          // Get vertices table name
          const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = '${stagingSchema}' 
            AND table_name LIKE '%vertices%'
          `);

          if (tablesResult.rows.length > 0) {
            const verticesTableName = `${stagingSchema}.${tablesResult.rows[0].table_name}`;
            
            // Create nodes table
            await client.query(`
              CREATE TABLE ${stagingSchema}.routing_nodes AS
              SELECT 
                id,
                the_geom,
                cnt,
                ST_X(the_geom) as lng,
                ST_Y(the_geom) as lat,
                ST_Z(the_geom) as elevation
              FROM ${verticesTableName}
            `);

            // Test connectivity
            const connectivityResult = await client.query(`
              SELECT 
                component,
                COUNT(*) as node_count
              FROM pgr_connectedComponents(
                'SELECT id, source, target, length_km * 1000 as cost FROM ${stagingSchema}.routing_edges WHERE length_km > 0'
              )
              GROUP BY component
              ORDER BY node_count DESC
            `);

            console.log(`   📊 Total components: ${connectivityResult.rows.length}`);

            // Test Bear Canyon connectivity specifically
            const bearCanyonEdges = await client.query(`
              SELECT 
                id,
                source,
                target,
                name,
                length_km
              FROM ${stagingSchema}.routing_edges
              WHERE name ILIKE '%bear canyon%' 
                 OR name ILIKE '%mesa%' 
                 OR name ILIKE '%fern canyon%'
            `);

            if (bearCanyonEdges.rows.length > 0) {
              const bearCanyonNodeIds = bearCanyonEdges.rows.flatMap(edge => [edge.source, edge.target]);
              const uniqueNodeIds = [...new Set(bearCanyonNodeIds)];
              
              const bearCanyonConnectivity = await client.query(`
                WITH bear_canyon_nodes AS (
                  SELECT UNNEST($1::int[]) as node_id
                ),
                components AS (
                  SELECT 
                    bcn.node_id,
                    cc.component
                  FROM bear_canyon_nodes bcn
                  JOIN pgr_connectedComponents(
                    'SELECT id, source, target, length_km * 1000 as cost FROM ${stagingSchema}.routing_edges WHERE length_km > 0'
                  ) cc ON bcn.node_id = cc.node
                )
                SELECT 
                  component,
                  COUNT(*) as node_count,
                  ARRAY_AGG(node_id ORDER BY node_id) as node_ids
                FROM components
                GROUP BY component
                ORDER BY node_count DESC
              `, [uniqueNodeIds]);

              console.log(`   🐻 Bear Canyon components: ${bearCanyonConnectivity.rows.length}`);
              
              if (bearCanyonConnectivity.rows.length === 1) {
                console.log(`   ✅ SUCCESS! Bear Canyon Loop is fully connected at ${tolerance.meters}m tolerance`);
                
                // Test loop detection
                const loopResult = await client.query(`
                  SELECT 
                    path_id as cycle_id,
                    COUNT(*) as edge_count,
                    SUM(cost) as total_cost
                  FROM pgr_hawickcircuits(
                    'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.routing_edges WHERE length_km > 0'
                  )
                  GROUP BY path_id
                  ORDER BY total_cost DESC
                  LIMIT 5
                `);

                console.log(`   🔄 Found ${loopResult.rows.length} complete loops`);
                loopResult.rows.forEach((loop, i) => {
                  console.log(`      Loop ${i + 1}: ${loop.edge_count} edges, ${(loop.total_cost).toFixed(2)}km`);
                });
                
                // Found the right tolerance - clean up and exit
                await client.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
                console.log(`\n🎉 SUCCESS: Bear Canyon Loop is routable with ${tolerance.meters}m tolerance!`);
                return;
              } else {
                console.log(`   ❌ Still ${bearCanyonConnectivity.rows.length} components`);
                bearCanyonConnectivity.rows.forEach((comp, i) => {
                  console.log(`      Component ${i + 1}: ${comp.node_count} nodes`);
                });
              }
            }
          }
        } else {
          console.log(`   ❌ Topology creation failed`);
        }

        // Cleanup
        await client.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        await client.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
      }
    }

    console.log('\n❌ No tolerance value fully connected the Bear Canyon Loop');

  } catch (error) {
    console.error('❌ Error during tolerance testing:', error);
  } finally {
    await client.end();
  }
}

testHigherTolerances();
