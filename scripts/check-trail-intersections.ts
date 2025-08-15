import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkTrailIntersections() {
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: process.env.PGDATABASE || 'trail_master_db_test',
  });

  try {
    console.log('🔍 Checking for actual intersections between NCAR Trail and NCAR Water Tank Road...');
    
    // Find the staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📁 Using schema: ${stagingSchema}`);
    
    // Check if trails table exists
    const tableResult = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '${stagingSchema}' 
        AND table_name = 'trails'
      )
    `);
    
    if (!tableResult.rows[0].exists) {
      console.log('❌ Trails table not found in staging schema');
      return;
    }
    
    // Get the specific trails
    const trailsResult = await pgClient.query(`
      SELECT id, name, ST_AsText(geometry) as geom_text, ST_GeometryType(geometry) as geom_type
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%NCAR%'
      ORDER BY name
    `);
    
    console.log(`\n📊 Found ${trailsResult.rows.length} NCAR trails:`);
    trailsResult.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ${row.name} (ID: ${row.id})`);
      console.log(`      Type: ${row.geom_type}`);
    });
    
    if (trailsResult.rows.length >= 2) {
      // Check for intersections between all NCAR trails
      console.log(`\n🔍 Checking intersections between NCAR trails...`);
      
      for (let i = 0; i < trailsResult.rows.length; i++) {
        for (let j = i + 1; j < trailsResult.rows.length; j++) {
          const trail1 = trailsResult.rows[i];
          const trail2 = trailsResult.rows[j];
          
          console.log(`\n   Comparing: ${trail1.name} vs ${trail2.name}`);
          
          const intersectionResult = await pgClient.query(`
            SELECT 
              ST_Intersects(t1.geometry, t2.geometry) as intersects,
              ST_Crosses(t1.geometry, t2.geometry) as crosses,
              ST_Touches(t1.geometry, t2.geometry) as touches,
              ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters,
              ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_geom
            FROM ${stagingSchema}.trails t1, ${stagingSchema}.trails t2
            WHERE t1.id = '${trail1.id}' AND t2.id = '${trail2.id}'
          `);
          
          const result = intersectionResult.rows[0];
          console.log(`      Intersects: ${result.intersects}`);
          console.log(`      Crosses: ${result.crosses}`);
          console.log(`      Touches: ${result.touches}`);
          console.log(`      Distance: ${result.distance_meters?.toFixed(1) || 'N/A'} meters`);
          console.log(`      Intersection: ${result.intersection_geom || 'None'}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

checkTrailIntersections().catch(console.error);
