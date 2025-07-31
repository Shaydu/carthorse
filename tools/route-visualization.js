#!/usr/bin/env node

/**
 * Route Recommendation Visualization Tool
 * 
 * This tool visualizes recommended routes from the staging schema in an interactive map.
 * It reads route recommendations from PostgreSQL and generates GeoJSON for visualization.
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  stagingSchema: process.env.STAGING_SCHEMA || 'boulder_staging',
  outputDir: 'tools/route-visualization-output'
};

// Ensure output directory exists
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

async function connectToDatabase() {
  const client = new Client(config);
  await client.connect();
  return client;
}

async function getRouteRecommendations(client, schema) {
  console.log(`📊 Fetching route recommendations from ${schema}...`);
  
  const query = `
    SELECT 
      id,
      route_uuid,
      region,
      input_distance_km,
      input_elevation_gain,
      recommended_distance_km,
      recommended_elevation_gain,
      recommended_elevation_loss,
      route_score,
      route_type,
      route_shape,
      trail_count,
      route_path,
      route_edges,
      created_at
    FROM ${schema}.route_recommendations
    ORDER BY route_score DESC, recommended_distance_km ASC
    LIMIT 50
  `;
  
  const result = await client.query(query);
  console.log(`✅ Found ${result.rows.length} route recommendations`);
  return result.rows;
}

async function getTrailData(client, schema) {
  console.log(`🗺️ Fetching trail data from ${schema}...`);
  
  const query = `
    SELECT 
      id,
      name,
      length_km,
      elevation_gain,
      elevation_loss,
      max_elevation,
      min_elevation,
      avg_elevation,
      geojson,
      source
    FROM ${schema}.trails
    ORDER BY name
  `;
  
  const result = await client.query(query);
  console.log(`✅ Found ${result.rows.length} trails`);
  return result.rows;
}

async function getRoutingGraph(client, schema) {
  console.log(`🕸️ Fetching routing graph from ${schema}...`);
  
  const nodesQuery = `
    SELECT 
      id,
      lat,
      lng,
      elevation,
      node_type,
      geojson
    FROM ${schema}.routing_nodes
    ORDER BY id
  `;
  
  const edgesQuery = `
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
    FROM ${schema}.routing_edges
    ORDER BY id
  `;
  
  const [nodesResult, edgesResult] = await Promise.all([
    client.query(nodesQuery),
    client.query(edgesQuery)
  ]);
  
  console.log(`✅ Found ${nodesResult.rows.length} routing nodes and ${edgesResult.rows.length} routing edges`);
  return {
    nodes: nodesResult.rows,
    edges: edgesResult.rows
  };
}

function createGeoJSONFeature(geometry, properties) {
  return {
    type: "Feature",
    geometry: typeof geometry === 'string' ? JSON.parse(geometry) : geometry,
    properties: properties
  };
}

function generateRouteVisualizationData(routes, trails, routingGraph) {
  console.log('🎨 Generating visualization data...');
  
  // Convert routes to GeoJSON
  const routeFeatures = routes.map(route => {
    const routePath = JSON.parse(route.route_path);
    return createGeoJSONFeature(routePath, {
      id: route.id,
      route_uuid: route.route_uuid,
      name: `Route ${route.id}`,
      distance_km: route.recommended_distance_km,
      elevation_gain: route.recommended_elevation_gain,
      elevation_loss: route.recommended_elevation_loss,
      route_score: route.route_score,
      route_type: route.route_type,
      route_shape: route.route_shape,
      trail_count: route.trail_count,
      input_distance_km: route.input_distance_km,
      input_elevation_gain: route.input_elevation_gain,
      created_at: route.created_at,
      type: 'route'
    });
  });
  
  // Convert trails to GeoJSON
  const trailFeatures = trails.map(trail => {
    return createGeoJSONFeature(trail.geojson, {
      id: trail.id,
      name: trail.name,
      length_km: trail.length_km,
      elevation_gain: trail.elevation_gain,
      elevation_loss: trail.elevation_loss,
      max_elevation: trail.max_elevation,
      min_elevation: trail.min_elevation,
      avg_elevation: trail.avg_elevation,
      source: trail.source,
      type: 'trail'
    });
  });
  
  // Convert routing nodes to GeoJSON
  const nodeFeatures = routingGraph.nodes.map(node => {
    return createGeoJSONFeature(node.geojson, {
      id: node.id,
      lat: node.lat,
      lng: node.lng,
      elevation: node.elevation,
      node_type: node.node_type,
      type: 'routing_node'
    });
  });
  
  // Convert routing edges to GeoJSON
  const edgeFeatures = routingGraph.edges.map(edge => {
    return createGeoJSONFeature(edge.geojson, {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      trail_id: edge.trail_id,
      trail_name: edge.trail_name,
      distance_km: edge.distance_km,
      elevation_gain: edge.elevation_gain,
      elevation_loss: edge.elevation_loss,
      type: 'routing_edge'
    });
  });
  
  return {
    routes: {
      type: "FeatureCollection",
      features: routeFeatures
    },
    trails: {
      type: "FeatureCollection", 
      features: trailFeatures
    },
    routingNodes: {
      type: "FeatureCollection",
      features: nodeFeatures
    },
    routingEdges: {
      type: "FeatureCollection",
      features: edgeFeatures
    }
  };
}

function generateHTMLVisualization(data, stats) {
  console.log('🌐 Generating HTML visualization...');
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Route Recommendations Visualization</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1800px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 2em;
            font-weight: 300;
        }
        .header p {
            margin: 10px 0 0 0;
            opacity: 0.9;
        }
        .content {
            display: flex;
            min-height: 800px;
        }
        .sidebar {
            width: 450px;
            padding: 20px;
            background: #f8f9fa;
            border-right: 1px solid #e9ecef;
            overflow-y: auto;
        }
        .map-container {
            flex: 1;
            position: relative;
        }
        #map {
            height: 100%;
            width: 100%;
        }
        .stats-section {
            margin-bottom: 20px;
            padding: 15px;
            background: white;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .stats-section h3 {
            margin: 0 0 10px 0;
            color: #333;
            font-size: 1.1em;
        }
        .stat-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }
        .stat-item {
            background: #f8f9fa;
            padding: 8px;
            border-radius: 4px;
            text-align: center;
        }
        .stat-value {
            font-size: 1.2em;
            font-weight: bold;
            color: #007bff;
        }
        .stat-label {
            font-size: 0.8em;
            color: #666;
        }
        .route-list {
            max-height: 400px;
            overflow-y: auto;
        }
        .route-item {
            background: white;
            margin-bottom: 10px;
            padding: 12px;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            cursor: pointer;
            transition: all 0.2s;
        }
        .route-item:hover {
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            transform: translateY(-1px);
        }
        .route-item.selected {
            border-left: 4px solid #007bff;
            background: #f8f9ff;
        }
        .route-name {
            font-weight: bold;
            color: #333;
            margin-bottom: 5px;
        }
        .route-details {
            font-size: 0.9em;
            color: #666;
        }
        .route-score {
            float: right;
            background: #28a745;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8em;
        }
        .controls {
            margin-bottom: 20px;
        }
        .control-group {
            margin-bottom: 15px;
        }
        .control-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #333;
        }
        .checkbox-group {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }
        .checkbox-item {
            display: flex;
            align-items: center;
        }
        .checkbox-item input[type="checkbox"] {
            margin-right: 6px;
        }
        .legend {
            margin-top: 20px;
        }
        .legend h3 {
            margin: 0 0 10px 0;
            color: #333;
        }
        .legend-item {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
        }
        .legend-color {
            width: 20px;
            height: 20px;
            border-radius: 3px;
            margin-right: 8px;
        }
        .popup-content {
            max-width: 300px;
        }
        .popup-title {
            font-weight: bold;
            margin-bottom: 8px;
            color: #333;
        }
        .popup-detail {
            margin-bottom: 4px;
            font-size: 0.9em;
        }
        .popup-label {
            font-weight: bold;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🗺️ Route Recommendations Visualization</h1>
            <p>Interactive map showing recommended routes from ${config.stagingSchema}</p>
        </div>
        
        <div class="content">
            <div class="sidebar">
                <div class="stats-section">
                    <h3>📊 Statistics</h3>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <div class="stat-value">${stats.totalRoutes}</div>
                            <div class="stat-label">Routes</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${stats.totalTrails}</div>
                            <div class="stat-label">Trails</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${stats.avgDistance.toFixed(1)}km</div>
                            <div class="stat-label">Avg Distance</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${stats.avgElevation.toFixed(0)}m</div>
                            <div class="stat-label">Avg Elevation</div>
                        </div>
                    </div>
                </div>
                
                <div class="controls">
                    <h3>🗺️ Map Layers</h3>
                    <div class="control-group">
                        <label>Routes:</label>
                        <div class="checkbox-group">
                            <div class="checkbox-item">
                                <input type="checkbox" id="show-routes" checked>
                                <label for="show-routes">Recommended Routes</label>
                            </div>
                        </div>
                    </div>
                    <div class="control-group">
                        <label>Trails:</label>
                        <div class="checkbox-group">
                            <div class="checkbox-item">
                                <input type="checkbox" id="show-trails" checked>
                                <label for="show-trails">Individual Trails</label>
                            </div>
                        </div>
                    </div>
                    <div class="control-group">
                        <label>Routing Graph:</label>
                        <div class="checkbox-group">
                            <div class="checkbox-item">
                                <input type="checkbox" id="show-nodes" checked>
                                <label for="show-nodes">Routing Nodes</label>
                            </div>
                            <div class="checkbox-item">
                                <input type="checkbox" id="show-edges" checked>
                                <label for="show-edges">Routing Edges</label>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="legend">
                    <h3>🎨 Legend</h3>
                    <div class="legend-item">
                        <div class="legend-color" style="background: #ff4444;"></div>
                        <span>Recommended Routes</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background: #3388ff;"></div>
                        <span>Individual Trails</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background: #ffaa00;"></div>
                        <span>Routing Nodes</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background: #aa44ff;"></div>
                        <span>Routing Edges</span>
                    </div>
                </div>
                
                <div class="route-list">
                    <h3>🏃‍♂️ Route List</h3>
                    ${data.routes.features.map(route => `
                        <div class="route-item" data-route-id="${route.properties.id}">
                            <div class="route-score">${route.properties.route_score.toFixed(0)}</div>
                            <div class="route-name">${route.properties.name}</div>
                            <div class="route-details">
                                ${route.properties.distance_km.toFixed(1)}km • 
                                +${route.properties.elevation_gain.toFixed(0)}m • 
                                ${route.properties.route_shape} • 
                                ${route.properties.trail_count} trail${route.properties.trail_count > 1 ? 's' : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="map-container">
                <div id="map"></div>
            </div>
        </div>
    </div>

    <script>
        let map;
        let routesLayer, trailsLayer, nodesLayer, edgesLayer;
        let selectedRoute = null;

        // Initialize map
        function initMap() {
            map = L.map('map').setView([39.985, -105.285], 13);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);
        }

        // Load route data
        function loadRouteData() {
            // Load recommended routes
            fetch('routes.geojson')
                .then(response => response.json())
                .then(data => {
                    routesLayer = L.geoJSON(data, {
                        style: function(feature) {
                            const score = feature.properties.route_score;
                            let color = '#ff4444';
                            if (score >= 80) color = '#28a745';
                            else if (score >= 60) color = '#ffc107';
                            else if (score >= 40) color = '#fd7e14';
                            
                            return {
                                color: color,
                                weight: 6,
                                opacity: 0.8
                            };
                        },
                        onEachFeature: function(feature, layer) {
                            const props = feature.properties;
                            layer.bindPopup(\`
                                <div class="popup-content">
                                    <div class="popup-title">\${props.name}</div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Distance:</span> \${props.distance_km.toFixed(1)}km
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Elevation Gain:</span> +\${props.elevation_gain.toFixed(0)}m
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Elevation Loss:</span> -\${props.elevation_loss.toFixed(0)}m
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Route Shape:</span> \${props.route_shape}
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Trail Count:</span> \${props.trail_count}
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Route Type:</span> \${props.route_type || 'N/A'}
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Score:</span> \${props.route_score.toFixed(1)}
                                    </div>
                                </div>
                            \`);
                        }
                    });
                    
                    if (document.getElementById('show-routes').checked) {
                        routesLayer.addTo(map);
                    }
                });

            // Load trails
            fetch('trails.geojson')
                .then(response => response.json())
                .then(data => {
                    trailsLayer = L.geoJSON(data, {
                        style: {
                            color: '#3388ff',
                            weight: 3,
                            opacity: 0.6
                        },
                        onEachFeature: function(feature, layer) {
                            const props = feature.properties;
                            layer.bindPopup(\`
                                <div class="popup-content">
                                    <div class="popup-title">\${props.name}</div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Length:</span> \${props.length_km.toFixed(1)}km
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Elevation Gain:</span> +\${props.elevation_gain.toFixed(0)}m
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Elevation Loss:</span> -\${props.elevation_loss.toFixed(0)}m
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Max Elevation:</span> \${props.max_elevation.toFixed(0)}m
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Min Elevation:</span> \${props.min_elevation.toFixed(0)}m
                                    </div>
                                </div>
                            \`);
                        }
                    });
                    
                    if (document.getElementById('show-trails').checked) {
                        trailsLayer.addTo(map);
                    }
                });

            // Load routing nodes
            fetch('routing-nodes.geojson')
                .then(response => response.json())
                .then(data => {
                    nodesLayer = L.geoJSON(data, {
                        pointToLayer: function(feature, latlng) {
                            return L.circleMarker(latlng, {
                                radius: 4,
                                fillColor: '#ffaa00',
                                color: '#cc8800',
                                weight: 1,
                                opacity: 1,
                                fillOpacity: 0.8
                            });
                        },
                        onEachFeature: function(feature, layer) {
                            const props = feature.properties;
                            layer.bindPopup(\`
                                <div class="popup-content">
                                    <div class="popup-title">Routing Node \${props.id}</div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Elevation:</span> \${props.elevation.toFixed(0)}m
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Type:</span> \${props.node_type}
                                    </div>
                                </div>
                            \`);
                        }
                    });
                    
                    if (document.getElementById('show-nodes').checked) {
                        nodesLayer.addTo(map);
                    }
                });

            // Load routing edges
            fetch('routing-edges.geojson')
                .then(response => response.json())
                .then(data => {
                    edgesLayer = L.geoJSON(data, {
                        style: {
                            color: '#aa44ff',
                            weight: 2,
                            opacity: 0.4
                        },
                        onEachFeature: function(feature, layer) {
                            const props = feature.properties;
                            layer.bindPopup(\`
                                <div class="popup-content">
                                    <div class="popup-title">Routing Edge \${props.id}</div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Trail:</span> \${props.trail_name || 'N/A'}
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Distance:</span> \${props.distance_km.toFixed(2)}km
                                    </div>
                                    <div class="popup-detail">
                                        <span class="popup-label">Elevation Gain:</span> +\${props.elevation_gain.toFixed(0)}m
                                    </div>
                                </div>
                            \`);
                        }
                    });
                    
                    if (document.getElementById('show-edges').checked) {
                        edgesLayer.addTo(map);
                    }
                });
        }

        // Layer controls
        document.getElementById('show-routes').addEventListener('change', function() {
            if (this.checked) {
                if (routesLayer) routesLayer.addTo(map);
            } else {
                if (routesLayer) map.removeLayer(routesLayer);
            }
        });

        document.getElementById('show-trails').addEventListener('change', function() {
            if (this.checked) {
                if (trailsLayer) trailsLayer.addTo(map);
            } else {
                if (trailsLayer) map.removeLayer(trailsLayer);
            }
        });

        document.getElementById('show-nodes').addEventListener('change', function() {
            if (this.checked) {
                if (nodesLayer) nodesLayer.addTo(map);
            } else {
                if (nodesLayer) map.removeLayer(nodesLayer);
            }
        });

        document.getElementById('show-edges').addEventListener('change', function() {
            if (this.checked) {
                if (edgesLayer) edgesLayer.addTo(map);
            } else {
                if (edgesLayer) map.removeLayer(edgesLayer);
            }
        });

        // Route selection
        document.querySelectorAll('.route-item').forEach(item => {
            item.addEventListener('click', function() {
                const routeId = this.dataset.routeId;
                
                // Update selection
                document.querySelectorAll('.route-item').forEach(i => i.classList.remove('selected'));
                this.classList.add('selected');
                
                // Highlight route on map
                if (routesLayer) {
                    routesLayer.eachLayer(layer => {
                        if (layer.feature && layer.feature.properties.id == routeId) {
                            layer.setStyle({
                                color: '#ff0000',
                                weight: 8,
                                opacity: 1
                            });
                            map.fitBounds(layer.getBounds());
                        } else {
                            layer.setStyle({
                                color: '#ff4444',
                                weight: 6,
                                opacity: 0.8
                            });
                        }
                    });
                }
            });
        });

        // Initialize
        initMap();
        loadRouteData();
    </script>
</body>
</html>`;

  return html;
}

async function main() {
  console.log('🗺️ Route Recommendation Visualization Tool');
  console.log(`📊 Connecting to database: ${config.database}`);
  console.log(`🎯 Staging schema: ${config.stagingSchema}`);
  
  const client = await connectToDatabase();
  
  try {
    // Fetch data from staging schema
    const [routes, trails, routingGraph] = await Promise.all([
      getRouteRecommendations(client, config.stagingSchema),
      getTrailData(client, config.stagingSchema),
      getRoutingGraph(client, config.stagingSchema)
    ]);
    
    // Generate visualization data
    const visualizationData = generateRouteVisualizationData(routes, trails, routingGraph);
    
    // Calculate statistics
    const stats = {
      totalRoutes: routes.length,
      totalTrails: trails.length,
      avgDistance: routes.length > 0 ? routes.reduce((sum, r) => sum + r.recommended_distance_km, 0) / routes.length : 0,
      avgElevation: routes.length > 0 ? routes.reduce((sum, r) => sum + r.recommended_elevation_gain, 0) / routes.length : 0
    };
    
    // Write GeoJSON files
    console.log('💾 Writing GeoJSON files...');
    fs.writeFileSync(
      path.join(config.outputDir, 'routes.geojson'),
      JSON.stringify(visualizationData.routes, null, 2)
    );
    fs.writeFileSync(
      path.join(config.outputDir, 'trails.geojson'),
      JSON.stringify(visualizationData.trails, null, 2)
    );
    fs.writeFileSync(
      path.join(config.outputDir, 'routing-nodes.geojson'),
      JSON.stringify(visualizationData.routingNodes, null, 2)
    );
    fs.writeFileSync(
      path.join(config.outputDir, 'routing-edges.geojson'),
      JSON.stringify(visualizationData.routingEdges, null, 2)
    );
    
    // Generate HTML visualization
    const html = generateHTMLVisualization(visualizationData, stats);
    fs.writeFileSync(path.join(config.outputDir, 'index.html'), html);
    
    console.log('✅ Visualization generated successfully!');
    console.log(`📁 Output directory: ${config.outputDir}`);
    console.log('🌐 To view the visualization:');
    console.log(`   cd ${config.outputDir} && python3 -m http.server 8083`);
    console.log('   Then open: http://localhost:8083');
    
  } catch (error) {
    console.error('❌ Error generating visualization:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main }; 