const { Pool } = require('pg');

// Connect to PostgreSQL
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'postgres',
  password: 'postgres'
});

async function checkSchema() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking staging schema route_recommendations table...\n');
    
    // Check what columns exist in the route_recommendations table
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'staging' 
        AND table_name = 'route_recommendations'
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Columns in staging.route_recommendations:');
    columnsResult.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
    });
    
    // Check how many routes exist
    const countResult = await client.query(`
      SELECT COUNT(*) as route_count 
      FROM staging.route_recommendations
    `);
    
    console.log(`\n📊 Total routes in staging: ${countResult.rows[0].route_count}`);
    
    // Check a sample route to see what data exists
    if (parseInt(countResult.rows[0].route_count) > 0) {
      const sampleResult = await client.query(`
        SELECT 
          route_uuid,
          route_name,
          route_shape,
          trail_count,
          recommended_length_km,
          recommended_elevation_gain,
          route_score
        FROM staging.route_recommendations 
        LIMIT 5
      `);
      
      console.log('\n📋 Sample routes:');
      sampleResult.rows.forEach((route, index) => {
        console.log(`\n${index + 1}. Route: ${route.route_name}`);
        console.log(`   UUID: ${route.route_uuid}`);
        console.log(`   Shape: ${route.route_shape}`);
        console.log(`   Trails: ${route.trail_count}`);
        console.log(`   Distance: ${route.recommended_length_km} km`);
        console.log(`   Elevation: ${route.recommended_elevation_gain} m`);
        console.log(`   Score: ${route.route_score}`);
      });
    }
    
    // Check if there are any routes with Cragmoor in the name
    const cragmoorResult = await client.query(`
      SELECT COUNT(*) as cragmoor_count
      FROM staging.route_recommendations 
      WHERE route_name LIKE '%Cragmoor%'
    `);
    
    console.log(`\n🔍 Routes with 'Cragmoor' in name: ${cragmoorResult.rows[0].cragmoor_count}`);
    
    if (parseInt(cragmoorResult.rows[0].cragmoor_count) > 0) {
      const cragmoorRoutes = await client.query(`
        SELECT 
          route_uuid,
          route_name,
          route_shape,
          trail_count,
          recommended_length_km,
          recommended_elevation_gain
        FROM staging.route_recommendations 
        WHERE route_name LIKE '%Cragmoor%'
        ORDER BY recommended_length_km DESC
      `);
      
      console.log('\n📋 Cragmoor routes found:');
      cragmoorRoutes.rows.forEach((route, index) => {
        console.log(`\n${index + 1}. ${route.route_name}`);
        console.log(`   UUID: ${route.route_uuid}`);
        console.log(`   Shape: ${route.route_shape}`);
        console.log(`   Trails: ${route.trail_count}`);
        console.log(`   Distance: ${route.recommended_length_km} km`);
        console.log(`   Elevation: ${route.recommended_elevation_gain} m`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkSchema();
