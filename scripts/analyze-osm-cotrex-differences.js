const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function analyzeOSMCOTREXDifferences() {
  try {
    console.log('🔍 Analyzing OSM vs COTREX differences for Enchanted Mesa and Kohler Spur trails...');
    
    // Get both OSM and COTREX versions of the trails
    const trailsResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        source,
        ST_AsText(geometry) as geom_text,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_IsSimple(geometry) as is_simple,
        ST_IsValid(geometry) as is_valid,
        ST_GeometryType(geometry) as geom_type,
        ST_NDims(geometry) as dimensions
      FROM public.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
      ORDER BY name, source
    `);
    
    console.log(`📊 Found ${trailsResult.rows.length} trail versions:`);
    
    const trailGroups = {};
    trailsResult.rows.forEach(row => {
      if (!trailGroups[row.name]) {
        trailGroups[row.name] = [];
      }
      trailGroups[row.name].push(row);
    });
    
    // Analyze each trail name
    for (const [trailName, versions] of Object.entries(trailGroups)) {
      console.log(`\n🔍 ${trailName}:`);
      
      if (versions.length < 2) {
        console.log(`   ⚠️ Only ${versions.length} version found (need both OSM and COTREX)`);
        continue;
      }
      
      const osmVersion = versions.find(v => v.source === 'osm');
      const cotrexVersion = versions.find(v => v.source === 'cotrex');
      
      if (!osmVersion || !cotrexVersion) {
        console.log(`   ⚠️ Missing one version: OSM=${!!osmVersion}, COTREX=${!!cotrexVersion}`);
        continue;
      }
      
      console.log(`   📊 OSM version:`);
      console.log(`      - Points: ${osmVersion.num_points}`);
      console.log(`      - Length: ${Math.round(osmVersion.length_meters)}m`);
      console.log(`      - Simple: ${osmVersion.is_simple}`);
      console.log(`      - Valid: ${osmVersion.is_valid}`);
      console.log(`      - Type: ${osmVersion.geom_type}`);
      console.log(`      - Dimensions: ${osmVersion.dimensions}D`);
      
      console.log(`   📊 COTREX version:`);
      console.log(`      - Points: ${cotrexVersion.num_points}`);
      console.log(`      - Length: ${Math.round(cotrexVersion.length_meters)}m`);
      console.log(`      - Simple: ${cotrexVersion.is_simple}`);
      console.log(`      - Valid: ${cotrexVersion.is_valid}`);
      console.log(`      - Type: ${cotrexVersion.geom_type}`);
      console.log(`      - Dimensions: ${cotrexVersion.dimensions}D`);
      
      // Test intersection detection with prototype logic
      console.log(`\n   🔗 Testing prototype intersection logic:`);
      
      // Step 1: Round coordinates to 6 decimal places
      const roundedResult = await pgClient.query(`
        WITH rounded_trails AS (
          SELECT 
            ST_GeomFromText(
              'LINESTRING(' || 
              string_agg(
                ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
                ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($1), pt1)
              ) || 
              ')'
            ) as osm_rounded,
            ST_GeomFromText(
              'LINESTRING(' || 
              string_agg(
                ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
                ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2), pt2)
              ) || 
              ')'
            ) as cotrex_rounded
          FROM 
            (SELECT (ST_DumpPoints(ST_GeomFromText($1))).geom AS pt1) as points1,
            (SELECT (ST_DumpPoints(ST_GeomFromText($2))).geom AS pt2) as points2
        )
        SELECT osm_rounded, cotrex_rounded FROM rounded_trails
      `, [osmVersion.geom_text, cotrexVersion.geom_text]);
      
      if (roundedResult.rows.length === 0) {
        console.log(`      ❌ Failed to round coordinates`);
        continue;
      }
      
      const osmRounded = roundedResult.rows[0].osm_rounded;
      const cotrexRounded = roundedResult.rows[0].cotrex_rounded;
      
      // Step 2: Test different snap tolerances
      const tolerances = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.0001, 0.001, 0.01];
      
      for (const tolerance of tolerances) {
        console.log(`      🔧 Testing tolerance ${tolerance}:`);
        
        try {
          // Snap with current tolerance
          const snappedResult = await pgClient.query(`
            SELECT 
              ST_Snap($1::geometry, $2::geometry, $3) AS osm_snapped,
              ST_Snap($2::geometry, $1::geometry, $3) AS cotrex_snapped
          `, [osmRounded, cotrexRounded, tolerance]);
          
          const osmSnapped = snappedResult.rows[0].osm_snapped;
          const cotrexSnapped = snappedResult.rows[0].cotrex_snapped;
          
          // Find intersections
          const intersectionResult = await pgClient.query(`
            SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
          `, [osmSnapped, cotrexSnapped]);
          
          if (intersectionResult.rows.length > 0) {
            console.log(`         ✅ Found ${intersectionResult.rows.length} intersection(s) with tolerance ${tolerance}`);
            
            // Test splitting
            const splitResult = await pgClient.query(`
              SELECT 
                (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
            `, [osmSnapped, intersectionResult.rows[0].pt]);
            
            console.log(`         📏 Split into ${splitResult.rows.length} segments`);
            
            if (tolerance <= 1e-4) {
              console.log(`         🎯 SUCCESS: Prototype logic works with tolerance ${tolerance}`);
              break;
            }
          } else {
            console.log(`         ❌ No intersections found with tolerance ${tolerance}`);
          }
        } catch (error) {
          console.log(`         ❌ Error with tolerance ${tolerance}: ${error.message}`);
        }
      }
      
      // Test distance between trail endpoints
      console.log(`\n   📏 Testing endpoint distances:`);
      
      const distanceResult = await pgClient.query(`
        SELECT 
          ST_Distance(ST_StartPoint($1::geometry)::geography, ST_StartPoint($2::geometry)::geography) as start_start_dist,
          ST_Distance(ST_StartPoint($1::geometry)::geography, ST_EndPoint($2::geometry)::geography) as start_end_dist,
          ST_Distance(ST_EndPoint($1::geometry)::geography, ST_StartPoint($2::geometry)::geography) as end_start_dist,
          ST_Distance(ST_EndPoint($1::geometry)::geography, ST_EndPoint($2::geometry)::geography) as end_end_dist
      `, [osmVersion.geom_text, cotrexVersion.geom_text]);
      
      const distances = distanceResult.rows[0];
      console.log(`      Start-Start: ${Math.round(distances.start_start_dist)}m`);
      console.log(`      Start-End: ${Math.round(distances.start_end_dist)}m`);
      console.log(`      End-Start: ${Math.round(distances.end_start_dist)}m`);
      console.log(`      End-End: ${Math.round(distances.end_end_dist)}m`);
      
      // Test overall trail similarity
      const similarityResult = await pgClient.query(`
        SELECT 
          ST_HausdorffDistance($1::geometry, $2::geometry) as hausdorff_dist,
          ST_FrechetDistance($1::geometry, $2::geometry) as frechet_dist,
          ST_Distance($1::geometry::geography, $2::geometry::geography) as min_dist
      `, [osmVersion.geom_text, cotrexVersion.geom_text]);
      
      const similarity = similarityResult.rows[0];
      console.log(`\n   📊 Trail similarity metrics:`);
      console.log(`      Hausdorff distance: ${Math.round(similarity.hausdorff_dist)}m`);
      console.log(`      Fréchet distance: ${Math.round(similarity.frechet_dist)}m`);
      console.log(`      Minimum distance: ${Math.round(similarity.min_dist)}m`);
    }
    
    console.log('\n✅ OSM vs COTREX analysis completed');
    
  } catch (error) {
    console.error('❌ Error analyzing OSM vs COTREX differences:', error);
  } finally {
    await pgClient.end();
  }
}

analyzeOSMCOTREXDifferences();
