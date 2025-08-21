const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function snapPublicTrailsEndpointsSmallBboxFinal() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🔗 Starting FINAL endpoint snapping for small bbox test...');
    
    // Define the small bounding box
    const bbox = {
      minLng: -105.30149874439387,
      maxLng: -105.28075856161965,
      minLat: 40.06333793003867,
      maxLat: 40.079827264297876
    };
    
    const toleranceVal = 25; // meters
    
    console.log(`📍 Processing trails within bbox: ${bbox.minLng}, ${bbox.minLat} to ${bbox.maxLng}, ${bbox.maxLat}`);
    console.log(`🎯 Tolerance: ${toleranceVal} meters`);
    
    // Step 1: Create a backup copy of public.trails for the small area
    console.log('📋 Creating backup of trails in small bbox...');
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS public.trails_snapped_small_final_backup AS 
      SELECT * FROM public.trails 
      WHERE bbox_min_lng >= $1 AND bbox_max_lng <= $2 
        AND bbox_min_lat >= $3 AND bbox_max_lat <= $4
    `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat]);
    
    const backupCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small_final_backup`);
    console.log(`✅ Backup created: public.trails_snapped_small_final_backup (${backupCount.rows[0].count} trails)`);
    
    // Step 2: Create the snapped version for small area
    console.log('🔧 Creating snapped trails table for small bbox...');
    await pgClient.query(`DROP TABLE IF EXISTS public.trails_snapped_small_final`);
    await pgClient.query(`
      CREATE TABLE public.trails_snapped_small_final AS 
      SELECT * FROM public.trails 
      WHERE bbox_min_lng >= $1 AND bbox_max_lng <= $2 
        AND bbox_min_lat >= $3 AND bbox_max_lat <= $4
    `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat]);
    
    const smallCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small_final`);
    console.log(`✅ Created public.trails_snapped_small_final (${smallCount.rows[0].count} trails)`);
    
    if (smallCount.rows[0].count === 0) {
      console.log('⚠️ No trails found in the specified bbox. Exiting.');
      return;
    }
    
    // Step 3: Find all snapping opportunities
    console.log('🔍 Finding snapping opportunities...');
    
    // Case 1: Endpoint to endpoint snapping
    const endpointToEndpoint = await pgClient.query(`
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'endpoint_to_endpoint' as snap_type,
        ST_Distance(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry)) as distance,
        'start_to_start' as endpoint_type,
        ST_StartPoint(t1.geometry) as source_point,
        ST_StartPoint(t2.geometry) as target_point
      FROM public.trails_snapped_small_final t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small_final t2
        WHERE t2.app_uuid != t1.app_uuid
          AND ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), $1)
      ) t2
      
      UNION ALL
      
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'endpoint_to_endpoint' as snap_type,
        ST_Distance(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry)) as distance,
        'start_to_end' as endpoint_type,
        ST_StartPoint(t1.geometry) as source_point,
        ST_EndPoint(t2.geometry) as target_point
      FROM public.trails_snapped_small_final t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small_final t2
        WHERE t2.app_uuid != t1.app_uuid
          AND ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), $1)
      ) t2
      
      UNION ALL
      
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'endpoint_to_endpoint' as snap_type,
        ST_Distance(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry)) as distance,
        'end_to_start' as endpoint_type,
        ST_EndPoint(t1.geometry) as source_point,
        ST_StartPoint(t2.geometry) as target_point
      FROM public.trails_snapped_small_final t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small_final t2
        WHERE t2.app_uuid != t1.app_uuid
          AND ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), $1)
      ) t2
      
      UNION ALL
      
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'endpoint_to_endpoint' as snap_type,
        ST_Distance(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry)) as distance,
        'end_to_end' as endpoint_type,
        ST_EndPoint(t1.geometry) as source_point,
        ST_EndPoint(t2.geometry) as target_point
      FROM public.trails_snapped_small_final t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small_final t2
        WHERE t2.app_uuid != t1.app_uuid
          AND ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), $1)
      ) t2
      
      ORDER BY distance
    `, [toleranceVal]);
    
    // Case 2: Endpoint to trail path snapping
    const endpointToPath = await pgClient.query(`
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'endpoint_to_path' as snap_type,
        ST_Distance(ST_StartPoint(t1.geometry), t2.geometry) as distance,
        'start_to_path' as endpoint_type,
        ST_StartPoint(t1.geometry) as source_point,
        ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry)) as target_point
      FROM public.trails_snapped_small_final t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small_final t2
        WHERE t2.app_uuid != t1.app_uuid
          AND ST_DWithin(ST_StartPoint(t1.geometry), t2.geometry, $1)
          AND NOT ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), $1)
          AND NOT ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), $1)
      ) t2
      
      UNION ALL
      
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'endpoint_to_path' as snap_type,
        ST_Distance(ST_EndPoint(t1.geometry), t2.geometry) as distance,
        'end_to_path' as endpoint_type,
        ST_EndPoint(t1.geometry) as source_point,
        ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) as target_point
      FROM public.trails_snapped_small_final t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small_final t2
        WHERE t2.app_uuid != t1.app_uuid
          AND ST_DWithin(ST_EndPoint(t1.geometry), t2.geometry, $1)
          AND NOT ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), $1)
          AND NOT ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), $1)
      ) t2
      
      ORDER BY distance
    `, [toleranceVal]);
    
    console.log(`📍 Found ${endpointToEndpoint.rows.length} endpoint-to-endpoint pairs`);
    console.log(`📍 Found ${endpointToPath.rows.length} endpoint-to-path pairs`);
    
    // Step 4: Process snapping opportunities
    let snappedCount = 0;
    const processedTrails = new Set(); // Track which trails have been snapped (only snap each trail once)
    
    // Process endpoint-to-endpoint first (higher priority)
    console.log('🔗 Processing endpoint-to-endpoint snapping...');
    for (const pair of endpointToEndpoint.rows) {
      if (processedTrails.has(pair.trail1_id)) continue;
      
      if (pair.distance <= toleranceVal) {
        console.log(`🔗 Snapping ${pair.trail1_name} ${pair.endpoint_type} to ${pair.trail2_name} endpoint (${pair.distance.toFixed(2)}m)`);
        
        // Get the current geometry for trail1
        const trail1Result = await pgClient.query(`
          SELECT geometry FROM public.trails_snapped_small_final WHERE app_uuid = $1
        `, [pair.trail1_id]);
        
        if (trail1Result.rows.length > 0) {
          const trail1Geom = trail1Result.rows[0].geometry;
          
          // Snap trail1 to the target endpoint
          const snappedTrail1 = await pgClient.query(`
            SELECT ST_Snap($1::geometry, $2::geometry, $3) as snapped_geom
          `, [trail1Geom, pair.target_point, toleranceVal]);
          
          if (snappedTrail1.rows[0].snapped_geom) {
            await pgClient.query(`
              UPDATE public.trails_snapped_small_final 
              SET geometry = $1 
              WHERE app_uuid = $2
            `, [snappedTrail1.rows[0].snapped_geom, pair.trail1_id]);
            
            processedTrails.add(pair.trail1_id);
            console.log(`   ✅ Snapped ${pair.trail1_name} to ${pair.trail2_name} endpoint`);
            snappedCount++;
          }
        }
      }
    }
    
    // Process endpoint-to-path (may require splitting)
    console.log('🔗 Processing endpoint-to-path snapping...');
    for (const pair of endpointToPath.rows) {
      if (processedTrails.has(pair.trail1_id)) continue;
      
      if (pair.distance <= toleranceVal) {
        console.log(`🔗 Snapping ${pair.trail1_name} ${pair.endpoint_type} to ${pair.trail2_name} path (${pair.distance.toFixed(2)}m)`);
        
        // Get the current geometries
        const trail1Result = await pgClient.query(`
          SELECT geometry FROM public.trails_snapped_small_final WHERE app_uuid = $1
        `, [pair.trail1_id]);
        
        const trail2Result = await pgClient.query(`
          SELECT geometry FROM public.trails_snapped_small_final WHERE app_uuid = $1
        `, [pair.trail2_id]);
        
        if (trail1Result.rows.length > 0 && trail2Result.rows.length > 0) {
          const trail1Geom = trail1Result.rows[0].geometry;
          const trail2Geom = trail2Result.rows[0].geometry;
          
          // Snap trail1 to the closest point on trail2
          const snappedTrail1 = await pgClient.query(`
            SELECT ST_Snap($1::geometry, $2::geometry, $3) as snapped_geom
          `, [trail1Geom, pair.target_point, toleranceVal]);
          
          if (snappedTrail1.rows[0].snapped_geom) {
            // Update trail1
            await pgClient.query(`
              UPDATE public.trails_snapped_small_final 
              SET geometry = $1 
              WHERE app_uuid = $2
            `, [snappedTrail1.rows[0].snapped_geom, pair.trail1_id]);
            
            // Split trail2 at the snap point
            console.log(`   🔪 Splitting ${pair.trail2_name} at snap point`);
            const splitResult = await pgClient.query(`
              WITH split AS (
                SELECT ST_Split($1::geometry, $2::geometry) as split_geom
              )
              SELECT 
                (ST_Dump(split_geom)).geom as segment_geom,
                (ST_Dump(split_geom)).path[1] as segment_id
              FROM split
              WHERE (ST_Dump(split_geom)).geom IS NOT NULL
              ORDER BY (ST_Dump(split_geom)).path[1]
            `, [trail2Geom, pair.target_point]);
            
            if (splitResult.rows.length >= 2) {
              // Replace original trail2 with first segment
              await pgClient.query(`
                UPDATE public.trails_snapped_small_final 
                SET geometry = $1 
                WHERE app_uuid = $2
              `, [splitResult.rows[0].segment_geom, pair.trail2_id]);
              
              // Insert additional segments as new trails
              for (let i = 1; i < splitResult.rows.length; i++) {
                const newTrailId = `${pair.trail2_id}_split_${i}`;
                await pgClient.query(`
                  INSERT INTO public.trails_snapped_small_final (
                    app_uuid, name, trail_type, surface, difficulty, length_km, 
                    elevation_gain, elevation_loss, geometry, bbox_min_lng, bbox_max_lng, 
                    bbox_min_lat, bbox_max_lat, source, region
                  )
                  SELECT 
                    $1, name, trail_type, surface, difficulty, 
                    ST_Length(geometry::geography) / 1000, elevation_gain, elevation_loss,
                    $2, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, region
                  FROM public.trails_snapped_small_final 
                  WHERE app_uuid = $3
                `, [newTrailId, splitResult.rows[i].segment_geom, pair.trail2_id]);
              }
              
              console.log(`   ✅ Split ${pair.trail2_name} into ${splitResult.rows.length} segments`);
            }
            
            processedTrails.add(pair.trail1_id);
            console.log(`   ✅ Snapped ${pair.trail1_name} to ${pair.trail2_name} path`);
            snappedCount++;
          }
        }
      }
    }
    
    console.log(`✅ Snapping completed: ${snappedCount} trails snapped`);
    
    // Step 5: Show summary
    const originalCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small_final_backup`);
    const finalCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small_final`);
    
    console.log(`📊 Summary:`);
    console.log(`   Original trails in bbox: ${originalCount.rows[0].count}`);
    console.log(`   Final trails in bbox: ${finalCount.rows[0].count}`);
    console.log(`   Trails processed: ${snappedCount} trails`);
    
    // Step 6: Show size comparison
    const originalSize = await pgClient.query(`SELECT pg_size_pretty(pg_total_relation_size('public.trails_snapped_small_final_backup')) as size`);
    const finalSize = await pgClient.query(`SELECT pg_size_pretty(pg_total_relation_size('public.trails_snapped_small_final')) as size`);
    
    console.log(`📏 Size comparison:`);
    console.log(`   Original size: ${originalSize.rows[0].size}`);
    console.log(`   Final size: ${finalSize.rows[0].size}`);
    
    console.log(`✅ FINAL small bbox endpoint snapping completed!`);
    console.log(`   - Original data preserved in: public.trails_snapped_small_final_backup`);
    console.log(`   - Snapped data available in: public.trails_snapped_small_final`);
    
  } catch (error) {
    console.error('❌ Error during endpoint snapping:', error);
    throw error;
  } finally {
    pgClient.release();
    await pool.end();
  }
}

// Run the script
snapPublicTrailsEndpointsSmallBboxFinal().catch(console.error);
