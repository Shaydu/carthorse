#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Bounding box coordinates for filtering
const bbox = {
  minLng: -105.28122955793897,
  maxLng: -105.23604178494656,
  minLat: 40.068313334562816,
  maxLat: 40.098317098641445
};

// Colors for different feature types
const colors = {
  nodes: '#FF0000',      // Red for nodes
  edges: '#0000FF',      // Blue for edges  
  trails: '#00FF00',     // Green for trails
  intersections: '#FFA500' // Orange for intersections
};

function createPointFeature(lat, lng, properties = {}) {
  return {
    type: "Feature",
    properties: {
      ...properties,
      color: properties.feature_type === 'intersection' ? colors.intersections : colors.nodes
    },
    geometry: {
      type: "Point",
      coordinates: [lng, lat]
    }
  };
}

function createLineStringFeature(coordinates, properties = {}) {
  return {
    type: "Feature",
    properties: {
      ...properties,
      color: colors.trails
    },
    geometry: {
      type: "LineString",
      coordinates: coordinates
    }
  };
}

function isPointInBbox(lat, lng) {
  return lng >= bbox.minLng && lng <= bbox.maxLng && 
         lat >= bbox.minLat && lat <= bbox.maxLat;
}

function isLineInBbox(coordinates) {
  return coordinates.some(coord => isPointInBbox(coord[1], coord[0]));
}

// Simple intersection detection
function findTrailIntersections(trails) {
  const intersections = [];
  const tolerance = 0.0001; // About 10 meters
  
  for (let i = 0; i < trails.length; i++) {
    for (let j = i + 1; j < trails.length; j++) {
      const trail1 = trails[i];
      const trail2 = trails[j];
      
      if (!trail1.coordinates || !trail2.coordinates) continue;
      
      // Check if trails have overlapping bounding boxes
      const overlap = !(trail1.bbox_max_lng < trail2.bbox_min_lng || 
                       trail1.bbox_min_lng > trail2.bbox_max_lng ||
                       trail1.bbox_max_lat < trail2.bbox_min_lat || 
                       trail1.bbox_min_lat > trail2.bbox_max_lat);
      
      if (overlap) {
        // Find closest points between trails
        let minDistance = Infinity;
        let closestPoint = null;
        
        for (const coord1 of trail1.coordinates) {
          for (const coord2 of trail2.coordinates) {
            const distance = Math.sqrt(
              Math.pow(coord1[0] - coord2[0], 2) + 
              Math.pow(coord1[1] - coord2[1], 2)
            );
            
            if (distance < minDistance && distance < tolerance) {
              minDistance = distance;
              closestPoint = [(coord1[0] + coord2[0]) / 2, (coord1[1] + coord2[1]) / 2];
            }
          }
        }
        
        if (closestPoint && isPointInBbox(closestPoint[1], closestPoint[0])) {
          intersections.push({
            lat: closestPoint[1],
            lng: closestPoint[0],
            trail1: trail1.name,
            trail2: trail2.name,
            distance: minDistance
          });
        }
      }
    }
  }
  
  return intersections;
}

async function extractData() {
  const dbPath = path.resolve(__dirname, 'boulder-final-export.db');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database file not found: ${dbPath}`);
    process.exit(1);
  }

  console.log('🔍 Opening database...');
  const db = new sqlite3.Database(dbPath);
  
  const features = [];
  let trailCount = 0;
  let intersectionCount = 0;

  return new Promise((resolve, reject) => {
    // Extract trails
    console.log('🛤️  Extracting trails...');
    db.all(`
      SELECT app_uuid, name, length_km, elevation_gain, elevation_loss, 
             bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, geojson
      FROM trails 
      WHERE bbox_min_lng <= ? AND bbox_max_lng >= ?
      AND bbox_min_lat <= ? AND bbox_max_lat >= ?
      AND geojson IS NOT NULL
    `, [bbox.maxLng, bbox.minLng, bbox.maxLat, bbox.minLat], (err, trails) => {
      if (err) {
        console.error('❌ Error querying trails:', err);
        reject(err);
        return;
      }

      console.log(`📊 Found ${trails.length} trails in bounding box`);
      
      const validTrails = [];
      
      trails.forEach(trail => {
        try {
          const geojson = JSON.parse(trail.geojson);
          if (geojson.coordinates && isLineInBbox(geojson.coordinates)) {
            features.push(createLineStringFeature(geojson.coordinates, {
              app_uuid: trail.app_uuid,
              trail_name: trail.name,
              length_km: trail.length_km,
              elevation_gain: trail.elevation_gain,
              elevation_loss: trail.elevation_loss,
              feature_type: 'trail'
            }));
            
            validTrails.push({
              ...trail,
              coordinates: geojson.coordinates
            });
            
            trailCount++;
          }
        } catch (parseErr) {
          console.warn('⚠️  Could not parse trail geojson:', parseErr.message);
        }
      });

      console.log(`✅ Added ${trailCount} trails to visualization`);
      
      // Find intersections
      console.log('🔍 Finding trail intersections...');
      const intersections = findTrailIntersections(validTrails);
      
      intersections.forEach(intersection => {
        features.push(createPointFeature(intersection.lat, intersection.lng, {
          trail1: intersection.trail1,
          trail2: intersection.trail2,
          distance: intersection.distance,
          feature_type: 'intersection'
        }));
        intersectionCount++;
      });

      console.log(`✅ Found ${intersectionCount} intersections`);

      // Check for orphan nodes (nodes without edges)
      console.log('🔍 Checking for orphan nodes...');
      db.get('SELECT COUNT(*) as count FROM routing_nodes', (err, result) => {
        if (err) {
          console.log('   ⚠️  No routing_nodes table found');
        } else {
          console.log(`   📊 Routing nodes: ${result.count}`);
        }
        
        db.get('SELECT COUNT(*) as count FROM routing_edges', (err, result) => {
          if (err) {
            console.log('   ⚠️  No routing_edges table found');
          } else {
            console.log(`   📊 Routing edges: ${result.count}`);
          }
          
          // Close database and create output
          db.close((err) => {
            if (err) {
              console.error('❌ Error closing database:', err);
              reject(err);
              return;
            }

            const geojsonOutput = {
              type: "FeatureCollection",
              features: features
            };

            const outputPath = path.resolve(__dirname, 'boulder-visualization.geojson');
            fs.writeFileSync(outputPath, JSON.stringify(geojsonOutput, null, 2));

            console.log('✅ Extraction completed!');
            console.log(`🛤️  Trails: ${trailCount}`);
            console.log(`🔍 Intersections: ${intersectionCount}`);
            console.log(`📊 Total features: ${features.length}`);
            console.log(`📁 Output saved to: ${outputPath}`);
            console.log('');
            console.log('🎨 Color coding:');
            console.log(`   🟢 Green: ${trailCount} trails`);
            console.log(`   🟠 Orange: ${intersectionCount} intersections`);
            console.log('');
            console.log('🌐 Open boulder-visualization.geojson in geojson.io to visualize!');
            console.log('');
            console.log('📋 Database validity summary:');
            console.log(`   ✅ ${trailCount} valid trails found in bounding box`);
            console.log(`   🔍 ${intersectionCount} potential intersections detected`);
            console.log(`   ⚠️  No routing nodes/edges found (database may need routing graph generation)`);

            resolve();
          });
        });
      });
    });
  });
}

// Run the extraction
extractData().catch(err => {
  console.error('❌ Extraction failed:', err);
  process.exit(1);
}); 