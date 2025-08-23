const { Pool } = require('pg');
require('dotenv').config();

async function visualizeYIntersectionAttempts() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'tester',
    database: 'trail_master_db',
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
  });

  try {
    console.log('🔄 Creating Y-intersection visualization...\n');

    // Configuration
    const config = {
      toleranceMeters: 10,
      minTrailLengthMeters: 5,
      minSnapDistanceMeters: 1.0, // Endpoint safe area - don't split within 1m of endpoints
      tempSchema: 'y_intersection_viz',
      testBbox: {
        minLng: -105.30123174925316, maxLng: -105.26050515816028,
        minLat: 39.96928418458248, maxLat: 40.06483855535663
      }
    };

    // Step 1: Create temporary schema
    console.log('🔄 Step 1: Creating temporary schema...');
    await pool.query(`DROP SCHEMA IF EXISTS ${config.tempSchema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${config.tempSchema}`);
    
    // Create trails table
    await pool.query(`
      CREATE TABLE ${config.tempSchema}.trails (
        app_uuid TEXT PRIMARY KEY,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        geometry geometry(LineString,4326)
      )
    `);
    console.log('   ✅ Temporary schema created\n');

    // Step 2: Copy test data from public.trails
    console.log('🔄 Step 2: Copying test data from public.trails...');
    
    const carthorsePool = new Pool({
      host: process.env.PGHOST || 'localhost',
      user: 'carthorse',
      database: 'trail_master_db',
      password: process.env.PGPASSWORD,
      port: process.env.PGPORT || 5432,
    });

    const copyResult = await carthorsePool.query(`
      SELECT 
        app_uuid,
        name,
        region,
        trail_type,
        ST_Force2D(geometry) as geometry
      FROM public.trails 
      WHERE region = 'boulder'
        AND ST_Intersects(
          geometry,
          ST_MakeEnvelope($1, $2, $3, $4, 4326)
        )
    `, [config.testBbox.minLng, config.testBbox.minLat, config.testBbox.maxLng, config.testBbox.maxLat]);

    for (const trail of copyResult.rows) {
      await pool.query(`
        INSERT INTO ${config.tempSchema}.trails (app_uuid, name, region, trail_type, geometry)
        VALUES ($1, $2, $3, $4, $5)
      `, [trail.app_uuid, trail.name, trail.region, trail.trail_type, trail.geometry]);
    }

    await carthorsePool.end();
    console.log(`   ✅ Copied ${copyResult.rows.length} trails to temporary schema\n`);

    // Step 3: Find all potential Y-intersections (without processing)
    console.log('🔄 Step 3: Finding all potential Y-intersections...');
    const allIntersections = await findAllYIntersections(pool, config);
    console.log(`   ✅ Found ${allIntersections.length} potential Y-intersections\n`);

    // Step 4: Create visualization data
    console.log('🔄 Step 4: Creating visualization data...');
    
    // Get all trails for visualization
    const trailsResult = await pool.query(`
      SELECT 
        app_uuid,
        name,
        region,
        trail_type,
        ST_AsGeoJSON(ST_Transform(geometry, 4326))::json as geometry,
        ST_Length(geometry::geography) as length_meters
      FROM ${config.tempSchema}.trails
      ORDER BY name
    `);

    const trails = trailsResult.rows.map(row => ({
      type: "Feature",
      properties: {
        id: row.app_uuid,
        name: row.name || 'Unnamed Trail',
        region: row.region,
        trail_type: row.trail_type,
        length_meters: Math.round(row.length_meters * 100) / 100,
        color: '#0000FF', // Blue for original trails
        stroke: '#0000FF',
        strokeWidth: 2,
        fillOpacity: 0.6
      },
      geometry: row.geometry
    }));

    // Create intersection points
    const intersectionPoints = allIntersections.map((intersection, index) => {
      // Extract coordinates from PostGIS point
      const splitPointCoords = intersection.split_point.coordinates || 
                               [intersection.split_point.x, intersection.split_point.y];
      
      return {
        type: "Feature",
        properties: {
          id: `intersection_${index}`,
          name: `Y-Intersection ${index + 1}`,
          visiting_trail: intersection.visiting_trail_name,
          visited_trail: intersection.visited_trail_name,
          distance_meters: Math.round(intersection.distance_meters * 100) / 100,
          split_ratio: Math.round(intersection.split_ratio * 1000) / 1000,
          color: '#FF0000', // Red for intersection points
          stroke: '#FF0000',
          strokeWidth: 3,
          fillOpacity: 0.8,
          radius: 8
        },
        geometry: {
          type: "Point",
          coordinates: splitPointCoords
        }
      };
    });

    // Create connector lines (showing what would be created)
    const connectorLines = allIntersections.map((intersection, index) => {
      // Extract coordinates from PostGIS points
      const visitingEndpointCoords = intersection.visiting_endpoint.coordinates || 
                                     [intersection.visiting_endpoint.x, intersection.visiting_endpoint.y];
      const splitPointCoords = intersection.split_point.coordinates || 
                               [intersection.split_point.x, intersection.split_point.y];
      
      return {
        type: "Feature",
        properties: {
          id: `connector_${index}`,
          name: `Connector ${index + 1}`,
          visiting_trail: intersection.visiting_trail_name,
          visited_trail: intersection.visited_trail_name,
          distance_meters: Math.round(intersection.distance_meters * 100) / 100,
          color: '#FFA500', // Orange for potential connectors
          stroke: '#FFA500',
          strokeWidth: 2,
          fillOpacity: 0.6,
          dashArray: [5, 5] // Dashed line
        },
        geometry: {
          type: "LineString",
          coordinates: [
            visitingEndpointCoords,
            splitPointCoords
          ]
        }
      };
    });

    // Create split points on visited trails
    const splitPoints = allIntersections.map((intersection, index) => {
      // Extract coordinates from PostGIS point
      const splitPointCoords = intersection.split_point.coordinates || 
                               [intersection.split_point.x, intersection.split_point.y];
      
      return {
        type: "Feature",
        properties: {
          id: `split_point_${index}`,
          name: `Split Point ${index + 1}`,
          trail: intersection.visited_trail_name,
          split_ratio: Math.round(intersection.split_ratio * 1000) / 1000,
          color: '#00FF00', // Green for split points
          stroke: '#00FF00',
          strokeWidth: 2,
          fillOpacity: 0.8,
          radius: 6
        },
        geometry: {
          type: "Point",
          coordinates: splitPointCoords
        }
      };
    });

    // Combine all features
    const visualizationGeoJSON = {
      type: "FeatureCollection",
      description: "Y-Intersection Visualization - All Attempts",
      properties: {
        total_trails: trails.length,
        total_intersections: allIntersections.length,
        tolerance_meters: config.toleranceMeters,
        min_snap_distance_meters: config.minSnapDistanceMeters
      },
      features: [
        ...trails,
        ...intersectionPoints,
        ...connectorLines,
        ...splitPoints
      ]
    };

    // Step 5: Export visualization
    console.log('🔄 Step 5: Exporting visualization...');
    const fs = require('fs');
    
    fs.writeFileSync('test-output/y-intersection-visualization.geojson', JSON.stringify(visualizationGeoJSON, null, 2));
    console.log('📄 Visualization GeoJSON written to: test-output/y-intersection-visualization.geojson');

    // Step 6: Create summary report
    console.log('\n📊 Y-INTERSECTION ANALYSIS SUMMARY:');
    console.log(`   Total trails: ${trails.length}`);
    console.log(`   Total Y-intersections found: ${allIntersections.length}`);
    console.log(`   Average distance: ${(allIntersections.reduce((sum, i) => sum + i.distance_meters, 0) / allIntersections.length).toFixed(2)}m`);
    
    // Analyze split ratios
    const splitRatios = allIntersections.map(i => i.split_ratio);
    const nearStart = splitRatios.filter(r => r < 0.1).length;
    const nearEnd = splitRatios.filter(r => r > 0.9).length;
    const middle = splitRatios.filter(r => r >= 0.1 && r <= 0.9).length;
    
    console.log(`   Split ratios - Near start (<0.1): ${nearStart}, Middle (0.1-0.9): ${middle}, Near end (>0.9): ${nearEnd}`);
    
    // Show some examples
    console.log('\n🔍 SAMPLE Y-INTERSECTIONS:');
    allIntersections.slice(0, 5).forEach((intersection, index) => {
      console.log(`   ${index + 1}. ${intersection.visiting_trail_name} → ${intersection.visited_trail_name}`);
      console.log(`      Distance: ${intersection.distance_meters.toFixed(2)}m, Split ratio: ${intersection.split_ratio.toFixed(3)}`);
    });

    // Step 7: Cleanup
    console.log('\n🧹 Cleaning up demo schema...');
    await pool.query(`DROP SCHEMA IF EXISTS ${config.tempSchema} CASCADE`);
    console.log('   ✅ Demo schema cleaned up\n');

    console.log('✅ Y-intersection visualization completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

/**
 * Find all potential Y-intersections (same as before but without processing)
 */
async function findAllYIntersections(pool, config) {
  const query = `
    WITH trail_endpoints AS (
      SELECT
        app_uuid as trail_id,
        name as trail_name,
        ST_AsGeoJSON(ST_StartPoint(geometry))::json as start_point,
        ST_AsGeoJSON(ST_EndPoint(geometry))::json as end_point,
        geometry as trail_geom
      FROM ${config.tempSchema}.trails
      WHERE ST_Length(geometry::geography) >= $1
        AND ST_IsValid(geometry)
    ),
    y_intersections AS (
      -- Find start points near other trails (Y-intersections)
      SELECT
        e1.trail_id as visiting_trail_id,
        e1.trail_name as visiting_trail_name,
        e1.start_point as visiting_endpoint,
        e2.trail_id as visited_trail_id,
        e2.trail_name as visited_trail_name,
        e2.trail_geom as visited_trail_geom,
        ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) as distance_meters,
        ST_AsGeoJSON(ST_ClosestPoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)))::json as split_point,
        ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)) as split_ratio
      FROM trail_endpoints e1
      CROSS JOIN trail_endpoints e2
      WHERE e1.trail_id != e2.trail_id
        AND ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) <= $2
        AND ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) > $3
      UNION ALL
      -- Find end points near other trails (Y-intersections)
      SELECT
        e1.trail_id as visiting_trail_id,
        e1.trail_name as visiting_trail_name,
        e1.end_point as visiting_endpoint,
        e2.trail_id as visited_trail_id,
        e2.trail_name as visited_trail_name,
        e2.trail_geom as visited_trail_geom,
        ST_Distance(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography) as distance_meters,
        ST_AsGeoJSON(ST_ClosestPoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)))::json as split_point,
        ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)) as split_ratio
      FROM trail_endpoints e1
      CROSS JOIN trail_endpoints e2
      WHERE e1.trail_id != e2.trail_id
        AND ST_Distance(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography) <= $2
        AND ST_Distance(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography) > $3
    ),
    best_matches AS (
      SELECT DISTINCT ON (visiting_trail_id, visited_trail_id)
        visiting_trail_id,
        visiting_trail_name,
        visiting_endpoint,
        visited_trail_id,
        visited_trail_name,
        visited_trail_geom,
        distance_meters,
        split_point,
        split_ratio
      FROM y_intersections
      ORDER BY visiting_trail_id, visited_trail_id, distance_meters
    )
    SELECT * FROM best_matches
    ORDER BY distance_meters
    LIMIT 50
  `;

  const result = await pool.query(query, [
    config.minTrailLengthMeters,
    config.toleranceMeters,
    config.minSnapDistanceMeters
  ]);

  return result.rows;
}

visualizeYIntersectionAttempts();
