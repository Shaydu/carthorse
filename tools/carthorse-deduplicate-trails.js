#!/usr/bin/env node
/**
 * Deduplicate Trails by UUID and Geometry
 * Removes duplicate trails based on app_uuid and geometry similarity
 */

const Database = require('better-sqlite3');
const path = require('path');

// Configuration
const SPATIALITE_PATH = process.platform === 'darwin' 
  ? '/opt/homebrew/lib/mod_spatialite' 
  : '/usr/lib/x86_64-linux-gnu/mod_spatialite';

class TrailDeduplicator {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async initialize() {
    console.log('🔧 Initializing trail deduplication...');
    
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

  async deduplicateByUuid() {
    console.log('🔍 Deduplicating by app_uuid...');
    
    try {
      // Get initial count
      const initialCount = this.db.prepare('SELECT COUNT(*) as count FROM trails').get().count;
      console.log(`📊 Initial trail count: ${initialCount}`);

      // Find duplicates by app_uuid
      const duplicates = this.db.prepare(`
        SELECT app_uuid, COUNT(*) as count
        FROM trails 
        WHERE app_uuid IS NOT NULL
        GROUP BY app_uuid 
        HAVING COUNT(*) > 1
        ORDER BY count DESC
      `).all();

      console.log(`🔍 Found ${duplicates.length} app_uuid groups with duplicates`);

      if (duplicates.length === 0) {
        console.log('✅ No UUID duplicates found');
        return;
      }

      // Show some examples
      console.log('\n📍 Sample duplicate groups:');
      duplicates.slice(0, 5).forEach(dup => {
        console.log(`  - ${dup.app_uuid}: ${dup.count} duplicates`);
      });

      // Remove duplicates, keeping the first occurrence
      let totalRemoved = 0;
      for (const dup of duplicates) {
        const deleteStmt = this.db.prepare(`
          DELETE FROM trails 
          WHERE app_uuid = ? 
          AND id NOT IN (
            SELECT MIN(id) 
            FROM trails 
            WHERE app_uuid = ?
          )
        `);
        
        const result = deleteStmt.run(dup.app_uuid, dup.app_uuid);
        totalRemoved += result.changes;
      }

      const finalCount = this.db.prepare('SELECT COUNT(*) as count FROM trails').get().count;
      console.log(`✅ UUID deduplication complete:`);
      console.log(`   Removed: ${totalRemoved} duplicate trails`);
      console.log(`   Final count: ${finalCount}`);
      console.log(`   Reduction: ${((initialCount - finalCount) / initialCount * 100).toFixed(1)}%`);

    } catch (error) {
      console.error('❌ UUID deduplication failed:', error);
      throw error;
    }
  }

  async deduplicateByGeometry() {
    console.log('🔍 Deduplicating by geometry similarity...');
    
    try {
      // Get initial count
      const initialCount = this.db.prepare('SELECT COUNT(*) as count FROM trails').get().count;
      console.log(`📊 Initial trail count: ${initialCount}`);

      // Find trails with identical geometry (using AsText for comparison)
      const duplicates = this.db.prepare(`
        SELECT AsText(geometry) as geom_text, COUNT(*) as count
        FROM trails 
        WHERE geometry IS NOT NULL
        GROUP BY AsText(geometry)
        HAVING COUNT(*) > 1
        ORDER BY count DESC
      `).all();

      console.log(`🔍 Found ${duplicates.length} geometry groups with duplicates`);

      if (duplicates.length === 0) {
        console.log('✅ No geometry duplicates found');
        return;
      }

      // Show some examples
      console.log('\n📍 Sample geometry duplicate groups:');
      duplicates.slice(0, 5).forEach(dup => {
        console.log(`  - Geometry: ${dup.geom_text.substring(0, 50)}... (${dup.count} duplicates)`);
      });

      // Remove duplicates, keeping the first occurrence
      let totalRemoved = 0;
      for (const dup of duplicates) {
        const deleteStmt = this.db.prepare(`
          DELETE FROM trails 
          WHERE AsText(geometry) = ? 
          AND id NOT IN (
            SELECT MIN(id) 
            FROM trails 
            WHERE AsText(geometry) = ?
          )
        `);
        
        const result = deleteStmt.run(dup.geom_text, dup.geom_text);
        totalRemoved += result.changes;
      }

      const finalCount = this.db.prepare('SELECT COUNT(*) as count FROM trails').get().count;
      console.log(`✅ Geometry deduplication complete:`);
      console.log(`   Removed: ${totalRemoved} duplicate trails`);
      console.log(`   Final count: ${finalCount}`);
      console.log(`   Reduction: ${((initialCount - finalCount) / initialCount * 100).toFixed(1)}%`);

    } catch (error) {
      console.error('❌ Geometry deduplication failed:', error);
      throw error;
    }
  }

  async generateReport() {
    console.log('\n📊 Deduplication Report');
    console.log('======================');
    
    try {
      const totalTrails = this.db.prepare('SELECT COUNT(*) as count FROM trails').get().count;
      const trailsWithGeometry = this.db.prepare('SELECT COUNT(*) as count FROM trails WHERE geometry IS NOT NULL').get().count;
      const uniqueUuids = this.db.prepare('SELECT COUNT(DISTINCT app_uuid) as count FROM trails WHERE app_uuid IS NOT NULL').get().count;
      
      console.log(`Total trails: ${totalTrails}`);
      console.log(`Trails with geometry: ${trailsWithGeometry}`);
      console.log(`Unique UUIDs: ${uniqueUuids}`);
      
      // Check for any remaining duplicates
      const remainingUuidDups = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM (
          SELECT app_uuid 
          FROM trails 
          WHERE app_uuid IS NOT NULL
          GROUP BY app_uuid 
          HAVING COUNT(*) > 1
        )
      `).get().count;
      
      const remainingGeomDups = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM (
          SELECT AsText(geometry) 
          FROM trails 
          WHERE geometry IS NOT NULL
          GROUP BY AsText(geometry) 
          HAVING COUNT(*) > 1
        )
      `).get().count;
      
      console.log(`Remaining UUID duplicates: ${remainingUuidDups}`);
      console.log(`Remaining geometry duplicates: ${remainingGeomDups}`);

      console.log('\n🎉 Deduplication completed successfully!');
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
      await this.deduplicateByUuid();
      await this.deduplicateByGeometry();
      await this.generateReport();
    } catch (error) {
      console.error('❌ Deduplication failed:', error);
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
    console.error('❌ Usage: node deduplicate_trails_by_uuid_and_geometry.js --db <database_path>');
    process.exit(1);
  }
  
  if (!path.isAbsolute(dbPath)) {
    dbPath = path.resolve(process.cwd(), dbPath);
  }
  
  return dbPath;
}

async function main() {
  const dbPath = parseArgs();
  const deduplicator = new TrailDeduplicator(dbPath);
  await deduplicator.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = TrailDeduplicator; 