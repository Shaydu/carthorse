const fs = require('fs');

async function fixGeoJSONDuplicates(inputPath, outputPath) {
    console.log('🔧 Fixing GeoJSON duplicates...');
    
    try {
        // Read the original GeoJSON file
        const data = fs.readFileSync(inputPath, 'utf8');
        const geojson = JSON.parse(data);
        
        console.log(`📊 Original file contains ${geojson.features.length} features`);
        
        // Separate features by type
        const trailFeatures = [];
        const nodeFeatures = [];
        const edgeFeatures = [];
        
        geojson.features.forEach(feature => {
            if (feature.properties) {
                if (feature.properties.trail_id && feature.properties.trail_name) {
                    // This is a routing edge (duplicate of trail)
                    edgeFeatures.push(feature);
                } else if (feature.properties.node_uuid) {
                    // This is a routing node
                    nodeFeatures.push(feature);
                } else if (feature.properties.name && !feature.properties.source) {
                    // This is an original trail
                    trailFeatures.push(feature);
                } else {
                    // Unknown feature type, keep it
                    trailFeatures.push(feature);
                }
            }
        });
        
        console.log(`📊 Feature breakdown:`);
        console.log(`   🗺️ Trails: ${trailFeatures.length}`);
        console.log(`   📍 Nodes: ${nodeFeatures.length}`);
        console.log(`   🔗 Edges: ${edgeFeatures.length} (duplicates to be removed)`);
        
        // Create new GeoJSON with only trails and nodes
        const fixedGeoJSON = {
            type: 'FeatureCollection',
            features: [...trailFeatures, ...nodeFeatures]
        };
        
        // Write the fixed file
        fs.writeFileSync(outputPath, JSON.stringify(fixedGeoJSON, null, 2));
        
        console.log(`✅ Fixed GeoJSON created:`);
        console.log(`   📁 Output: ${outputPath}`);
        console.log(`   🗺️ Features: ${fixedGeoJSON.features.length} (removed ${edgeFeatures.length} duplicates)`);
        console.log(`   📊 Breakdown: ${trailFeatures.length} trails + ${nodeFeatures.length} nodes`);
        
        return {
            originalFeatures: geojson.features.length,
            fixedFeatures: fixedGeoJSON.features.length,
            removedEdges: edgeFeatures.length,
            trails: trailFeatures.length,
            nodes: nodeFeatures.length
        };
        
    } catch (error) {
        console.error('❌ Error fixing GeoJSON:', error);
        throw error;
    }
}

// Run the fix
const inputPath = '/Users/shaydu/dev/carthorse/test-boulder-complete.geojson';
const outputPath = '/Users/shaydu/dev/carthorse/test-boulder-fixed.geojson';

fixGeoJSONDuplicates(inputPath, outputPath)
    .then(results => {
        console.log('\n=== SUMMARY ===');
        console.log(`✅ Successfully removed ${results.removedEdges} duplicate edges`);
        console.log(`📊 Final file: ${results.trails} trails + ${results.nodes} nodes = ${results.fixedFeatures} total features`);
    })
    .catch(error => {
        console.error('Error:', error);
    }); 