#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function verifyRouteRecommendations(dbPath) {
  console.log(`🔍 Verifying route recommendations in: ${dbPath}`);
  
  const db = new sqlite3.Database(dbPath);
  
  return new Promise((resolve, reject) => {
    // Check if database exists and has route_recommendations table
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='route_recommendations'", (err, row) => {
      if (err) {
        console.error('❌ Database error:', err.message);
        reject(err);
        return;
      }
      
      if (!row) {
        console.error('❌ No route_recommendations table found');
        reject(new Error('No route_recommendations table'));
        return;
      }
      
      console.log('✅ Route recommendations table exists');
      
      // Get total count
      db.get("SELECT COUNT(*) as count FROM route_recommendations", (err, row) => {
        if (err) {
          console.error('❌ Error counting recommendations:', err.message);
          reject(err);
          return;
        }
        
        const totalCount = row.count;
        console.log(`📊 Total route recommendations: ${totalCount}`);
        
        if (totalCount === 0) {
          console.log('❌ No route recommendations found - export may have failed');
          db.close();
          reject(new Error('No route recommendations generated'));
          return;
        }
        
        // Get detailed statistics
        db.all(`
          SELECT 
            route_shape,
            COUNT(*) as count,
            AVG(recommended_distance_km) as avg_distance,
            AVG(recommended_elevation_gain) as avg_elevation,
            AVG(route_score) as avg_score,
            MIN(recommended_distance_km) as min_distance,
            MAX(recommended_distance_km) as max_distance,
            MIN(recommended_elevation_gain) as min_elevation,
            MAX(recommended_elevation_gain) as max_elevation
          FROM route_recommendations 
          GROUP BY route_shape
          ORDER BY count DESC
        `, (err, rows) => {
          if (err) {
            console.error('❌ Error getting statistics:', err.message);
            reject(err);
            return;
          }
          
          console.log('\n📈 Route Recommendations by Shape:');
          rows.forEach(row => {
            console.log(`   ${row.route_shape}:`);
            console.log(`     - Count: ${row.count}`);
            console.log(`     - Distance: ${row.min_distance?.toFixed(1)}-${row.max_distance?.toFixed(1)}km (avg: ${row.avg_distance?.toFixed(1)}km)`);
            console.log(`     - Elevation: ${row.min_elevation?.toFixed(0)}-${row.max_elevation?.toFixed(0)}m (avg: ${row.avg_elevation?.toFixed(0)}m)`);
            console.log(`     - Score: ${row.avg_score?.toFixed(2)}`);
          });
          
          // Check for route names
          db.get("SELECT COUNT(*) as count FROM route_recommendations WHERE route_name IS NOT NULL", (err, row) => {
            if (err) {
              console.error('❌ Error checking route names:', err.message);
              reject(err);
              return;
            }
            
            console.log(`\n🏷️  Route Names: ${row.count}/${totalCount} have names`);
            
            // Show sample recommendations
            db.all(`
              SELECT 
                route_name,
                route_shape,
                recommended_distance_km,
                recommended_elevation_gain,
                route_score,
                trail_count
              FROM route_recommendations 
              ORDER BY route_score DESC 
              LIMIT 10
            `, (err, rows) => {
              if (err) {
                console.error('❌ Error getting samples:', err.message);
                reject(err);
                return;
              }
              
              console.log('\n🏆 Top 10 Route Recommendations:');
              rows.forEach((rec, i) => {
                console.log(`   ${i + 1}. ${rec.route_name || 'Unnamed Route'}`);
                console.log(`      - Shape: ${rec.route_shape}`);
                console.log(`      - Distance: ${rec.recommended_distance_km?.toFixed(1)}km`);
                console.log(`      - Elevation: ${rec.recommended_elevation_gain?.toFixed(0)}m`);
                console.log(`      - Score: ${rec.route_score?.toFixed(1)}`);
                console.log(`      - Trails: ${rec.trail_count}`);
              });
              
              // Check for data quality issues
              db.all(`
                SELECT 
                  COUNT(*) as null_names,
                  COUNT(CASE WHEN route_name = '' THEN 1 END) as empty_names,
                  COUNT(CASE WHEN recommended_distance_km <= 0 THEN 1 END) as invalid_distance,
                  COUNT(CASE WHEN recommended_elevation_gain < 0 THEN 1 END) as invalid_elevation,
                  COUNT(CASE WHEN route_score < 0 OR route_score > 100 THEN 1 END) as invalid_score
                FROM route_recommendations
              `, (err, rows) => {
                if (err) {
                  console.error('❌ Error checking data quality:', err.message);
                  reject(err);
                  return;
                }
                
                const quality = rows[0];
                console.log('\n🔍 Data Quality Check:');
                console.log(`   - Null names: ${quality.null_names}`);
                console.log(`   - Empty names: ${quality.empty_names}`);
                console.log(`   - Invalid distance: ${quality.invalid_distance}`);
                console.log(`   - Invalid elevation: ${quality.invalid_elevation}`);
                console.log(`   - Invalid score: ${quality.invalid_score}`);
                
                const issues = quality.null_names + quality.empty_names + quality.invalid_distance + quality.invalid_elevation + quality.invalid_score;
                
                if (issues === 0) {
                  console.log('✅ All data quality checks passed');
                } else {
                  console.log(`⚠️  Found ${issues} data quality issues`);
                }
                
                console.log('\n✅ Route recommendations verification complete!');
                db.close();
                resolve({
                  totalCount,
                  shapeStats: rows,
                  qualityIssues: issues
                });
              });
            });
          });
        });
      });
    });
  });
}

// If run directly, check the Boulder database
if (require.main === module) {
  const dbPath = path.join(__dirname, 'api-service', 'data', 'boulder.db');
  verifyRouteRecommendations(dbPath)
    .then(result => {
      console.log(`\n🎉 Verification successful! Found ${result.totalCount} route recommendations`);
      process.exit(0);
    })
    .catch(error => {
      console.error(`\n❌ Verification failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { verifyRouteRecommendations }; 