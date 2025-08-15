import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function debugMesaKohlerIntersection() {
  const pgClient = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔍 Debugging Mesa Trail and Kohler Mesa Trail intersection...\n');

    // Check if we can find these trails in the database
    const trailsResult = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters,
        ST_NumPoints(geometry) as num_points
      FROM staging.trails 
      WHERE name IN ('Mesa Trail', 'Kohler Mesa Trail')
      ORDER BY name
    `);

    console.log('📋 Found trails:');
    trailsResult.rows.forEach(row => {
      console.log(`  ${row.name}:`);
      console.log(`    UUID: ${row.app_uuid}`);
      console.log(`    Start: ${row.start_point}`);
      console.log(`    End: ${row.end_point}`);
      console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
      console.log(`    Points: ${row.num_points}`);
      console.log('');
    });

    if (trailsResult.rows.length < 2) {
      console.log('❌ Could not find both trails in staging.trails');
      return;
    }

    // Check intersection relationships
    console.log('🔗 Checking intersection relationships...\n');
    
    const intersectionResult = await pgClient.query(`
      SELECT 
        t1.name as trail1, 
        t2.name as trail2,
        ST_Intersects(t1.geometry, t2.geometry) as intersects,
        ST_Crosses(t1.geometry, t2.geometry) as crosses,
        ST_Touches(t1.geometry, t2.geometry) as touches,
        ST_Overlaps(t1.geometry, t2.geometry) as overlaps,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point,
        ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters
      FROM staging.trails t1
      JOIN staging.trails t2 ON t1.name = 'Mesa Trail' AND t2.name = 'Kohler Mesa Trail'
    `);

    if (intersectionResult.rows.length > 0) {
      const row = intersectionResult.rows[0];
      console.log('📊 Intersection Analysis:');
      console.log(`  Intersects: ${row.intersects}`);
      console.log(`  Crosses: ${row.crosses}`);
      console.log(`  Touches: ${row.touches}`);
      console.log(`  Overlaps: ${row.overlaps}`);
      console.log(`  Intersection Type: ${row.intersection_type}`);
      console.log(`  Intersection Point: ${row.intersection_point}`);
      console.log(`  Distance: ${row.distance_meters?.toFixed(2)}m`);
      console.log('');
    }

    // Check with simplified geometry (like in the actual processing)
    console.log('🔧 Checking with simplified geometry (ST_SimplifyPreserveTopology)...\n');
    
    const simplifiedResult = await pgClient.query(`
      SELECT 
        t1.name as trail1, 
        t2.name as trail2,
        ST_Intersects(
          ST_SimplifyPreserveTopology(t1.geometry, 0.001), 
          ST_SimplifyPreserveTopology(t2.geometry, 0.001)
        ) as intersects_simplified,
        ST_Crosses(
          ST_SimplifyPreserveTopology(t1.geometry, 0.001), 
          ST_SimplifyPreserveTopology(t2.geometry, 0.001)
        ) as crosses_simplified,
        ST_Touches(
          ST_SimplifyPreserveTopology(t1.geometry, 0.001), 
          ST_SimplifyPreserveTopology(t2.geometry, 0.001)
        ) as touches_simplified,
        ST_GeometryType(ST_Intersection(
          ST_SimplifyPreserveTopology(t1.geometry, 0.001), 
          ST_SimplifyPreserveTopology(t2.geometry, 0.001)
        )) as intersection_type_simplified,
        ST_AsText(ST_Intersection(
          ST_SimplifyPreserveTopology(t1.geometry, 0.001), 
          ST_SimplifyPreserveTopology(t2.geometry, 0.001)
        )) as intersection_point_simplified
      FROM staging.trails t1
      JOIN staging.trails t2 ON t1.name = 'Mesa Trail' AND t2.name = 'Kohler Mesa Trail'
    `);

    if (simplifiedResult.rows.length > 0) {
      const row = simplifiedResult.rows[0];
      console.log('📊 Simplified Geometry Analysis:');
      console.log(`  Intersects (simplified): ${row.intersects_simplified}`);
      console.log(`  Crosses (simplified): ${row.crosses_simplified}`);
      console.log(`  Touches (simplified): ${row.touches_simplified}`);
      console.log(`  Intersection Type (simplified): ${row.intersection_type_simplified}`);
      console.log(`  Intersection Point (simplified): ${row.intersection_point_simplified}`);
      console.log('');
    }

    // Test pgRouting functions directly
    console.log('🛣️ Testing pgRouting functions directly...\n');
    
    try {
      const pgroutingResult = await pgClient.query(`
        WITH test_trails AS (
          SELECT 
            id,
            ST_Force2D(geometry) as geom
          FROM staging.trails 
          WHERE name IN ('Mesa Trail', 'Kohler Mesa Trail')
        )
        SELECT 
          'pgr_separateCrossing' as function_name,
          COUNT(*) as segments_created
        FROM pgr_separateCrossing(
          'SELECT id, geom FROM test_trails', 
          0.00001
        )
        UNION ALL
        SELECT 
          'pgr_separateTouching' as function_name,
          COUNT(*) as segments_created
        FROM pgr_separateTouching(
          'SELECT id, geom FROM test_trails', 
          0.00001
        )
      `);

      console.log('📊 pgRouting Function Results:');
      pgroutingResult.rows.forEach(row => {
        console.log(`  ${row.function_name}: ${row.segments_created} segments created`);
      });
      console.log('');

    } catch (error) {
      console.log('❌ pgRouting function test failed:', error);
    }

    // Check if trails exist in the final network
    console.log('🌐 Checking final network for these trails...\n');
    
    const networkResult = await pgClient.query(`
      SELECT 
        name,
        COUNT(*) as segment_count,
        SUM(length_km) as total_length_km
      FROM staging.trails 
      WHERE name IN ('Mesa Trail', 'Kohler Mesa Trail')
      GROUP BY name
      ORDER BY name
    `);

    console.log('📊 Final Network Segments:');
    networkResult.rows.forEach(row => {
      console.log(`  ${row.name}: ${row.segment_count} segments, ${row.total_length_km.toFixed(3)}km total`);
    });

    // Check for any edges in the network that might be related
    const edgesResult = await pgClient.query(`
      SELECT 
        e.source,
        e.target,
        e.trail_id,
        e.trail_name,
        e.length_km
      FROM staging.edges e
      WHERE e.trail_name IN ('Mesa Trail', 'Kohler Mesa Trail')
      ORDER BY e.trail_name, e.source, e.target
    `);

    console.log('\n🔗 Related Edges in Network:');
    edgesResult.rows.forEach(row => {
      console.log(`  ${row.trail_name}: source=${row.source}, target=${row.target}, length=${row.length_km.toFixed(3)}km`);
    });

  } catch (error) {
    console.error('❌ Error during debugging:', error);
  } finally {
    await pgClient.end();
  }
}

debugMesaKohlerIntersection().catch(console.error);
