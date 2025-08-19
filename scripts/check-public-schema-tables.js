const { Pool } = require('pg');
require('dotenv').config();

async function checkPublicSchemaTables() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'shaydu',
    password: process.env.PGPASSWORD,
  });

  try {
    console.log('🔍 Checking public schema tables...\n');

    // List all tables in public schema
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('Tables in public schema:');
    if (tablesResult.rows.length === 0) {
      console.log('   No tables found');
    } else {
      tablesResult.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    }

    // Check if routing_edges table exists and has data
    console.log('\n1️⃣ Checking routing_edges table...');
    const edgeCountResult = await pool.query(`
      SELECT COUNT(*) as edge_count
      FROM public.routing_edges
    `);

    console.log(`   - Total edges: ${edgeCountResult.rows[0].edge_count}`);

    if (edgeCountResult.rows[0].edge_count > 0) {
      // Check for Bear Canyon edges
      const bearCanyonResult = await pool.query(`
        SELECT 
          id,
          app_uuid,
          name,
          length_km,
          elevation_gain,
          source,
          target
        FROM public.routing_edges 
        WHERE name LIKE '%Bear Canyon%'
        ORDER BY id
      `);

      console.log(`   - Bear Canyon edges: ${bearCanyonResult.rows.length}`);
      bearCanyonResult.rows.forEach(row => {
        console.log(`     Edge ${row.id}: ${row.name} (${row.length_km}km, ${row.elevation_gain}m gain)`);
      });

      // Check if edge 100 exists
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

      if (edge100Result.rows.length > 0) {
        console.log(`   - Edge 100: ${edge100Result.rows[0].name}`);
      } else {
        console.log('   - Edge 100: NOT FOUND');
      }
    }

    // Check route_recommendations table
    console.log('\n2️⃣ Checking route_recommendations table...');
    const routeCountResult = await pool.query(`
      SELECT COUNT(*) as route_count
      FROM public.route_recommendations
    `);

    console.log(`   - Total routes: ${routeCountResult.rows[0].route_count}`);

    // Check what schemas exist
    console.log('\n3️⃣ Checking all schemas...');
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT LIKE 'pg_%' 
        AND schema_name != 'information_schema'
      ORDER BY schema_name
    `);

    console.log('Available schemas:');
    schemaResult.rows.forEach(row => {
      console.log(`   - ${row.schema_name}`);
    });

    // Check if there are any staging schemas with data
    console.log('\n4️⃣ Checking staging schemas...');
    const stagingResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%'
      ORDER BY schema_name DESC
      LIMIT 5
    `);

    if (stagingResult.rows.length > 0) {
      console.log('Recent staging schemas:');
      stagingResult.rows.forEach(row => {
        console.log(`   - ${row.schema_name}`);
      });

      // Check the most recent staging schema
      const latestSchema = stagingResult.rows[0].schema_name;
      console.log(`\n5️⃣ Checking latest staging schema: ${latestSchema}`);
      
      const stagingEdgeCount = await pool.query(`
        SELECT COUNT(*) as edge_count
        FROM ${latestSchema}.routing_edges
      `);

      console.log(`   - Total edges: ${stagingEdgeCount.rows[0].edge_count}`);

      if (stagingEdgeCount.rows[0].edge_count > 0) {
        const stagingBearCanyon = await pool.query(`
          SELECT 
            id,
            app_uuid,
            name,
            length_km,
            elevation_gain,
            source,
            target
          FROM ${latestSchema}.routing_edges 
          WHERE name LIKE '%Bear Canyon%'
          ORDER BY id
        `);

        console.log(`   - Bear Canyon edges: ${stagingBearCanyon.rows.length}`);
        stagingBearCanyon.rows.forEach(row => {
          console.log(`     Edge ${row.id}: ${row.name} (${row.length_km}km, ${row.elevation_gain}m gain)`);
        });
      }
    } else {
      console.log('   No staging schemas found');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkPublicSchemaTables();
