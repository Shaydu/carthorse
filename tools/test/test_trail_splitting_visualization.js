const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function generateTestSplittingVisualization() {
    console.log('🧪 Generating test trail splitting visualization...');
    
    const client = new Client({
        database: 'trail_master_db_test'
    });
    
    try {
        await client.connect();
        
        // Get test trails data (pre-split) - using realistic test data
        const testTrails = await client.query(`
            SELECT 
                app_uuid, name, trail_type, surface, difficulty, length_km,
                elevation_gain, elevation_loss, max_elevation, min_elevation,
                ST_AsGeoJSON(geometry) as geojson
            FROM trails 
            WHERE name LIKE 'TEST_%'
            ORDER BY name
        `);
        
        // Get intersection points for test trails (from main schema)
        const testIntersections = await client.query(`
            SELECT 
                id, connected_trail_names, array_length(connected_trail_names, 1) as trail_count,
                ST_AsGeoJSON(point) as geojson
            FROM intersection_points 
            WHERE EXISTS (
                SELECT 1 FROM unnest(connected_trail_names) AS trail_name 
                WHERE trail_name LIKE 'TEST_%'
            )
            ORDER BY id
        `);
        
        // Get split trails for test cases (from staging schema)
        const splitTrails = await client.query(`
            SELECT 
                s.id, s.name as original_trail_name, s.segment_number,
                ST_AsGeoJSON(s.geometry) as geojson
            FROM test_staging.trails s
            WHERE s.name LIKE 'TEST_%'
            ORDER BY s.name, s.segment_number
        `);
        
        // Get routing nodes for test cases
        const testNodes = await client.query(`
            SELECT 
                id, node_id, lat, lng, elevation, node_type,
                ST_AsGeoJSON(geometry) as geojson
            FROM routing_nodes n
            WHERE EXISTS (
                SELECT 1 FROM trails t 
                WHERE t.name LIKE 'TEST_%' 
                AND ST_DWithin(n.geometry, t.geometry, 0.001)
            )
            ORDER BY id
        `);
        
        // Get routing edges for test cases
        const testEdges = await client.query(`
            SELECT 
                e.id, e.from_node_id, e.to_node_id, e.trail_id, e.trail_name,
                e.distance_km, e.elevation_gain, e.elevation_loss,
                ST_AsGeoJSON(e.geometry) as geojson
            FROM routing_edges e
            JOIN trails t ON e.trail_id = t.app_uuid
            WHERE t.name LIKE 'TEST_%'
            ORDER BY e.id
        `);
        
        console.log(`📊 Test Data Summary:`);
        console.log(`   Original Test Trails: ${testTrails.rows.length}`);
        console.log(`   Intersection Points: ${testIntersections.rows.length}`);
        console.log(`   Split Trail Segments: ${splitTrails.rows.length}`);
        console.log(`   Routing Nodes: ${testNodes.rows.length}`);
        console.log(`   Routing Edges: ${testEdges.rows.length}`);
        
        // Create output directory
        const outputDir = path.join(__dirname, 'test-splitting-visualization');
        fs.mkdirSync(outputDir, { recursive: true });
        
        // Generate pre-split visualization
        const preSplitData = {
            trails: testTrails.rows.map(row => ({
                type: 'Feature',
                geometry: row.geojson ? JSON.parse(row.geojson) : null,
                properties: {
                    id: row.app_uuid,
                    name: row.name,
                    trail_type: row.trail_type,
                    surface: row.surface,
                    difficulty: row.difficulty,
                    length_km: row.length_km,
                    elevation_gain: row.elevation_gain,
                    elevation_loss: row.elevation_loss,
                    max_elevation: row.max_elevation,
                    min_elevation: row.min_elevation,
                    test_type: getTestType(row.name)
                }
            })).filter(feature => feature.geometry !== null),
            intersections: testIntersections.rows.map(row => ({
                type: 'Feature',
                geometry: row.geojson ? JSON.parse(row.geojson) : null,
                properties: {
                    id: row.point_id,
                    connected_trail_names: row.connected_trail_names,
                    trail_count: row.trail_count
                }
            })).filter(feature => feature.geometry !== null)
        };
        
        // Generate post-split visualization
        const postSplitData = {
            split_trails: splitTrails.rows.map(row => ({
                type: 'Feature',
                geometry: row.geojson ? JSON.parse(row.geojson) : null,
                properties: {
                    id: row.id,
                    original_trail_name: row.original_trail_name,
                    segment_order: row.segment_number,
                    test_type: getTestType(row.original_trail_name)
                }
            })).filter(feature => feature.geometry !== null),
            nodes: testNodes.rows.map(row => ({
                type: 'Feature',
                geometry: row.geojson ? JSON.parse(row.geojson) : null,
                properties: {
                    id: row.id,
                    node_id: row.node_id,
                    elevation: row.elevation,
                    node_type: row.node_type
                }
            })).filter(feature => feature.geometry !== null),
            edges: testEdges.rows.map(row => ({
                type: 'Feature',
                geometry: row.geojson ? JSON.parse(row.geojson) : null,
                properties: {
                    id: row.id,
                    from_node_id: row.from_node_id,
                    to_node_id: row.to_node_id,
                    trail_id: row.trail_id,
                    trail_name: row.trail_name,
                    distance_km: row.distance_km,
                    elevation_gain: row.elevation_gain,
                    elevation_loss: row.elevation_loss
                }
            })).filter(feature => feature.geometry !== null)
        };
        
        // Write pre-split data
        fs.writeFileSync(
            path.join(outputDir, 'pre-split-trails.geojson'),
            JSON.stringify({ type: 'FeatureCollection', features: preSplitData.trails }, null, 2)
        );
        
        fs.writeFileSync(
            path.join(outputDir, 'pre-split-intersections.geojson'),
            JSON.stringify({ type: 'FeatureCollection', features: preSplitData.intersections }, null, 2)
        );
        
        // Write post-split data
        fs.writeFileSync(
            path.join(outputDir, 'post-split-trails.geojson'),
            JSON.stringify({ type: 'FeatureCollection', features: postSplitData.split_trails }, null, 2)
        );
        
        fs.writeFileSync(
            path.join(outputDir, 'post-split-nodes.geojson'),
            JSON.stringify({ type: 'FeatureCollection', features: postSplitData.nodes }, null, 2)
        );
        
        fs.writeFileSync(
            path.join(outputDir, 'post-split-edges.geojson'),
            JSON.stringify({ type: 'FeatureCollection', features: postSplitData.edges }, null, 2)
        );
        
        // Generate test summary
        const testSummary = {
            timestamp: new Date().toISOString(),
            test_cases: {
                y_intersection: {
                    original_trails: testTrails.rows.filter(t => t.name.includes('Y')).length,
                    split_segments: splitTrails.rows.filter(s => s.original_trail_name.includes('Y')).length,
                    nodes: testNodes.rows.filter(n => n.node_type === 'intersection').length,
                    edges: testEdges.rows.filter(e => e.trail_name.includes('Y')).length
                },
                t_intersection: {
                    original_trails: testTrails.rows.filter(t => t.name.includes('T')).length,
                    split_segments: splitTrails.rows.filter(s => s.original_trail_name.includes('T')).length,
                    nodes: testNodes.rows.filter(n => n.node_type === 'intersection').length,
                    edges: testEdges.rows.filter(e => e.trail_name.includes('T')).length
                },
                x_intersection: {
                    original_trails: testTrails.rows.filter(t => t.name.includes('X')).length,
                    split_segments: splitTrails.rows.filter(s => s.original_trail_name.includes('X')).length,
                    nodes: testNodes.rows.filter(n => n.node_type === 'intersection').length,
                    edges: testEdges.rows.filter(e => e.trail_name.includes('X')).length
                }
            },
            stats: {
                original_trails: testTrails.rows.length,
                intersection_points: testIntersections.rows.length,
                split_segments: splitTrails.rows.length,
                routing_nodes: testNodes.rows.length,
                routing_edges: testEdges.rows.length
            }
        };
        
        fs.writeFileSync(
            path.join(outputDir, 'test-summary.json'),
            JSON.stringify(testSummary, null, 2)
        );
        
        // Generate HTML visualization
        const htmlContent = generateTestHTMLVisualization(testSummary);
        fs.writeFileSync(
            path.join(outputDir, 'index.html'),
            htmlContent
        );
        
        console.log('✅ Test splitting visualization generated successfully!');
        console.log(`📁 Output directory: ${outputDir}`);
        console.log(`🌐 Open ${path.join(outputDir, 'index.html')} in your browser to view the test results`);
        
        return {
            outputDir,
            testSummary,
            preSplitData,
            postSplitData
        };
        
    } finally {
        await client.end();
    }
}

function getTestType(trailName) {
    if (trailName.includes('Y')) return 'Y-intersection';
    if (trailName.includes('T')) return 'T-intersection';
    if (trailName.includes('X')) return 'X-intersection';
    return 'unknown';
}

function generateTestHTMLVisualization(summary) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trail Splitting Test Visualization</title>
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
            max-width: 1600px;
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
            width: 400px;
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
        .test-section {
            margin-bottom: 20px;
            padding: 15px;
            background: white;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .test-section h3 {
            margin: 0 0 10px 0;
            color: #333;
            font-size: 1.1em;
        }
        .test-case {
            margin-bottom: 15px;
            padding: 10px;
            border-radius: 4px;
            border-left: 4px solid #007bff;
        }
        .test-case.y { border-left-color: #28a745; }
        .test-case.t { border-left-color: #ffc107; }
        .test-case.x { border-left-color: #dc3545; }
        .test-case h4 {
            margin: 0 0 8px 0;
            font-size: 1em;
        }
        .test-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 5px;
            font-size: 0.85em;
        }
        .test-stat {
            display: flex;
            justify-content: space-between;
        }
        .test-stat-label {
            color: #666;
        }
        .test-stat-value {
            font-weight: 600;
            color: #333;
        }
        .controls {
            margin-bottom: 20px;
            padding: 15px;
            background: white;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .control-group {
            margin-bottom: 10px;
        }
        .control-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
            color: #333;
        }
        .checkbox-group {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }
        .checkbox-item {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .checkbox-item input[type="checkbox"] {
            margin: 0;
        }
        .legend {
            margin-top: 20px;
            padding: 15px;
            background: white;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .legend-item {
            display: flex;
            align-items: center;
            margin: 5px 0;
            font-size: 0.9em;
        }
        .legend-color {
            width: 20px;
            height: 20px;
            border-radius: 3px;
            margin-right: 10px;
        }
        .view-toggle {
            margin-bottom: 15px;
            padding: 15px;
            background: white;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .toggle-buttons {
            display: flex;
            gap: 10px;
        }
        .toggle-btn {
            padding: 8px 16px;
            border: 1px solid #007bff;
            background: white;
            color: #007bff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
        }
        .toggle-btn.active {
            background: #007bff;
            color: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Trail Splitting Test Visualization</h1>
            <p>Y, T, and X Intersection Test Cases - ${summary.timestamp}</p>
        </div>
        <div class="content">
            <div class="sidebar">
                <div class="view-toggle">
                    <h3>🔍 View Mode</h3>
                    <div class="toggle-buttons">
                        <button class="toggle-btn active" onclick="switchView('pre-split')">Pre-Split</button>
                        <button class="toggle-btn" onclick="switchView('post-split')">Post-Split</button>
                    </div>
                </div>

                <div class="test-section">
                    <h3>🧪 Test Cases</h3>
                    <div class="test-case y">
                        <h4>Y Intersection</h4>
                        <div class="test-stats">
                            <div class="test-stat">
                                <span class="test-stat-label">Original Trails:</span>
                                <span class="test-stat-value">${summary.test_cases.y_intersection.original_trails}</span>
                            </div>
                            <div class="test-stat">
                                <span class="test-stat-label">Split Segments:</span>
                                <span class="test-stat-value">${summary.test_cases.y_intersection.split_segments}</span>
                            </div>
                            <div class="test-stat">
                                <span class="test-stat-label">Nodes:</span>
                                <span class="test-stat-value">${summary.test_cases.y_intersection.nodes}</span>
                            </div>
                            <div class="test-stat">
                                <span class="test-stat-label">Edges:</span>
                                <span class="test-stat-value">${summary.test_cases.y_intersection.edges}</span>
                            </div>
                        </div>
                    </div>
                    <div class="test-case t">
                        <h4>T Intersection</h4>
                        <div class="test-stats">
                            <div class="test-stat">
                                <span class="test-stat-label">Original Trails:</span>
                                <span class="test-stat-value">${summary.test_cases.t_intersection.original_trails}</span>
                            </div>
                            <div class="test-stat">
                                <span class="test-stat-label">Split Segments:</span>
                                <span class="test-stat-value">${summary.test_cases.t_intersection.split_segments}</span>
                            </div>
                            <div class="test-stat">
                                <span class="test-stat-label">Nodes:</span>
                                <span class="test-stat-value">${summary.test_cases.t_intersection.nodes}</span>
                            </div>
                            <div class="test-stat">
                                <span class="test-stat-label">Edges:</span>
                                <span class="test-stat-value">${summary.test_cases.t_intersection.edges}</span>
                            </div>
                        </div>
                    </div>
                    <div class="test-case x">
                        <h4>X Intersection</h4>
                        <div class="test-stats">
                            <div class="test-stat">
                                <span class="test-stat-label">Original Trails:</span>
                                <span class="test-stat-value">${summary.test_cases.x_intersection.original_trails}</span>
                            </div>
                            <div class="test-stat">
                                <span class="test-stat-label">Split Segments:</span>
                                <span class="test-stat-value">${summary.test_cases.x_intersection.split_segments}</span>
                            </div>
                            <div class="test-stat">
                                <span class="test-stat-label">Nodes:</span>
                                <span class="test-stat-value">${summary.test_cases.x_intersection.nodes}</span>
                            </div>
                            <div class="test-stat">
                                <span class="test-stat-label">Edges:</span>
                                <span class="test-stat-value">${summary.test_cases.x_intersection.edges}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="controls">
                    <h3>🗺️ Map Layers</h3>
                    <div class="control-group">
                        <label>Pre-Split:</label>
                        <div class="checkbox-group">
                            <div class="checkbox-item">
                                <input type="checkbox" id="show-pre-trails" checked>
                                <label for="show-pre-trails">Original Trails</label>
                            </div>
                            <div class="checkbox-item">
                                <input type="checkbox" id="show-pre-intersections" checked>
                                <label for="show-pre-intersections">Intersection Points</label>
                            </div>
                        </div>
                    </div>
                    <div class="control-group">
                        <label>Post-Split:</label>
                        <div class="checkbox-group">
                            <div class="checkbox-item">
                                <input type="checkbox" id="show-post-trails" checked>
                                <label for="show-post-trails">Split Trails</label>
                            </div>
                            <div class="checkbox-item">
                                <input type="checkbox" id="show-post-nodes" checked>
                                <label for="show-post-nodes">Routing Nodes</label>
                            </div>
                            <div class="checkbox-item">
                                <input type="checkbox" id="show-post-edges" checked>
                                <label for="show-post-edges">Routing Edges</label>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="legend">
                    <h3>🎨 Legend</h3>
                    <div class="legend-item">
                        <div class="legend-color" style="background: #3388ff;"></div>
                        <span>Original Trails</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background: #ff4444;"></div>
                        <span>Intersection Points</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background: #44ff44;"></div>
                        <span>Split Trail Segments</span>
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
            </div>
            <div class="map-container">
                <div id="map"></div>
            </div>
        </div>
    </div>

    <script>
        let map, currentView = 'pre-split';
        let preTrailsLayer, preIntersectionsLayer;
        let postTrailsLayer, postNodesLayer, postEdgesLayer;

        // Initialize map
        function initMap() {
            map = L.map('map').setView([39.985, -105.285], 15);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);
        }

        // Load pre-split data
        function loadPreSplitData() {
            // Load original trails
            fetch('pre-split-trails.geojson')
                .then(response => response.json())
                .then(data => {
                    preTrailsLayer = L.geoJSON(data, {
                        style: function(feature) {
                            const testType = feature.properties.test_type;
                            let color = '#3388ff';
                            if (testType === 'Y-intersection') color = '#28a745';
                            else if (testType === 'T-intersection') color = '#ffc107';
                            else if (testType === 'X-intersection') color = '#dc3545';
                            
                            return {
                                color: color,
                                weight: 4,
                                opacity: 0.8
                            };
                        },
                        onEachFeature: function(feature, layer) {
                            if (feature.properties && feature.properties.name) {
                                layer.bindPopup(\`
                                    <strong>\${feature.properties.name}</strong><br>
                                    Test Type: \${feature.properties.test_type}<br>
                                    Length: \${feature.properties.length_km?.toFixed(2) || 'Unknown'} km
                                \`);
                            }
                        }
                    });
                    if (document.getElementById('show-pre-trails').checked) {
                        preTrailsLayer.addTo(map);
                    }
                });

            // Load intersection points
            fetch('pre-split-intersections.geojson')
                .then(response => response.json())
                .then(data => {
                    preIntersectionsLayer = L.geoJSON(data, {
                        pointToLayer: function(feature, latlng) {
                            return L.circleMarker(latlng, {
                                radius: 8,
                                fillColor: '#ff4444',
                                color: '#fff',
                                weight: 2,
                                opacity: 1,
                                fillOpacity: 0.8
                            });
                        },
                        onEachFeature: function(feature, layer) {
                            if (feature.properties) {
                                layer.bindPopup(\`
                                    <strong>Intersection Point</strong><br>
                                    Connected Trails: \${feature.properties.connected_trail_names?.join(', ') || 'None'}<br>
                                    Trail Count: \${feature.properties.trail_count || 0}
                                \`);
                            }
                        }
                    });
                    if (document.getElementById('show-pre-intersections').checked) {
                        preIntersectionsLayer.addTo(map);
                    }
                });
        }

        // Load post-split data
        function loadPostSplitData() {
            // Load split trails
            fetch('post-split-trails.geojson')
                .then(response => response.json())
                .then(data => {
                    postTrailsLayer = L.geoJSON(data, {
                        style: function(feature) {
                            const testType = feature.properties.test_type;
                            let color = '#44ff44';
                            if (testType === 'Y-intersection') color = '#28a745';
                            else if (testType === 'T-intersection') color = '#ffc107';
                            else if (testType === 'X-intersection') color = '#dc3545';
                            
                            return {
                                color: color,
                                weight: 3,
                                opacity: 0.8
                            };
                        },
                        onEachFeature: function(feature, layer) {
                            if (feature.properties) {
                                layer.bindPopup(\`
                                    <strong>Split Segment</strong><br>
                                    Original Trail: \${feature.properties.original_trail_name}<br>
                                    Segment Order: \${feature.properties.segment_order}<br>
                                    Test Type: \${feature.properties.test_type}
                                \`);
                            }
                        }
                    });
                    if (document.getElementById('show-post-trails').checked) {
                        postTrailsLayer.addTo(map);
                    }
                });

            // Load routing nodes
            fetch('post-split-nodes.geojson')
                .then(response => response.json())
                .then(data => {
                    postNodesLayer = L.geoJSON(data, {
                        pointToLayer: function(feature, latlng) {
                            return L.circleMarker(latlng, {
                                radius: 6,
                                fillColor: '#ffaa00',
                                color: '#fff',
                                weight: 2,
                                opacity: 1,
                                fillOpacity: 0.8
                            });
                        },
                        onEachFeature: function(feature, layer) {
                            if (feature.properties) {
                                layer.bindPopup(\`
                                    <strong>Routing Node \${feature.properties.id}</strong><br>
                                    Type: \${feature.properties.node_type || 'Unknown'}<br>
                                    Elevation: \${feature.properties.elevation?.toFixed(0) || 'Unknown'} m
                                \`);
                            }
                        }
                    });
                    if (document.getElementById('show-post-nodes').checked) {
                        postNodesLayer.addTo(map);
                    }
                });

            // Load routing edges
            fetch('post-split-edges.geojson')
                .then(response => response.json())
                .then(data => {
                    postEdgesLayer = L.geoJSON(data, {
                        style: {
                            color: '#aa44ff',
                            weight: 4,
                            opacity: 0.6
                        },
                        onEachFeature: function(feature, layer) {
                            if (feature.properties) {
                                layer.bindPopup(\`
                                    <strong>Routing Edge \${feature.properties.id}</strong><br>
                                    Trail: \${feature.properties.trail_name || 'Unknown'}<br>
                                    Distance: \${feature.properties.distance_km?.toFixed(2) || 'Unknown'} km<br>
                                    From Node: \${feature.properties.from_node_id}<br>
                                    To Node: \${feature.properties.to_node_id}
                                \`);
                            }
                        }
                    });
                    if (document.getElementById('show-post-edges').checked) {
                        postEdgesLayer.addTo(map);
                    }
                });
        }

        // Switch between pre-split and post-split views
        function switchView(view) {
            currentView = view;
            
            // Update button states
            document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            // Clear map
            if (preTrailsLayer) map.removeLayer(preTrailsLayer);
            if (preIntersectionsLayer) map.removeLayer(preIntersectionsLayer);
            if (postTrailsLayer) map.removeLayer(postTrailsLayer);
            if (postNodesLayer) map.removeLayer(postNodesLayer);
            if (postEdgesLayer) map.removeLayer(postEdgesLayer);
            
            // Load appropriate data
            if (view === 'pre-split') {
                loadPreSplitData();
            } else {
                loadPostSplitData();
            }
        }

        // Layer controls
        document.getElementById('show-pre-trails').addEventListener('change', function() {
            if (this.checked && preTrailsLayer) {
                preTrailsLayer.addTo(map);
            } else if (!this.checked && preTrailsLayer) {
                map.removeLayer(preTrailsLayer);
            }
        });

        document.getElementById('show-pre-intersections').addEventListener('change', function() {
            if (this.checked && preIntersectionsLayer) {
                preIntersectionsLayer.addTo(map);
            } else if (!this.checked && preIntersectionsLayer) {
                map.removeLayer(preIntersectionsLayer);
            }
        });

        document.getElementById('show-post-trails').addEventListener('change', function() {
            if (this.checked && postTrailsLayer) {
                postTrailsLayer.addTo(map);
            } else if (!this.checked && postTrailsLayer) {
                map.removeLayer(postTrailsLayer);
            }
        });

        document.getElementById('show-post-nodes').addEventListener('change', function() {
            if (this.checked && postNodesLayer) {
                postNodesLayer.addTo(map);
            } else if (!this.checked && postNodesLayer) {
                map.removeLayer(postNodesLayer);
            }
        });

        document.getElementById('show-post-edges').addEventListener('change', function() {
            if (this.checked && postEdgesLayer) {
                postEdgesLayer.addTo(map);
            } else if (!this.checked && postEdgesLayer) {
                map.removeLayer(postEdgesLayer);
            }
        });

        // Initialize
        initMap();
        loadPreSplitData();
    </script>
</body>
</html>`;
}

// Run the test visualization generator if called directly
if (require.main === module) {
    generateTestSplittingVisualization()
        .then(result => {
            console.log('✅ Test visualization complete!');
            console.log(`🌐 Open ${path.join(result.outputDir, 'index.html')} in your browser`);
        })
        .catch(error => {
            console.error('❌ Error generating test visualization:', error);
            process.exit(1);
        });
}

module.exports = { generateTestSplittingVisualization }; 