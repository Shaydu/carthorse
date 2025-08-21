const { Pool } = require('pg');

const pool = new Pool({
  user: 'carthorse',
  host: 'localhost',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

async function checkSpecificOverlap() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking overlap between specific trails...');
    
    // Check overlap between the connector trail and Foothills North Trail
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
      overlap_calc AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.length_meters as trail1_length,
          t1.area as trail1_area,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.length_meters as trail2_length,
          t2.area as trail2_area,
          ST_Area(ST_Intersection(t1.geometry, t2.geometry)) as intersection_area,
          ST_Distance(t1.geometry, t2.geometry) as distance_meters,
          CASE 
            WHEN LEAST(t1.area, t2.area) > 0 
            THEN ST_Area(ST_Intersection(t1.geometry, t2.geometry)) / LEAST(t1.area, t2.area)
            ELSE 0
          END as overlap_ratio
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
        intersection_area,
        distance_meters,
        overlap_ratio,
        CASE 
          WHEN overlap_ratio > 0.8 THEN 'REMOVE (80%+ overlap)'
          WHEN distance_meters < 5 AND overlap_ratio > 0.5 THEN 'REMOVE (close + 50%+ overlap)'
          ELSE 'KEEP'
        END as deduplication_action
      FROM overlap_calc
    `);
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log('\n📊 Overlap Analysis:');
      console.log(`   Trail 1: ${row.trail1_name} (${row.trail1_uuid})`);
      console.log(`   Length: ${row.trail1_length.toFixed(2)}m`);
      console.log(`   Trail 2: ${row.trail2_name} (${row.trail2_uuid})`);
      console.log(`   Length: ${row.trail2_length.toFixed(2)}m`);
      console.log(`   Intersection Area: ${row.intersection_area.toFixed(6)}`);
      console.log(`   Distance: ${row.distance_meters.toFixed(2)}m`);
      console.log(`   Overlap Ratio: ${(row.overlap_ratio * 100).toFixed(2)}%`);
      console.log(`   Deduplication Action: ${row.deduplication_action}`);
      
      if (row.deduplication_action.startsWith('REMOVE')) {
        console.log('\n❌ This trail pair would be removed by deduplication!');
      } else {
        console.log('\n✅ This trail pair would be kept by deduplication.');
      }
    } else {
      console.log('❌ No overlap data found for these specific trails');
    }
    
  } catch (error) {
    console.error('❌ Error checking overlap:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkSpecificOverlap();
