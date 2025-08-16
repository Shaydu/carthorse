#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

async function fixBearCanyonRouting() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: 'carthorse',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('🔧 Fixing Bear Canyon Loop routing with pgRouting...\n');

    // Create a test staging schema
    const stagingSchema = `staging_bear_canyon_fix_${Date.now()}`;
    console.log(`📋 Creating staging schema: ${stagingSchema}`);

    // Step 1: Create staging schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);

    // Step 2: Copy Boulder trails to staging
    console.log('📋 Copying Boulder trails to staging...');
    await client.query(`
      CREATE TABLE ${stagingSchema}.trails AS 
      SELECT * FROM public.trails 
      WHERE ST_Intersects(
        geometry, 
        ST_MakeEnvelope(-105.3, 39.9, -105.2, 40.0, 4326)
      )
    `);

    const trailCount = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
    console.log(`✅ Copied ${trailCount.rows[0].count} trails to staging`);

    // Step 3: Let pgRouting create topology directly (skip our custom functions)
    console.log('🛤️ Creating routing topology with pgRouting...');
    
    // Create routing_edges table directly from trails
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

    // Check the data quality
    const dataCheck = await client.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN geom IS NULL THEN 1 END) as null_geom,
        COUNT(CASE WHEN NOT ST_IsValid(geom) THEN 1 END) as invalid_geom,
        COUNT(CASE WHEN ST_Length(geom) = 0 THEN 1 END) as zero_length
      FROM ${stagingSchema}.routing_edges
    `);
    console.log('Data quality check:', dataCheck.rows[0]);

    // Create topology using pgRouting with generous tolerance (10 meters)
    console.log('🔗 Creating topology with 10m tolerance...');
    
    // Try different tolerance values
    const tolerances = [0.0001, 0.001, 0.01, 0.1];
    let topologySuccess = false;
    let verticesTableName = null;
    
    for (const tolerance of tolerances) {
      console.log(`   Trying tolerance: ${tolerance} (${(tolerance * 111000).toFixed(1)}m)`);
      
      try {
        const topologyResult = await client.query(`
          SELECT pgr_createTopology('${stagingSchema}.routing_edges', ${tolerance}, 'geom', 'id')
        `);
        console.log('   Topology result:', topologyResult.rows[0]);
        
        // Check if vertices table was created
        const tablesResult = await client.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = '${stagingSchema}' 
          AND table_name LIKE '%vertices%'
        `);
        
        if (tablesResult.rows.length > 0) {
          verticesTableName = `${stagingSchema}.${tablesResult.rows[0].table_name}`;
          console.log(`   ✅ Success! Vertices table: ${verticesTableName}`);
          topologySuccess = true;
          break;
        }
      } catch (error) {
        console.log(`   ❌ Failed with tolerance ${tolerance}:`, error.message);
      }
    }
    
    if (!topologySuccess) {
      throw new Error('Failed to create topology with any tolerance value');
    }

    // Create nodes table from pgRouting topology
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

    // Add spatial indexes
    await client.query(`
      CREATE INDEX idx_${stagingSchema}_routing_edges_geom ON ${stagingSchema}.routing_edges USING GIST (geom);
      CREATE INDEX idx_${stagingSchema}_routing_nodes_geom ON ${stagingSchema}.routing_nodes USING GIST (the_geom);
    `);

    // Step 4: Check the results
    console.log('📊 Checking routing network results...');
    
    const edgeCount = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_edges`);
    const nodeCount = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_nodes`);
    
    console.log(`✅ Created ${edgeCount.rows[0].count} routing edges`);
    console.log(`✅ Created ${nodeCount.rows[0].count} routing nodes`);

    // Step 5: Test connectivity
    console.log('🔍 Testing network connectivity...');
    
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

    // Step 6: Test Bear Canyon Loop specifically
    console.log('🐻 Testing Bear Canyon Loop connectivity...');
    
    // Find Bear Canyon related edges
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
        console.log('✅ SUCCESS: Bear Canyon Loop is now connected!');
        
        // Test actual loop detection
        console.log('🔄 Testing loop detection...');
        const loopResult = await client.query(`
          SELECT 
            path_id as cycle_id,
            edge as edge_id,
            cost,
            agg_cost,
            path_seq
          FROM pgr_hawickcircuits(
            'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.routing_edges WHERE length_km > 0'
          )
          ORDER BY path_id, path_seq
          LIMIT 50
        `);

        console.log(`🔄 Found ${loopResult.rows.length} loop edges`);
        
        // Group by cycle_id to show complete loops
        const loops = {};
        loopResult.rows.forEach(row => {
          if (!loops[row.cycle_id]) {
            loops[row.cycle_id] = [];
          }
          loops[row.cycle_id].push(row);
        });

        console.log(`🔄 Found ${Object.keys(loops).length} complete loops`);
        Object.keys(loops).slice(0, 5).forEach(cycleId => {
          const loop = loops[cycleId];
          const totalCost = loop[loop.length - 1].agg_cost;
          console.log(`   Loop ${cycleId}: ${loop.length} edges, ${(totalCost/1000).toFixed(2)}km`);
        });

      } else {
        console.log('❌ Bear Canyon Loop is still disconnected');
        bearCanyonConnectivity.rows.forEach((comp, i) => {
          console.log(`   Component ${i + 1}: ${comp.node_count} nodes [${comp.node_ids.join(', ')}]`);
        });
      }
    }

    // Step 7: Export the fixed network
    console.log('💾 Exporting fixed network...');
    
    const exportResult = await client.query(`
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(geom)::json,
              'properties', json_build_object(
                'id', id,
                'source', source,
                'target', target,
                'name', name,
                'length_km', length_km,
                'elevation_gain', elevation_gain,
                'elevation_loss', elevation_loss,
                'type', 'edge'
              )
            )
          )
        ) as geojson
      FROM ${stagingSchema}.routing_edges
      WHERE geom IS NOT NULL
    `);

    if (exportResult.rows[0].geojson) {
      const fs = require('fs');
      const outputPath = 'test-output/bear-canyon-fixed-network.geojson';
      fs.writeFileSync(outputPath, JSON.stringify(exportResult.rows[0].geojson, null, 2));
      console.log(`✅ Exported fixed network to: ${outputPath}`);
    }

    // Step 8: Cleanup (optional)
    console.log('🧹 Cleaning up staging schema...');
    await client.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);

    console.log('\n✅ Bear Canyon Loop routing fix complete!');

  } catch (error) {
    console.error('❌ Error during Bear Canyon routing fix:', error);
  } finally {
    await client.end();
  }
}

fixBearCanyonRouting();
