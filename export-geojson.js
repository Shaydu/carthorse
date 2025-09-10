const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: 'localhost',
  user: 'carthorse',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

const stagingSchema = 'carthorse_1757465639927';

async function exportTrails() {
  console.log('🛤️ Exporting trails as GeoJSON...');
  
  const query = `
    SELECT 
      app_uuid,
      name,
      region,
      osm_id,
      trail_type,
      surface_type,
      difficulty,
      length_km,
      elevation_gain,
      elevation_loss,
      max_elevation,
      min_elevation,
      avg_elevation,
      ST_AsGeoJSON(geometry, 6) as geojson
    FROM ${stagingSchema}.trails 
    WHERE geometry IS NOT NULL
    ORDER BY name;
  `;
  
  const result = await pool.query(query);
  
  const features = result.rows.map(row => ({
    type: "Feature",
    properties: {
      id: row.app_uuid,
      name: row.name,
      region: row.region,
      osm_id: row.osm_id,
      trail_type: row.trail_type,
      surface_type: row.surface_type,
      difficulty: row.difficulty,
      length_km: row.length_km,
      elevation_gain: row.elevation_gain,
      elevation_loss: row.elevation_loss,
      max_elevation: row.max_elevation,
      min_elevation: row.min_elevation,
      avg_elevation: row.avg_elevation
    },
    geometry: JSON.parse(row.geojson)
  }));
  
  const geojson = {
    type: "FeatureCollection",
    features: features
  };
  
  fs.writeFileSync('boulder-trails.geojson', JSON.stringify(geojson, null, 2));
  console.log(`✅ Exported ${features.length} trails to boulder-trails.geojson`);
}

async function exportRoutes() {
  console.log('🛣️ Exporting routes as GeoJSON...');
  
  const query = `
    SELECT 
      route_uuid,
      region,
      route_name,
      route_shape,
      recommended_length_km,
      recommended_elevation_gain,
      route_score,
      trail_count,
      ST_AsGeoJSON(route_geometry, 6) as geojson
    FROM ${stagingSchema}.route_recommendations 
    WHERE route_geometry IS NOT NULL
    ORDER BY recommended_length_km DESC;
  `;
  
  const result = await pool.query(query);
  
  const features = result.rows.map(row => ({
    type: "Feature",
    properties: {
      id: row.route_uuid,
      name: row.route_name,
      region: row.region,
      shape: row.route_shape,
      length_km: row.recommended_length_km,
      elevation_gain: row.recommended_elevation_gain,
      score: row.route_score,
      trail_count: row.trail_count
    },
    geometry: JSON.parse(row.geojson)
  }));
  
  const geojson = {
    type: "FeatureCollection",
    features: features
  };
  
  fs.writeFileSync('boulder-routes.geojson', JSON.stringify(geojson, null, 2));
  console.log(`✅ Exported ${features.length} routes to boulder-routes.geojson`);
}

async function main() {
  try {
    await exportTrails();
    await exportRoutes();
    console.log('\n🎉 GeoJSON export completed successfully!');
    console.log('📁 Files created:');
    console.log('   - boulder-trails.geojson (trails)');
    console.log('   - boulder-routes.geojson (routes)');
  } catch (error) {
    console.error('❌ Export failed:', error);
  } finally {
    await pool.end();
  }
}

main();
