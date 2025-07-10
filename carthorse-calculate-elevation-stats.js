const Database = require('better-sqlite3');
const path = require('path');

// Parse --db argument
let dbPath = null;
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--db' && process.argv[i + 1]) {
    dbPath = process.argv[i + 1];
  }
}
if (!dbPath) {
  console.error('Usage: node calculate_elevation_stats.js --db <database_path>');
  process.exit(1);
}
if (!path.isAbsolute(dbPath)) {
  dbPath = path.resolve(process.cwd(), dbPath);
}

// Initialize database connection - use current database
const db = new Database(dbPath);

// Configuration
const BATCH_SIZE = 500;

console.log('🔄 Starting elevation stats calculation...');
console.log(`📂 Using database: ${dbPath}`);

try {
    // Load SpatiaLite extension with correct path
    db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Get total count of trails to process
    const totalTrails = db.prepare(`
        SELECT COUNT(*) as count
        FROM trails 
        WHERE geometry IS NOT NULL
    `).get().count;

    console.log(`📊 Found ${totalTrails} trails with geometry data to process`);

    // Prepare statements - use ST_AsText to get coordinates from geometry blob
    const getTrailsBatch = db.prepare(`
        SELECT app_uuid, ST_AsText(geometry) as coords
        FROM trails 
        WHERE geometry IS NOT NULL
        LIMIT ? OFFSET ?
    `);

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
    let offset = 0;

    // Process trails in batches
    while (offset < totalTrails) {
        // Start transaction for this batch
        db.prepare('BEGIN TRANSACTION').run();
        
        const trails = getTrailsBatch.all(BATCH_SIZE, offset);
        
        // Process each trail in the batch
        for (const trail of trails) {
            try {
                // Parse LINESTRING format (2D coordinates)
                const coords = trail.coords;
                if (!coords.startsWith('LINESTRING')) continue;

                // Extract just the coordinates part
                const coordsStr = coords.substring(coords.indexOf('(') + 1, coords.lastIndexOf(')'));
                const points = coordsStr.split(',').map(point => {
                    const [lng, lat] = point.trim().split(' ').map(Number);
                    return { lng, lat };
                });

                if (points.length > 0) {
                    // For 2D geometry, we can't calculate elevation stats from geometry alone
                    // Set default values or skip elevation calculation
                    const maxElevation = 0; // No elevation data in 2D geometry
                    const minElevation = 0;
                    const avgElevation = 0;
                    const elevationGain = 0;

                    // Update trail stats (will be zero since no elevation data)
                    updateTrailStats.run(
                        elevationGain,
                        maxElevation,
                        minElevation,
                        avgElevation,
                        trail.app_uuid
                    );
                    updatedCount++;
                }

                processedCount++;
                if (processedCount % 100 === 0) {
                    console.log(`⏳ Processed ${processedCount}/${totalTrails} trails...`);
                }
            } catch (error) {
                console.error(`Error processing trail ${trail.app_uuid}:`, error);
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
            COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as trails_with_elevation,
            AVG(CASE WHEN elevation_gain IS NOT NULL THEN elevation_gain ELSE NULL END) as avg_elevation_gain
        FROM trails
    `).get();

    console.log('\n📊 Final Results:');
    console.log(`Total trails processed: ${processedCount}`);
    console.log(`Trails updated with elevation stats: ${updatedCount}`);
    console.log(`Average elevation gain: ${Math.round(results.avg_elevation_gain || 0)}m`);
    console.log('\n⚠️  Note: All trails have 2D geometry only. Elevation stats are set to 0.');
    console.log('   To get real elevation data, run the elevation backfill script first.');

} catch (error) {
    console.error('❌ Error:', error);
    db.prepare('ROLLBACK').run();
    process.exit(1);
} finally {
    db.close();
} 