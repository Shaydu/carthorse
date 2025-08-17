const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function lookupHollyBerryTrail() {
  try {
    console.log('\n🔍 Looking up Holly Berry Trail in public.trails...');
    
    // Search for Holly Berry Trail (case insensitive)
    const result = await pgClient.query(`
      SELECT 
        id,
        app_uuid,
        name,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        source,
        region,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        created_at,
        updated_at
      FROM public.trails 
      WHERE name ILIKE '%holly berry%'
      ORDER BY name
    `);

    console.log(`🔍 Found ${result.rows.length} trail(s) matching "Holly Berry":`);
    
    if (result.rows.length === 0) {
      console.log('❌ No trails found with "Holly Berry" in the name');
      
      // Let's also search for partial matches
      const partialResult = await pgClient.query(`
        SELECT 
          id,
          app_uuid,
          name,
          trail_type,
          surface,
          difficulty,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          source,
          region,
          created_at
        FROM public.trails 
        WHERE name ILIKE '%holly%' OR name ILIKE '%berry%'
        ORDER BY name
        LIMIT 10
      `);
      
      if (partialResult.rows.length > 0) {
        console.log(`🔍 Found ${partialResult.rows.length} trail(s) with "holly" or "berry" in the name:`);
        partialResult.rows.forEach((trail, index) => {
          console.log(`\n  ${index + 1}. ${trail.name}`);
          console.log(`     ID: ${trail.id}`);
          console.log(`     UUID: ${trail.app_uuid}`);
          console.log(`     Type: ${trail.trail_type || 'N/A'}`);
          console.log(`     Surface: ${trail.surface || 'N/A'}`);
          console.log(`     Difficulty: ${trail.difficulty || 'N/A'}`);
          console.log(`     Length: ${trail.length_km ? `${trail.length_km.toFixed(2)} km` : 'N/A'}`);
          console.log(`     Elevation Gain: ${trail.elevation_gain ? `${trail.elevation_gain.toFixed(0)} m` : 'N/A'}`);
          console.log(`     Region: ${trail.region || 'N/A'}`);
          console.log(`     Source: ${trail.source || 'N/A'}`);
        });
      }
    } else {
      result.rows.forEach((trail, index) => {
        console.log(`\n  ${index + 1}. ${trail.name}`);
        console.log(`     ID: ${trail.id}`);
        console.log(`     UUID: ${trail.app_uuid}`);
        console.log(`     Type: ${trail.trail_type || 'N/A'}`);
        console.log(`     Surface: ${trail.surface || 'N/A'}`);
        console.log(`     Difficulty: ${trail.difficulty || 'N/A'}`);
        console.log(`     Length: ${trail.length_km ? `${trail.length_km.toFixed(2)} km` : 'N/A'}`);
        console.log(`     Elevation Gain: ${trail.elevation_gain ? `${trail.elevation_gain.toFixed(0)} m` : 'N/A'}`);
        console.log(`     Elevation Loss: ${trail.elevation_loss ? `${trail.elevation_loss.toFixed(0)} m` : 'N/A'}`);
        console.log(`     Max Elevation: ${trail.max_elevation ? `${trail.max_elevation.toFixed(0)} m` : 'N/A'}`);
        console.log(`     Min Elevation: ${trail.min_elevation ? `${trail.min_elevation.toFixed(0)} m` : 'N/A'}`);
        console.log(`     Avg Elevation: ${trail.avg_elevation ? `${trail.avg_elevation.toFixed(0)} m` : 'N/A'}`);
        console.log(`     Region: ${trail.region || 'N/A'}`);
        console.log(`     Source: ${trail.source || 'N/A'}`);
        console.log(`     Bbox: [${trail.bbox_min_lng?.toFixed(4) || 'N/A'}, ${trail.bbox_min_lat?.toFixed(4) || 'N/A'}, ${trail.bbox_max_lng?.toFixed(4) || 'N/A'}, ${trail.bbox_max_lat?.toFixed(4) || 'N/A'}]`);
        console.log(`     Created: ${trail.created_at}`);
        console.log(`     Updated: ${trail.updated_at}`);
      });
    }

    // Check if Holly Berry Trail has any intersections with other trails
    if (result.rows.length > 0) {
      const hollyBerryTrail = result.rows[0];
      console.log(`\n🔍 Checking for intersections with Holly Berry Trail (${hollyBerryTrail.app_uuid})...`);
      
      // Find trails that intersect with Holly Berry Trail
      const intersectionResult = await pgClient.query(`
        SELECT 
          t2.id,
          t2.app_uuid,
          t2.name,
          t2.trail_type,
          t2.surface,
          t2.difficulty,
          t2.length_km,
          t2.elevation_gain,
          t2.source,
          t2.region,
          ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_geom,
          ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type
        FROM public.trails t1
        JOIN public.trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE t1.app_uuid = $1
          AND ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint', 'ST_LineString', 'ST_MultiLineString')
        ORDER BY t2.name
      `, [hollyBerryTrail.app_uuid]);

      console.log(`🔍 Found ${intersectionResult.rows.length} trail(s) that intersect with Holly Berry Trail:`);
      
      if (intersectionResult.rows.length === 0) {
        console.log('   ✅ Holly Berry Trail has no intersections with other trails');
      } else {
        intersectionResult.rows.forEach((trail, index) => {
          console.log(`\n  ${index + 1}. ${trail.name}`);
          console.log(`     ID: ${trail.id}`);
          console.log(`     UUID: ${trail.app_uuid}`);
          console.log(`     Type: ${trail.trail_type || 'N/A'}`);
          console.log(`     Surface: ${trail.surface || 'N/A'}`);
          console.log(`     Difficulty: ${trail.difficulty || 'N/A'}`);
          console.log(`     Length: ${trail.length_km ? `${trail.length_km.toFixed(2)} km` : 'N/A'}`);
          console.log(`     Elevation Gain: ${trail.elevation_gain ? `${trail.elevation_gain.toFixed(0)} m` : 'N/A'}`);
          console.log(`     Region: ${trail.region || 'N/A'}`);
          console.log(`     Source: ${trail.source || 'N/A'}`);
          console.log(`     Intersection Type: ${trail.intersection_type}`);
          console.log(`     Intersection Geometry: ${trail.intersection_geom}`);
        });
      }

      // Check if Holly Berry Trail appears in any staging schemas (indicating it was processed)
      console.log(`\n🔍 Checking if Holly Berry Trail appears in staging schemas...`);
      
      // First, let's see what staging schemas exist
      const allStagingSchemasResult = await pgClient.query(`
        SELECT 
          schema_name
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'staging_%'
        ORDER BY schema_name DESC
        LIMIT 10
      `);

      console.log(`Found ${allStagingSchemasResult.rows.length} staging schemas:`);
      allStagingSchemasResult.rows.forEach(schema => {
        console.log(`   - ${schema.schema_name}`);
      });

      // Now check for trails tables in staging schemas
      const stagingSchemasResult = await pgClient.query(`
        SELECT 
          table_schema
        FROM information_schema.tables 
        WHERE table_schema LIKE 'staging_%' 
          AND table_name = 'trails'
        ORDER BY table_schema DESC
        LIMIT 10
      `);

      if (stagingSchemasResult.rows.length > 0) {
        console.log(`\nFound ${stagingSchemasResult.rows.length} staging schemas with trails tables:`);
        
        for (const schema of stagingSchemasResult.rows) {
          const stagingTrailsResult = await pgClient.query(`
            SELECT COUNT(*) as count
            FROM ${schema.table_schema}.trails 
            WHERE app_uuid = $1
          `, [hollyBerryTrail.app_uuid]);
          
          const count = parseInt(stagingTrailsResult.rows[0].count);
          console.log(`   ${schema.table_schema}: ${count} instance(s) of Holly Berry Trail`);
          
          // If found, show more details
          if (count > 0) {
            const trailDetailsResult = await pgClient.query(`
              SELECT 
                id,
                name,
                length_km,
                elevation_gain,
                elevation_loss,
                created_at
              FROM ${schema.table_schema}.trails 
              WHERE app_uuid = $1
            `, [hollyBerryTrail.app_uuid]);
            
            trailDetailsResult.rows.forEach((trail, index) => {
              console.log(`     Instance ${index + 1}: ID=${trail.id}, Length=${trail.length_km?.toFixed(3)}km, Gain=${trail.elevation_gain?.toFixed(0)}m, Loss=${trail.elevation_loss?.toFixed(0)}m`);
            });
          }
        }
      } else {
        console.log('   No staging schemas with trails tables found');
      }
    }

  } catch (error) {
    console.error('❌ Error looking up Holly Berry Trail:', error.message);
  }
}

async function testPrototypeWithActualData() {
  try {
    console.log('🔍 Testing prototype with actual trail data from database...');
    
    // Get the actual Enchanted Mesa, Kohler, Skunk Canyon, and Skunk Connector trails from public.trails
    const trailsResult = await pgClient.query(`
      SELECT app_uuid, name, ST_AsText(geometry) as geom_text
      FROM public.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail', 'Skunk Canyon Trail', 'Skunk Connector Trail')
      ORDER BY name
    `);
    
    console.log(`🔍 Found ${trailsResult.rows.length} trails:`);
    trailsResult.rows.forEach(row => {
      console.log(`   - ${row.name} (${row.app_uuid})`);
    });
    
    if (trailsResult.rows.length < 4) {
      console.log('❌ Need Enchanted Mesa, Kohler, Skunk Canyon, and Skunk Connector trails');
      return;
    }
    
    const enchantedMesa = trailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
    const kohlerSpur = trailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');
    const skunkCanyon = trailsResult.rows.find(t => t.app_uuid === '8fa2152a-a213-40d1-b8b6-ef1b233f2bc6'); // Specific UUID from intersection analysis
    const skunkConnector = trailsResult.rows.find(t => t.app_uuid === '3da33063-b264-4455-b32e-5881325f26fd'); // Specific UUID from intersection analysis
    
    // Test 1: Enchanted Mesa <-> Kohler Spur (original test)
    console.log(`\n🔗 Test 1: ${enchantedMesa.name} (${enchantedMesa.app_uuid}) <-> ${kohlerSpur.name} (${kohlerSpur.app_uuid})`);
    
    // Step 1: Round coordinates to 6 decimal places (exactly like prototype)
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
          ) as enchanted_mesa_rounded,
          ST_GeomFromText(
            'LINESTRING(' || 
            string_agg(
              ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
              ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2), pt2)
            ) || 
            ')'
          ) as kohler_spur_rounded
        FROM 
          (SELECT (ST_DumpPoints(ST_GeomFromText($1))).geom AS pt1) as points1,
          (SELECT (ST_DumpPoints(ST_GeomFromText($2))).geom AS pt2) as points2
      )
      SELECT enchanted_mesa_rounded, kohler_spur_rounded FROM rounded_trails
    `, [enchantedMesa.geom_text, kohlerSpur.geom_text]);
    
    if (roundedResult.rows.length === 0) {
      console.log('❌ Failed to round coordinates');
      return;
    }
    
    const enchantedMesaRounded = roundedResult.rows[0].enchanted_mesa_rounded;
    const kohlerSpurRounded = roundedResult.rows[0].kohler_spur_rounded;
    
    // Step 2: Snap with 1e-6 tolerance (exactly like prototype)
    const snappedResult = await pgClient.query(`
      SELECT 
        ST_Snap($1::geometry, $2::geometry, 1e-6) AS enchanted_mesa_snapped,
        ST_Snap($2::geometry, $1::geometry, 1e-6) AS kohler_spur_snapped
    `, [enchantedMesaRounded, kohlerSpurRounded]);
    
    const enchantedMesaSnapped = snappedResult.rows[0].enchanted_mesa_snapped;
    const kohlerSpurSnapped = snappedResult.rows[0].kohler_spur_snapped;
    
    // Step 3: Find intersections (exactly like prototype)
    const intersectionResult = await pgClient.query(`
      SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
    `, [enchantedMesaSnapped, kohlerSpurSnapped]);
    
    console.log(`🔍 Found ${intersectionResult.rows.length} intersection(s)`);
    
    if (intersectionResult.rows.length === 0) {
      console.log('❌ No intersections found - prototype logic failed');
      return;
    }
    
    // Step 4: Split both trails at intersection points (exactly like prototype)
    for (const intersection of intersectionResult.rows) {
      const splitPoint = intersection.pt;
      console.log(`   ✅ Intersection point: ${splitPoint}`);
      
      // Split Enchanted Mesa
      const splitEnchantedMesaResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [enchantedMesaSnapped, splitPoint]);
      
      console.log(`   📏 Enchanted Mesa split into ${splitEnchantedMesaResult.rows.length} segments`);
      
      // Split Kohler Spur
      const splitKohlerSpurResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [kohlerSpurSnapped, splitPoint]);
      
      console.log(`   📏 Kohler Spur split into ${splitKohlerSpurResult.rows.length} segments`);
    }

    // Test 2: Skunk Canyon <-> Skunk Connector
    console.log(`\n🔗 Test 2: ${skunkCanyon.name} (${skunkCanyon.app_uuid}) <-> ${skunkConnector.name} (${skunkConnector.app_uuid})`);
    
    // Step 1: Round coordinates to 6 decimal places (exactly like prototype)
    const roundedResult2 = await pgClient.query(`
      WITH rounded_trails AS (
        SELECT 
          ST_GeomFromText(
            'LINESTRING(' || 
            string_agg(
              ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
              ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($1), pt1)
            ) || 
            ')'
          ) as skunk_canyon_rounded,
          ST_GeomFromText(
            'LINESTRING(' || 
            string_agg(
              ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
              ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2), pt2)
            ) || 
            ')'
          ) as skunk_connector_rounded
        FROM 
          (SELECT (ST_DumpPoints(ST_GeomFromText($1))).geom AS pt1) as points1,
          (SELECT (ST_DumpPoints(ST_GeomFromText($2))).geom AS pt2) as points2
      )
      SELECT skunk_canyon_rounded, skunk_connector_rounded FROM rounded_trails
    `, [skunkCanyon.geom_text, skunkConnector.geom_text]);
    
    if (roundedResult2.rows.length === 0) {
      console.log('❌ Failed to round coordinates for Skunk trails');
      return;
    }
    
    const skunkCanyonRounded = roundedResult2.rows[0].skunk_canyon_rounded;
    const skunkConnectorRounded = roundedResult2.rows[0].skunk_connector_rounded;
    
    // Step 2: Snap with 1e-6 tolerance (exactly like prototype)
    const snappedResult2 = await pgClient.query(`
      SELECT 
        ST_Snap($1::geometry, $2::geometry, 1e-6) AS skunk_canyon_snapped,
        ST_Snap($2::geometry, $1::geometry, 1e-6) AS skunk_connector_snapped
    `, [skunkCanyonRounded, skunkConnectorRounded]);
    
    const skunkCanyonSnapped = snappedResult2.rows[0].skunk_canyon_snapped;
    const skunkConnectorSnapped = snappedResult2.rows[0].skunk_connector_snapped;
    
    // Step 3: Find intersections (exactly like prototype)
    const intersectionResult2 = await pgClient.query(`
      SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
    `, [skunkCanyonSnapped, skunkConnectorSnapped]);
    
    console.log(`🔍 Found ${intersectionResult2.rows.length} intersection(s)`);
    
    if (intersectionResult2.rows.length === 0) {
      console.log('❌ No intersections found between Skunk Canyon and Skunk Connector');
    } else {
      // Step 4: Split both trails at intersection points (exactly like prototype)
      for (const intersection of intersectionResult2.rows) {
        const splitPoint = intersection.pt;
        console.log(`   ✅ Intersection point: ${splitPoint}`);
        
        // Split Skunk Canyon
        const splitSkunkCanyonResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [skunkCanyonSnapped, splitPoint]);
        
        console.log(`   📏 Skunk Canyon split into ${splitSkunkCanyonResult.rows.length} segments`);
        
        // Split Skunk Connector
        const splitSkunkConnectorResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [skunkConnectorSnapped, splitPoint]);
        
        console.log(`   📏 Skunk Connector split into ${splitSkunkConnectorResult.rows.length} segments`);
      }
    }

    // Test 3: Holly Berry <-> Skunk Canyon (we know these intersect)
    console.log(`\n🔗 Test 3: Holly Berry Trail <-> ${skunkCanyon.name} (${skunkCanyon.app_uuid})`);
    
    // Get Holly Berry Trail geometry
    const hollyBerryResult = await pgClient.query(`
      SELECT app_uuid, name, ST_AsText(geometry) as geom_text
      FROM public.trails 
      WHERE name = 'Holly Berry Trail'
      LIMIT 1
    `);
    
    if (hollyBerryResult.rows.length === 0) {
      console.log('❌ Holly Berry Trail not found');
    } else {
      const hollyBerry = hollyBerryResult.rows[0];
      
      // Step 1: Round coordinates to 6 decimal places (exactly like prototype)
      const roundedResult3 = await pgClient.query(`
        WITH rounded_trails AS (
          SELECT 
            ST_GeomFromText(
              'LINESTRING(' || 
              string_agg(
                ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
                ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($1), pt1)
              ) || 
              ')'
            ) as holly_berry_rounded,
            ST_GeomFromText(
              'LINESTRING(' || 
              string_agg(
                ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
                ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2), pt2)
              ) || 
              ')'
            ) as skunk_canyon_rounded
          FROM 
            (SELECT (ST_DumpPoints(ST_GeomFromText($1))).geom AS pt1) as points1,
            (SELECT (ST_DumpPoints(ST_GeomFromText($2))).geom AS pt2) as points2
        )
        SELECT holly_berry_rounded, skunk_canyon_rounded FROM rounded_trails
      `, [hollyBerry.geom_text, skunkCanyon.geom_text]);
      
      if (roundedResult3.rows.length === 0) {
        console.log('❌ Failed to round coordinates for Holly Berry <-> Skunk Canyon');
      } else {
        const hollyBerryRounded = roundedResult3.rows[0].holly_berry_rounded;
        const skunkCanyonRounded2 = roundedResult3.rows[0].skunk_canyon_rounded;
        
        // Step 2: Snap with 1e-6 tolerance (exactly like prototype)
        const snappedResult3 = await pgClient.query(`
          SELECT 
            ST_Snap($1::geometry, $2::geometry, 1e-6) AS holly_berry_snapped,
            ST_Snap($2::geometry, $1::geometry, 1e-6) AS skunk_canyon_snapped
        `, [hollyBerryRounded, skunkCanyonRounded2]);
        
        const hollyBerrySnapped = snappedResult3.rows[0].holly_berry_snapped;
        const skunkCanyonSnapped2 = snappedResult3.rows[0].skunk_canyon_snapped;
        
        // Step 3: Find intersections (exactly like prototype)
        const intersectionResult3 = await pgClient.query(`
          SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
        `, [hollyBerrySnapped, skunkCanyonSnapped2]);
        
        console.log(`🔍 Found ${intersectionResult3.rows.length} intersection(s)`);
        
        if (intersectionResult3.rows.length === 0) {
          console.log('❌ No intersections found between Holly Berry and Skunk Canyon');
        } else {
          // Step 4: Split both trails at intersection points (exactly like prototype)
          for (const intersection of intersectionResult3.rows) {
            const splitPoint = intersection.pt;
            console.log(`   ✅ Intersection point: ${splitPoint}`);
            
            // Split Holly Berry
            const splitHollyBerryResult = await pgClient.query(`
              SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
            `, [hollyBerrySnapped, splitPoint]);
            
            console.log(`   📏 Holly Berry split into ${splitHollyBerryResult.rows.length} segments`);
            
            // Split Skunk Canyon
            const splitSkunkCanyonResult2 = await pgClient.query(`
              SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
            `, [skunkCanyonSnapped2, splitPoint]);
            
            console.log(`   📏 Skunk Canyon split into ${splitSkunkCanyonResult2.rows.length} segments`);
          }
        }
      }
    }
    
    console.log('✅ All prototype tests with actual data completed successfully!');
    
  } catch (error) {
    console.error('❌ Error testing prototype with actual data:', error);
  }
}

async function main() {
  try {
    // Run the original prototype test
    await testPrototypeWithActualData();
    
    // Run the Holly Berry Trail lookup
    await lookupHollyBerryTrail();
    
  } catch (error) {
    console.error('❌ Error in main:', error);
  } finally {
    await pgClient.end();
  }
}

main();
