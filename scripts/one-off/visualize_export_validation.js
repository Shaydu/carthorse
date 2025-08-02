const Database = require('better-sqlite3');
const fs = require('fs');

console.log('🎨 Creating Visual Validation Charts...');

// Open the SQLite database
const db = new Database('./test-export-no-split-trails.db');

// Generate HTML visualization
const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Trail Export Validation Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .chart-container { width: 100%; height: 400px; margin: 20px 0; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: #f5f5f5; padding: 15px; border-radius: 8px; }
        .stat-value { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .stat-label { color: #7f8c8d; margin-top: 5px; }
        .map-container { height: 500px; margin: 20px 0; border-radius: 8px; overflow: hidden; }
        .validation-status { padding: 10px; border-radius: 5px; margin: 10px 0; }
        .status-pass { background: #d4edda; color: #155724; }
        .status-warn { background: #fff3cd; color: #856404; }
        .status-fail { background: #f8d7da; color: #721c24; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚴 Trail Export Validation Dashboard</h1>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${db.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count.toLocaleString()}</div>
                <div class="stat-label">Total Trail Segments</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count.toLocaleString()}</div>
                <div class="stat-label">Total Nodes</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${db.prepare('SELECT COUNT(DISTINCT trail_name) as count FROM routing_edges').get().count.toLocaleString()}</div>
                <div class="stat-label">Unique Trail Names</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${(db.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count / db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count).toFixed(2)}</div>
                <div class="stat-label">Edges per Node</div>
            </div>
        </div>

        <h2>📊 Node Type Distribution</h2>
        <div class="chart-container">
            <canvas id="nodeTypeChart"></canvas>
        </div>

        <h2>📈 Trail Segment Distribution</h2>
        <div class="chart-container">
            <canvas id="trailSegmentChart"></canvas>
        </div>

        <h2>🗺️ Trail Network Map</h2>
        <div id="map" class="map-container"></div>

        <h2>✅ Validation Results</h2>
        <div id="validation-results"></div>
    </div>

    <script>
        // Node type distribution chart
        const nodeTypeCtx = document.getElementById('nodeTypeChart').getContext('2d');
        new Chart(nodeTypeCtx, {
            type: 'doughnut',
            data: {
                labels: ['Intersection Nodes', 'Endpoint Nodes'],
                datasets: [{
                    data: [
                        ${db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = "intersection"').get().count},
                        ${db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = "endpoint"').get().count}
                    ],
                    backgroundColor: ['#e74c3c', '#3498db'],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    title: { display: true, text: 'Node Type Distribution' }
                }
            }
        });

        // Trail segment distribution chart
        const trailSegmentCtx = document.getElementById('trailSegmentChart').getContext('2d');
        const trailData = ${JSON.stringify(db.prepare(`
            SELECT trail_name, COUNT(*) as segment_count
            FROM routing_edges 
            GROUP BY trail_name
            ORDER BY segment_count DESC
            LIMIT 15
        `).all())};
        
        new Chart(trailSegmentCtx, {
            type: 'bar',
            data: {
                labels: trailData.map(t => t.trail_name.substring(0, 20) + (t.trail_name.length > 20 ? '...' : '')),
                datasets: [{
                    label: 'Segments per Trail',
                    data: trailData.map(t => t.segment_count),
                    backgroundColor: '#2ecc71',
                    borderColor: '#27ae60',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Top 15 Trails by Segment Count' }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });

        // Initialize map
        const map = L.map('map').setView([40.0, -105.3], 10);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Add trail segments to map
        const trailSegments = ${JSON.stringify(db.prepare(`
            SELECT trail_name, geojson, elevation_gain, elevation_loss, distance_km
            FROM routing_edges 
            LIMIT 100
        `).all())};

        trailSegments.forEach(segment => {
            try {
                const geojson = JSON.parse(segment.geojson);
                if (geojson.geometry && geojson.geometry.coordinates) {
                    const coordinates = geojson.geometry.coordinates.map(coord => [coord[1], coord[0]]);
                    const polyline = L.polyline(coordinates, {
                        color: '#e74c3c',
                        weight: 3,
                        opacity: 0.8
                    }).addTo(map);
                    
                    // Add popup with trail info
                    polyline.bindPopup(`
                        <strong>${segment.trail_name}</strong><br>
                        Distance: ${segment.distance_km.toFixed(2)}km<br>
                        Elevation: +${segment.elevation_gain}m/-${segment.elevation_loss}m
                    `);
                }
            } catch (e) {
                console.log('Error parsing GeoJSON:', e);
            }
        });

        // Add nodes to map
        const nodes = ${JSON.stringify(db.prepare(`
            SELECT node_type, lat, lng, elevation, connected_trails
            FROM routing_nodes 
            LIMIT 200
        `).all())};

        nodes.forEach(node => {
            const color = node.node_type === 'intersection' ? '#e74c3c' : '#3498db';
            const radius = node.node_type === 'intersection' ? 6 : 4;
            
            const marker = L.circleMarker([node.lat, node.lng], {
                radius: radius,
                fillColor: color,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(map);
            
            marker.bindPopup(`
                <strong>${node.node_type.toUpperCase()}</strong><br>
                Elevation: ${node.elevation}m<br>
                Trails: ${node.connected_trails}
            `);
        });

        // Validation results
        const validationResults = document.getElementById('validation-results');
        const ratios = {
            edgesPerNode: ${(db.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count / db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count).toFixed(3)},
            intersectionRatio: ${(db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = "intersection"').get().count / db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count).toFixed(3)},
            threeDRatio: ${(db.prepare(`
                SELECT COUNT(*) as count
                FROM routing_edges 
                WHERE geojson LIKE '%[%' 
                  AND geojson LIKE '%,%' 
                  AND geojson LIKE '%,%'
                  AND geojson LIKE '%,%'
            `).get().count / db.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count).toFixed(3)}
        };

        const validations = [
            {
                name: 'Edges per Node',
                value: ratios.edgesPerNode,
                expected: '1.5-3.0',
                isValid: ratios.edgesPerNode >= 1.5 && ratios.edgesPerNode <= 3.0
            },
            {
                name: 'Intersection Node Ratio',
                value: ratios.intersectionRatio,
                expected: '0.1-0.4',
                isValid: ratios.intersectionRatio >= 0.1 && ratios.intersectionRatio <= 0.4
            },
            {
                name: '3D Data Ratio',
                value: ratios.threeDRatio,
                expected: '>0.9',
                isValid: ratios.threeDRatio >= 0.9
            }
        ];

        validations.forEach(validation => {
            const statusClass = validation.isValid ? 'status-pass' : 'status-warn';
            validationResults.innerHTML += \`
                <div class="validation-status \${statusClass}">
                    <strong>\${validation.name}:</strong> \${validation.value} (Expected: \${validation.expected})
                </div>
            \`;
        });
    </script>
</body>
</html>
`;

fs.writeFileSync('./export_validation_dashboard.html', html);
console.log('✅ Visual dashboard created: export_validation_dashboard.html');

// Generate summary statistics
const summary = {
  total_edges: db.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count,
  total_nodes: db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count,
  intersection_nodes: db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = "intersection"').get().count,
  endpoint_nodes: db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = "endpoint"').get().count,
  unique_trails: db.prepare('SELECT COUNT(DISTINCT trail_name) as count FROM routing_edges').get().count,
  edges_with_3d: db.prepare(`
    SELECT COUNT(*) as count
    FROM routing_edges 
    WHERE geojson LIKE '%[%' 
      AND geojson LIKE '%,%' 
      AND geojson LIKE '%,%'
      AND geojson LIKE '%,%'
  `).get().count,
  nodes_with_elevation: db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE elevation IS NOT NULL').get().count
};

console.log('\n📊 QUICK SUMMARY:');
console.log(`   Total Trail Segments: ${summary.total_edges.toLocaleString()}`);
console.log(`   Total Nodes: ${summary.total_nodes.toLocaleString()}`);
console.log(`   Intersection Nodes: ${summary.intersection_nodes.toLocaleString()} (${(summary.intersection_nodes/summary.total_nodes*100).toFixed(1)}%)`);
console.log(`   Endpoint Nodes: ${summary.endpoint_nodes.toLocaleString()} (${(summary.endpoint_nodes/summary.total_nodes*100).toFixed(1)}%)`);
console.log(`   Unique Trails: ${summary.unique_trails.toLocaleString()}`);
console.log(`   Edges per Node: ${(summary.total_edges/summary.total_nodes).toFixed(2)}`);
console.log(`   3D Data Coverage: ${(summary.edges_with_3d/summary.total_edges*100).toFixed(1)}%`);

// Assess if ratios are realistic
const assessment = {
  edgesPerNode: summary.total_edges / summary.total_nodes,
  intersectionRatio: summary.intersection_nodes / summary.total_nodes,
  endpointRatio: summary.endpoint_nodes / summary.total_nodes,
  threeDRatio: summary.edges_with_3d / summary.total_edges
};

console.log('\n🎯 RATIO ASSESSMENT:');
console.log(`   Edges per Node: ${assessment.edgesPerNode.toFixed(2)} (Expected: 1.5-3.0) ${assessment.edgesPerNode >= 1.5 && assessment.edgesPerNode <= 3.0 ? '✅' : '⚠️'}`);
console.log(`   Intersection Ratio: ${(assessment.intersectionRatio*100).toFixed(1)}% (Expected: 10-40%) ${assessment.intersectionRatio >= 0.1 && assessment.intersectionRatio <= 0.4 ? '✅' : '⚠️'}`);
console.log(`   Endpoint Ratio: ${(assessment.endpointRatio*100).toFixed(1)}% (Expected: 60-90%) ${assessment.endpointRatio >= 0.6 && assessment.endpointRatio <= 0.9 ? '✅' : '⚠️'}`);
console.log(`   3D Data Ratio: ${(assessment.threeDRatio*100).toFixed(1)}% (Expected: >90%) ${assessment.threeDRatio >= 0.9 ? '✅' : '⚠️'}`);

db.close(); 