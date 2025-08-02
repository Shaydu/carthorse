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

function isPointInBbox(lat, lng) {
  return lng >= bbox.minLng && lng <= bbox.maxLng && 
         lat >= bbox.minLat && lat <= bbox.maxLat;
}

function isLineInBbox(coordinates) {
  return coordinates.some(coord => isPointInBbox(coord[1], coord[0]));
}

async function checkTrailCoordinates() {
  const dbPath = path.resolve(__dirname, 'boulder-final-export.db');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database file not found: ${dbPath}`);
    process.exit(1);
  }

  console.log('🔍 Checking trail coordinates...');
  const db = new sqlite3.Database(dbPath);
  
  return new Promise((resolve, reject) => {
    // Get coordinate ranges
    db.get(`
      SELECT 
        MIN(bbox_min_lng) as min_lng,
        MAX(bbox_max_lng) as max_lng,
        MIN(bbox_min_lat) as min_lat,
        MAX(bbox_max_lat) as max_lat,
        COUNT(*) as total_trails
      FROM trails
    `, (err, result) => {
      if (err) {
        console.error('❌ Error getting coordinate ranges:', err);
        reject(err);
        return;
      }
      
      console.log('📊 Database coordinate ranges:');
      console.log(`   Longitude: ${result.min_lng} to ${result.max_lng}`);
      console.log(`   Latitude: ${result.min_lat} to ${result.max_lat}`);
      console.log(`   Total trails: ${result.total_trails}`);
      console.log('');
      console.log('🎯 Target bounding box:');
      console.log(`   Longitude: ${bbox.minLng} to ${bbox.maxLng}`);
      console.log(`   Latitude: ${bbox.minLat} to ${bbox.maxLat}`);
      console.log('');
      
      // Check for trails in our bounding box
      db.get(`
        SELECT COUNT(*) as count
        FROM trails 
        WHERE bbox_min_lng <= ? AND bbox_max_lng >= ?
        AND bbox_min_lat <= ? AND bbox_max_lat >= ?
      `, [bbox.maxLng, bbox.minLng, bbox.maxLat, bbox.minLat], (err, bboxResult) => {
        if (err) {
          console.error('❌ Error checking bounding box:', err);
          reject(err);
          return;
        }
        
        console.log(`📍 Trails in bounding box: ${bboxResult.count}`);
        
        if (bboxResult.count > 0) {
          // Get sample trails in bounding box
          db.all(`
            SELECT name, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
            FROM trails 
            WHERE bbox_min_lng <= ? AND bbox_max_lng >= ?
            AND bbox_min_lat <= ? AND bbox_max_lat >= ?
            LIMIT 5
          `, [bbox.maxLng, bbox.minLng, bbox.maxLat, bbox.minLat], (err, samples) => {
            if (!err && samples.length > 0) {
              console.log('📋 Sample trails in bounding box:');
              samples.forEach((trail, i) => {
                console.log(`   ${i + 1}. ${trail.name}`);
                console.log(`      Bbox: (${trail.bbox_min_lng}, ${trail.bbox_min_lat}) to (${trail.bbox_max_lng}, ${trail.bbox_max_lat})`);
              });
            }
            
            db.close();
            resolve();
          });
        } else {
          console.log('❌ No trails found in the specified bounding box!');
          console.log('💡 Try expanding the bounding box or check if the coordinates are correct.');
          db.close();
          resolve();
        }
      });
    });
  });
}

// Run the check
checkTrailCoordinates().catch(err => {
  console.error('❌ Check failed:', err);
  process.exit(1);
}); 