#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');

// Database configuration
const dbConfig = {
  host: 'localhost',
  port: 5432,
  user: 'carthorse',
  password: '',
  database: 'trail_master_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

async function exportLayer2Data() {
  const pool = new Pool(dbConfig);
  
  try {
    // Use the specific staging schema from the export
    const stagingSchema = 'carthorse_1755609589571';
    console.log(`Using staging schema: ${stagingSchema}`);
    
    // Check if the required tables exist
    const tablesExist = await pool.query(`
      SELECT 
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as vertices_exist,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as edges_exist
    `, [stagingSchema]);
    
    if (!tablesExist.rows[0].vertices_exist || !tablesExist.rows[0].edges_exist) {
      console.error('Required pgRouting tables not found in staging schema.');
      return;
    }
    
    // Check current degree values
    console.log('Checking current degree values...');
    const degreeCheck = await pool.query(`
      SELECT COUNT(*) as total_vertices, 
             COUNT(CASE WHEN cnt > 0 THEN 1 END) as vertices_with_degree,
             MIN(cnt) as min_degree, 
             MAX(cnt) as max_degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr
    `);
    
    const stats = degreeCheck.rows[0];
    console.log(`Degree stats: ${stats.total_vertices} total vertices, ${stats.vertices_with_degree} with degree > 0, range ${stats.min_degree}-${stats.max_degree}`);
    
    // Export nodes with degree information from existing data
    console.log('Exporting nodes...');
    const nodesResult = await pool.query(`
      SELECT 
        v.id, 
        'node-' || v.id::text as node_uuid, 
        ST_Y(v.the_geom) as lat, 
        ST_X(v.the_geom) as lng, 
        COALESCE(ST_Z(v.the_geom), 0) as elevation, 
        CASE 
          WHEN v.cnt >= 3 THEN 'intersection'
          WHEN v.cnt = 2 THEN 'connector'
          WHEN v.cnt = 1 THEN 'endpoint'
          ELSE 'unknown'
        END as node_type, 
        v.cnt as degree,
        ST_AsGeoJSON(v.the_geom, 6, 0) as geojson
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE v.the_geom IS NOT NULL
      ORDER BY v.id
    `);
    
    // Export edges
    console.log('Exporting edges...');
    const edgesResult = await pool.query(`
      SELECT 
        w.id,
        w.source,
        w.target,
        w.length_km,
        w.elevation_gain,
        w.elevation_loss,
        w.app_uuid as trail_uuid,
        w.name as trail_name,
        ST_AsGeoJSON(w.the_geom, 6, 0) as geojson,
        'edge-' || w.id as edge_uuid,
        'trail_segment' as edge_type,
        'edge' as type
      FROM ${stagingSchema}.ways_noded w
      WHERE w.the_geom IS NOT NULL
      ORDER BY w.id
    `);
    
    // Create GeoJSON features
    const geojson = {
      type: 'FeatureCollection',
      features: []
    };
    
    // Add nodes
    nodesResult.rows.forEach((node) => {
      const degree = parseInt(node.degree) || 0;
      let color, stroke, strokeWidth, fillOpacity, radius;
      
      if (degree === 1) {
        // Endpoints (degree 1) - Green
        color = "#00FF00";
        stroke = "#00FF00";
        strokeWidth = 2;
        fillOpacity = 0.8;
        radius = 4;
      } else if (degree === 2) {
        // Connectors (degree 2) - Blue
        color = "#0000FF";
        stroke = "#0000FF";
        strokeWidth = 2;
        fillOpacity = 0.8;
        radius = 5;
      } else if (degree >= 3) {
        // Intersections (degree ≥3) - Red
        color = "#FF0000";
        stroke = "#FF0000";
        strokeWidth = 3;
        fillOpacity = 0.9;
        radius = 6;
      } else {
        // Unknown degree - Gray
        color = "#808080";
        stroke = "#808080";
        strokeWidth = 1;
        fillOpacity = 0.5;
        radius = 3;
      }
      
      geojson.features.push({
        type: 'Feature',
        geometry: JSON.parse(node.geojson),
        properties: {
          id: node.id,
          node_uuid: node.node_uuid,
          lat: node.lat,
          lng: node.lng,
          elevation: node.elevation,
          node_type: node.node_type,
          degree: node.degree,
          type: 'edge_network_vertex',
          color: color,
          stroke: stroke,
          strokeWidth: strokeWidth,
          fillOpacity: fillOpacity,
          radius: radius
        }
      });
    });
    
    // Add edges
    edgesResult.rows.forEach((edge) => {
      geojson.features.push({
        type: 'Feature',
        geometry: JSON.parse(edge.geojson),
        properties: {
          id: edge.id,
          edge_uuid: edge.edge_uuid,
          source: edge.source,
          target: edge.target,
          length_km: edge.length_km,
          elevation_gain: edge.elevation_gain,
          elevation_loss: edge.elevation_loss,
          trail_uuid: edge.trail_uuid,
          trail_name: edge.trail_name,
          edge_type: edge.edge_type,
          type: edge.type,
          color: "#4169E1",
          stroke: "#4169E1",
          strokeWidth: 1,
          fillOpacity: 0.4
        }
      });
    });
    
    // Write to file
    const outputPath = './test-output/layer2-nodes-edges-pgr-analyze.geojson';
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported ${nodesResult.rows.length} nodes and ${edgesResult.rows.length} edges`);
    console.log(`📄 Output file: ${outputPath}`);
    
    // Print degree statistics
    const degreeStats = nodesResult.rows.reduce((stats, node) => {
      const degree = parseInt(node.degree) || 0;
      stats[degree] = (stats[degree] || 0) + 1;
      return stats;
    }, {});
    
    console.log('\n📊 Node degree statistics:');
    Object.keys(degreeStats).sort((a, b) => parseInt(a) - parseInt(b)).forEach(degree => {
      console.log(`  Degree ${degree}: ${degreeStats[degree]} nodes`);
    });
    
  } catch (error) {
    console.error('Error exporting Layer 2 data:', error);
  } finally {
    await pool.end();
  }
}

exportLayer2Data();
