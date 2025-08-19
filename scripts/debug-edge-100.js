const { Pool } = require('pg');
require('dotenv').config();

async function debugEdge100() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'shaydu',
    password: process.env.PGPASSWORD,
  });

  try {
    console.log('🔍 Debugging edge-100 (Bear Canyon Trail Segment 1)...\n');

    // Find the latest staging schema
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schemas found');
      return;
    }

    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}\n`);

    // Check if the edge exists in routing_edges
    console.log('1️⃣ Checking if edge-100 exists in routing_edges...');
    const edgeResult = await pool.query(`
      SELECT 
        id,
        app_uuid,
        name,
        length_km,
        elevation_gain,
        elevation_loss,
        source,
        target,
        trail_type
      FROM ${stagingSchema}.routing_edges 
      WHERE app_uuid = '0fd533e6-6c44-4fac-baea-c04028800a49'
         OR name = 'Bear Canyon Trail Segment 1'
         OR id = 100
    `);

    if (edgeResult.rows.length === 0) {
      console.log('❌ Edge-100 NOT found in routing_edges');
      
      // Check if it exists in trails table
      console.log('\n2️⃣ Checking if it exists in trails table...');
      const trailResult = await pool.query(`
        SELECT 
          id,
          app_uuid,
          name,
          length_km,
          elevation_gain,
          elevation_loss,
          geometry IS NOT NULL as has_geometry,
          ST_IsValid(geometry) as is_valid_geometry,
          ST_Length(geometry::geography) as geom_length_meters
        FROM ${stagingSchema}.trails 
        WHERE app_uuid = '0fd533e6-6c44-4fac-baea-c04028800a49'
           OR name = 'Bear Canyon Trail Segment 1'
      `);

      if (trailResult.rows.length === 0) {
        console.log('❌ Trail NOT found in trails table');
      } else {
        console.log('✅ Trail found in trails table:');
        trailResult.rows.forEach(row => {
          console.log(`   - ID: ${row.id}`);
          console.log(`   - UUID: ${row.app_uuid}`);
          console.log(`   - Name: ${row.name}`);
          console.log(`   - Length: ${row.length_km}km`);
          console.log(`   - Elevation gain: ${row.elevation_gain}m`);
          console.log(`   - Has geometry: ${row.has_geometry}`);
          console.log(`   - Valid geometry: ${row.is_valid_geometry}`);
          console.log(`   - Geometry length: ${row.geom_length_meters}m`);
        });
      }
    } else {
      console.log('✅ Edge-100 found in routing_edges:');
      edgeResult.rows.forEach(row => {
        console.log(`   - ID: ${row.id}`);
        console.log(`   - UUID: ${row.app_uuid}`);
        console.log(`   - Name: ${row.name}`);
        console.log(`   - Length: ${row.length_km}km`);
        console.log(`   - Elevation gain: ${row.elevation_gain}m`);
        console.log(`   - Source node: ${row.source}`);
        console.log(`   - Target node: ${row.target}`);
        console.log(`   - Trail type: ${row.trail_type}`);
      });

      // Check if source and target nodes exist
      console.log('\n3️⃣ Checking if source and target nodes exist...');
      const edge = edgeResult.rows[0];
      const nodesResult = await pool.query(`
        SELECT 
          id,
          node_type,
          lat,
          lng
        FROM ${stagingSchema}.routing_nodes 
        WHERE id IN (${edge.source}, ${edge.target})
        ORDER BY id
      `);

      console.log(`   - Source node ${edge.source}: ${nodesResult.rows.find(n => n.id === edge.source) ? '✅ EXISTS' : '❌ MISSING'}`);
      console.log(`   - Target node ${edge.target}: ${nodesResult.rows.find(n => n.id === edge.target) ? '✅ EXISTS' : '❌ MISSING'}`);

      if (nodesResult.rows.length > 0) {
        nodesResult.rows.forEach(node => {
          console.log(`     Node ${node.id}: type=${node.node_type}, lat=${node.lat}, lng=${node.lng}`);
        });
      }

      // Check if this edge is connected to other edges
      console.log('\n4️⃣ Checking edge connectivity...');
      const connectivityResult = await pool.query(`
        SELECT 
          COUNT(*) as connected_edges,
          COUNT(CASE WHEN source = ${edge.target} THEN 1 END) as outgoing_edges,
          COUNT(CASE WHEN target = ${edge.source} THEN 1 END) as incoming_edges
        FROM ${stagingSchema}.routing_edges 
        WHERE source = ${edge.target} OR target = ${edge.source}
      `);

      const connectivity = connectivityResult.rows[0];
      console.log(`   - Connected edges: ${connectivity.connected_edges}`);
      console.log(`   - Outgoing from target: ${connectivity.outgoing_edges}`);
      console.log(`   - Incoming to source: ${connectivity.incoming_edges}`);

      // Check if this edge is part of any routes
      console.log('\n5️⃣ Checking if edge is used in any routes...');
      const routeResult = await pool.query(`
        SELECT 
          COUNT(*) as route_count
        FROM ${stagingSchema}.route_recommendations 
        WHERE route_edges @> ARRAY[${edge.id}]
      `);

      console.log(`   - Routes using this edge: ${routeResult.rows[0].route_count}`);
    }

    // Check configuration values that might filter out this edge
    console.log('\n6️⃣ Checking configuration values...');
    console.log('   - minTrailLengthMeters: 0.1m (from carthorse.config.yaml)');
    console.log('   - minTrailLengthMeters: 0m (from layer3-routing.config.yaml)');
    
    // Check if there are any other edges with similar characteristics
    console.log('\n7️⃣ Checking for similar edges...');
    const similarResult = await pool.query(`
      SELECT 
        id,
        app_uuid,
        name,
        length_km,
        elevation_gain,
        source,
        target
      FROM ${stagingSchema}.routing_edges 
      WHERE name LIKE '%Bear Canyon%'
      ORDER BY id
    `);

    if (similarResult.rows.length > 0) {
      console.log('   Similar Bear Canyon edges:');
      similarResult.rows.forEach(row => {
        console.log(`     - Edge ${row.id}: ${row.name} (${row.length_km}km, ${row.elevation_gain}m gain)`);
      });
    } else {
      console.log('   No other Bear Canyon edges found');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

debugEdge100();
