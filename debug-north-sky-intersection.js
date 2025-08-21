const { Pool } = require('pg');

async function debugNorthSkyIntersection() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'postgres',
    password: 'postgres'
  });

  try {
    console.log('🔍 Debugging North Sky Trail intersection issues...');
    
    // First, let's check if North Sky Trail exists in public schema
    const northSkyCheck = await pool.query(`
      SELECT app_uuid, name, source, ST_Length(geometry::geography) as length_meters 
      FROM public.trails 
      WHERE name ILIKE '%North Sky%' 
      ORDER BY length_meters DESC
    `);
    
    console.log('📊 North Sky Trail in public schema:');
    northSkyCheck.rows.forEach(row => {
      console.log(`   - ${row.name} (${row.app_uuid}): ${row.length_meters}m, source: ${row.source}`);
    });
    
    // Check if North Sky Trail intersects with any other trails
    const intersectionCheck = await pool.query(`
      WITH north_sky AS (
        SELECT app_uuid, geometry 
        FROM public.trails 
        WHERE name = 'North Sky Trail' 
        AND ST_Length(geometry::geography) > 5000
      )
      SELECT 
        t.app_uuid,
        t.name, 
        t.source, 
        ST_Length(t.geometry::geography) as length_meters,
        ST_GeometryType(ST_Intersection(t.geometry, ns.geometry)) as intersection_type
      FROM public.trails t, north_sky ns 
      WHERE ST_Intersects(t.geometry, ns.geometry) 
      AND t.app_uuid != ns.app_uuid
      ORDER BY length_meters DESC
    `);
    
    console.log('📊 Trails that intersect with North Sky Trail:');
    if (intersectionCheck.rows.length === 0) {
      console.log('   - No intersections found');
    } else {
      intersectionCheck.rows.forEach(row => {
        console.log(`   - ${row.name} (${row.app_uuid}): ${row.length_meters}m, intersection type: ${row.intersection_type}`);
      });
    }
    
    // Check if there are any staging schemas and what's in them
    const stagingSchemas = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%'
      ORDER BY schema_name DESC
      LIMIT 5
    `);
    
    console.log('📊 Recent staging schemas:');
    stagingSchemas.rows.forEach(row => {
      console.log(`   - ${row.schema_name}`);
    });
    
    // Check the most recent staging schema for North Sky Trail
    if (stagingSchemas.rows.length > 0) {
      const latestSchema = stagingSchemas.rows[0].schema_name;
      console.log(`📊 Checking ${latestSchema} for North Sky Trail...`);
      
      const stagingCheck = await pool.query(`
        SELECT app_uuid, name, original_trail_uuid, source, ST_Length(geometry::geography) as length_meters 
        FROM ${latestSchema}.trails 
        WHERE name ILIKE '%North Sky%' OR original_trail_uuid IN (
          SELECT app_uuid FROM public.trails WHERE name ILIKE '%North Sky%'
        )
        ORDER BY name
      `);
      
      console.log(`📊 North Sky Trail in ${latestSchema}:`);
      if (stagingCheck.rows.length === 0) {
        console.log('   - Not found in staging schema');
      } else {
        stagingCheck.rows.forEach(row => {
          console.log(`   - ${row.name} (${row.app_uuid}): ${row.length_meters}m, original: ${row.original_trail_uuid}`);
        });
      }
      
      // Check total trails in staging
      const totalTrails = await pool.query(`SELECT COUNT(*) as count FROM ${latestSchema}.trails`);
      console.log(`📊 Total trails in ${latestSchema}: ${totalTrails.rows[0].count}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

debugNorthSkyIntersection();
