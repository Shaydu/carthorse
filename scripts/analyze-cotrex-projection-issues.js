const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function analyzeCOTREXProjectionIssues() {
  try {
    console.log('🔍 Analyzing COTREX projection and coordinate system issues...');
    
    // Get both OSM and COTREX versions with detailed geometry analysis
    const trailsResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        source,
        ST_AsText(geometry) as geom_text,
        ST_SRID(geometry) as srid,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters_geography,
        ST_Length(geometry) as length_degrees,
        ST_IsSimple(geometry) as is_simple,
        ST_IsValid(geometry) as is_valid,
        ST_GeometryType(geometry) as geom_type,
        ST_NDims(geometry) as dimensions,
        ST_X(ST_StartPoint(geometry)) as start_lng,
        ST_Y(ST_StartPoint(geometry)) as start_lat,
        ST_X(ST_EndPoint(geometry)) as end_lng,
        ST_Y(ST_EndPoint(geometry)) as end_lat,
        ST_Envelope(geometry) as bbox
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
      console.log(`      - SRID: ${osmVersion.srid}`);
      console.log(`      - Points: ${osmVersion.num_points}`);
      console.log(`      - Length (geography): ${Math.round(osmVersion.length_meters_geography)}m`);
      console.log(`      - Length (degrees): ${osmVersion.length_degrees.toFixed(6)}°`);
      console.log(`      - Start: (${osmVersion.start_lng.toFixed(6)}, ${osmVersion.start_lat.toFixed(6)})`);
      console.log(`      - End: (${osmVersion.end_lng.toFixed(6)}, ${osmVersion.end_lat.toFixed(6)})`);
      console.log(`      - Simple: ${osmVersion.is_simple}`);
      console.log(`      - Valid: ${osmVersion.is_valid}`);
      console.log(`      - Type: ${osmVersion.geom_type}`);
      console.log(`      - Dimensions: ${osmVersion.dimensions}D`);
      
      console.log(`   📊 COTREX version:`);
      console.log(`      - SRID: ${cotrexVersion.srid}`);
      console.log(`      - Points: ${cotrexVersion.num_points}`);
      console.log(`      - Length (geography): ${Math.round(cotrexVersion.length_meters_geography)}m`);
      console.log(`      - Length (degrees): ${cotrexVersion.length_degrees.toFixed(6)}°`);
      console.log(`      - Start: (${cotrexVersion.start_lng.toFixed(6)}, ${cotrexVersion.start_lat.toFixed(6)})`);
      console.log(`      - End: (${cotrexVersion.end_lng.toFixed(6)}, ${cotrexVersion.end_lat.toFixed(6)})`);
      console.log(`      - Simple: ${cotrexVersion.is_simple}`);
      console.log(`      - Valid: ${cotrexVersion.is_valid}`);
      console.log(`      - Type: ${cotrexVersion.geom_type}`);
      console.log(`      - Dimensions: ${cotrexVersion.dimensions}D`);
      
      // Test coordinate system transformations
      console.log(`\n   🔄 Testing coordinate system transformations:`);
      
      // Test different SRIDs for COTREX data
      const testSrids = [4326, 3857, 26913, 26914, 26915, 26916, 26917, 26918, 26919, 26920];
      
      for (const testSrid of testSrids) {
        try {
          const transformResult = await pgClient.query(`
            SELECT 
              ST_Length(ST_Transform($1::geometry, $2)::geography) as transformed_length_meters,
              ST_NumPoints(ST_Transform($1::geometry, $2)) as transformed_points
          `, [cotrexVersion.geom_text, testSrid]);
          
          const transformedLength = transformResult.rows[0].transformed_length_meters;
          const transformedPoints = transformResult.rows[0].transformed_points;
          
          if (transformedLength > 100 && transformedLength < 2000) {
            console.log(`      🎯 SRID ${testSrid}: ${Math.round(transformedLength)}m (${transformedPoints} points) - POTENTIAL MATCH!`);
          } else {
            console.log(`      SRID ${testSrid}: ${Math.round(transformedLength)}m (${transformedPoints} points)`);
          }
        } catch (error) {
          console.log(`      ❌ SRID ${testSrid}: Error - ${error.message}`);
        }
      }
      
      // Test if COTREX data needs reprojection to match OSM
      console.log(`\n   🔧 Testing reprojection to match OSM:`);
      
      try {
        // Try transforming COTREX to different projections and back to 4326
        const reprojectResult = await pgClient.query(`
          WITH transformed AS (
            SELECT ST_Transform($1::geometry, 3857) as web_mercator,
                   ST_Transform($1::geometry, 26913) as utm_13n,
                   ST_Transform($1::geometry, 26914) as utm_14n
          )
          SELECT 
            ST_Length(ST_Transform(web_mercator, 4326)::geography) as web_mercator_length,
            ST_Length(ST_Transform(utm_13n, 4326)::geography) as utm_13n_length,
            ST_Length(ST_Transform(utm_14n, 4326)::geography) as utm_14n_length
          FROM transformed
        `, [cotrexVersion.geom_text]);
        
        const reprojected = reprojectResult.rows[0];
        console.log(`      Web Mercator (3857): ${Math.round(reprojected.web_mercator_length)}m`);
        console.log(`      UTM 13N (26913): ${Math.round(reprojected.utm_13n_length)}m`);
        console.log(`      UTM 14N (26914): ${Math.round(reprojected.utm_14n_length)}m`);
        console.log(`      OSM target: ${Math.round(osmVersion.length_meters_geography)}m`);
        
        // Find the best match
        const lengths = [
          { name: 'Web Mercator', length: reprojected.web_mercator_length },
          { name: 'UTM 13N', length: reprojected.utm_13n_length },
          { name: 'UTM 14N', length: reprojected.utm_14n_length }
        ];
        
        const bestMatch = lengths.reduce((best, current) => {
          const osmLength = osmVersion.length_meters_geography;
          const currentDiff = Math.abs(current.length - osmLength);
          const bestDiff = Math.abs(best.length - osmLength);
          return currentDiff < bestDiff ? current : best;
        });
        
        console.log(`      🎯 Best match: ${bestMatch.name} (${Math.round(bestMatch.length)}m vs OSM ${Math.round(osmVersion.length_meters_geography)}m)`);
        
      } catch (error) {
        console.log(`      ❌ Reprojection test failed: ${error.message}`);
      }
      
      // Test intersection with corrected COTREX data
      console.log(`\n   🔗 Testing intersection with corrected COTREX data:`);
      
      try {
        // Try different transformations for COTREX data
        const intersectionTestResult = await pgClient.query(`
          WITH cotrex_corrected AS (
            SELECT ST_Transform($1::geometry, 3857) as corrected_geom
          ),
          intersection_test AS (
            SELECT 
              ST_Intersects($2::geometry, corrected_geom) as intersects,
              ST_Distance($2::geometry::geography, corrected_geom::geography) as min_distance
            FROM cotrex_corrected
          )
          SELECT * FROM intersection_test
        `, [cotrexVersion.geom_text, osmVersion.geom_text]);
        
        const intersectionTest = intersectionTestResult.rows[0];
        console.log(`      Intersects: ${intersectionTest.intersects}`);
        console.log(`      Min distance: ${Math.round(intersectionTest.min_distance)}m`);
        
      } catch (error) {
        console.log(`      ❌ Intersection test failed: ${error.message}`);
      }
    }
    
    console.log('\n✅ COTREX projection analysis completed');
    
  } catch (error) {
    console.error('❌ Error analyzing COTREX projection issues:', error);
  } finally {
    await pgClient.end();
  }
}

analyzeCOTREXProjectionIssues();
