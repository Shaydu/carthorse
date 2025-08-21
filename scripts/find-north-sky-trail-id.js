const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function findNorthSkyTrailId() {
  const pgClient = await pool.connect();
  
  try {
    const searchId = 'df3b7eb8-b3bf-4ad8-bed8-979c6378f870';
    
    console.log(`🔍 Searching for North Sky Trail with ID: ${searchId}`);
    
    // Check in public.trails
    console.log('\n📋 Checking public.trails:');
    const inPublicTrails = await pgClient.query(`
      SELECT app_uuid, name, trail_type, length_km
      FROM public.trails 
      WHERE app_uuid = $1 OR name ILIKE '%north sky%'
      ORDER BY name
    `, [searchId]);
    
    console.log(`Found ${inPublicTrails.rows.length} matches in public.trails:`);
    inPublicTrails.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.name} (${row.app_uuid}) - ${row.length_km}km`);
    });
    
    // Check in our processed tables
    console.log('\n🔗 Checking processed tables:');
    const tables = [
      'public.trails_snapped_small_final',
      'public.trails_snapped_small_final_backup',
      'public.trails_snapped_small',
      'public.trails_snapped_small_backup'
    ];
    
    for (const table of tables) {
      try {
        const result = await pgClient.query(`
          SELECT app_uuid, name, trail_type, length_km
          FROM ${table}
          WHERE app_uuid = $1 OR name ILIKE '%north sky%'
          ORDER BY name
        `, [searchId]);
        
        console.log(`\n${table}:`);
        console.log(`  Found ${result.rows.length} matches:`);
        result.rows.forEach((row, index) => {
          console.log(`    ${index + 1}. ${row.name} (${row.app_uuid}) - ${row.length_km}km`);
        });
      } catch (error) {
        console.log(`  ${table}: Table doesn't exist or error: ${error.message}`);
      }
    }
    
    // Let's also search for any trail with that ID pattern
    console.log('\n🔍 Searching for any trail with similar ID pattern:');
    const similarId = await pgClient.query(`
      SELECT app_uuid, name, trail_type, length_km
      FROM public.trails 
      WHERE app_uuid::text LIKE '%df3b7eb8%' 
         OR app_uuid::text LIKE '%b3bf%'
         OR app_uuid::text LIKE '%979c6378f870%'
      ORDER BY name
    `);
    
    console.log(`Found ${similarId.rows.length} trails with similar ID pattern:`);
    similarId.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.name} (${row.app_uuid}) - ${row.length_km}km`);
    });
    
    // Let's also check if there are any North Sky trails with different IDs
    console.log('\n🛤️ All North Sky trails in public.trails:');
    const allNorthSky = await pgClient.query(`
      SELECT app_uuid, name, trail_type, length_km, ST_Length(geometry) as length_m
      FROM public.trails 
      WHERE name ILIKE '%north sky%'
      ORDER BY ST_Length(geometry) DESC
    `);
    
    console.log(`Found ${allNorthSky.rows.length} North Sky trails:`);
    allNorthSky.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.name} (${row.app_uuid})`);
      console.log(`     Length: ${row.length_km}km (${row.length_m.toFixed(2)}m)`);
      console.log(`     Type: ${row.trail_type}`);
    });
    
    // Check if the ID might be in a different column
    console.log('\n🔍 Checking if ID might be in source_id or other columns:');
    const columnCheck = await pgClient.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'trails' 
        AND table_schema = 'public'
        AND (column_name ILIKE '%id%' OR column_name ILIKE '%uuid%' OR column_name ILIKE '%source%')
      ORDER BY column_name
    `);
    
    console.log('ID-related columns in public.trails:');
    columnCheck.rows.forEach((col, index) => {
      console.log(`  ${index + 1}. ${col.column_name} (${col.data_type})`);
    });
    
    // If there are source_id columns, let's check them
    const sourceColumns = columnCheck.rows.filter(col => 
      col.column_name.includes('source') || col.column_name.includes('id')
    );
    
    for (const col of sourceColumns) {
      try {
        const result = await pgClient.query(`
          SELECT ${col.column_name}, name, trail_type, length_km
          FROM public.trails 
          WHERE ${col.column_name}::text ILIKE '%df3b7eb8%' 
             OR ${col.column_name}::text ILIKE '%north sky%'
          ORDER BY name
          LIMIT 5
        `);
        
        if (result.rows.length > 0) {
          console.log(`\n${col.column_name} column matches:`);
          result.rows.forEach((row, index) => {
            console.log(`  ${index + 1}. ${row.name} (${row[col.column_name]}) - ${row.length_km}km`);
          });
        }
      } catch (error) {
        // Skip columns that can't be queried this way
      }
    }
    
  } catch (error) {
    console.error('❌ Error during search:', error);
    throw error;
  } finally {
    pgClient.release();
    await pool.end();
  }
}

// Run the script
findNorthSkyTrailId().catch(console.error);
