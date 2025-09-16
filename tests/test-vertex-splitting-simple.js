const { Pool } = require('pg');

async function testVertexSplittingSimple() {
  console.log('🧪 Testing vertex-based splitting with simple trail data...');
  
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'postgres',
    password: 'postgres'
  });
  
  const stagingSchema = 'staging';
  
  try {
    // Check if we have trails in staging
    const trailCheck = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${stagingSchema}.trails 
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    console.log(`📊 Found ${trailCheck.rows[0].count} valid trails in staging`);
    
    if (trailCheck.rows[0].count === 0) {
      console.log('⚠️ No trails found in staging - checking if we need to copy from public...');
      
      // Check if we have trails in public
      const publicTrailCheck = await pool.query(`
        SELECT COUNT(*) as count 
        FROM public.trails 
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      `);
      
      console.log(`📊 Found ${publicTrailCheck.rows[0].count} valid trails in public`);
      
      if (publicTrailCheck.rows[0].count > 0) {
        console.log('📋 Copying trails from public to staging...');
        await pool.query(`DELETE FROM ${stagingSchema}.trails`);
        await pool.query(`
          INSERT INTO ${stagingSchema}.trails (
            id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, 
            source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, 
            avg_elevation, source, created_at, updated_at, geometry
          )
          SELECT 
            id, app_uuid, osm_id, name, region, trail_type, surface, difficulty,
            source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation,
            avg_elevation, source, created_at, updated_at, geometry
          FROM public.trails
          WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
          LIMIT 100  -- Start with a small subset for testing
        `);
        
        const copiedCount = await pool.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
        console.log(`✅ Copied ${copiedCount.rows[0].count} trails to staging`);
      }
    }
    
    // Now test the vertex extraction
    console.log('\n🔗 Testing vertex extraction...');
    
    // Extract vertices manually to see what we get
    const verticesResult = await pool.query(`
      WITH vertex_dump AS (
        SELECT 
          t.id as trail_id,
          t.app_uuid as trail_uuid,
          t.name as trail_name,
          (ST_DumpPoints(t.geometry)).geom as vertex_point,
          (ST_DumpPoints(t.geometry)).path[1] as vertex_order
        FROM ${stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        LIMIT 10  -- Just test with first 10 trails
      )
      SELECT 
        trail_id,
        trail_uuid,
        trail_name,
        ST_AsText(ST_Force2D(vertex_point)) as vertex_text,
        vertex_order
      FROM vertex_dump
      WHERE ST_GeometryType(vertex_point) = 'ST_Point'
      ORDER BY trail_id, vertex_order
      LIMIT 20
    `);
    
    console.log(`📍 Extracted ${verticesResult.rows.length} vertices from first 10 trails`);
    console.log('Sample vertices:');
    verticesResult.rows.slice(0, 5).forEach((row, i) => {
      console.log(`   ${i + 1}. Trail: ${row.trail_name} (${row.trail_id}) - Vertex ${row.vertex_order}: ${row.vertex_text}`);
    });
    
    // Test intersection detection
    console.log('\n🔍 Testing intersection detection...');
    const intersectionResult = await pool.query(`
      WITH vertex_clusters AS (
        SELECT 
          ST_SnapToGrid(vertex_point, 0.00001) as snapped_point,
          COUNT(DISTINCT trail_uuid) as trail_count,
          ARRAY_AGG(DISTINCT trail_uuid) as connected_trails
        FROM (
          SELECT 
            t.app_uuid as trail_uuid,
            (ST_DumpPoints(t.geometry)).geom as vertex_point
          FROM ${stagingSchema}.trails t
          WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
          LIMIT 20
        ) as vertices
        GROUP BY ST_SnapToGrid(vertex_point, 0.00001)
        HAVING COUNT(DISTINCT trail_uuid) > 1
      )
      SELECT 
        ST_AsText(snapped_point) as intersection_point,
        trail_count,
        connected_trails
      FROM vertex_clusters
      ORDER BY trail_count DESC
      LIMIT 10
    `);
    
    console.log(`🔍 Found ${intersectionResult.rows.length} intersection vertices`);
    if (intersectionResult.rows.length > 0) {
      console.log('Sample intersections:');
      intersectionResult.rows.slice(0, 3).forEach((row, i) => {
        console.log(`   ${i + 1}. Point: ${row.intersection_point} - ${row.trail_count} trails connected`);
      });
    }
    
    console.log('\n✅ Vertex extraction test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testVertexSplittingSimple();
