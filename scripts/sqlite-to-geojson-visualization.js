#!/usr/bin/env node
/**
 * SQLite to GeoJSON Visualization Script
 * 
 * Exports trails, nodes, and edges from SQLite database to GeoJSON for visualization
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function exportSqliteToGeoJSON(dbPath, outputPath) {
  console.log(`🗺️ Exporting SQLite database to GeoJSON: ${dbPath} -> ${outputPath}`);
  
  const db = new Database(dbPath);
  
  // Create GeoJSON FeatureCollection
  const geojson = {
    type: 'FeatureCollection',
    features: []
  };
  
  try {
    // Export trails
    console.log('📋 Exporting trails...');
    const trails = db.prepare(`
      SELECT 
        app_uuid,
        name,
        region,
        osm_id,
        osm_type,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        difficulty,
        surface_type,
        trail_type,
        geojson,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        created_at,
        updated_at
      FROM trails
      WHERE geojson IS NOT NULL
      ORDER BY name
    `).all();
    
    trails.forEach(trail => {
      try {
        const geometry = JSON.parse(trail.geojson);
        geojson.features.push({
          type: 'Feature',
          properties: {
            id: trail.app_uuid,
            name: trail.name,
            type: 'trail',
            region: trail.region,
            osm_id: trail.osm_id,
            osm_type: trail.osm_type,
            length_km: trail.length_km,
            elevation_gain: trail.elevation_gain,
            elevation_loss: trail.elevation_loss,
            max_elevation: trail.max_elevation,
            min_elevation: trail.min_elevation,
            avg_elevation: trail.avg_elevation,
            difficulty: trail.difficulty,
            surface_type: trail.surface_type,
            trail_type: trail.trail_type,
            bbox_min_lng: trail.bbox_min_lng,
            bbox_max_lng: trail.bbox_max_lng,
            bbox_min_lat: trail.bbox_min_lat,
            bbox_max_lat: trail.bbox_max_lat,
            created_at: trail.created_at,
            updated_at: trail.updated_at,
            color: '#00ff00', // Green for trails
            size: 2
          },
          geometry: geometry
        });
      } catch (e) {
        console.warn(`⚠️ Skipping trail ${trail.name} - invalid GeoJSON`);
      }
    });
    
    console.log(`✅ Exported ${trails.length} trails`);
    
    // Export routing nodes
    console.log('📍 Exporting routing nodes...');
    const nodes = db.prepare(`
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        elevation,
        node_type,
        connected_trails
      FROM routing_nodes
      ORDER BY id
    `).all();
    
    nodes.forEach(node => {
      geojson.features.push({
        type: 'Feature',
        properties: {
          id: node.id,
          node_uuid: node.node_uuid,
          type: 'node',
          node_type: node.node_type,
          connected_trails: node.connected_trails,
          color: node.node_type === 'intersection' ? '#ff0000' : '#0000ff', // Red for intersections, blue for endpoints
          size: node.node_type === 'intersection' ? 4 : 2
        },
        geometry: {
          type: 'Point',
          coordinates: [node.lng, node.lat, node.elevation || 0]
        }
      });
    });
    
    console.log(`✅ Exported ${nodes.length} nodes`);
    
    // Export routing edges
    console.log('🛤️ Exporting routing edges...');
    const edges = db.prepare(`
      SELECT 
        id,
        source,
        target,
        trail_id,
        trail_name,
        distance_km,
        elevation_gain,
        elevation_loss,
        geojson
      FROM routing_edges
      WHERE geojson IS NOT NULL
      ORDER BY id
    `).all();
    
    edges.forEach(edge => {
      try {
        const geometry = JSON.parse(edge.geojson);
        geojson.features.push({
          type: 'Feature',
          properties: {
            id: edge.id,
            type: 'edge',
            source: edge.source,
            target: edge.target,
            trail_id: edge.trail_id,
            trail_name: edge.trail_name,
            distance_km: edge.distance_km,
            elevation_gain: edge.elevation_gain,
            elevation_loss: edge.elevation_loss,
            color: '#ff00ff', // Magenta for edges
            size: 1
          },
          geometry: geometry
        });
      } catch (e) {
        console.warn(`⚠️ Skipping edge ${edge.id} - invalid GeoJSON`);
      }
    });
    
    console.log(`✅ Exported ${edges.length} edges`);
    
    // Write GeoJSON file
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    // Print summary
    const trailCount = trails.length;
    const nodeCount = nodes.length;
    const edgeCount = edges.length;
    const intersectionNodes = nodes.filter(n => n.node_type === 'intersection').length;
    const endpointNodes = nodes.filter(n => n.node_type === 'endpoint').length;
    
    console.log('\n📊 Export Summary:');
    console.log(`   🗺️ Trails: ${trailCount}`);
    console.log(`   📍 Nodes: ${nodeCount} (${intersectionNodes} intersections, ${endpointNodes} endpoints)`);
    console.log(`   🛤️ Edges: ${edgeCount}`);
    console.log(`   📁 Output: ${outputPath}`);
    console.log(`   📏 File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
    
    // Calculate ratios
    if (trailCount > 0) {
      console.log(`   📈 Node-to-trail ratio: ${(nodeCount / trailCount).toFixed(2)}`);
      console.log(`   📈 Edge-to-trail ratio: ${(edgeCount / trailCount).toFixed(2)}`);
    }
    
    if (nodeCount > 0) {
      console.log(`   📈 Edge-to-node ratio: ${(edgeCount / nodeCount).toFixed(2)}`);
    }
    
  } catch (error) {
    console.error('❌ Error exporting to GeoJSON:', error);
    throw error;
  } finally {
    db.close();
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: node sqlite-to-geojson-visualization.js <sqlite-db-path> [output-path]');
    console.error('Example: node sqlite-to-geojson-visualization.js boulder.db boulder-visualization.geojson');
    process.exit(1);
  }
  
  const dbPath = args[0];
  const outputPath = args[1] || path.basename(dbPath, '.db') + '-visualization.geojson';
  
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database file not found: ${dbPath}`);
    process.exit(1);
  }
  
  exportSqliteToGeoJSON(dbPath, outputPath);
}

module.exports = { exportSqliteToGeoJSON }; 