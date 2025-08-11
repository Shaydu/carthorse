const fs = require('fs');

async function analyzeDuplicateEdges(filePath) {
    console.log('Loading and analyzing GeoJSON file for duplicate edges...');
    
    try {
        // Read the entire file
        const data = fs.readFileSync(filePath, 'utf8');
        const geojson = JSON.parse(data);
        
        console.log(`File loaded successfully. Found ${geojson.features.length} features.`);
        
        // Track potential duplicates
        const edgeSignatures = new Map(); // key: signature, value: array of feature indices
        const duplicates = [];
        
        geojson.features.forEach((feature, index) => {
            if (feature.properties && feature.geometry) {
                // Create a signature for this edge
                const signature = createEdgeSignature(feature);
                
                if (!edgeSignatures.has(signature)) {
                    edgeSignatures.set(signature, []);
                }
                
                edgeSignatures.get(signature).push({
                    index: index,
                    properties: feature.properties,
                    geometry: feature.geometry
                });
            }
        });
        
        // Find duplicates
        for (const [signature, features] of edgeSignatures) {
            if (features.length > 1) {
                duplicates.push({
                    signature,
                    count: features.length,
                    features: features
                });
            }
        }
        
        console.log('\n=== DUPLICATE EDGE ANALYSIS ===');
        console.log(`Total features processed: ${geojson.features.length}`);
        console.log(`Unique edge signatures: ${edgeSignatures.size}`);
        console.log(`Duplicate edge groups found: ${duplicates.length}`);
        
        if (duplicates.length > 0) {
            console.log('\n=== DUPLICATE DETAILS ===');
            duplicates.forEach((dup, index) => {
                console.log(`\nDuplicate Group ${index + 1}:`);
                console.log(`  Count: ${dup.count} instances`);
                console.log(`  Signature: ${dup.signature}`);
                console.log(`  Feature indices: ${dup.features.map(f => f.index).join(', ')}`);
                
                // Show properties of first duplicate
                if (dup.features[0].properties) {
                    console.log(`  Sample properties:`, JSON.stringify(dup.features[0].properties, null, 2));
                }
            });
        } else {
            console.log('\n✅ No duplicate edges found!');
        }
        
        // Additional analysis
        console.log('\n=== ADDITIONAL ANALYSIS ===');
        console.log(`Features with properties: ${geojson.features.filter(f => f.properties).length}`);
        console.log(`Features with geometry: ${geojson.features.filter(f => f.geometry).length}`);
        console.log(`Features with both: ${geojson.features.filter(f => f.properties && f.geometry).length}`);
        
        // Analyze property types
        const propertyTypes = new Set();
        geojson.features.forEach(f => {
            if (f.properties) {
                Object.keys(f.properties).forEach(key => propertyTypes.add(key));
            }
        });
        console.log(`Unique property keys: ${Array.from(propertyTypes).sort().join(', ')}`);
        
        return {
            totalFeatures: geojson.features.length,
            uniqueSignatures: edgeSignatures.size,
            duplicateGroups: duplicates.length,
            duplicates: duplicates
        };
        
    } catch (error) {
        console.error('Error analyzing file:', error);
        throw error;
    }
}

function createEdgeSignature(feature) {
    // Create a unique signature based on edge properties and geometry
    const props = feature.properties || {};
    const geom = feature.geometry || {};
    
    // Key properties that should make an edge unique
    const keyProps = {
        trail_id: props.trail_id,
        edge_id: props.edge_id,
        start_node_id: props.start_node_id,
        end_node_id: props.end_node_id,
        route_id: props.route_id,
        trail_name: props.trail_name,
        route_name: props.route_name
    };
    
    // Geometry signature (coordinates)
    let geomSignature = '';
    if (geom.coordinates && Array.isArray(geom.coordinates)) {
        // For LineString, use start and end points
        if (geom.coordinates.length >= 2) {
            const start = geom.coordinates[0];
            const end = geom.coordinates[geom.coordinates.length - 1];
            geomSignature = `${start[0]},${start[1]}-${end[0]},${end[1]}`;
        }
    }
    
    return JSON.stringify(keyProps) + '|' + geomSignature;
}

// Run the analysis
const filePath = '/Users/shaydu/dev/carthorse/test-boulder-complete.geojson';

analyzeDuplicateEdges(filePath)
    .then(results => {
        console.log('\n=== SUMMARY ===');
        console.log(`Analysis complete. Found ${results.duplicateGroups} groups of duplicate edges.`);
    })
    .catch(error => {
        console.error('Error analyzing file:', error);
    }); 