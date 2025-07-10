#!/usr/bin/env node
/**
 * Calculate Elevation Loss Script
 * Calculates elevation_loss for trails with 3D geometry
 */

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
  console.error('Usage: node calculate_elevation_loss.js --db <database_path>');
  process.exit(1);
}
if (!path.isAbsolute(dbPath)) {
  dbPath = path.resolve(process.cwd(), dbPath);
}

// Initialize database connection
const db = new Database(dbPath);

// Configuration
const BATCH_SIZE = 500;

console.log('🔄 Starting elevation loss calculation...');
console.log(`📂 Using database: ${dbPath}`);

try {
    // Load SpatiaLite extension
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

    // Prepare statements
    const getTrailsBatch = db.prepare(`
        SELECT app_uuid, ST_AsText(geometry) as coords
        FROM trails 
        WHERE geometry IS NOT NULL
        LIMIT ? OFFSET ?
    `);

    const updateElevationLoss = db.prepare(`
        UPDATE trails 
        SET elevation_loss = ?
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
                // Parse LINESTRING format (3D coordinates)
                const coords = trail.coords;
                if (!coords.startsWith('LINESTRING')) continue;

                // Extract just the coordinates part
                const coordsStr = coords.substring(coords.indexOf('(') + 1, coords.lastIndexOf(')'));
                const points = coordsStr.split(',').map(point => {
                    const parts = point.trim().split(' ');
                    const lng = parseFloat(parts[0]);
                    const lat = parseFloat(parts[1]);
                    const elev = parts.length > 2 ? parseFloat(parts[2]) : 0;
                    return { lng, lat, elev };
                });

                if (points.length > 1) {
                    // Calculate elevation loss (downhill segments)
                    let totalLoss = 0;
                    for (let i = 1; i < points.length; i++) {
                        const diff = points[i-1].elev - points[i].elev;
                        if (diff > 0) { // Downhill segment
                            totalLoss += diff;
                        }
                    }

                    // Update trail with elevation loss
                    updateElevationLoss.run(totalLoss, trail.app_uuid);
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
            COUNT(CASE WHEN elevation_loss IS NOT NULL THEN 1 END) as trails_with_elevation_loss,
            AVG(CASE WHEN elevation_loss IS NOT NULL THEN elevation_loss ELSE NULL END) as avg_elevation_loss
        FROM trails
    `).get();

    console.log('\n📊 Final Results:');
    console.log(`Total trails processed: ${processedCount}`);
    console.log(`Trails updated with elevation loss: ${updatedCount}`);
    console.log(`Average elevation loss: ${Math.round(results.avg_elevation_loss || 0)}m`);

} catch (error) {
    console.error('❌ Error:', error);
    db.prepare('ROLLBACK').run();
    process.exit(1);
} finally {
    db.close();
} 