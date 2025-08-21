const { Client } = require('pg');
const fs = require('fs');

async function installEnhancedFunction() {
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

    // Read and install the enhanced function
    const functionSql = fs.readFileSync('sql/organized/functions/enhanced-intersection-splitting.sql', 'utf8');
    
    console.log('Installing enhanced intersection splitting function...');
    await client.query(functionSql);
    console.log('✅ Enhanced function installed successfully');

    // Test the function with a small dataset
    console.log('\nTesting enhanced function with small dataset...');
    
    // Create a test staging schema
    const testSchema = `test_enhanced_${Date.now()}`;
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Create trails table in test schema
    await client.query(`
      CREATE TABLE ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        osm_id TEXT,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source_tags JSONB,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        source TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);

    // Create intersection_points table
    await client.query(`
      CREATE TABLE ${testSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326),
        point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters REAL
      )
    `);

    // Insert test trails (North Sky and Foothills North)
    const northSkyTrail = {
      "type": "Feature",
      "properties": {
        "id": "ab36dded-56f4-4a1d-bd16-6781586a3336",
        "name": "North Sky Trail",
        "length_meters": 106.28836983903227
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
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
          [-105.291421057, 40.069978588, 1726.752563477]
        ]
      }
    };

    const foothillsNorthTrail = {
      "type": "Feature",
      "properties": {
        "id": "c55c0383-f02c-4761-aebe-26098441802d",
        "name": "Foothills North Trail",
        "length_meters": 833.6713479390932
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
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
          [-105.291421057, 40.069978588, 1726.752563477],
          [-105.29149735, 40.069947311, 1727.308837891],
          [-105.291532339, 40.069902174, 1727.308837891],
          [-105.291624656, 40.069550564, 1734.462280273],
          [-105.291612545, 40.069460498, 1735.524536133],
          [-105.291670757, 40.069361246, 1738.508422852]
        ]
      }
    };

    await client.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, length_km, geometry)
      VALUES 
        ($1, $2, $3, ST_GeomFromGeoJSON($4)),
        ($5, $6, $7, ST_GeomFromGeoJSON($8))
    `, [
      northSkyTrail.properties.id,
      northSkyTrail.properties.name,
      northSkyTrail.properties.length_meters / 1000,
      JSON.stringify(northSkyTrail.geometry),
      foothillsNorthTrail.properties.id,
      foothillsNorthTrail.properties.name,
      foothillsNorthTrail.properties.length_meters / 1000,
      JSON.stringify(foothillsNorthTrail.geometry)
    ]);

    console.log('Test trails inserted');

    // Test the enhanced function
    const result = await client.query(`
      SELECT * FROM public.replace_trails_with_split_trails_enhanced($1, $2)
    `, [testSchema, 2.0]);

    console.log('Enhanced function result:', result.rows[0]);

    // Check the results
    const splitTrails = await client.query(`
      SELECT name, ST_Length(geometry::geography) as length_meters
      FROM ${testSchema}.trails
      ORDER BY name
    `);

    console.log('\nSplit trails:');
    splitTrails.rows.forEach(row => {
      console.log(`  ${row.name}: ${row.length_meters}m`);
    });

    // Clean up test schema
    await client.query(`DROP SCHEMA ${testSchema} CASCADE`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

installEnhancedFunction().catch(console.error);

