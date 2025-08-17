#!/usr/bin/env node
/**
 * Convert SQL Prototype Results to GeoJSON (Proper PostGIS Method)
 * 
 * Runs the prototype SQL and converts the results to GeoJSON format using PostGIS ST_AsGeoJSON
 */

const { Client } = require('pg');
const fs = require('fs');

async function convertSqlToGeoJSON() {
  console.log('🗺️ Converting SQL prototype results to GeoJSON...');
  
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'shaydu',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'trail_master_db'
  });

  try {
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL database');

    // Modified SQL query that outputs GeoJSON directly
    const geoJsonSql = `
      WITH 
      -- Get the actual coordinates and round them to 6 decimal places (like prototype 1)
      actual_enchanted_mesa AS (
        SELECT ST_GeomFromText('LINESTRING(-105.281535 39.994968,-105.281456 39.995011,-105.281023 39.995156,-105.280708 39.995391,-105.280509 39.995473,-105.280275 39.995528,-105.279584 39.995565,-105.278753 39.995702,-105.278612 39.995676,-105.278518 39.995622,-105.278271 39.995352,-105.278141 39.995028,-105.27814 39.994929,-105.278187 39.99483,-105.27828 39.994712,-105.279016 39.99417,-105.279261 39.993935,-105.279669 39.993628,-105.280313 39.993329,-105.280663 39.993193,-105.281049 39.993075,-105.281119 39.993012,-105.281457 39.992488,-105.281655 39.992263,-105.281667 39.9922,-105.28169 39.992181,-105.281689 39.991884,-105.281757 39.991298,-105.281707 39.990596,-105.281718 39.990524,-105.281788 39.990406,-105.281764 39.990253,-105.281869 39.990127,-105.281881 39.990082,-105.281891 39.989856,-105.281855 39.989622,-105.28189 39.989505,-105.28203 39.989352,-105.282087 39.989054,-105.282168 39.988793,-105.282261 39.988675,-105.282331 39.988621,-105.282387 39.988581,-105.282425 39.988585,-105.282647 39.98853,-105.282858 39.988503,-105.283104 39.988502,-105.283385 39.988456,-105.283595 39.988303,-105.284156 39.988049,-105.284332 39.98794,-105.28439 39.987859,-105.284448 39.987715,-105.284494 39.987661,-105.284623 39.987597,-105.284717 39.987579,-105.285361 39.987596,-105.285645 39.987574)') AS geom
      ),
      actual_enchanted_kohler AS (
        SELECT ST_GeomFromText('LINESTRING(-105.280213 39.987924,-105.28033 39.987927,-105.280452 39.987899,-105.280589 39.987885,-105.280674 39.987892,-105.280816 39.987867,-105.280881 39.987874,-105.281039 39.987855,-105.281202 39.987849,-105.281358 39.987886,-105.281479 39.987875,-105.281601 39.987875,-105.281648 39.987865,-105.281702 39.987842,-105.281749 39.987836,-105.281859 39.98784,-105.281927 39.987858,-105.282005 39.987866,-105.282025 39.987875,-105.282037 39.987898,-105.28206 39.987993,-105.282056 39.988036,-105.282078 39.988102,-105.282084 39.988191,-105.282109 39.988239,-105.282114 39.988305,-105.282124 39.988335,-105.282185 39.988407,-105.282257 39.988433,-105.282313 39.98847,-105.282387 39.988581)') AS geom
      ),
      -- snap them with a tolerance (1e-6 ~ 0.1m at this latitude) - EXACT SAME LOGIC AS PROTOTYPE 1
      snapped AS (
        SELECT 
          ST_Snap(actual_enchanted_mesa.geom, actual_enchanted_kohler.geom, 1e-6) AS enchanted_mesa_geom,
          ST_Snap(actual_enchanted_kohler.geom, actual_enchanted_mesa.geom, 1e-6) AS enchanted_kohler_geom
        FROM actual_enchanted_mesa, actual_enchanted_kohler
      ),
      -- get intersection points - EXACT SAME LOGIC AS PROTOTYPE 1
      ix AS (
        SELECT (ST_Dump(ST_Intersection(enchanted_mesa_geom, enchanted_kohler_geom))).geom AS pt
        FROM snapped
      ),
      -- split both lines at intersection points - EXACT SAME LOGIC AS PROTOTYPE 1
      split_enchanted_mesa AS (
        SELECT (ST_Dump(ST_Split(enchanted_mesa_geom, pt))).geom AS geom
        FROM snapped, ix
      ),
      split_enchanted_kohler AS (
        SELECT (ST_Dump(ST_Split(enchanted_kohler_geom, pt))).geom AS geom
        FROM snapped, ix
      )
      -- final union of split trail segments with GeoJSON output
      SELECT 
        'Enchanted Mesa Trail (Actual Coords - Rounded)' AS trail_name, 
        ST_AsGeoJSON(geom) as geojson,
        ST_Length(geom::geography) as length_meters 
      FROM split_enchanted_mesa
      UNION ALL
      SELECT 
        'Enchanted-Kohler Spur Trail (Actual Coords - Rounded)' AS trail_name, 
        ST_AsGeoJSON(geom) as geojson,
        ST_Length(geom::geography) as length_meters 
      FROM split_enchanted_kohler
      ORDER BY trail_name, length_meters DESC
    `;
    
    console.log('📄 Executing prototype SQL with GeoJSON output...');
    const result = await pgClient.query(geoJsonSql);
    
    console.log(`📊 Found ${result.rows.length} trail segments`);

    // Convert to GeoJSON FeatureCollection
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row, index) => ({
        type: 'Feature',
        id: index + 1,
        properties: {
          trail_name: row.trail_name,
          length_meters: row.length_meters,
          segment_id: index + 1
        },
        geometry: JSON.parse(row.geojson)
      }))
    };

    // Save to file
    const outputPath = './test-output/enchanted-splitting-prototype-2-results.geojson';
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ GeoJSON saved to: ${outputPath}`);
    console.log('\n📋 Trail Segments Summary:');
    result.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.trail_name}: ${row.length_meters.toFixed(2)}m`);
    });

    // Also create a simple HTML viewer
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Enchanted Mesa Trail Splitting Results</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.7.1/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.7.1/dist/leaflet.js"></script>
    <style>
        body { margin: 0; padding: 0; }
        #map { height: 100vh; width: 100%; }
        .info { position: absolute; top: 10px; left: 10px; z-index: 1000; background: white; padding: 10px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.3); }
    </style>
</head>
<body>
    <div id="map"></div>
    <div class="info">
        <h3>Prototype 2 Results</h3>
        <p>Enchanted Mesa and Kohler Trail Splitting</p>
        <p>Total segments: ${result.rows.length}</p>
    </div>
    <script>
        const map = L.map('map').setView([39.99, -105.28], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        const trailData = ${JSON.stringify(geojson)};
        
        const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];
        
        trailData.features.forEach((feature, index) => {
            const color = colors[index % colors.length];
            L.geoJSON(feature, {
                style: {
                    color: color,
                    weight: 4,
                    opacity: 0.8
                }
            }).addTo(map).bindPopup(\`
                <b>\${feature.properties.trail_name}</b><br>
                Length: \${feature.properties.length_meters.toFixed(2)}m<br>
                Segment: \${feature.properties.segment_id}
            \`);
        });
    </script>
</body>
</html>`;

    const htmlPath = './test-output/enchanted-splitting-prototype-2-viewer.html';
    fs.writeFileSync(htmlPath, htmlContent);
    console.log(`✅ HTML viewer saved to: ${htmlPath}`);

    return geojson;

  } catch (error) {
    console.error('❌ Error converting SQL to GeoJSON:', error.message);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the script
if (require.main === module) {
  convertSqlToGeoJSON()
    .then(() => {
      console.log('🎉 Script completed successfully');
      console.log('\n📁 Files created:');
      console.log('  - test-output/enchanted-splitting-prototype-2-results.geojson');
      console.log('  - test-output/enchanted-splitting-prototype-2-viewer.html');
      console.log('\n🌐 Open the HTML file in your browser to view the results!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { convertSqlToGeoJSON };
