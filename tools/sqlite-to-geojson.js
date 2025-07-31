#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

if (process.argv.length < 4) {
    console.log('Usage: node sqlite-to-geojson.js <input.db> <output.geojson>');
    process.exit(1);
}

const inputDb = process.argv[2];
const outputFile = process.argv[3];

const db = new sqlite3.Database(inputDb);

const geojson = {
    type: 'FeatureCollection',
    features: []
};

// Get trails
db.all('SELECT * FROM trails', [], (err, trails) => {
    if (err) {
        console.error('Error reading trails:', err);
        return;
    }

    // Add trail features
    trails.forEach(trail => {
        if (trail.geojson) {
            try {
                const trailGeoJSON = JSON.parse(trail.geojson);
                geojson.features.push({
                    type: 'Feature',
                    properties: {
                        id: trail.id,
                        name: trail.name,
                        trail_type: trail.trail_type,
                        surface: trail.surface,
                        difficulty: trail.difficulty,
                        length_km: trail.length_km,
                        elevation_gain: trail.elevation_gain,
                        elevation_loss: trail.elevation_loss,
                        max_elevation: trail.max_elevation,
                        min_elevation: trail.min_elevation,
                        avg_elevation: trail.avg_elevation,
                        feature_type: 'trail'
                    },
                    geometry: trailGeoJSON.geometry
                });
            } catch (e) {
                console.warn('Invalid GeoJSON for trail:', trail.name);
            }
        }
    });

    // Get nodes
    db.all('SELECT * FROM routing_nodes', [], (err, nodes) => {
        if (err) {
            console.error('Error reading nodes:', err);
            return;
        }

        // Add node features
        nodes.forEach(node => {
            geojson.features.push({
                type: 'Feature',
                properties: {
                    id: node.id,
                    node_uuid: node.node_uuid,
                    node_type: node.node_type,
                    connected_trails: node.connected_trails,
                    elevation: node.elevation,
                    feature_type: 'node'
                },
                geometry: {
                    type: 'Point',
                    coordinates: [node.lng, node.lat, node.elevation]
                }
            });
        });

        // Write to file
        fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
        console.log(`✅ Converted ${trails.length} trails and ${nodes.length} nodes to GeoJSON`);
        console.log(`📁 Output: ${outputFile}`);
        
        db.close();
    });
}); 