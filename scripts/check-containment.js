const { Pool } = require('pg');

const pool = new Pool({
  user: 'carthorse',
  host: 'localhost',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

async function checkContainment() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking containment between specific trails...');
    
    // Check if the connector trail is contained within the Foothills North Trail
    const result = await client.query(`
      WITH trail_data AS (
        SELECT 
          id,
          app_uuid,
          name,
          ST_Length(geometry::geography) as length_meters,
          ST_Area(geometry) as area,
          geometry
        FROM public.trails 
        WHERE app_uuid IN (
          'ab36dded-56f4-4a1d-bd16-6781586a3336', -- North Sky Trail connector
          'c55c0383-f02c-4761-aebe-26098441802d'   -- Foothills North Trail
        )
      ),
      containment_calc AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.length_meters as trail1_length,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.length_meters as trail2_length,
          -- Check if trail1 is contained within trail2
          ST_Contains(t2.geometry, t1.geometry) as trail1_contained_in_trail2,
          -- Check if trail2 is contained within trail1
          ST_Contains(t1.geometry, t2.geometry) as trail2_contained_in_trail1,
          -- Check if they overlap at all
          ST_Intersects(t1.geometry, t2.geometry) as trails_intersect,
          -- Check if they are equal
          ST_Equals(t1.geometry, t2.geometry) as trails_equal,
          -- Calculate overlap ratio
          CASE 
            WHEN LEAST(ST_Area(t1.geometry), ST_Area(t2.geometry)) > 0 
            THEN ST_Area(ST_Intersection(t1.geometry, t2.geometry)) / LEAST(ST_Area(t1.geometry), ST_Area(t2.geometry))
            ELSE 0
          END as overlap_ratio,
          -- Calculate distance
          ST_Distance(t1.geometry, t2.geometry) as distance_meters
        FROM trail_data t1
        JOIN trail_data t2 ON t1.app_uuid < t2.app_uuid
      )
      SELECT 
        trail1_uuid,
        trail1_name,
        trail1_length,
        trail2_uuid,
        trail2_name,
        trail2_length,
        trail1_contained_in_trail2,
        trail2_contained_in_trail1,
        trails_intersect,
        trails_equal,
        overlap_ratio,
        distance_meters,
        CASE 
          WHEN trail1_contained_in_trail2 THEN 'TRAIL1_CONTAINED_IN_TRAIL2'
          WHEN trail2_contained_in_trail1 THEN 'TRAIL2_CONTAINED_IN_TRAIL1'
          WHEN trails_equal THEN 'TRAILS_EQUAL'
          WHEN trails_intersect THEN 'TRAILS_INTERSECT'
          ELSE 'NO_RELATIONSHIP'
        END as relationship_type
      FROM containment_calc
    `);
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log('\n📊 Containment Analysis:');
      console.log(`   Trail 1: ${row.trail1_name} (${row.trail1_uuid})`);
      console.log(`   Length: ${row.trail1_length.toFixed(2)}m`);
      console.log(`   Trail 2: ${row.trail2_name} (${row.trail2_uuid})`);
      console.log(`   Length: ${row.trail2_length.toFixed(2)}m`);
      console.log(`   Relationship: ${row.relationship_type}`);
      console.log(`   Trail1 contained in Trail2: ${row.trail1_contained_in_trail2}`);
      console.log(`   Trail2 contained in Trail1: ${row.trail2_contained_in_trail1}`);
      console.log(`   Trails intersect: ${row.trails_intersect}`);
      console.log(`   Trails equal: ${row.trails_equal}`);
      console.log(`   Overlap ratio: ${(row.overlap_ratio * 100).toFixed(2)}%`);
      console.log(`   Distance: ${row.distance_meters.toFixed(2)}m`);
      
      if (row.trail1_contained_in_trail2) {
        console.log('\n✅ Trail1 is contained within Trail2 - this should NOT be deduplicated!');
      } else if (row.trail2_contained_in_trail1) {
        console.log('\n✅ Trail2 is contained within Trail1 - this should NOT be deduplicated!');
      } else if (row.overlap_ratio > 0.8) {
        console.log('\n⚠️ High overlap ratio - this might be linear overlap that should be deduplicated');
      } else {
        console.log('\n✅ No containment detected');
      }
    } else {
      console.log('❌ No containment data found for these specific trails');
    }
    
  } catch (error) {
    console.error('❌ Error checking containment:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkContainment();
