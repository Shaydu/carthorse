import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkNCARDistances() {
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: process.env.PGDATABASE || 'trail_master_db_test',
  });

  try {
    console.log('🔍 Checking distances between NCAR Trail and NCAR Water Tank Road...');
    
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
    
    // Get the trail geometries
    const trailResult = await pgClient.query(`
      SELECT 
        id,
        name,
        ST_AsText(geometry) as geom_text,
        ST_Length(geometry::geography) as length_meters,
        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point,
        ST_LineInterpolatePoint(geometry, 0.5) as midpoint
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%NCAR%'
      ORDER BY name
    `);
    
    if (trailResult.rows.length === 0) {
      console.log('❌ No NCAR trails found');
      return;
    }
    
    console.log(`\n📊 Found ${trailResult.rows.length} NCAR trails:`);
    trailResult.rows.forEach((trail, index) => {
      console.log(`   ${index + 1}. ${trail.name} (ID: ${trail.id})`);
      console.log(`      Length: ${trail.length_meters.toFixed(1)}m`);
    });
    
    // Check distances between all points
    if (trailResult.rows.length >= 2) {
      const trail1 = trailResult.rows[0];
      const trail2 = trailResult.rows[1];
      
      console.log(`\n📏 Distances between ${trail1.name} and ${trail2.name}:`);
      
      // Check various point combinations
      const distances = await pgClient.query(`
        WITH trail1 AS (
          SELECT 
            '${trail1.id}' as id,
            '${trail1.name}' as name,
            ST_GeomFromText('${trail1.geom_text}') as geom,
            ST_GeomFromText('${trail1.start_point}') as start_point,
            ST_GeomFromText('${trail1.end_point}') as end_point,
            ST_GeomFromText('${trail1.midpoint}') as midpoint
        ),
        trail2 AS (
          SELECT 
            '${trail2.id}' as id,
            '${trail2.name}' as name,
            ST_GeomFromText('${trail2.geom_text}') as geom,
            ST_GeomFromText('${trail2.start_point}') as start_point,
            ST_GeomFromText('${trail2.end_point}') as end_point,
            ST_GeomFromText('${trail2.midpoint}') as midpoint
        )
        SELECT 
          'start1_to_start2' as comparison,
          ST_Distance(t1.start_point::geography, t2.start_point::geography) as distance_meters
        FROM trail1 t1, trail2 t2
        UNION ALL
        SELECT 
          'start1_to_end2' as comparison,
          ST_Distance(t1.start_point::geography, t2.end_point::geography) as distance_meters
        FROM trail1 t1, trail2 t2
        UNION ALL
        SELECT 
          'start1_to_mid2' as comparison,
          ST_Distance(t1.start_point::geography, t2.midpoint::geography) as distance_meters
        FROM trail1 t1, trail2 t2
        UNION ALL
        SELECT 
          'end1_to_start2' as comparison,
          ST_Distance(t1.end_point::geography, t2.start_point::geography) as distance_meters
        FROM trail1 t1, trail2 t2
        UNION ALL
        SELECT 
          'end1_to_end2' as comparison,
          ST_Distance(t1.end_point::geography, t2.end_point::geography) as distance_meters
        FROM trail1 t1, trail2 t2
        UNION ALL
        SELECT 
          'end1_to_mid2' as comparison,
          ST_Distance(t1.end_point::geography, t2.midpoint::geography) as distance_meters
        FROM trail1 t1, trail2 t2
        UNION ALL
        SELECT 
          'mid1_to_start2' as comparison,
          ST_Distance(t1.midpoint::geography, t2.start_point::geography) as distance_meters
        FROM trail1 t1, trail2 t2
        UNION ALL
        SELECT 
          'mid1_to_end2' as comparison,
          ST_Distance(t1.midpoint::geography, t2.end_point::geography) as distance_meters
        FROM trail1 t1, trail2 t2
        UNION ALL
        SELECT 
          'mid1_to_mid2' as comparison,
          ST_Distance(t1.midpoint::geography, t2.midpoint::geography) as distance_meters
        FROM trail1 t1, trail2 t2
        ORDER BY distance_meters
      `);
      
      distances.rows.forEach((row) => {
        const withinTolerance = row.distance_meters <= 3;
        const status = withinTolerance ? '✅' : '❌';
        console.log(`   ${status} ${row.comparison}: ${row.distance_meters.toFixed(1)}m`);
      });
      
      // Check if trails actually intersect
      const intersectionResult = await pgClient.query(`
        SELECT 
          ST_Intersects(ST_GeomFromText('${trail1.geom_text}'), ST_GeomFromText('${trail2.geom_text}')) as intersects,
          ST_Crosses(ST_GeomFromText('${trail1.geom_text}'), ST_GeomFromText('${trail2.geom_text}')) as crosses,
          ST_Touches(ST_GeomFromText('${trail1.geom_text}'), ST_GeomFromText('${trail2.geom_text}')) as touches,
          ST_DWithin(ST_GeomFromText('${trail1.geom_text}'), ST_GeomFromText('${trail2.geom_text}'), 3/111000.0) as within_3m
      `);
      
      const intersection = intersectionResult.rows[0];
      console.log(`\n🔗 Intersection analysis:`);
      console.log(`   Intersects: ${intersection.intersects}`);
      console.log(`   Crosses: ${intersection.crosses}`);
      console.log(`   Touches: ${intersection.touches}`);
      console.log(`   Within 3m: ${intersection.within_3m}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

checkNCARDistances().catch(console.error);
