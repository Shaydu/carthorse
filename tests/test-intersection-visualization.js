const { Client } = require('pg');
const fs = require('fs');

// Test data from the user's example
const foothillsNorthTrail = {
  name: "Foothills North Trail",
  app_uuid: "873d19f1-26df-4b91-91ee-d1139ff88683",
  coordinates: [
    [-105.282727593, 40.070455567, 1687.336791992],
    [-105.283430657, 40.070318704, 1687.121826172],
    [-105.283899475, 40.070254488, 1687.099975586],
    [-105.284392235, 40.070307338, 1687.581542969],
    [-105.284767464, 40.070297406, 1688.423217773],
    [-105.285294652, 40.070169973, 1691.094604492],
    [-105.285540957, 40.070178377, 1691.958129883],
    [-105.285658152, 40.070160069, 1692.993164062],
    [-105.286173462, 40.069996623, 1693.963989258],
    [-105.286700986, 40.069950269, 1696.985595703],
    [-105.287052908, 40.069976428, 1698.661499023],
    [-105.28747508, 40.06997538, 1699.495117188],
    [-105.287827153, 40.070037574, 1699.94909668],
    [-105.288976702, 40.07010679, 1705.932006836],
    [-105.289164332, 40.070106322, 1707.591918945],
    [-105.289656484, 40.070014995, 1710.877929688],
    [-105.290125639, 40.070031841, 1715.303955078],
    [-105.290336496, 40.069977254, 1715.358520508],
    [-105.290547543, 40.069967716, 1718.499755859],
    [-105.290652971, 40.069940422, 1721.354125977],
    [-105.290988133, 40.069969306, 1723.668579102],
    [-105.291177042, 40.069954216, 1726.449462891],
    [-105.291243129, 40.069970456, 1726.449462891],
    [-105.291421057, 40.069978588, 1726.752563477]
  ]
};

const northSkyTrail = {
  name: "North Sky Trail", 
  app_uuid: "ab36dded-56f4-4a1d-bd16-6781586a3336",
  coordinates: [
    [-105.291193821, 40.070110007, 1731.133178711],
    [-105.29122595, 40.070040755, 1726.449462891],
    [-105.291243129, 40.069970456, 1726.449462891],
    [-105.291266876, 40.069873291, 1727.728393555],
    [-105.291296544, 40.069653513, 1728.930541992],
    [-105.291315845, 40.069611252, 1729.321533203],
    [-105.291333853, 40.069598859, 1729.321533203],
    [-105.291371229, 40.06960322, 1729.321533203],
    [-105.291398126, 40.069624179, 1729.321533203],
    [-105.291394233, 40.069694656, 1728.997192383],
    [-105.291419156, 40.06977441, 1727.890380859],
    [-105.291427745, 40.069832987, 1727.890380859],
    [-105.291421057, 40.069978588, 0]
  ]
};

async function createIntersectionVisualization() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Create test trails in staging schema
    const createTrailsQuery = `
      DROP TABLE IF EXISTS staging.test_trails;
      CREATE TABLE staging.test_trails (
        app_uuid UUID PRIMARY KEY,
        name TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        is_valid BOOLEAN DEFAULT true,
        length_m DOUBLE PRECISION,
        is_simple BOOLEAN DEFAULT true,
        original_trail_uuid UUID
      );
    `;
    
    await client.query(createTrailsQuery);
    console.log('Created test_trails table');

    // Insert the test trails
    const foothillsGeom = `LINESTRINGZ(${foothillsNorthTrail.coordinates.map(c => `${c[0]} ${c[1]} ${c[2]}`).join(', ')})`;
    const northSkyGeom = `LINESTRINGZ(${northSkyTrail.coordinates.map(c => `${c[0]} ${c[1]} ${c[2]}`).join(', ')})`;

    await client.query(`
      INSERT INTO staging.test_trails (app_uuid, name, geometry, length_m) VALUES
      ($1, $2, ST_GeomFromText($3, 4326), ST_Length(ST_GeomFromText($3, 4326)::geography)),
      ($4, $5, ST_GeomFromText($6, 4326), ST_Length(ST_GeomFromText($6, 4326)::geography))
    `, [
      foothillsNorthTrail.app_uuid, foothillsNorthTrail.name, foothillsGeom,
      northSkyTrail.app_uuid, northSkyTrail.name, northSkyGeom
    ]);

    console.log('Inserted test trails');

    // Get the intersection points and create GeoJSON
    const intersectionQuery = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t1.geometry as trail1_geom,
          t2.geometry as trail2_geom,
          ST_StartPoint(t1.geometry) as trail1_start,
          ST_EndPoint(t1.geometry) as trail1_end,
          ST_StartPoint(t2.geometry) as trail2_start,
          ST_EndPoint(t2.geometry) as trail2_end
        FROM staging.test_trails t1
        JOIN staging.test_trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_Intersects(t1.geometry, t2.geometry)
      ),
      intersection_points AS (
        SELECT 
          trail1_name,
          trail2_name,
          (ST_Dump(ST_Force3D(ST_Intersection(trail1_geom, trail2_geom)))).geom as point_geom,
          (ST_Dump(ST_Force3D(ST_Intersection(trail1_geom, trail2_geom)))).path as point_path,
          trail1_start,
          trail1_end,
          trail2_start,
          trail2_end
        FROM trail_pairs
        WHERE ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) = 'ST_MultiPoint'
      )
      SELECT 
        trail1_name,
        trail2_name,
        ST_AsGeoJSON(point_geom) as point_geojson,
        ST_X(point_geom) as lon,
        ST_Y(point_geom) as lat,
        ST_Z(point_geom) as elevation,
        -- Distance from each endpoint in meters
        ST_Distance(point_geom::geography, trail1_start::geography) as dist_from_trail1_start_m,
        ST_Distance(point_geom::geography, trail1_end::geography) as dist_from_trail1_end_m,
        ST_Distance(point_geom::geography, trail2_start::geography) as dist_from_trail2_start_m,
        ST_Distance(point_geom::geography, trail2_end::geography) as dist_from_trail2_end_m,
        -- Classification
        CASE 
          WHEN ST_DWithin(point_geom, trail1_start, 1) THEN 'near_trail1_start'
          WHEN ST_DWithin(point_geom, trail1_end, 1) THEN 'near_trail1_end'
          WHEN ST_DWithin(point_geom, trail2_start, 1) THEN 'near_trail2_start'
          WHEN ST_DWithin(point_geom, trail2_end, 1) THEN 'near_trail2_end'
          ELSE 'middle_intersection'
        END as intersection_location
      FROM intersection_points
      ORDER BY trail1_name, trail2_name, point_path;
    `;

    const result = await client.query(intersectionQuery);
    
    console.log('\n=== INTERSECTION POINTS DETECTED ===');
    
    // Create GeoJSON features for intersection points
    const intersectionFeatures = [];
    
    for (const row of result.rows) {
      console.log(`📍 ${row.intersection_location}: ${row.lon}, ${row.lat}, ${row.elevation}`);
      console.log(`   Distance from ${row.trail1_name} start: ${row.dist_from_trail1_start_m.toFixed(2)}m`);
      console.log(`   Distance from ${row.trail1_name} end: ${row.dist_from_trail1_end_m.toFixed(2)}m`);
      console.log(`   Distance from ${row.trail2_name} start: ${row.dist_from_trail2_start_m.toFixed(2)}m`);
      console.log(`   Distance from ${row.trail2_name} end: ${row.dist_from_trail2_end_m.toFixed(2)}m`);
      console.log('---');
      
      // Parse the GeoJSON and create a feature
      const pointGeoJSON = JSON.parse(row.point_geojson);
      
      intersectionFeatures.push({
        type: "Feature",
        geometry: pointGeoJSON,
        properties: {
          name: `${row.trail1_name} ↔ ${row.trail2_name} intersection`,
          trail1_name: row.trail1_name,
          trail2_name: row.trail2_name,
          intersection_location: row.intersection_location,
          elevation: row.elevation,
          dist_from_trail1_start_m: Math.round(row.dist_from_trail1_start_m * 100) / 100,
          dist_from_trail1_end_m: Math.round(row.dist_from_trail1_end_m * 100) / 100,
          dist_from_trail2_start_m: Math.round(row.dist_from_trail2_start_m * 100) / 100,
          dist_from_trail2_end_m: Math.round(row.dist_from_trail2_end_m * 100) / 100,
          marker_color: "#FF8C00", // Orange color
          marker_size: "medium"
        }
      });
    }

    // Also get the trail geometries for context
    const trailsQuery = `
      SELECT 
        name,
        ST_AsGeoJSON(geometry) as trail_geojson,
        app_uuid
      FROM staging.test_trails
      ORDER BY name;
    `;

    const trailsResult = await client.query(trailsQuery);
    
    const trailFeatures = [];
    for (const row of trailsResult.rows) {
      const trailGeoJSON = JSON.parse(row.trail_geojson);
      trailFeatures.push({
        type: "Feature",
        geometry: trailGeoJSON,
        properties: {
          name: row.name,
          app_uuid: row.app_uuid,
          stroke: "#0000FF", // Blue for trails
          stroke_width: 3
        }
      });
    }

    // Create the complete GeoJSON
    const geoJSON = {
      type: "FeatureCollection",
      features: [...trailFeatures, ...intersectionFeatures]
    };

    // Write to file
    const filename = 'foothills-north-sky-intersections.geojson';
    fs.writeFileSync(filename, JSON.stringify(geoJSON, null, 2));
    console.log(`\n✅ Created GeoJSON visualization: ${filename}`);
    console.log(`   - ${trailFeatures.length} trail features (blue lines)`);
    console.log(`   - ${intersectionFeatures.length} intersection points (orange markers)`);

    // Clean up
    await client.query('DROP TABLE IF EXISTS staging.test_trails');
    console.log('\nCleaned up test data');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

createIntersectionVisualization();
