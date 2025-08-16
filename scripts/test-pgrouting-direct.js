#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

async function testPgRoutingDirect() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: 'carthorse',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('🧪 Testing pgRouting direct topology implementation...\n');

    // Create a test staging schema
    const stagingSchema = `test_pgrouting_direct_${Date.now()}`;
    console.log(`📋 Creating test staging schema: ${stagingSchema}`);

    // Step 1: Create staging schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);

    // Step 2: Copy trails from Bear Canyon bbox
    console.log('📋 Copying trails from Bear Canyon bbox...');
    await client.query(`
      CREATE TABLE ${stagingSchema}.trails AS 
      SELECT * FROM public.trails 
      WHERE ST_Intersects(
        geometry, 
        ST_MakeEnvelope(-105.29123174925316, 39.96928418458248, -105.28050515816028, 39.981172777276015, 4326)
      )
    `);

    const trailCount = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
    console.log(`✅ Copied ${trailCount.rows[0].count} trails to staging`);

    // Step 3: Test our pgRouting direct topology implementation
    console.log('🛤️ Testing pgRouting direct topology...');
    
    // Create routing_edges from trails
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

    // Add routing topology columns
    await client.query(`
      ALTER TABLE ${stagingSchema}.routing_edges 
      ADD COLUMN source INTEGER,
      ADD COLUMN target INTEGER
    `);

    const edgeCount = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_edges`);
    console.log(`✅ Created ${edgeCount.rows[0].count} routing edges`);

    // Create pgRouting topology with 111m tolerance
    console.log('🔗 Creating pgRouting topology with 111m tolerance...');
    const topologyResult = await client.query(`
      SELECT pgr_createTopology('${stagingSchema}.routing_edges', 0.001, 'geom', 'id')
    `);
    console.log('Topology result:', topologyResult.rows[0]);

    // Get vertices table name
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = '${stagingSchema}' 
      AND table_name LIKE '%vertices%'
    `);

    if (tablesResult.rows.length === 0) {
      throw new Error('No vertices table found after pgRouting topology creation');
    }

    const verticesTableName = `${stagingSchema}.${tablesResult.rows[0].table_name}`;
    console.log(`✅ Vertices table: ${verticesTableName}`);

    // Create nodes table from vertices
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

    const nodeCount = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_nodes`);
    console.log(`✅ Created ${nodeCount.rows[0].count} routing nodes`);

    // Test connectivity
    console.log('🔍 Testing connectivity...');
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

    console.log(`📊 Found ${connectivityResult.rows.length} connected components:`);
    connectivityResult.rows.forEach((comp, i) => {
      console.log(`   Component ${i + 1}: ${comp.node_count} nodes`);
    });

    // Test Bear Canyon Loop specifically
    console.log('🐻 Testing Bear Canyon Loop connectivity...');
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
      ORDER BY name
    `);

    console.log(`🐻 Found ${bearCanyonEdges.rows.length} Bear Canyon related edges:`);
    bearCanyonEdges.rows.forEach((edge, i) => {
      console.log(`   ${i + 1}. ${edge.name} (Edge ${edge.id})`);
      console.log(`      Source: ${edge.source} → Target: ${edge.target}`);
      console.log(`      Length: ${edge.length_km.toFixed(2)}km`);
    });

    // Check if Bear Canyon edges are in the same component
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

      console.log(`🐻 Bear Canyon connectivity: ${bearCanyonConnectivity.rows.length} components`);
      
      if (bearCanyonConnectivity.rows.length === 1) {
        console.log('✅ SUCCESS: Bear Canyon Loop is fully connected!');
        
        // Test loop detection
        console.log('🔄 Testing loop detection...');
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

        console.log(`🔄 Found ${loopResult.rows.length} complete loops`);
        loopResult.rows.forEach((loop, i) => {
          console.log(`   Loop ${i + 1}: ${loop.edge_count} edges, ${(loop.total_cost).toFixed(2)}km`);
        });
        
      } else {
        console.log('❌ Bear Canyon Loop is still disconnected');
        bearCanyonConnectivity.rows.forEach((comp, i) => {
          console.log(`   Component ${i + 1}: ${comp.node_count} nodes [${comp.node_ids.join(', ')}]`);
        });
      }
    }

    // Cleanup
    console.log('🧹 Cleaning up test schema...');
    await client.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);

    console.log('\n✅ pgRouting direct topology test completed!');

  } catch (error) {
    console.error('❌ Error during pgRouting direct topology test:', error);
  } finally {
    await client.end();
  }
}

testPgRoutingDirect();
