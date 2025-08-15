import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function testTIntersection() {
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: 'carthorse',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: 'trail_master_db',
  });

  try {
    console.log('🔍 Testing T-intersection with pgr_separatetouching...');

    // Create a test schema
    const testSchema = 'test_t_intersection';
    await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${testSchema}`);

    // Create test trails table with T-intersection
    await pgClient.query(`
      CREATE TABLE ${testSchema}.test_trails (
        id serial PRIMARY KEY,
        name text,
        geom geometry(LineString, 4326)
      )
    `);

    // Insert trails that form a T-intersection (one endpoint touches the middle of another trail)
    await pgClient.query(`
      INSERT INTO ${testSchema}.test_trails (name, geom) VALUES
      ('Horizontal Trail', ST_GeomFromText('LINESTRING(0 0, 10 0)', 4326)),
      ('Vertical Trail', ST_GeomFromText('LINESTRING(5 -5, 5 5)', 4326))
    `);

    console.log('📊 T-intersection test trails created');

    // Test pgr_separatetouching with different tolerances
    console.log('\n🔗 Testing pgr_separatetouching on T-intersection...');
    
    const tolerances = [0.001, 0.01, 0.1, 1.0, 2.0, 3.0];
    
    for (const tolerance of tolerances) {
      try {
        const result = await pgClient.query(`
          SELECT COUNT(*) as count FROM pgr_separatetouching(
            'SELECT id, geom FROM ${testSchema}.test_trails',
            ${tolerance / 111000.0}
          )
        `);
        
        console.log(`   Tolerance ${tolerance}m (${(tolerance / 111000.0).toFixed(8)} degrees): ${result.rows[0].count} segments`);
      } catch (error) {
        console.log(`   Tolerance ${tolerance}m: ERROR - ${(error as Error).message}`);
      }
    }

    // Test direct intersection detection
    console.log('\n🔍 Testing direct intersection detection...');
    
    const intersectionResult = await pgClient.query(`
      SELECT 
        t1.name as trail1,
        t2.name as trail2,
        ST_Intersects(t1.geom, t2.geom) as intersects,
        ST_Crosses(t1.geom, t2.geom) as crosses,
        ST_Touches(t1.geom, t2.geom) as touches,
        ST_GeometryType(ST_Intersection(t1.geom, t2.geom)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geom, t2.geom)) as intersection_geom,
        ST_Distance(t1.geom::geography, t2.geom::geography) as distance_meters
      FROM ${testSchema}.test_trails t1
      CROSS JOIN ${testSchema}.test_trails t2
      WHERE t1.id < t2.id
    `);

    if (intersectionResult.rows.length > 0) {
      const intersection = intersectionResult.rows[0];
      console.log(`   ${intersection.trail1} ↔ ${intersection.trail2}:`);
      console.log(`     Intersects: ${intersection.intersects}`);
      console.log(`     Crosses: ${intersection.crosses}`);
      console.log(`     Touches: ${intersection.touches}`);
      console.log(`     Distance: ${intersection.distance_meters.toFixed(1)}m`);
      console.log(`     Intersection type: ${intersection.intersection_type}`);
      if (intersection.intersection_geom) {
        console.log(`     Intersection geometry: ${intersection.intersection_geom}`);
      }
    }

    // Test ST_Split as an alternative
    console.log('\n🔧 Testing ST_Split as alternative...');
    
    const splitResult = await pgClient.query(`
      WITH intersections AS (
        SELECT 
          t1.id as trail1_id,
          t2.id as trail2_id,
          ST_Intersection(t1.geom, t2.geom) as intersection_point
        FROM ${testSchema}.test_trails t1
        CROSS JOIN ${testSchema}.test_trails t2
        WHERE t1.id < t2.id AND ST_Intersects(t1.geom, t2.geom)
      ),
      split_trails AS (
        SELECT 
          t.id,
          t.name,
          (ST_Dump(ST_Split(t.geom, i.intersection_point))).geom as split_geom,
          (ST_Dump(ST_Split(t.geom, i.intersection_point))).path[1] as segment_id
        FROM ${testSchema}.test_trails t
        JOIN intersections i ON t.id IN (i.trail1_id, i.trail2_id)
      )
      SELECT 
        id,
        name,
        segment_id,
        ST_AsText(split_geom) as geom_text,
        ST_Length(split_geom::geography) as length_meters
      FROM split_trails
      WHERE ST_Length(split_geom::geography) > 1
      ORDER BY id, segment_id
    `);

    console.log('   ST_Split results:');
    splitResult.rows.forEach((row, index) => {
      console.log(`     ${index + 1}. ${row.name} segment ${row.segment_id}: ${row.length_meters.toFixed(1)}m`);
      console.log(`        Geometry: ${row.geom_text}`);
    });

    // Clean up
    await pgClient.query(`DROP SCHEMA ${testSchema} CASCADE`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testTIntersection().catch(console.error);
