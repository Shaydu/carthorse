const fs = require('fs');

async function fixGeoJSONExport(inputPath, outputPath) {
    console.log('🔧 Fixing GeoJSON export with proper deduplication...');
    
    try {
        const data = fs.readFileSync(inputPath, 'utf8');
        const geojson = JSON.parse(data);
        
        console.log(`📊 Original file contains ${geojson.features.length} features`);
        
        // Separate features by type and deduplicate
        const trailFeatures = new Map(); // key: trail_id, value: feature
        const nodeFeatures = new Map(); // key: node_uuid, value: feature
        const edgeFeatures = new Map(); // key: edge_signature, value: feature
        
        geojson.features.forEach(feature => {
            if (feature.properties) {
                if (feature.properties.trail_id && feature.properties.source && feature.properties.target) {
                    // This is a routing edge
                    const key = `${feature.properties.trail_id}|${feature.properties.source}|${feature.properties.target}`;
                    if (!edgeFeatures.has(key)) {
                        edgeFeatures.set(key, feature);
                    }
                } else if (feature.properties.node_uuid) {
                    // This is a routing node
                    const key = feature.properties.node_uuid;
                    if (!nodeFeatures.has(key)) {
                        nodeFeatures.set(key, feature);
                    }
                } else if (feature.properties.name && !feature.properties.source) {
                    // This is an original trail
                    const key = feature.properties.id || feature.properties.name;
                    if (!trailFeatures.has(key)) {
                        trailFeatures.set(key, feature);
                    }
                }
            }
        });
        
        console.log(`📊 Feature breakdown after deduplication:`);
        console.log(`   🗺️ Trails: ${trailFeatures.size}`);
        console.log(`   📍 Nodes: ${nodeFeatures.size}`);
        console.log(`   🔗 Edges: ${edgeFeatures.size}`);
        
        // Create new GeoJSON with deduplicated features
        const fixedGeoJSON = {
            type: 'FeatureCollection',
            features: [
                ...Array.from(trailFeatures.values()),
                ...Array.from(nodeFeatures.values()),
                ...Array.from(edgeFeatures.values())
            ]
        };
        
        // Write the fixed file
        fs.writeFileSync(outputPath, JSON.stringify(fixedGeoJSON, null, 2));
        
        console.log(`✅ Fixed GeoJSON created:`);
        console.log(`   📁 Output: ${outputPath}`);
        console.log(`   🗺️ Features: ${fixedGeoJSON.features.length} (removed ${geojson.features.length - fixedGeoJSON.features.length} duplicates)`);
        console.log(`   📊 Breakdown: ${trailFeatures.size} trails + ${nodeFeatures.size} nodes + ${edgeFeatures.size} edges`);
        
        return {
            originalFeatures: geojson.features.length,
            fixedFeatures: fixedGeoJSON.features.length,
            removedDuplicates: geojson.features.length - fixedGeoJSON.features.length,
            trails: trailFeatures.size,
            nodes: nodeFeatures.size,
            edges: edgeFeatures.size
        };
        
    } catch (error) {
        console.error('❌ Error fixing GeoJSON export:', error);
        throw error;
    }
}

// Run the fix
const inputPath = '/Users/shaydu/dev/carthorse/test-boulder-complete.geojson';
const outputPath = '/Users/shaydu/dev/carthorse/test-boulder-fixed-export.geojson';

fixGeoJSONExport(inputPath, outputPath)
    .then(results => {
        console.log('\n=== SUMMARY ===');
        console.log(`✅ Successfully removed ${results.removedDuplicates} duplicate features`);
        console.log(`📊 Final file: ${results.trails} trails + ${results.nodes} nodes + ${results.edges} edges = ${results.fixedFeatures} total features`);
        console.log(`📈 Deduplication rate: ${((results.removedDuplicates / results.originalFeatures) * 100).toFixed(1)}%`);
    })
    .catch(error => {
        console.error('Error:', error);
    }); 