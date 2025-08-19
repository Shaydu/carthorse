const { Pool } = require('pg');
require('dotenv').config();

async function checkEdge100Public() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'shaydu',
    password: process.env.PGPASSWORD,
  });

  try {
    console.log('🔍 Checking edge-100 in public schema...\n');

    // Check if the trail exists in public.trails
    console.log('1️⃣ Checking if trail exists in public.trails...');
    const trailResult = await pool.query(`
      SELECT 
        id,
        app_uuid,
        name,
        length_km,
        elevation_gain,
        elevation_loss,
        source,
        geometry IS NOT NULL as has_geometry,
        ST_IsValid(geometry) as is_valid_geometry,
        ST_Length(geometry::geography) as geom_length_meters
      FROM public.trails 
      WHERE app_uuid = '0fd533e6-6c44-4fac-baea-c04028800a49'
         OR name = 'Bear Canyon Trail Segment 1'
         OR name LIKE '%Bear Canyon%'
      ORDER BY name
    `);

    if (trailResult.rows.length === 0) {
      console.log('❌ Trail NOT found in public.trails');
    } else {
      console.log('✅ Trails found in public.trails:');
      trailResult.rows.forEach(row => {
        console.log(`   - ID: ${row.id}`);
        console.log(`   - UUID: ${row.app_uuid}`);
        console.log(`   - Name: ${row.name}`);
        console.log(`   - Length: ${row.length_km}km`);
        console.log(`   - Elevation gain: ${row.elevation_gain}m`);
        console.log(`   - Source: ${row.source}`);
        console.log(`   - Has geometry: ${row.has_geometry}`);
        console.log(`   - Valid geometry: ${row.is_valid_geometry}`);
        console.log(`   - Geometry length: ${row.geom_length_meters}m`);
        console.log('');
      });
    }

    // Check if edge exists in public.routing_edges
    console.log('2️⃣ Checking if edge exists in public.routing_edges...');
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
      FROM public.routing_edges 
      WHERE app_uuid = '0fd533e6-6c44-4fac-baea-c04028800a49'
         OR name = 'Bear Canyon Trail Segment 1'
         OR name LIKE '%Bear Canyon%'
      ORDER BY name
    `);

    if (edgeResult.rows.length === 0) {
      console.log('❌ Edge NOT found in public.routing_edges');
    } else {
      console.log('✅ Edges found in public.routing_edges:');
      edgeResult.rows.forEach(row => {
        console.log(`   - ID: ${row.id}`);
        console.log(`   - UUID: ${row.app_uuid}`);
        console.log(`   - Name: ${row.name}`);
        console.log(`   - Length: ${row.length_km}km`);
        console.log(`   - Elevation gain: ${row.elevation_gain}m`);
        console.log(`   - Source node: ${row.source}`);
        console.log(`   - Target node: ${row.target}`);
        console.log(`   - Trail type: ${row.trail_type}`);
        console.log('');
      });
    }

    // Check what schemas exist
    console.log('3️⃣ Checking available schemas...');
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT LIKE 'pg_%' 
        AND schema_name != 'information_schema'
        AND schema_name != 'public'
      ORDER BY schema_name
    `);

    console.log('Available schemas:');
    schemaResult.rows.forEach(row => {
      console.log(`   - ${row.schema_name}`);
    });

    // Check if there are any route recommendations in public schema
    console.log('\n4️⃣ Checking route recommendations in public schema...');
    const routeResult = await pool.query(`
      SELECT 
        COUNT(*) as total_routes,
        COUNT(CASE WHEN route_edges @> ARRAY[100] THEN 1 END) as routes_with_edge_100
      FROM public.route_recommendations
    `);

    console.log(`   - Total routes: ${routeResult.rows[0].total_routes}`);
    console.log(`   - Routes with edge 100: ${routeResult.rows[0].routes_with_edge_100}`);

    // Check if edge 100 exists by ID
    console.log('\n5️⃣ Checking if edge ID 100 exists...');
    const edge100Result = await pool.query(`
      SELECT 
        id,
        app_uuid,
        name,
        length_km,
        elevation_gain,
        source,
        target
      FROM public.routing_edges 
      WHERE id = 100
    `);

    if (edge100Result.rows.length === 0) {
      console.log('❌ Edge ID 100 does not exist');
    } else {
      console.log('✅ Edge ID 100 found:');
      const edge = edge100Result.rows[0];
      console.log(`   - ID: ${edge.id}`);
      console.log(`   - UUID: ${edge.app_uuid}`);
      console.log(`   - Name: ${edge.name}`);
      console.log(`   - Length: ${edge.length_km}km`);
      console.log(`   - Elevation gain: ${edge.elevation_gain}m`);
      console.log(`   - Source: ${edge.source}, Target: ${edge.target}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkEdge100Public();
