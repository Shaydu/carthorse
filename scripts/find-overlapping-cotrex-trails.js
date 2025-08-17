const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  user: 'shaydu',
  password: '',
  database: 'trail_master_db',
  port: 5432
});

async function findOverlappingCotrexTrails() {
  try {
    console.log('🔍 Finding cotrex trails that overlap with working OSM trails...');
    
    // Get the working OSM trails (the ones that successfully split)
    const osmTrailsResult = await pgClient.query(`
      SELECT name, app_uuid, ST_AsText(geometry) as geom_text, ST_Length(geometry::geography) as length_meters
      FROM public.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND app_uuid IN ('4cda78f2-3a86-4e56-9300-c62480ca11fa', 'a610885e-8cf0-48bd-9b47-2217e2055101')
      ORDER BY name
    `);
    
    console.log(`🔍 Found ${osmTrailsResult.rows.length} working OSM trails:`);
    osmTrailsResult.rows.forEach(trail => {
      console.log(`   - ${trail.name} (${trail.app_uuid}): ${Math.round(trail.length_meters * 100) / 100}m`);
    });
    
    if (osmTrailsResult.rows.length < 2) {
      console.log('❌ Need both working OSM trails');
      return;
    }
    
    const osmEnchantedMesa = osmTrailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
    const osmKohlerSpur = osmTrailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');
    
    // Find cotrex trails that are close to the OSM trails
    console.log('\n🔍 Finding cotrex trails close to OSM Enchanted Mesa Trail...');
    const cotrexNearEnchantedResult = await pgClient.query(`
      SELECT 
        name, 
        app_uuid, 
        ST_Length(geometry::geography) as length_meters,
        ST_Distance(geometry, ST_GeomFromText($1, 4326)) as distance_degrees,
        ST_Distance(geometry::geography, ST_GeomFromText($1, 4326)::geography) as distance_meters,
        ST_AsText(ST_Centroid(geometry)) as centroid
      FROM public.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND source = 'cotrex'
      ORDER BY ST_Distance(geometry::geography, ST_GeomFromText($1, 4326)::geography)
      LIMIT 5
    `, [osmEnchantedMesa.geom_text]);
    
    console.log(`📏 Cotrex trails near OSM Enchanted Mesa Trail:`);
    cotrexNearEnchantedResult.rows.forEach(trail => {
      console.log(`   - ${trail.name} (${trail.app_uuid}): ${Math.round(trail.length_meters * 100) / 100}m, ${Math.round(trail.distance_meters * 100) / 100}m away at ${trail.centroid}`);
    });
    
    console.log('\n🔍 Finding cotrex trails close to OSM Kohler Spur Trail...');
    const cotrexNearKohlerResult = await pgClient.query(`
      SELECT 
        name, 
        app_uuid, 
        ST_Length(geometry::geography) as length_meters,
        ST_Distance(geometry, ST_GeomFromText($1, 4326)) as distance_degrees,
        ST_Distance(geometry::geography, ST_GeomFromText($1, 4326)::geography) as distance_meters,
        ST_AsText(ST_Centroid(geometry)) as centroid
      FROM public.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND source = 'cotrex'
      ORDER BY ST_Distance(geometry::geography, ST_GeomFromText($1, 4326)::geography)
      LIMIT 5
    `, [osmKohlerSpur.geom_text]);
    
    console.log(`📏 Cotrex trails near OSM Kohler Spur Trail:`);
    cotrexNearKohlerResult.rows.forEach(trail => {
      console.log(`   - ${trail.name} (${trail.app_uuid}): ${Math.round(trail.length_meters * 100) / 100}m, ${Math.round(trail.distance_meters * 100) / 100}m away at ${trail.centroid}`);
    });
    
         // Test intersection between the closest cotrex trails
     if (cotrexNearEnchantedResult.rows.length > 0 && cotrexNearKohlerResult.rows.length > 0) {
       // Find the closest cotrex Enchanted Mesa Trail (not Kohler Spur)
       const closestCotrexEnchanted = cotrexNearEnchantedResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
       const closestCotrexKohler = cotrexNearKohlerResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');
      
      console.log(`\n🔗 Testing intersection between closest cotrex trails:`);
      console.log(`   - ${closestCotrexEnchanted.name} (${closestCotrexEnchanted.app_uuid})`);
      console.log(`   - ${closestCotrexKohler.name} (${closestCotrexKohler.app_uuid})`);
      
      // Get the geometry for these cotrex trails
      const cotrexTrailsResult = await pgClient.query(`
        SELECT name, app_uuid, ST_AsText(geometry) as geom_text
        FROM public.trails 
        WHERE app_uuid IN ($1, $2)
        ORDER BY name
      `, [closestCotrexEnchanted.app_uuid, closestCotrexKohler.app_uuid]);
      
      if (cotrexTrailsResult.rows.length === 2) {
        const cotrexEnchanted = cotrexTrailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
        const cotrexKohler = cotrexTrailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');
        
        // Test the working prototype logic on these cotrex trails
        console.log('\n🔧 Testing working prototype logic on closest cotrex trails...');
        
                 // Round coordinates to 6 decimal places
         const roundedResult = await pgClient.query(`
           WITH rounded_trails AS (
             SELECT 
               ST_GeomFromText(
                 'LINESTRING(' || 
                 string_agg(
                   ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
                   ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($1, 4326), pt1)
                 ) || 
                 ')', 4326
               ) as enchanted_mesa_rounded,
               ST_GeomFromText(
                 'LINESTRING(' || 
                 string_agg(
                   ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
                   ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2, 4326), pt2)
                 ) || 
                 ')', 4326
               ) as kohler_spur_rounded
             FROM 
               (SELECT (ST_DumpPoints(ST_GeomFromText($1, 4326))).geom AS pt1) as points1,
               (SELECT (ST_DumpPoints(ST_GeomFromText($2, 4326))).geom AS pt2) as points2
           )
           SELECT enchanted_mesa_rounded, kohler_spur_rounded FROM rounded_trails
         `, [cotrexEnchanted.geom_text, cotrexKohler.geom_text]);
        
        const enchantedMesaRounded = roundedResult.rows[0].enchanted_mesa_rounded;
        const kohlerSpurRounded = roundedResult.rows[0].kohler_spur_rounded;
        
        // Snap with 1e-6 tolerance
        const snappedResult = await pgClient.query(`
          SELECT 
            ST_Snap($1::geometry, $2::geometry, 1e-6) AS enchanted_mesa_snapped,
            ST_Snap($2::geometry, $1::geometry, 1e-6) AS kohler_spur_snapped
        `, [enchantedMesaRounded, kohlerSpurRounded]);
        
        const enchantedMesaSnapped = snappedResult.rows[0].enchanted_mesa_snapped;
        const kohlerSpurSnapped = snappedResult.rows[0].kohler_spur_snapped;
        
        // Find intersections
        const intersectionResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt,
                 ST_GeometryType((ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom) as geom_type
        `, [enchantedMesaSnapped, kohlerSpurSnapped]);
        
        console.log(`🔍 Found ${intersectionResult.rows.length} intersection(s) with cotrex trails`);
        intersectionResult.rows.forEach((intersection, index) => {
          console.log(`   ${index + 1}. Type: ${intersection.geom_type}, Point: ${intersection.pt}`);
        });
        
        if (intersectionResult.rows.length > 0) {
          console.log(`✅ SUCCESS: Cotrex trails can be split!`);
        } else {
          console.log(`❌ No intersections found with cotrex trails`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error finding overlapping cotrex trails:', error);
  } finally {
    await pgClient.end();
  }
}

findOverlappingCotrexTrails();
