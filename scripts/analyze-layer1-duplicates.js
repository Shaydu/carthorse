const fs = require('fs');

function analyzeLayer1Duplicates() {
    console.log('Analyzing layer1 trails for duplicates...');
    
    try {
        // Read the layer1 trails file
        const filePath = '/Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test-fixed-layer1-trails.geojson';
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        console.log(`Total features: ${data.features.length}`);
        
        // Group trails by geometry (using coordinates as key)
        const geometryGroups = new Map();
        const nameGroups = new Map();
        const sourceIdentifierGroups = new Map();
        
        data.features.forEach((feature, index) => {
            const props = feature.properties;
            const geometry = feature.geometry;
            
            // Create a geometry key from coordinates
            const coordsKey = JSON.stringify(geometry.coordinates);
            
            // Group by geometry
            if (!geometryGroups.has(coordsKey)) {
                geometryGroups.set(coordsKey, []);
            }
            geometryGroups.get(coordsKey).push({
                index,
                id: props.id,
                name: props.name,
                source_identifier: props.source_identifier,
                length_km: props.length_km
            });
            
            // Group by name
            const nameKey = props.name || 'unnamed';
            if (!nameGroups.has(nameKey)) {
                nameGroups.set(nameKey, []);
            }
            nameGroups.get(nameKey).push({
                index,
                id: props.id,
                source_identifier: props.source_identifier,
                length_km: props.length_km
            });
            
            // Group by source identifier
            if (!sourceIdentifierGroups.has(props.source_identifier)) {
                sourceIdentifierGroups.set(props.source_identifier, []);
            }
            sourceIdentifierGroups.get(props.source_identifier).push({
                index,
                id: props.id,
                name: props.name,
                length_km: props.length_km
            });
        });
        
        // Find duplicates by geometry
        console.log('\n=== DUPLICATES BY GEOMETRY ===');
        let geometryDuplicates = 0;
        geometryGroups.forEach((trails, geometryKey) => {
            if (trails.length > 1) {
                geometryDuplicates++;
                console.log(`\nGeometry Group ${geometryDuplicates} (${trails.length} duplicates):`);
                trails.forEach(trail => {
                    console.log(`  - ID: ${trail.id}`);
                    console.log(`    Name: "${trail.name}"`);
                    console.log(`    Source ID: ${trail.source_identifier}`);
                    console.log(`    Length: ${trail.length_km} km`);
                });
            }
        });
        
        // Find duplicates by name
        console.log('\n=== DUPLICATES BY NAME ===');
        let nameDuplicates = 0;
        nameGroups.forEach((trails, name) => {
            if (trails.length > 1) {
                nameDuplicates++;
                console.log(`\nName Group "${name}" (${trails.length} duplicates):`);
                trails.forEach(trail => {
                    console.log(`  - ID: ${trail.id}`);
                    console.log(`    Source ID: ${trail.source_identifier}`);
                    console.log(`    Length: ${trail.length_km} km`);
                });
            }
        });
        
        // Find duplicates by source identifier
        console.log('\n=== DUPLICATES BY SOURCE IDENTIFIER ===');
        let sourceDuplicates = 0;
        sourceIdentifierGroups.forEach((trails, sourceId) => {
            if (trails.length > 1) {
                sourceDuplicates++;
                console.log(`\nSource ID Group ${sourceId} (${trails.length} duplicates):`);
                trails.forEach(trail => {
                    console.log(`  - ID: ${trail.id}`);
                    console.log(`    Name: "${trail.name}"`);
                    console.log(`    Length: ${trail.length_km} km`);
                });
            }
        });
        
        console.log('\n=== SUMMARY ===');
        console.log(`Total features: ${data.features.length}`);
        console.log(`Unique geometries: ${geometryGroups.size}`);
        console.log(`Unique names: ${nameGroups.size}`);
        console.log(`Unique source identifiers: ${sourceIdentifierGroups.size}`);
        console.log(`Geometry duplicate groups: ${geometryDuplicates}`);
        console.log(`Name duplicate groups: ${nameDuplicates}`);
        console.log(`Source ID duplicate groups: ${sourceDuplicates}`);
        
        // Show some examples of the most duplicated geometries
        console.log('\n=== MOST DUPLICATED GEOMETRIES ===');
        const sortedGeometryGroups = Array.from(geometryGroups.entries())
            .filter(([key, trails]) => trails.length > 1)
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 5);
            
        sortedGeometryGroups.forEach(([geometryKey, trails], index) => {
            console.log(`\n${index + 1}. Geometry with ${trails.length} duplicates:`);
            trails.forEach(trail => {
                console.log(`   - "${trail.name}" (${trail.source_identifier})`);
            });
        });
        
    } catch (error) {
        console.error('Error analyzing file:', error);
    }
}

analyzeLayer1Duplicates();
