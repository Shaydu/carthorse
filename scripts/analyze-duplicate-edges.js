const fs = require('fs');
const readline = require('readline');

async function analyzeDuplicateEdges(filePath) {
    console.log('Analyzing GeoJSON file for duplicate edges...');
    
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let lineCount = 0;
    let features = [];
    let inFeature = false;
    let currentFeature = '';
    let featureCount = 0;
    
    // Track potential duplicates
    const edgeSignatures = new Map(); // key: signature, value: array of feature indices
    const duplicates = [];
    
    for await (const line of rl) {
        lineCount++;
        
        if (lineCount % 10000 === 0) {
            console.log(`Processed ${lineCount} lines...`);
        }
        
        if (line.includes('"type": "Feature"')) {
            inFeature = true;
            currentFeature = '';
            featureCount++;
        }
        
        if (inFeature) {
            currentFeature += line;
        }
        
        if (inFeature && line.trim() === '},') {
            inFeature = false;
            
            try {
                // Try to parse the feature
                const featureStr = currentFeature.replace(/,$/, '');
                const feature = JSON.parse(featureStr);
                
                if (feature.properties && feature.geometry) {
                    // Create a signature for this edge
                    const signature = createEdgeSignature(feature);
                    
                    if (!edgeSignatures.has(signature)) {
                        edgeSignatures.set(signature, []);
                    }
                    
                    edgeSignatures.get(signature).push({
                        index: featureCount,
                        properties: feature.properties,
                        geometry: feature.geometry
                    });
                }
            } catch (e) {
                // Skip malformed features
                console.log(`Warning: Could not parse feature at line ${lineCount}`);
            }
        }
    }
    
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
    console.log(`Total features processed: ${featureCount}`);
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
    
    return {
        totalFeatures: featureCount,
        uniqueSignatures: edgeSignatures.size,
        duplicateGroups: duplicates.length,
        duplicates: duplicates
    };
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
        route_id: props.route_id
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