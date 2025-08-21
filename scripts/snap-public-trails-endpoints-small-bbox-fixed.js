const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function snapPublicTrailsEndpointsSmallBboxFixed() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🔗 Starting CORRECTED endpoint snapping for small bbox test...');
    
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
      CREATE TABLE IF NOT EXISTS public.trails_snapped_small_fixed_backup AS 
      SELECT * FROM public.trails 
      WHERE bbox_min_lng >= $1 AND bbox_max_lng <= $2 
        AND bbox_min_lat >= $3 AND bbox_max_lat <= $4
    `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat]);
    
    const backupCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small_fixed_backup`);
    console.log(`✅ Backup created: public.trails_snapped_small_fixed_backup (${backupCount.rows[0].count} trails)`);
    
    // Step 2: Create the snapped version for small area
    console.log('🔧 Creating snapped trails table for small bbox...');
    await pgClient.query(`DROP TABLE IF EXISTS public.trails_snapped_small_fixed`);
    await pgClient.query(`
      CREATE TABLE public.trails_snapped_small_fixed AS 
      SELECT * FROM public.trails 
      WHERE bbox_min_lng >= $1 AND bbox_max_lng <= $2 
        AND bbox_min_lat >= $3 AND bbox_max_lat <= $4
    `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat]);
    
    const smallCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small_fixed`);
    console.log(`✅ Created public.trails_snapped_small_fixed (${smallCount.rows[0].count} trails)`);
    
    if (smallCount.rows[0].count === 0) {
      console.log('⚠️ No trails found in the specified bbox. Exiting.');
      return;
    }
    
    // Step 3: Find all endpoint-to-endpoint/midpoint pairs within tolerance (25 meters)
    console.log('🔍 Finding endpoint-to-endpoint/midpoint pairs within 25 meters...');
    const endpointPairs = await pgClient.query(`
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'start_to_start' as snap_type,
        ST_Distance(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry)) as distance,
        ST_StartPoint(t1.geometry) as source_point,
        ST_StartPoint(t2.geometry) as target_point
      FROM public.trails_snapped_small_fixed t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small_fixed t2
        WHERE t2.app_uuid != t1.app_uuid
          AND ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 25)
      ) t2
      
      UNION ALL
      
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'start_to_end' as snap_type,
        ST_Distance(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry)) as distance,
        ST_StartPoint(t1.geometry) as source_point,
        ST_EndPoint(t2.geometry) as target_point
      FROM public.trails_snapped_small_fixed t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small_fixed t2
        WHERE t2.app_uuid != t1.app_uuid
          AND ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 25)
      ) t2
      
      UNION ALL
      
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'end_to_start' as snap_type,
        ST_Distance(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry)) as distance,
        ST_EndPoint(t1.geometry) as source_point,
        ST_StartPoint(t2.geometry) as target_point
      FROM public.trails_snapped_small_fixed t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small_fixed t2
        WHERE t2.app_uuid != t1.app_uuid
          AND ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 25)
      ) t2
      
      UNION ALL
      
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'end_to_end' as snap_type,
        ST_Distance(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry)) as distance,
        ST_EndPoint(t1.geometry) as source_point,
        ST_EndPoint(t2.geometry) as target_point
      FROM public.trails_snapped_small_fixed t1
      CROSS JOIN LATERAL (
        SELECT t2.app_uuid, t2.name, t2.geometry
        FROM public.trails_snapped_small_fixed t2
        WHERE t2.app_uuid != t1.app_uuid
          AND ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 25)
      ) t2
      
      ORDER BY distance
    `);
    
    console.log(`📍 Found ${endpointPairs.rows.length} endpoint pairs within 25 meters`);
    
    // Step 4: Process each pair and snap ONE endpoint to the nearest endpoint
    let snappedCount = 0;
    const processedTrails = new Set(); // Track which trails have been snapped (only snap each trail once)
    
    for (const pair of endpointPairs.rows) {
      // Only snap each trail once - if trail1 has already been snapped, skip this pair
      if (processedTrails.has(pair.trail1_id)) continue;
      
      if (pair.distance <= 25) {
        console.log(`🔗 Snapping ${pair.trail1_name} ${pair.snap_type} (${pair.distance.toFixed(2)}m)`);
        
        // Get the current geometry for trail1
        const trail1Result = await pgClient.query(`
          SELECT geometry FROM public.trails_snapped_small_fixed WHERE app_uuid = $1
        `, [pair.trail1_id]);
        
        if (trail1Result.rows.length > 0) {
          const trail1Geom = trail1Result.rows[0].geometry;
          
          // Snap trail1 to the target point (endpoint of trail2)
          const snappedTrail1 = await pgClient.query(`
            SELECT ST_Snap($1::geometry, $2::geometry, 25) as snapped_geom
          `, [trail1Geom, pair.target_point]);
          
          // Update trail1 with snapped geometry
          if (snappedTrail1.rows[0].snapped_geom) {
            await pgClient.query(`
              UPDATE public.trails_snapped_small_fixed 
              SET geometry = $1 
              WHERE app_uuid = $2
            `, [snappedTrail1.rows[0].snapped_geom, pair.trail1_id]);
            
            // Mark this trail as processed (only snap each trail once)
            processedTrails.add(pair.trail1_id);
            
            console.log(`   ✅ Snapped ${pair.trail1_name} ${pair.snap_type} to ${pair.trail2_name}`);
            snappedCount++;
          }
        }
      }
    }
    
    console.log(`✅ Snapping completed: ${snappedCount} trail pairs snapped`);
    
    // Step 5: Show summary
    const originalCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small_fixed_backup`);
    const finalCount = await pgClient.query(`SELECT COUNT(*) as count FROM public.trails_snapped_small_fixed`);
    
    console.log(`📊 Summary:`);
    console.log(`   Original trails in bbox: ${originalCount.rows[0].count}`);
    console.log(`   Snapped trails in bbox: ${finalCount.rows[0].count}`);
    console.log(`   Trails processed: ${snappedCount} pairs`);
    
    // Step 6: Show size comparison
    const originalSize = await pgClient.query(`SELECT pg_size_pretty(pg_total_relation_size('public.trails_snapped_small_fixed_backup')) as size`);
    const finalSize = await pgClient.query(`SELECT pg_size_pretty(pg_total_relation_size('public.trails_snapped_small_fixed')) as size`);
    
    console.log(`📏 Size comparison:`);
    console.log(`   Original size: ${originalSize.rows[0].size}`);
    console.log(`   Final size: ${finalSize.rows[0].size}`);
    
    console.log(`✅ CORRECTED small bbox endpoint snapping completed!`);
    console.log(`   - Original data preserved in: public.trails_snapped_small_fixed_backup`);
    console.log(`   - Snapped data available in: public.trails_snapped_small_fixed`);
    
  } catch (error) {
    console.error('❌ Error during endpoint snapping:', error);
    throw error;
  } finally {
    pgClient.release();
    await pool.end();
  }
}

// Run the script
snapPublicTrailsEndpointsSmallBboxFixed().catch(console.error);
