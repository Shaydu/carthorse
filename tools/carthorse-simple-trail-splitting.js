const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { INTERSECTION_TOLERANCE } = require('./src/constants');

// Parse command line arguments
let dbPath = null;
let detectIntersections = false;
let splitTrails = false;
let deleteUnsplitTrails = false;

for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--db' && process.argv[i + 1]) {
    dbPath = process.argv[i + 1];
  } else if (process.argv[i] === '--detect-intersections') {
    detectIntersections = true;
  } else if (process.argv[i] === '--split-trails') {
    splitTrails = true;
  } else if (process.argv[i] === '--delete-unsplit') {
    deleteUnsplitTrails = true;
  }
}

if (!dbPath) {
  console.error('Usage: node simple-trail-splitting-migration.js --db <database_path> [--detect-intersections] [--split-trails] [--delete-unsplit]');
  console.error('');
  console.error('Flags:');
  console.error('  --detect-intersections  Run intersection detection only');
  console.error('  --split-trails         Run trail splitting only (requires intersection data)');
  console.error('  --delete-unsplit       Delete original unsplit trails after splitting');
  console.error('');
  console.error('Examples:');
  console.error('  node simple-trail-splitting-migration.js --db trails.db --detect-intersections');
  console.error('  node simple-trail-splitting-migration.js --db trails.db --split-trails');
  console.error('  node simple-trail-splitting-migration.js --db trails.db --detect-intersections --split-trails');
  console.error('  node simple-trail-splitting-migration.js --db trails.db --detect-intersections --split-trails --delete-unsplit');
  process.exit(1);
}
if (!path.isAbsolute(dbPath)) {
  dbPath = path.resolve(process.cwd(), dbPath);
}

// Configuration
const TARGET_DB_PATH = dbPath;
const SPATIALITE_PATH = process.platform === 'darwin' 
  ? '/opt/homebrew/lib/mod_spatialite' 
  : '/usr/lib/x86_64-linux-gnu/mod_spatialite';


class SimpleTrailSplittingMigration {
  constructor() {
    this.db = null;
    this.splitPoints = new Map(); // trailId -> array of split points
  }

  async initialize() {
    console.log('🔧 Initializing simple trail splitting migration...');
    
    try {
      // Use the target database directly
      this.db = new Database(TARGET_DB_PATH);
      
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
    const [lng1, lat1] = coord1;
    const [lng2, lat2] = coord2;
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // async detectIntersections() {
  //   console.log('🔍 Detecting trail intersections...');
  //   try {
  //     // Get all trails with their geometries
  //     const trails = this.db.prepare(`
  //       SELECT id, app_uuid, name, 
  //              AsGeoJSON(geometry) as geojson,
  //              bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
  //       FROM trails 
  //       WHERE geometry IS NOT NULL
  //       ORDER BY id
  //     `).all();

  //     console.log(`📊 Analyzing ${trails.length} trails for intersections...`);
  //     let intersectionCount = 0;

  //     // For each host trail
  //     for (let i = 0; i < trails.length; i++) {
  //       const host = trails[i];
  //       const hostGeom = JSON.parse(host.geojson);
  //       if (!hostGeom.coordinates || hostGeom.coordinates.length < 2) continue;

  //       // Initialize split points for this trail
  //       if (!this.splitPoints.has(host.id)) {
  //         this.splitPoints.set(host.id, []);
  //       }

  //       // For every other trail (visitor)
  //       for (let j = 0; j < trails.length; j++) {
  //         if (i === j) continue;
  //         const visitor = trails[j];
  //         const visitorGeom = JSON.parse(visitor.geojson);
  //         if (!visitorGeom.coordinates || visitorGeom.coordinates.length < 2) continue;

  //         // Check visitor's start and end points
  //         const visitorEndpoints = [
  //           visitorGeom.coordinates[0], 
  //           visitorGeom.coordinates[visitorGeom.coordinates.length - 1]
  //         ];

  //         for (const endpoint of visitorEndpoints) {
  //           // Find the closest point on the host trail (excluding endpoints)
  //           let minDist = Infinity;
  //           let minIdx = -1;
  //           for (let k = 0; k < hostGeom.coordinates.length; k++) { // Include endpoints
  //             const dist = this.calculateDistance(endpoint, hostGeom.coordinates[k]);
  //             if (dist < minDist) {
  //               minDist = dist;
  //               minIdx = k;
  //             }
  //           }

  //           if (minDist <= INTERSECTION_TOLERANCE) {
  //             // Add split point to host trail
  //             const splitPoint = {
  //               lng: hostGeom.coordinates[minIdx][0],
  //               lat: hostGeom.coordinates[minIdx][1],
  //               idx: minIdx,
  //               distance: minDist,
  //               visitorTrailId: visitor.id,
  //               visitorTrailName: visitor.name
  //             };

  //             this.splitPoints.get(host.id).push(splitPoint);
  //             intersectionCount++;

  //             if (intersectionCount % 10 === 0) {
  //               console.log(`📍 Found ${intersectionCount} intersection points...`);
  //             }
  //           }
  //         }
  //       }
  //     }

  //     // Sort split points by index for each trail
  //     for (const [trailId, points] of this.splitPoints) {
  //       points.sort((a, b) => a.idx - b.idx);
  //     }

  //     console.log(`✅ Found ${intersectionCount} intersection points across ${this.splitPoints.size} trails`);
      
  //     // Save intersection data to database for later use
  //     await this.saveIntersectionData();
  //   } catch (error) {
  //     console.error('❌ Intersection detection failed:', error);
  //     throw error;
  //   }
  // }

  async saveIntersectionData() {
    console.log('💾 Saving intersection data...');
    try {
      // Create intersection_data table if it doesn't exist
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS intersection_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trail_id INTEGER NOT NULL,
          split_points TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      // Clear existing data
      this.db.prepare('DELETE FROM intersection_data').run();

      // Save current intersection data
      for (const [trailId, points] of this.splitPoints) {
        if (trailId && points && points.length > 0) {
          this.db.prepare(`
            INSERT INTO intersection_data (trail_id, split_points)
            VALUES (?, ?)
          `).run(trailId, JSON.stringify(points));
        }
      }

      console.log(`✅ Saved intersection data for ${this.splitPoints.size} trails`);
    } catch (error) {
      console.error('❌ Failed to save intersection data:', error);
      throw error;
    }
  }

  async loadIntersectionData() {
    console.log('📂 Loading intersection data...');
    try {
      // Check if intersection_data table exists
      const tableExists = this.db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='intersection_data'
      `).get();

      if (!tableExists) {
        console.log('⚠️  No intersection data found. Run --detect-intersections first.');
        return false;
      }

      // Load intersection data
      const data = this.db.prepare(`
        SELECT trail_id, split_points FROM intersection_data
      `).all();

      this.splitPoints.clear();
      for (const row of data) {
        this.splitPoints.set(row.trail_id, JSON.parse(row.split_points));
      }

      console.log(`✅ Loaded intersection data for ${this.splitPoints.size} trails`);
      return true;
    } catch (error) {
      console.error('❌ Failed to load intersection data:', error);
      return false;
    }
  }

  calculateBbox(coordinates) {
    if (!coordinates || coordinates.length === 0) return null;
    
    let minLng = coordinates[0][0];
    let maxLng = coordinates[0][0];
    let minLat = coordinates[0][1];
    let maxLat = coordinates[0][1];

    for (const [lng, lat] of coordinates) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    return {
      bbox_min_lng: minLng,
      bbox_max_lng: maxLng,
      bbox_min_lat: minLat,
      bbox_max_lat: maxLat
    };
  }

  calculateTrailLength(coordinates) {
    if (!coordinates || coordinates.length < 2) return 0;
    
    let totalLength = 0;
    for (let i = 1; i < coordinates.length; i++) {
      totalLength += this.calculateDistance(coordinates[i-1], coordinates[i]);
    }
    return totalLength;
  }

  calculateElevationStats(coordinates) {
    if (!coordinates || coordinates.length === 0) return null;
    
    const elevations = coordinates.map(coord => coord[2] || 0).filter(elev => elev !== 0);
    if (elevations.length === 0) return null;

    const minElev = Math.min(...elevations);
    const maxElev = Math.max(...elevations);
    const avgElev = elevations.reduce((sum, elev) => sum + elev, 0) / elevations.length;
    
    let totalGain = 0;
    let totalLoss = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i-1];
      if (diff > 0) totalGain += diff;
      else totalLoss += Math.abs(diff);
    }

    return {
      min_elevation: minElev,
      max_elevation: maxElev,
      avg_elevation: avgElev,
      elevation_gain: totalGain,
      elevation_loss: totalLoss
    };
  }

  async deleteUnsplitTrails() {
    console.log('🗑️  Deleting original unsplit trails...');
    
    try {
      let deletedCount = 0;
      
      for (const [trailId, splitPoints] of this.splitPoints) {
        if (splitPoints.length === 0) continue;
        
        // Check if this trail still exists (hasn't been deleted yet)
        const trailExists = this.db.prepare('SELECT id FROM trails WHERE id = ?').get(trailId);
        if (trailExists) {
          this.db.prepare('DELETE FROM trails WHERE id = ?').run(trailId);
          deletedCount++;
        }
      }
      
      console.log(`✅ Deleted ${deletedCount} original unsplit trails`);
    } catch (error) {
      console.error('❌ Failed to delete unsplit trails:', error);
      throw error;
    }
  }

  async splitTrails() {
    console.log('✂️  Splitting trails at intersection points...');
    
    try {
      let totalSegments = 0;
      let processedTrails = 0;

      for (const [trailId, splitPoints] of this.splitPoints) {
        if (splitPoints.length === 0) continue;

        // Get the original trail data
        const originalTrail = this.db.prepare(`
          SELECT * FROM trails WHERE id = ?
        `).get(trailId);

        if (!originalTrail) continue;

        const originalGeom = JSON.parse(originalTrail.geometry ? 
          this.db.prepare('SELECT AsGeoJSON(?) as geojson').get(originalTrail.geometry).geojson : 
          '{"coordinates": []}'
        );

        if (!originalGeom.coordinates || originalGeom.coordinates.length < 2) continue;

        // Create segments based on split points
        const segments = [];
        let startIdx = 0;

        for (const splitPoint of splitPoints) {
          if (splitPoint.idx > startIdx) {
            // Create segment from startIdx to splitPoint.idx
            const segmentCoords = originalGeom.coordinates.slice(startIdx, splitPoint.idx + 1);
            if (segmentCoords.length >= 2) {
              segments.push({
                coordinates: segmentCoords,
                startIdx: startIdx,
                endIdx: splitPoint.idx
              });
            }
          }
          startIdx = splitPoint.idx;
        }

        // Add final segment from last split point to end
        if (startIdx < originalGeom.coordinates.length - 1) {
          const finalSegmentCoords = originalGeom.coordinates.slice(startIdx);
          if (finalSegmentCoords.length >= 2) {
            segments.push({
              coordinates: finalSegmentCoords,
              startIdx: startIdx,
              endIdx: originalGeom.coordinates.length - 1
            });
          }
        }

        // If no segments were created, skip this trail
        if (segments.length === 0) continue;

        // Delete the original trail only if flag is set
        if (deleteUnsplitTrails) {
          this.db.prepare('DELETE FROM trails WHERE id = ?').run(trailId);
        }

        // Insert new segments
        for (const segment of segments) {
          const bbox = this.calculateBbox(segment.coordinates);
          const length = this.calculateTrailLength(segment.coordinates);
          const elevationStats = this.calculateElevationStats(segment.coordinates) || {
            min_elevation: segment.coordinates[0]?.[2] ?? 0,
            max_elevation: segment.coordinates[0]?.[2] ?? 0,
            avg_elevation: segment.coordinates[0]?.[2] ?? 0,
            elevation_gain: 0
          };
          
          // Create geometry from coordinates
          const geometryJson = JSON.stringify({
            type: 'LineString',
            coordinates: segment.coordinates
          });

          const insertStmt = this.db.prepare(`
            INSERT INTO trails (
              app_uuid, name, geometry, length_km, 
              bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              min_elevation, max_elevation, avg_elevation, elevation_gain,
              surface, trail_type, difficulty, source, source_tags, created_at, updated_at, osm_id
            ) VALUES (?, ?, GeomFromGeoJSON(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            uuidv4(), // new UUID for each segment
            originalTrail.name,
            geometryJson,
            length / 1000, // convert meters to km
            bbox.bbox_min_lng,
            bbox.bbox_max_lng,
            bbox.bbox_min_lat,
            bbox.bbox_max_lat,
            elevationStats.min_elevation,
            elevationStats.max_elevation,
            elevationStats.avg_elevation,
            elevationStats.elevation_gain,
            originalTrail.surface,
            originalTrail.trail_type,
            originalTrail.difficulty,
            originalTrail.source,
            originalTrail.source_tags,
            originalTrail.created_at,
            new Date().toISOString(),
            originalTrail.osm_id
          );

          totalSegments++;
        }

        processedTrails++;
        if (processedTrails % 10 === 0) {
          console.log(`✂️  Processed ${processedTrails} trails, created ${totalSegments} segments...`);
        }
      }

      console.log(`✅ Split ${processedTrails} trails into ${totalSegments} segments`);
    } catch (error) {
      console.error('❌ Trail splitting failed:', error);
      throw error;
    }
  }

  async generateReport() {
    console.log('\n📊 Migration Report');
    console.log('==================');
    
    try {
      const totalTrails = this.db.prepare('SELECT COUNT(*) as count FROM trails').get().count;
      const trailsWithGeometry = this.db.prepare('SELECT COUNT(*) as count FROM trails WHERE geometry IS NOT NULL').get().count;
      
      console.log(`Trails: ${totalTrails}`);
      console.log(`Trails with geometry: ${trailsWithGeometry}`);
      console.log(`Trails with split points: ${this.splitPoints.size}`);
      
      let totalSplitPoints = 0;
      for (const [trailId, points] of this.splitPoints) {
        totalSplitPoints += points.length;
      }
      console.log(`Total split points: ${totalSplitPoints}`);

      // Show some sample split trails
      console.log('\n📍 Sample split trails:');
      let count = 0;
      for (const [trailId, points] of this.splitPoints) {
        if (count >= 5) break;
        const trail = this.db.prepare('SELECT name FROM trails WHERE id = ?').get(trailId);
        console.log(`  - Trail ${trailId} (${trail?.name || 'Unknown'}): ${points.length} split points`);
        count++;
      }

      console.log('\n🎉 Simple trail splitting migration completed successfully!');
      console.log(`📁 Database: ${TARGET_DB_PATH}`);
      
      if (deleteUnsplitTrails) {
        console.log('🗑️  Original unsplit trails have been deleted');
      } else if (splitTrails) {
        console.log('⚠️  Original unsplit trails are still in the database (use --delete-unsplit to remove them)');
      }
      
      console.log('🔍 You can now test the API with this database.');
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
      
      if (detectIntersections) {
        await this.detectIntersections();
      } else if (splitTrails || deleteUnsplitTrails) {
        // Load intersection data if not detecting
        const loaded = await this.loadIntersectionData();
        if (!loaded) {
          console.log('⚠️  No intersection data available. Run with --detect-intersections first.');
          return;
        }
      }
      
      if (splitTrails) {
        await this.splitTrails();
      }
      
      if (deleteUnsplitTrails) {
        if (this.splitPoints.size === 0) {
          console.log('⚠️  No intersection data available. Run with --detect-intersections first.');
          return;
        }
        await this.deleteUnsplitTrails();
      }
      
      if (!detectIntersections && !splitTrails && !deleteUnsplitTrails) {
        console.log('ℹ️  No operations specified. Use --detect-intersections, --split-trails, and/or --delete-unsplit flags.');
        console.log('Run with --help for usage information.');
        return;
      }
      
      await this.generateReport();
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

async function runMigration() {
  const migration = new SimpleTrailSplittingMigration();
  await migration.run();
}

if (require.main === module) {
  runMigration().catch(console.error);
}

module.exports = SimpleTrailSplittingMigration; 