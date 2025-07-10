const Database = require('better-sqlite3');
const path = require('path');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const trailIndex = args.indexOf('--trail');
  let trailName = null;
  
  if (trailIndex !== -1 && trailIndex + 1 < args.length) {
    trailName = args[trailIndex + 1];
  }
  
  return { trailName };
}

// Parse --db argument
let dbPath = null;
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--db' && process.argv[i + 1]) {
    dbPath = process.argv[i + 1];
  }
}
if (!dbPath) {
  console.error('Usage: node calculate_elevation_stats_3d.js --db <database_path>');
  process.exit(1);
}
if (!path.isAbsolute(dbPath)) {
  dbPath = path.resolve(process.cwd(), dbPath);
}

// Initialize database connection - use current database
const db = new Database(dbPath);

// Configuration
const BATCH_SIZE = 500;

const { trailName } = parseArgs();

console.log('🔄 Starting 3D elevation stats calculation...');
console.log(`📂 Using database: ${dbPath}`);
if (trailName) {
  console.log(`🎯 Targeting specific trail: "${trailName}"`);
}

try {
    // Load SpatiaLite extension with correct path
    db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Get total count of trails to process
    let totalTrails;
    if (trailName) {
      totalTrails = db.prepare(`
          SELECT COUNT(*) as count
          FROM trails 
          WHERE name = ? AND geometry IS NOT NULL
      `).get(trailName).count;
    } else {
      totalTrails = db.prepare(`
          SELECT COUNT(*) as count
          FROM trails 
          WHERE geometry IS NOT NULL
      `).get().count;
    }

    console.log(`📊 Found ${totalTrails} trails with geometry data to process`);

    // Prepare statements - use ST_AsText to get coordinates from geometry blob
    let getTrailsBatch;
    if (trailName) {
      getTrailsBatch = db.prepare(`
          SELECT app_uuid, name, ST_AsText(geometry) as coords
          FROM trails 
          WHERE name = ? AND geometry IS NOT NULL
          LIMIT ? OFFSET ?
      `);
    } else {
      getTrailsBatch = db.prepare(`
          SELECT app_uuid, name, ST_AsText(geometry) as coords
          FROM trails 
          WHERE geometry IS NOT NULL
          LIMIT ? OFFSET ?
      `);
    }

    const updateTrailStats = db.prepare(`
        UPDATE trails 
        SET 
            elevation_gain = ?,
            max_elevation = ?,
            min_elevation = ?,
            avg_elevation = ?
        WHERE app_uuid = ?
    `);

    let processedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let offset = 0;

    // Process trails in batches
    while (offset < totalTrails) {
        // Start transaction for this batch
        db.prepare('BEGIN TRANSACTION').run();
        
        let trails;
        if (trailName) {
          trails = getTrailsBatch.all(trailName, BATCH_SIZE, offset);
        } else {
          trails = getTrailsBatch.all(BATCH_SIZE, offset);
        }
        
        // Process each trail in the batch
        for (const trail of trails) {
            try {
                const coords = trail.coords;
                
                // Check if it's 3D geometry (LINESTRING Z)
                if (coords.startsWith('LINESTRING Z')) {
                    // Extract coordinates from LINESTRING Z format
                    const coordsStr = coords.substring(coords.indexOf('(') + 1, coords.lastIndexOf(')'));
                    const points = coordsStr.split(',').map(point => {
                        const [lng, lat, elev] = point.trim().split(' ').map(Number);
                        return { lng, lat, elev };
                    });

                    if (points.length > 0 && points.some(p => p.elev !== undefined && p.elev !== null)) {
                        // Filter out points without elevation data
                        const elevations = points.map(p => p.elev).filter(e => e !== undefined && e !== null && !isNaN(e));
                        
                        if (elevations.length > 0) {
                            // Calculate stats
                            const maxElevation = Math.max(...elevations);
                            const minElevation = Math.min(...elevations);
                            const avgElevation = Math.round(elevations.reduce((a, b) => a + b, 0) / elevations.length);

                            // Calculate elevation gain (sum of positive elevation changes)
                            let elevationGain = 0;
                            for (let i = 1; i < elevations.length; i++) {
                                const gain = elevations[i] - elevations[i - 1];
                                if (gain > 0) {
                                    elevationGain += gain;
                                }
                            }

                            // Update trail stats
                            updateTrailStats.run(
                                elevationGain,
                                maxElevation,
                                minElevation,
                                avgElevation,
                                trail.app_uuid
                            );
                            updatedCount++;
                            
                            if (updatedCount % 100 === 0) {
                                console.log(`✅ Updated ${updatedCount} trails with elevation stats...`);
                            }
                        } else {
                            skippedCount++;
                        }
                    } else {
                        skippedCount++;
                    }
                } else if (coords.startsWith('LINESTRING')) {
                    // 2D geometry - skip for now (no elevation data)
                    skippedCount++;
                } else {
                    // Unknown format
                    skippedCount++;
                }

                processedCount++;
                if (processedCount % 100 === 0) {
                    console.log(`⏳ Processed ${processedCount}/${totalTrails} trails...`);
                }
            } catch (error) {
                console.error(`Error processing trail ${trail.app_uuid}:`, error.message);
                skippedCount++;
            }
        }

        // Commit transaction for this batch
        db.prepare('COMMIT').run();
        
        // Update offset for next batch
        offset += BATCH_SIZE;
    }

    // Show results
    const results = db.prepare(`
        SELECT 
            COUNT(*) as total_trails,
            COUNT(CASE WHEN elevation_gain IS NOT NULL AND elevation_gain > 0 THEN 1 END) as trails_with_elevation,
            AVG(CASE WHEN elevation_gain IS NOT NULL AND elevation_gain > 0 THEN elevation_gain ELSE NULL END) as avg_elevation_gain,
            COUNT(CASE WHEN max_elevation IS NOT NULL AND max_elevation > 0 THEN 1 END) as trails_with_max_elevation
        FROM trails
    `).get();

    console.log('\n📊 Final Results:');
    console.log(`Total trails processed: ${processedCount}`);
    console.log(`Trails updated with elevation stats: ${updatedCount}`);
    console.log(`Trails skipped: ${skippedCount}`);
    console.log(`Trails with elevation gain > 0: ${results.trails_with_elevation}`);
    console.log(`Trails with max elevation > 0: ${results.trails_with_max_elevation}`);
    console.log(`Average elevation gain: ${Math.round(results.avg_elevation_gain || 0)}m`);

} catch (error) {
    console.error('❌ Error:', error);
    db.prepare('ROLLBACK').run();
    process.exit(1);
} finally {
    db.close();
} 