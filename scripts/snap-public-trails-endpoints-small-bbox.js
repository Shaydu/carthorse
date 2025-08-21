const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function snapPublicTrailsEndpointsSmallBbox() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🔗 Starting endpoint snapping for small bbox test...');
    
    // Define the small bounding box
    const bbox = {
      minLng: -105.30149874439387,
      maxLng: -105.28075856161965,
      minLat: 40.06333793003867,
      maxLat: 40.079827264297876
    };
    
    console.log(`📍 Processing trails within bbox: ${bbox.minLng}, ${bbox.minLat} to ${bbox.maxLng}, ${bbox.maxLat}`);
    
    // Step 1: Create a backup copy of public.trails for the small area
    console.log('📋 Creating backup of trails in small bbox...');
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS public.trails_snapped_small_backup AS 
      SELECT * FROM public.trails 
      WHERE bbox_min_lng >= $1 AND bbox_max_lng <= $2 
        AND bbox_min_lat >= $3 AND bbox_max_lat <= $4
    `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat]);
    
    const backupCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small_backup`);
    console.log(`✅ Backup created: public.trails_snapped_small_backup (${backupCount.rows[0].count} trails)`);
    
    // Step 2: Create the snapped version for small area
    console.log('🔧 Creating snapped trails table for small bbox...');
    await pgClient.query(`DROP TABLE IF EXISTS public.trails_snapped_small`);
    await pgClient.query(`
      CREATE TABLE public.trails_snapped_small AS 
      SELECT * FROM public.trails 
      WHERE bbox_min_lng >= $1 AND bbox_max_lng <= $2 
        AND bbox_min_lat >= $3 AND bbox_max_lat <= $4
    `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat]);
    
    const smallCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small`);
    console.log(`✅ Created public.trails_snapped_small (${smallCount.rows[0].count} trails)`);
    
    if (smallCount.rows[0].count === 0) {
      console.log('⚠️ No trails found in the specified bbox. Exiting.');
      return;
    }
    
    // Step 3: Find all endpoint pairs within tolerance (25 meters) in the small area
    console.log('🔍 Finding endpoints within 25 meters in small bbox...');
    const endpointPairs = await pgClient.query(`
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        ST_Distance(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry)) as start_to_start_distance,
        ST_Distance(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry)) as start_to_end_distance,
        ST_Distance(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry)) as end_to_start_distance,
        ST_Distance(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry)) as end_to_end_distance
      FROM public.trails_snapped_small t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small t2
        WHERE t2.app_uuid != t1.app_uuid
          AND (
            ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 25) OR
            ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 25) OR
            ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 25) OR
            ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 25)
          )
      ) t2
      ORDER BY 
        LEAST(
          ST_Distance(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry)),
          ST_Distance(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry)),
          ST_Distance(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry)),
          ST_Distance(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry))
        )
    `);
    
    console.log(`📍 Found ${endpointPairs.rows.length} endpoint pairs within 25 meters`);
    
    // Step 4: Process each pair and snap endpoints
    let snappedCount = 0;
    const processedPairs = new Set(); // Avoid processing same pair twice
    
    for (const pair of endpointPairs.rows) {
      const pairKey = [pair.trail1_id, pair.trail2_id].sort().join('-');
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);
      
      // Find the closest endpoint combination
      const distances = [
        { type: 'start_start', distance: pair.start_to_start_distance },
        { type: 'start_end', distance: pair.start_to_end_distance },
        { type: 'end_start', distance: pair.end_to_start_distance },
        { type: 'end_end', distance: pair.end_to_end_distance }
      ];
      
      const closest = distances.reduce((min, curr) => 
        curr.distance < min.distance ? curr : min
      );
      
      if (closest.distance <= 25) {
        console.log(`🔗 Snapping ${pair.trail1_name} and ${pair.trail2_name} (${closest.type}, ${closest.distance.toFixed(2)}m)`);
        
        // Get the current geometries
        const trail1Result = await pgClient.query(`
          SELECT geometry FROM public.trails_snapped_small WHERE app_uuid = $1
        `, [pair.trail1_id]);
        
        const trail2Result = await pgClient.query(`
          SELECT geometry FROM public.trails_snapped_small WHERE app_uuid = $1
        `, [pair.trail2_id]);
        
        if (trail1Result.rows.length > 0 && trail2Result.rows.length > 0) {
          const trail1Geom = trail1Result.rows[0].geometry;
          const trail2Geom = trail2Result.rows[0].geometry;
          
          // Snap the geometries based on the closest endpoint type
          let snappedTrail1, snappedTrail2;
          
          switch (closest.type) {
            case 'start_start':
              snappedTrail1 = await pgClient.query(`
                SELECT ST_Snap(t1.geometry, ST_StartPoint(t2.geometry), 25) as snapped_geom
                FROM (SELECT $1::geometry as geometry) t1, (SELECT $2::geometry as geometry) t2
              `, [trail1Geom, trail2Geom]);
              snappedTrail2 = await pgClient.query(`
                SELECT ST_Snap(t2.geometry, ST_StartPoint(t1.geometry), 25) as snapped_geom
                FROM (SELECT $1::geometry as geometry) t1, (SELECT $2::geometry as geometry) t2
              `, [trail1Geom, trail2Geom]);
              break;
            case 'start_end':
              snappedTrail1 = await pgClient.query(`
                SELECT ST_Snap(t1.geometry, ST_EndPoint(t2.geometry), 25) as snapped_geom
                FROM (SELECT $1::geometry as geometry) t1, (SELECT $2::geometry as geometry) t2
              `, [trail1Geom, trail2Geom]);
              snappedTrail2 = await pgClient.query(`
                SELECT ST_Snap(t2.geometry, ST_StartPoint(t1.geometry), 25) as snapped_geom
                FROM (SELECT $1::geometry as geometry) t1, (SELECT $2::geometry as geometry) t2
              `, [trail1Geom, trail2Geom]);
              break;
            case 'end_start':
              snappedTrail1 = await pgClient.query(`
                SELECT ST_Snap(t1.geometry, ST_StartPoint(t2.geometry), 25) as snapped_geom
                FROM (SELECT $1::geometry as geometry) t1, (SELECT $2::geometry as geometry) t2
              `, [trail1Geom, trail2Geom]);
              snappedTrail2 = await pgClient.query(`
                SELECT ST_Snap(t2.geometry, ST_EndPoint(t1.geometry), 25) as snapped_geom
                FROM (SELECT $1::geometry as geometry) t1, (SELECT $2::geometry as geometry) t2
              `, [trail1Geom, trail2Geom]);
              break;
            case 'end_end':
              snappedTrail1 = await pgClient.query(`
                SELECT ST_Snap(t1.geometry, ST_EndPoint(t2.geometry), 25) as snapped_geom
                FROM (SELECT $1::geometry as geometry) t1, (SELECT $2::geometry as geometry) t2
              `, [trail1Geom, trail2Geom]);
              snappedTrail2 = await pgClient.query(`
                SELECT ST_Snap(t2.geometry, ST_EndPoint(t1.geometry), 25) as snapped_geom
                FROM (SELECT $1::geometry as geometry) t1, (SELECT $2::geometry as geometry) t2
              `, [trail1Geom, trail2Geom]);
              break;
          }
          
          // Update the trails with snapped geometries
          if (snappedTrail1.rows[0].snapped_geom && snappedTrail2.rows[0].snapped_geom) {
            await pgClient.query(`
              UPDATE public.trails_snapped_small 
              SET geometry = $1 
              WHERE app_uuid = $2
            `, [snappedTrail1.rows[0].snapped_geom, pair.trail1_id]);
            
            await pgClient.query(`
              UPDATE public.trails_snapped_small 
              SET geometry = $1 
              WHERE app_uuid = $2
            `, [snappedTrail2.rows[0].snapped_geom, pair.trail2_id]);
            
            snappedCount++;
          }
        }
      }
    }
    
    console.log(`✅ Snapping completed: ${snappedCount} trail pairs snapped`);
    
    // Step 5: Show summary
    const originalCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small_backup`);
    const finalCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small`);
    
    console.log(`📊 Summary:`);
    console.log(`   Original trails in bbox: ${originalCount.rows[0].count}`);
    console.log(`   Snapped trails in bbox: ${finalCount.rows[0].count}`);
    console.log(`   Trails processed: ${snappedCount} pairs`);
    
    // Step 6: Show size comparison
    const originalSize = await pgClient.query(`SELECT pg_size_pretty(pg_total_relation_size('public.trails_snapped_small_backup')) as size`);
    const finalSize = await pgClient.query(`SELECT pg_size_pretty(pg_total_relation_size('public.trails_snapped_small')) as size`);
    
    console.log(`📏 Size comparison:`);
    console.log(`   Original size: ${originalSize.rows[0].size}`);
    console.log(`   Final size: ${finalSize.rows[0].size}`);
    
    console.log(`✅ Small bbox endpoint snapping completed!`);
    console.log(`   - Original data preserved in: public.trails_snapped_small_backup`);
    console.log(`   - Snapped data available in: public.trails_snapped_small`);
    
  } catch (error) {
    console.error('❌ Error during endpoint snapping:', error);
    throw error;
  } finally {
    pgClient.release();
    await pool.end();
  }
}

// Run the script
snapPublicTrailsEndpointsSmallBbox().catch(console.error);
