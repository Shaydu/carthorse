const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function debugSplitting() {
  try {
    console.log('🔍 Debugging Splitting Issue...');
    
    // Test with the Shanahan T-Intersection case
    const trail1Id = '643fc095-8bbd-4310-9028-723484460fbd'; // North Fork Shanahan Trail
    const trail2Id = '67143e1d-83c5-4223-9c58-3c6f670fd7b2'; // Shanahan Connector Trail
    
    console.log('Testing Shanahan T-Intersection splitting...');
    
    // Get the trails
    const trailsResult = await pgClient.query(`
      SELECT app_uuid, name, ST_AsText(geometry) as geom_text, ST_Length(geometry::geography) as length_m
      FROM public.trails 
      WHERE app_uuid IN ($1, $2)
    `, [trail1Id, trail2Id]);
    
    const [trail1, trail2] = trailsResult.rows;
    console.log(`Trail 1: ${trail1.name} (${trail1.length_m.toFixed(1)}m)`);
    console.log(`Trail 2: ${trail2.name} (${trail2.length_m.toFixed(1)}m)`);
    
    // Find intersection point
    const intersectionResult = await pgClient.query(`
      WITH trail1_rounded AS (
        SELECT ST_SnapToGrid(geometry, 0.000001) as geom 
        FROM public.trails WHERE app_uuid = $1
      ),
      trail2_rounded AS (
        SELECT ST_SnapToGrid(geometry, 0.000001) as geom 
        FROM public.trails WHERE app_uuid = $2
      ),
      trail1_snapped AS (
        SELECT ST_Snap(trail1_rounded.geom, trail2_rounded.geom, 0.0001) as geom 
        FROM trail1_rounded, trail2_rounded
      ),
      trail2_snapped AS (
        SELECT ST_Snap(trail2_rounded.geom, trail1_rounded.geom, 0.0001) as geom 
        FROM trail1_rounded, trail2_rounded
      )
      SELECT ST_Intersection(trail1_snapped.geom, trail2_snapped.geom) as intersection_point
      FROM trail1_snapped, trail2_snapped
    `, [trail1Id, trail2Id]);
    
    const intersectionPoint = intersectionResult.rows[0].intersection_point;
    console.log(`Intersection point: ${intersectionPoint}`);
    
    // Test splitting trail1
    console.log('\n🔧 Testing splitting of trail1...');
    
    const splitResult = await pgClient.query(`
      WITH intersection_point AS (
        SELECT $1::geometry as point
      ),
      trail_geom AS (
        SELECT ST_SnapToGrid(geometry, 0.000001) as geom 
        FROM public.trails WHERE app_uuid = $2
      ),
      trail_split AS (
        SELECT ST_Split(trail_geom.geom, ST_Buffer(intersection_point.point, 0.000001)) as split_geom
        FROM trail_geom, intersection_point
      )
      SELECT 
        ST_NumGeometries(split_geom) as num_segments,
        ST_AsText(split_geom) as split_geometries
      FROM trail_split
    `, [intersectionPoint, trail1Id]);
    
    const split = splitResult.rows[0];
    console.log(`Number of segments: ${split.num_segments}`);
    console.log(`Split geometries: ${split.split_geometries}`);
    
    if (split.num_segments > 1) {
      console.log('\n📊 Analyzing segments:');
      
      for (let i = 1; i <= split.num_segments; i++) {
        const segmentResult = await pgClient.query(`
          WITH split_geom AS (
            SELECT ST_GeomFromText($1) as geom
          )
          SELECT 
            ST_GeometryN(split_geom.geom, $2) as segment_geom,
            ST_Length(ST_GeometryN(split_geom.geom, $2)::geography) as length_m
          FROM split_geom
        `, [split.split_geometries, i]);
        
                 const segment = segmentResult.rows[0];
         console.log(`  Segment ${i}: ${segment.length_m.toFixed(1)}m`);
         console.log(`  Geometry: ${segment.segment_geom}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugSplitting();
