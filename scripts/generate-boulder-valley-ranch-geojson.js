#!/usr/bin/env node

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Boulder Valley Ranch bbox coordinates (3km x 3km around centerpoint 40.0803, -105.2625)
const BOULDER_VALLEY_BBOX = {
  minLat: 40.0533,
  maxLat: 40.1073,
  minLng: -105.2895,
  maxLng: -105.2355
};

function generateBoulderValleyRanchGeoJSON() {
  console.log('🗺️  Generating Boulder Valley Ranch GeoJSON...');
  
  // Find the most recent SQLite test database
  const testOutputDir = path.join(__dirname, '..', 'src', '__tests__', 'test-output');
  const sqliteFiles = fs.readdirSync(testOutputDir)
    .filter(file => file.endsWith('.sqlite'))
    .sort((a, b) => {
      const statA = fs.statSync(path.join(testOutputDir, a));
      const statB = fs.statSync(path.join(testOutputDir, b));
      return statB.mtime.getTime() - statA.mtime.getTime();
    });
  
  if (sqliteFiles.length === 0) {
    console.error('❌ No SQLite database files found in test-output directory');
    console.log('💡 Run the Boulder Valley Ranch test first to generate the database');
    return;
  }
  
  const dbPath = path.join(testOutputDir, sqliteFiles[0]);
  console.log(`📁 Using database: ${sqliteFiles[0]}`);
  
  const db = new Database(dbPath);
  
  try {
    // Get all nodes in Boulder Valley Ranch area
    const nodes = db.prepare(`
      SELECT id, lat, lng, elevation, node_type
      FROM routing_nodes 
      WHERE lat BETWEEN ? AND ? 
      AND lng BETWEEN ? AND ?
      ORDER BY id
    `).all(BOULDER_VALLEY_BBOX.minLat, BOULDER_VALLEY_BBOX.maxLat, 
            BOULDER_VALLEY_BBOX.minLng, BOULDER_VALLEY_BBOX.maxLng);
    
    console.log(`📍 Found ${nodes.length} nodes in Boulder Valley Ranch area`);
    
    // Get all edges in Boulder Valley Ranch area
    const edges = db.prepare(`
      SELECT id, source, target, source_lat, source_lng, target_lat, target_lng, 
             trail_name, distance_km, elevation_gain, elevation_loss
      FROM routing_edges 
      WHERE source_lat BETWEEN ? AND ? 
      AND source_lng BETWEEN ? AND ?
      AND target_lat BETWEEN ? AND ? 
      AND target_lng BETWEEN ? AND ?
      ORDER BY id
    `).all(BOULDER_VALLEY_BBOX.minLat, BOULDER_VALLEY_BBOX.maxLat,
            BOULDER_VALLEY_BBOX.minLng, BOULDER_VALLEY_BBOX.maxLng,
            BOULDER_VALLEY_BBOX.minLat, BOULDER_VALLEY_BBOX.maxLat,
            BOULDER_VALLEY_BBOX.minLng, BOULDER_VALLEY_BBOX.maxLng);
    
    console.log(`🛤️  Found ${edges.length} edges in Boulder Valley Ranch area`);
    
    // Get all trails in Boulder Valley Ranch area
    const trails = db.prepare(`
      SELECT id, name, length_km, elevation_gain, elevation_loss, bbox_min_lat, bbox_min_lng
      FROM trails 
      WHERE bbox_min_lat BETWEEN ? AND ? 
      AND bbox_min_lng BETWEEN ? AND ?
      ORDER BY name
    `).all(BOULDER_VALLEY_BBOX.minLat, BOULDER_VALLEY_BBOX.maxLat,
            BOULDER_VALLEY_BBOX.minLng, BOULDER_VALLEY_BBOX.maxLng);
    
    console.log(`🥾 Found ${trails.length} trails in Boulder Valley Ranch area`);
    
    // Create GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      features: []
    };
    
    // Add nodes as Point features
    nodes.forEach(node => {
      geojson.features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [node.lng, node.lat]
        },
        properties: {
          id: node.id,
          elevation: node.elevation,
          node_type: node.node_type,
          feature_type: 'node'
        }
      });
    });
    
    // Add edges as LineString features
    edges.forEach(edge => {
      geojson.features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [edge.source_lng, edge.source_lat],
            [edge.target_lng, edge.target_lat]
          ]
        },
        properties: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          trail_name: edge.trail_name,
          distance_km: edge.distance_km,
          elevation_gain: edge.elevation_gain,
          elevation_loss: edge.elevation_loss,
          feature_type: 'edge'
        }
      });
    });
    
    // Add trails as Point features (using trail centerpoints)
    trails.forEach(trail => {
      geojson.features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [trail.bbox_min_lng, trail.bbox_min_lat]
        },
        properties: {
          id: trail.id,
          name: trail.name,
          length_km: trail.length_km,
          elevation_gain: trail.elevation_gain,
          elevation_loss: trail.elevation_loss,
          feature_type: 'trail'
        }
      });
    });
    
    // Write GeoJSON to file
    const outputPath = path.join(__dirname, '..', 'boulder-valley-ranch-network.geojson');
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ GeoJSON written to: ${outputPath}`);
    console.log(`📊 Summary:`);
    console.log(`   - Nodes: ${nodes.length}`);
    console.log(`   - Edges: ${edges.length}`);
    console.log(`   - Trails: ${trails.length}`);
    console.log(`   - Total features: ${geojson.features.length}`);
    
    // Log some specific trails found
    const trailNames = trails.map(t => t.name);
    console.log(`🏃 Sample trails found: ${trailNames.slice(0, 5).join(', ')}`);
    
    // Check for specific trails we're looking for
    const sageTrails = trailNames.filter(name => name.includes('Sage'));
    const eagleTrails = trailNames.filter(name => name.includes('Eagle'));
    
    if (sageTrails.length > 0) {
      console.log(`🌿 Sage Trail segments found: ${sageTrails.length}`);
    }
    if (eagleTrails.length > 0) {
      console.log(`🦅 Eagle Trail segments found: ${eagleTrails.length}`);
    }
    
  } catch (error) {
    console.error('❌ Error generating GeoJSON:', error);
  } finally {
    db.close();
  }
}

// Run the script
if (require.main === module) {
  generateBoulderValleyRanchGeoJSON();
}

module.exports = { generateBoulderValleyRanchGeoJSON }; 