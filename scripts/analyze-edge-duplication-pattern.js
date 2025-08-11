const fs = require('fs');

async function analyzeEdgeDuplicationPattern(filePath) {
    console.log('🔍 Analyzing edge duplication pattern...');
    
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const geojson = JSON.parse(data);
        
        console.log(`📊 Total features: ${geojson.features.length}`);
        
        // Separate features by type
        const edgeFeatures = [];
        const trailFeatures = [];
        const nodeFeatures = [];
        
        geojson.features.forEach(feature => {
            if (feature.properties) {
                if (feature.properties.trail_id && feature.properties.source && feature.properties.target) {
                    // This is a routing edge
                    edgeFeatures.push(feature);
                } else if (feature.properties.node_uuid) {
                    // This is a routing node
                    nodeFeatures.push(feature);
                } else if (feature.properties.name && !feature.properties.source) {
                    // This is an original trail
                    trailFeatures.push(feature);
                }
            }
        });
        
        console.log(`📊 Feature breakdown:`);
        console.log(`   🗺️ Trails: ${trailFeatures.length}`);
        console.log(`   📍 Nodes: ${nodeFeatures.length}`);
        console.log(`   🔗 Edges: ${edgeFeatures.length}`);
        
        // Analyze edge duplication patterns
        const edgeGroups = new Map();
        
        edgeFeatures.forEach(edge => {
            const key = `${edge.properties.trail_id}|${edge.properties.source}|${edge.properties.target}`;
            if (!edgeGroups.has(key)) {
                edgeGroups.set(key, []);
            }
            edgeGroups.get(key).push(edge);
        });
        
        const duplicates = [];
        const uniqueEdges = [];
        
        for (const [key, edges] of edgeGroups) {
            if (edges.length > 1) {
                duplicates.push({
                    key,
                    count: edges.length,
                    edges: edges,
                    trail_id: edges[0].properties.trail_id,
                    trail_name: edges[0].properties.trail_name,
                    source: edges[0].properties.source,
                    target: edges[0].properties.target
                });
            } else {
                uniqueEdges.push(edges[0]);
            }
        }
        
        console.log(`\n=== EDGE DUPLICATION ANALYSIS ===`);
        console.log(`Unique edge connections: ${uniqueEdges.length}`);
        console.log(`Duplicate edge groups: ${duplicates.length}`);
        console.log(`Total duplicate edges: ${duplicates.reduce((sum, d) => sum + d.count, 0)}`);
        
        // Analyze the most duplicated trails
        const trailDuplication = new Map();
        duplicates.forEach(dup => {
            const trailId = dup.trail_id;
            if (!trailDuplication.has(trailId)) {
                trailDuplication.set(trailId, {
                    trail_name: dup.trail_name,
                    duplicate_groups: 0,
                    total_duplicates: 0
                });
            }
            const trail = trailDuplication.get(trailId);
            trail.duplicate_groups++;
            trail.total_duplicates += dup.count;
        });
        
        const sortedTrails = Array.from(trailDuplication.entries())
            .map(([trailId, data]) => ({ trailId, ...data }))
            .sort((a, b) => b.total_duplicates - a.total_duplicates);
        
        console.log(`\n=== TOP DUPLICATED TRAILS ===`);
        sortedTrails.slice(0, 10).forEach((trail, index) => {
            console.log(`${index + 1}. ${trail.trail_name}`);
            console.log(`   Trail ID: ${trail.trailId}`);
            console.log(`   Duplicate groups: ${trail.duplicate_groups}`);
            console.log(`   Total duplicates: ${trail.total_duplicates}`);
        });
        
        // Analyze node patterns
        console.log(`\n=== NODE ANALYSIS ===`);
        const nodeTypes = new Map();
        nodeFeatures.forEach(node => {
            const type = node.properties.node_type || 'unknown';
            nodeTypes.set(type, (nodeTypes.get(type) || 0) + 1);
        });
        
        console.log('Node types:');
        for (const [type, count] of nodeTypes) {
            console.log(`   ${type}: ${count}`);
        }
        
        // Check if the issue is multiple nodes near the same trail endpoints
        console.log(`\n=== ROOT CAUSE HYPOTHESIS ===`);
        console.log('The duplication appears to be caused by:');
        console.log('1. Multiple routing nodes being created near the same trail endpoints');
        console.log('2. Each node combination creating a separate edge for the same trail segment');
        console.log('3. No deduplication in the edge generation process');
        
        // Calculate statistics
        const totalEdges = edgeFeatures.length;
        const uniqueConnections = uniqueEdges.length;
        const duplicateEdges = totalEdges - uniqueConnections;
        const duplicationRate = ((duplicateEdges / totalEdges) * 100).toFixed(1);
        
        console.log(`\n=== SUMMARY ===`);
        console.log(`Total edges: ${totalEdges}`);
        console.log(`Unique connections: ${uniqueConnections}`);
        console.log(`Duplicate edges: ${duplicateEdges}`);
        console.log(`Duplication rate: ${duplicationRate}%`);
        
        return {
            totalEdges,
            uniqueConnections,
            duplicateEdges,
            duplicationRate,
            duplicateGroups: duplicates.length,
            topDuplicatedTrails: sortedTrails.slice(0, 5)
        };
        
    } catch (error) {
        console.error('❌ Error analyzing edge duplication:', error);
        throw error;
    }
}

// Run the analysis
const filePath = '/Users/shaydu/dev/carthorse/test-boulder-complete.geojson';

analyzeEdgeDuplicationPattern(filePath)
    .then(results => {
        console.log('\n=== RECOMMENDATION ===');
        console.log('To fix the duplicate edges issue:');
        console.log('1. Modify the edge generation SQL to use DISTINCT or GROUP BY');
        console.log('2. Improve node generation to avoid creating multiple nodes near the same point');
        console.log('3. Add deduplication logic in the edge generation process');
        console.log('4. Consider using a more sophisticated node selection strategy');
    })
    .catch(error => {
        console.error('Error:', error);
    }); 