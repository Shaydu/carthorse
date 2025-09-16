const { Pool } = require('pg');

// Database connection
const pgClient = new Pool({
  user: 'carthorse',
  host: 'localhost',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

async function testDirectSplit() {
  try {
    console.log('🔍 Testing direct splitting logic...');
    
    // Get the intersection details
    const intersectionResult = await pgClient.query(`
      SELECT 
        t1.app_uuid as trail1_uuid,
        t1.name as trail1_name,
        t2.app_uuid as trail2_uuid,
        t2.name as trail2_name,
        t1.geometry as trail1_geom,
        t2.geometry as trail2_geom,
        ST_Intersection(t1.geometry, t2.geometry) as intersection_geom
      FROM staging.trails t1
      JOIN staging.trails t2 ON t1.app_uuid != t2.app_uuid
      WHERE (t1.app_uuid = 'c55c0383-f02c-4761-aebe-26098441802d' AND t2.app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336')
         OR (t1.app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336' AND t2.app_uuid = 'c55c0383-f02c-4761-aebe-26098441802d')
    `);
    
    if (intersectionResult.rows.length === 0) {
      console.log('❌ No intersection found');
      return;
    }
    
    const row = intersectionResult.rows[0];
    console.log(`📍 Intersection: ${row.trail1_name} ↔ ${row.trail2_name}`);
    
    // Test the exact logic from the service
    const client = await pgClient.connect();
    
    try {
      await client.query('BEGIN');
      
      let segmentsCreated = 0;
      
      // Split trail1
      console.log(`\n🔧 Splitting ${row.trail1_name}...`);
      const trail1Segments = await splitTrailAtIntersectionGeometry(
        client, 
        row.trail1_uuid, 
        row.trail1_geom, 
        row.intersection_geom
      );
      segmentsCreated += trail1Segments;
      console.log(`   Created ${trail1Segments} segments`);
      
      // Split trail2
      console.log(`\n🔧 Splitting ${row.trail2_name}...`);
      const trail2Segments = await splitTrailAtIntersectionGeometry(
        client, 
        row.trail2_uuid, 
        row.trail2_geom, 
        row.intersection_geom
      );
      segmentsCreated += trail2Segments;
      console.log(`   Created ${trail2Segments} segments`);
      
      await client.query('COMMIT');
      
      console.log(`\n✅ Total segments created: ${segmentsCreated}`);
      
      // Check what's in staging after
      const trailsAfter = await pgClient.query(`
        SELECT app_uuid, name, ST_Length(geometry::geography) as length_m
        FROM staging.trails 
        ORDER BY name, length_m
      `);
      
      console.log(`\n📊 Trails in staging after splitting:`);
      for (const trail of trailsAfter.rows) {
        console.log(`   - ${trail.name}: ${trail.app_uuid} (${parseFloat(trail.length_m).toFixed(1)}m)`);
      }
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

// Copy the exact logic from the service
async function splitTrailAtIntersectionGeometry(client, trailUuid, trailGeom, intersectionGeom) {
  // Get the original trail data first
  const originalTrailResult = await client.query(`
    SELECT * FROM staging.trails WHERE app_uuid = $1
  `, [trailUuid]);

  if (originalTrailResult.rows.length === 0) {
    return 0;
  }

  const originalTrail = originalTrailResult.rows[0];
  let segmentCount = 0;
  
  // Use the working approach: ST_Split directly on the intersection geometry
  const splitResult = await client.query(`
    SELECT ST_Split($1::geometry, $2::geometry) as split_geom
  `, [trailGeom, intersectionGeom]);
  
  if (splitResult.rows.length > 0 && splitResult.rows[0].split_geom) {
    const splitGeom = splitResult.rows[0].split_geom;
    
    // Extract individual segments from the split geometry
    const segmentsResult = await client.query(`
      SELECT 
        (ST_Dump($1::geometry)).geom as segment_geom,
        (ST_Dump($1::geometry)).path as segment_path
      FROM (SELECT $1::geometry as geom) as g
    `, [splitGeom]);
    
    console.log(`   Found ${segmentsResult.rows.length} segments from ST_Split`);
    
    // Process each segment
    for (const segmentRow of segmentsResult.rows) {
      const segmentGeom = segmentRow.segment_geom;
      
      // Ensure 3D coordinates are preserved
      const segment3DResult = await client.query(`
        SELECT ST_Force3D($1::geometry) as segment_3d_geom
      `, [segmentGeom]);
      
      if (segment3DResult.rows.length > 0) {
        const segment3DGeom = segment3DResult.rows[0].segment_3d_geom;
        
        // Check if the segment is long enough
        const lengthMeters = await client.query(`
          SELECT ST_Length($1::geography) as length_m
        `, [segment3DGeom]);
        
        const lengthM = parseFloat(lengthMeters.rows[0].length_m);
        
        console.log(`   Segment ${segmentCount + 1}: ${lengthM.toFixed(1)}m (min: 10.0m)`);
        
        if (lengthM >= 10.0) {
          // Generate a proper UUID for the segment
          const segmentUuidResult = await client.query('SELECT gen_random_uuid() as segment_uuid');
          const segmentUuid = segmentUuidResult.rows[0].segment_uuid;
          
          await client.query(`
            INSERT INTO staging.trails (
              app_uuid, original_trail_uuid, osm_id, name, trail_type, surface, difficulty,
              source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
              source, geometry, geojson_cached, geometry_hash
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
            )
          `, [
            segmentUuid,
            originalTrail.original_trail_uuid || originalTrail.app_uuid,
            originalTrail.osm_id,
            `${originalTrail.name} (segment ${segmentCount + 1})`,
            originalTrail.trail_type,
            originalTrail.surface,
            originalTrail.difficulty,
            originalTrail.source_tags,
            originalTrail.bbox_min_lng,
            originalTrail.bbox_max_lng,
            originalTrail.bbox_min_lat,
            originalTrail.bbox_max_lat,
            lengthM / 1000, // Convert to km
            originalTrail.elevation_gain,
            originalTrail.elevation_loss,
            originalTrail.max_elevation,
            originalTrail.min_elevation,
            originalTrail.avg_elevation,
            originalTrail.source,
            segment3DGeom,
            originalTrail.geojson_cached,
            originalTrail.geometry_hash
          ]);
          
          segmentCount++;
        }
      }
    }
  }

  // Delete the original trail only if we created segments
  if (segmentCount > 0) {
    await client.query(`
      DELETE FROM staging.trails WHERE app_uuid = $1
    `, [trailUuid]);
    console.log(`   Deleted original trail: ${trailUuid}`);
  }

  return segmentCount;
}

testDirectSplit();
