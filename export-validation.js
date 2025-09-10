const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const dbPath = '/Users/shaydu/dev/carthorse/test-output/boulder.db';

// Export trails as GeoJSON
function exportTrails() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all(`
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
        geojson
      FROM trails 
      WHERE geojson IS NOT NULL AND geojson != ''
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      const features = rows.map(row => {
        const geometry = JSON.parse(row.geojson);
        return {
          type: "Feature",
          properties: {
            app_uuid: row.app_uuid,
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
          geometry: geometry
        };
      });
      
      const geojson = {
        type: "FeatureCollection",
        features: features
      };
      
      fs.writeFileSync('/Users/shaydu/dev/carthorse/test-output/boulder-trails-validation.geojson', 
                      JSON.stringify(geojson, null, 2));
      
      console.log(`✅ Exported ${features.length} trails to boulder-trails-validation.geojson`);
      db.close();
      resolve();
    });
  });
}

// Export route analysis as GeoJSON (these contain route data)
function exportRoutes() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    
    db.all(`
      SELECT 
        route_uuid,
        route_name,
        edge_count,
        unique_trail_count,
        total_distance_km,
        total_elevation_gain_m,
        out_and_back_distance_km,
        out_and_back_elevation_gain_m,
        constituent_analysis_json
      FROM route_analysis
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      const features = rows.map(row => {
        // Parse the constituent analysis to get route geometry
        let geometry = null;
        try {
          const analysis = JSON.parse(row.constituent_analysis_json);
          if (analysis && analysis.route_geometry) {
            geometry = JSON.parse(analysis.route_geometry);
          }
        } catch (e) {
          console.log(`Warning: Could not parse route geometry for ${row.route_uuid}`);
        }
        
        return {
          type: "Feature",
          properties: {
            route_uuid: row.route_uuid,
            route_name: row.route_name,
            edge_count: row.edge_count,
            unique_trail_count: row.unique_trail_count,
            total_distance_km: row.total_distance_km,
            total_elevation_gain_m: row.total_elevation_gain_m,
            out_and_back_distance_km: row.out_and_back_distance_km,
            out_and_back_elevation_gain_m: row.out_and_back_elevation_gain_m
          },
          geometry: geometry
        };
      }).filter(feature => feature.geometry !== null);
      
      const geojson = {
        type: "FeatureCollection",
        features: features
      };
      
      fs.writeFileSync('/Users/shaydu/dev/carthorse/test-output/boulder-routes-validation.geojson', 
                      JSON.stringify(geojson, null, 2));
      
      console.log(`✅ Exported ${features.length} routes to boulder-routes-validation.geojson`);
      db.close();
      resolve();
    });
  });
}

// Run exports
async function main() {
  try {
    await exportTrails();
    await exportRoutes();
    console.log('🎉 Validation GeoJSON exports completed!');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main();
