const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function checkSpecificTrailSource() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🔍 Checking data source for specific trail...');
    
    const trailId = 'b43a9490-6651-428e-b5e4-fb2ffce3b220';
    
    // Get detailed information about this specific trail
    const trailInfo = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        source,
        source_tags,
        osm_id,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_Length(geometry::geography) as length_meters,
        ST_NumPoints(geometry) as num_points,
        ST_GeometryType(geometry) as geometry_type,
        ST_SRID(geometry) as srid,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM public.trails
      WHERE app_uuid = $1
    `, [trailId]);
    
    if (trailInfo.rows.length === 0) {
      console.log('❌ Trail not found with that ID');
      return;
    }
    
    const trail = trailInfo.rows[0];
    
    console.log('📋 Trail Details:');
    console.log(`   ID: ${trail.app_uuid}`);
    console.log(`   Name: ${trail.name}`);
    console.log(`   Source: ${trail.source}`);
    console.log(`   OSM ID: ${trail.osm_id}`);
    console.log(`   Source Tags: ${trail.source_tags}`);
    console.log(`   Trail Type: ${trail.trail_type}`);
    console.log(`   Surface: ${trail.surface}`);
    console.log(`   Difficulty: ${trail.difficulty}`);
    console.log(`   Length (km): ${trail.length_km}`);
    console.log(`   Length (m): ${trail.length_meters}`);
    console.log(`   Elevation Gain: ${trail.elevation_gain}`);
    console.log(`   Elevation Loss: ${trail.elevation_loss}`);
    console.log(`   Geometry Type: ${trail.geometry_type}`);
    console.log(`   SRID: ${trail.srid}`);
    console.log(`   Number of Points: ${trail.num_points}`);
    console.log(`   Start Point: ${trail.start_point}`);
    console.log(`   End Point: ${trail.end_point}`);
    
    // Check if this trail exists in our processed tables
    console.log('\n🔍 Checking processed tables...');
    
    // Check Layer 1
    const layer1Check = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM carthorse_1755774476689.trails 
      WHERE app_uuid = $1
    `, [trailId]);
    
    console.log(`   Layer 1 (${process.env.STAGING_SCHEMA || 'carthorse_1755774476689'}.trails): ${layer1Check.rows[0].count} segments`);
    if (layer1Check.rows[0].count > 0) {
      console.log(`   Layer 1 length: ${layer1Check.rows[0].length_meters}m`);
    }
    
    // Check if it was split into multiple segments
    const layer1Segments = await pgClient.query(`
      SELECT app_uuid, 
             original_trail_uuid,
             ST_Length(geometry::geography) as length_meters,
             ST_NumPoints(geometry) as num_points
      FROM carthorse_1755774476689.trails 
      WHERE app_uuid = $1 OR original_trail_uuid = $1
      ORDER BY ST_Length(geometry::geography) DESC
    `, [trailId]);
    
    if (layer1Segments.rows.length > 1) {
      console.log('   Split into multiple segments:');
      layer1Segments.rows.forEach((segment, i) => {
        console.log(`     Segment ${i+1}: ${segment.length_meters.toFixed(2)}m, ${segment.num_points} points`);
      });
    }
    
    // Check Layer 2
    const layer2Check = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM carthorse_1755774476689.ways 
      WHERE trail_uuid = $1
    `, [trailId]);
    
    console.log(`   Layer 2 (carthorse_1755774476689.ways): ${layer2Check.rows[0].count} segments`);
    
    // Check if it was dropped due to length
    if (layer1Check.rows[0].count === 0) {
      console.log('\n⚠️  Trail was dropped during Layer 1 processing!');
      console.log(`   Original length: ${trail.length_meters}m`);
      console.log(`   Current minTrailLengthMeters setting: 0.1m`);
      
      if (trail.length_meters < 0.1) {
        console.log('   ❌ Trail is shorter than minimum length threshold');
      } else {
        console.log('   ❓ Trail should have been kept - investigate further');
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking trail source:', error);
  } finally {
    await pgClient.release();
    await pool.end();
  }
}

checkSpecificTrailSource();
