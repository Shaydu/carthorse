#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

class TrailDeduplicator {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  async deduplicateTrails() {
    console.log('🔍 Analyzing trail duplicates...');
    
    const db = new sqlite3.Database(this.dbPath);
    
    try {
      // Get all trails with their geometries
      const trails = await this.getAllTrails(db);
      console.log(`📊 Found ${trails.length} total trails`);
      
      // Group trails by name
      const trailsByName = this.groupTrailsByName(trails);
      console.log(`📊 Found ${Object.keys(trailsByName).length} unique trail names`);
      
      // Find duplicates and create deduplication plan
      const duplicates = this.findDuplicates(trailsByName);
      console.log(`🔍 Found ${duplicates.length} groups of duplicate trails`);
      
      // Remove duplicate trails, keeping the shortest
      const trailsToRemove = duplicates.flatMap(group => 
        group.trails.slice(1) // Keep the first (shortest), remove the rest
      );
      
      console.log(`🗑️  Removing ${trailsToRemove.length} duplicate trails`);
      
      // Delete duplicate trails
      await this.removeTrails(db, trailsToRemove);
      
      // Verify results
      const remainingTrails = await this.getAllTrails(db);
      console.log(`✅ Deduplication complete! ${remainingTrails.length} trails remaining`);
      
    } finally {
      db.close();
    }
  }

  async getAllTrails(db) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT app_uuid, name, length_km, geojson, trail_type
        FROM trails 
        ORDER BY name, length_km
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  groupTrailsByName(trails) {
    const groups = {};
    for (const trail of trails) {
      if (!groups[trail.name]) {
        groups[trail.name] = [];
      }
      groups[trail.name].push(trail);
    }
    return groups;
  }

  findDuplicates(trailsByName) {
    const duplicates = [];
    
    for (const [name, trails] of Object.entries(trailsByName)) {
      if (trails.length <= 1) continue;
      
      // Sort by length (shortest first)
      trails.sort((a, b) => a.length_km - b.length_km);
      
      // Group trails with similar lengths (within 10% tolerance)
      const groups = this.groupBySimilarLength(trails);
      
      for (const group of groups) {
        if (group.length > 1) {
          duplicates.push({
            name: name,
            trails: group,
            totalLength: group.reduce((sum, t) => sum + t.length_km, 0)
          });
        }
      }
    }
    
    return duplicates;
  }

  groupBySimilarLength(trails) {
    const groups = [];
    const tolerance = 0.1; // 10% tolerance
    
    for (const trail of trails) {
      let addedToGroup = false;
      
      for (const group of groups) {
        const groupAvgLength = group.reduce((sum, t) => sum + t.length_km, 0) / group.length;
        const lengthDiff = Math.abs(trail.length_km - groupAvgLength) / groupAvgLength;
        
        if (lengthDiff <= tolerance) {
          group.push(trail);
          addedToGroup = true;
          break;
        }
      }
      
      if (!addedToGroup) {
        groups.push([trail]);
      }
    }
    
    return groups;
  }

  async removeTrails(db, trailsToRemove) {
    if (trailsToRemove.length === 0) return;
    
    const uuids = trailsToRemove.map(t => t.app_uuid);
    const placeholders = uuids.map(() => '?').join(',');
    
    return new Promise((resolve, reject) => {
      db.run(`
        DELETE FROM trails 
        WHERE app_uuid IN (${placeholders})
      `, uuids, function(err) {
        if (err) reject(err);
        else {
          console.log(`🗑️  Removed ${this.changes} trails`);
          resolve();
        }
      });
    });
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node deduplicate-trails.js <sqlite-db-path>');
    process.exit(1);
  }
  
  const dbPath = args[0];
  const deduplicator = new TrailDeduplicator(dbPath);
  
  deduplicator.deduplicateTrails()
    .then(() => {
      console.log('✅ Trail deduplication completed successfully!');
    })
    .catch(err => {
      console.error('❌ Error during deduplication:', err);
      process.exit(1);
    });
}

module.exports = TrailDeduplicator;
