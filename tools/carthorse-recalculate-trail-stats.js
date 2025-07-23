#!/usr/bin/env node
/**
 * Recalculate Trail Stats Script
 * Recalculates length_km and elevation_gain for trails with missing data
 */

const Database = require('better-sqlite3');
const path = require('path');

// Configuration
const SPATIALITE_PATH = process.platform === 'darwin' 
  ? '/opt/homebrew/lib/mod_spatialite' 
  : '/usr/lib/x86_64-linux-gnu/mod_spatialite';

class TrailStatsRecalculator {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async initialize() {
    console.log('🔧 Initializing trail stats recalculation...');
    
    try {
      this.db = new Database(this.dbPath);
      
      // Load SpatiaLite extension
      try {
        this.db.loadExtension(SPATIALITE_PATH);
        console.log('✅ SpatiaLite loaded successfully');
      } catch (error) {
        console.log('⚠️  SpatiaLite not available, using basic SQLite functions');
      }
      
      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');
      
      console.log('✅ Database initialized');
    } catch (error) {
      console.error('❌ Failed to initialize database:', error);
      throw error;
    }
  }

  calculateDistance(coord1, coord2) {
    const R = 6371; // Earth's radius in km
    const lat1 = coord1[1] * Math.PI / 180;
    const lat2 = coord2[1] * Math.PI / 180;
    const deltaLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const deltaLng = (coord2[0] - coord1[0]) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  calculateTrailLength(coordinates) {
    if (!coordinates || coordinates.length < 2) return 0;
    
    let totalDistance = 0;
    for (let i = 1; i < coordinates.length; i++) {
      totalDistance += this.calculateDistance(coordinates[i-1], coordinates[i]);
    }
    return totalDistance;
  }

  calculateElevationStats(coordinates) {
    if (!coordinates || coordinates.length === 0) return null;
    
    const elevations = coordinates.map(coord => coord[2] || 0).filter(elev => elev !== 0);
    if (elevations.length === 0) return null;

    const minElev = Math.min(...elevations);
    const maxElev = Math.max(...elevations);
    const avgElev = elevations.reduce((sum, elev) => sum + elev, 0) / elevations.length;
    
    let totalGain = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i-1];
      if (diff > 0) totalGain += diff;
    }

    return {
      min_elevation: minElev,
      max_elevation: maxElev,
      avg_elevation: avgElev,
      elevation_gain: totalGain
    };
  }

  async recalculateStats() {
    console.log('🔍 Recalculating trail stats...');
    
    try {
      // Get trails that need recalculation
      const trailsToUpdate = this.db.prepare(`
        SELECT id, app_uuid, name, AsGeoJSON(geometry) as geojson
        FROM trails 
        WHERE geometry IS NOT NULL 
        AND (length_km IS NULL OR elevation_gain IS NULL)
      `).all();

      console.log(`📊 Found ${trailsToUpdate.length} trails needing stats recalculation`);

      if (trailsToUpdate.length === 0) {
        console.log('✅ No trails need stats recalculation');
        return;
      }

      const updateStmt = this.db.prepare(`
        UPDATE trails 
        SET length_km = ?, 
            elevation_gain = ?,
            min_elevation = ?,
            max_elevation = ?,
            avg_elevation = ?,
            updated_at = ?
        WHERE id = ?
      `);

      let updatedCount = 0;
      let skippedCount = 0;

      for (const trail of trailsToUpdate) {
        try {
          const geojson = JSON.parse(trail.geojson);
          const coordinates = geojson.coordinates;

          if (!coordinates || coordinates.length < 2) {
            skippedCount++;
            continue;
          }

          // Calculate length
          const length = this.calculateTrailLength(coordinates);

          // Calculate elevation stats
          const elevationStats = this.calculateElevationStats(coordinates);

          // Update the trail
          updateStmt.run(
            length,
            elevationStats?.elevation_gain || 0,
            elevationStats?.min_elevation || null,
            elevationStats?.max_elevation || null,
            elevationStats?.avg_elevation || null,
            new Date().toISOString(),
            trail.id
          );

          updatedCount++;

          if (updatedCount % 100 === 0) {
            console.log(`📍 Updated ${updatedCount}/${trailsToUpdate.length} trails...`);
          }

        } catch (error) {
          console.warn(`⚠️ Error processing trail ${trail.app_uuid}:`, error.message);
          skippedCount++;
        }
      }

      console.log(`✅ Stats recalculation complete:`);
      console.log(`   Updated: ${updatedCount} trails`);
      console.log(`   Skipped: ${skippedCount} trails`);

    } catch (error) {
      console.error('❌ Stats recalculation failed:', error);
      throw error;
    }
  }

  async generateReport() {
    console.log('\n📊 Recalculation Report');
    console.log('======================');
    
    try {
      const totalTrails = this.db.prepare('SELECT COUNT(*) as count FROM trails WHERE geometry IS NOT NULL').get().count;
      const trailsWithLength = this.db.prepare('SELECT COUNT(*) as count FROM trails WHERE geometry IS NOT NULL AND length_km IS NOT NULL').get().count;
      const trailsWithElevationGain = this.db.prepare('SELECT COUNT(*) as count FROM trails WHERE geometry IS NOT NULL AND elevation_gain IS NOT NULL').get().count;
      
      console.log(`Total trails with geometry: ${totalTrails}`);
      console.log(`Trails with length_km: ${trailsWithLength} (${(trailsWithLength/totalTrails*100).toFixed(1)}%)`);
      console.log(`Trails with elevation_gain: ${trailsWithElevationGain} (${(trailsWithElevationGain/totalTrails*100).toFixed(1)}%)`);

      console.log('\n🎉 Stats recalculation completed successfully!');
      console.log(`📁 Database: ${this.dbPath}`);
    } catch (error) {
      console.error('❌ Report generation failed:', error);
    }
  }

  async cleanup() {
    if (this.db) {
      this.db.close();
      console.log('✅ Database connection closed');
    }
  }

  async run() {
    try {
      await this.initialize();
      await this.recalculateStats();
      await this.generateReport();
    } catch (error) {
      console.error('❌ Recalculation failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Command line argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && i + 1 < args.length) {
      dbPath = args[i + 1];
      break;
    }
  }
  
  if (!dbPath) {
    console.error('❌ Usage: node recalculate_trail_stats.js --db <database_path>');
    process.exit(1);
  }
  
  if (!path.isAbsolute(dbPath)) {
    dbPath = path.resolve(process.cwd(), dbPath);
  }
  
  return dbPath;
}

async function main() {
  const dbPath = parseArgs();
  const recalculator = new TrailStatsRecalculator(dbPath);
  await recalculator.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = TrailStatsRecalculator; 