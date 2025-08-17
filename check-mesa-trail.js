const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function checkMesaTrail() {
  try {
    // First, let's see what columns are available in the trails table
    const columnsResult = await pgClient.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'trails' 
      ORDER BY ordinal_position
    `);
    
    console.log('Available columns in trails table:');
    columnsResult.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type}`);
    });
    console.log('');
    
    // Find the specific Mesa Trail with the provided app_uuid
    const specificMesaTrail = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        source,
        ST_Length(geometry::geography) as length_m,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_NumPoints(geometry) as num_points
      FROM trails 
      WHERE app_uuid = $1
    `, ['078b1d00-5da4-42b8-9de8-65c38c9da925']);
    
    console.log('Specific Mesa Trail with app_uuid:');
    if (specificMesaTrail.rows.length > 0) {
      const trail = specificMesaTrail.rows[0];
      console.log(`   Name: ${trail.name}`);
      console.log(`   app_uuid: ${trail.app_uuid}`);
      console.log(`   source: ${trail.source}`);
      console.log(`   Length: ${trail.length_m.toFixed(1)}m`);
      console.log(`   Points: ${trail.num_points}`);
      console.log(`   Start point: ${trail.start_point}`);
      console.log(`   End point: ${trail.end_point}`);
      console.log('');
      
      // Now find potential intersection partners for this specific trail
      console.log(`\nLooking for trails that intersect with: ${trail.name} (${trail.app_uuid})`);
      
      const intersectionPartners = await pgClient.query(`
        WITH mesa_trail AS (
          SELECT geometry as geom FROM trails WHERE app_uuid = $1
        )
        SELECT 
          t.app_uuid,
          t.name,
          t.source,
          ST_Length(t.geometry::geography) as length_m,
          ST_Intersects(t.geometry, mesa_trail.geom) as intersects,
          ST_GeometryType(ST_Intersection(t.geometry, mesa_trail.geom)) as intersection_type,
          ST_NumGeometries(ST_Intersection(t.geometry, mesa_trail.geom)) as intersection_count
        FROM trails t, mesa_trail
        WHERE t.app_uuid != $1
        AND ST_DWithin(t.geometry, mesa_trail.geom, 0.01)
        ORDER BY ST_Distance(t.geometry, mesa_trail.geom)
        LIMIT 10
      `, [trail.app_uuid]);
      
      console.log('Potential intersection partners:');
      intersectionPartners.rows.forEach((row, index) => {
        console.log(`${index + 1}. ${row.name} (${row.app_uuid})`);
        console.log(`   source: ${row.source}`);
        console.log(`   Length: ${row.length_m.toFixed(1)}m`);
        console.log(`   Intersects: ${row.intersects}`);
        console.log(`   Intersection type: ${row.intersection_type}`);
        console.log(`   Intersection count: ${row.intersection_count}`);
        console.log('');
      });
      
    } else {
      console.log('No trail found with app_uuid: 078b1d00-5da4-42b8-9de8-65c38c9da925');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pgClient.end();
  }
}

checkMesaTrail();
