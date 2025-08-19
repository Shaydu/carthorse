const fs = require('fs');
const turf = require('@turf/turf');

async function analyzeGeoJSONOverlaps(filePath) {
    console.log('🔍 Analyzing GeoJSON for overlapping geometries...');
    
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const geojson = JSON.parse(data);
        
        console.log(`📊 File contains ${geojson.features.length} features`);
        
        // Track overlapping features
        const overlaps = [];
        const duplicateGeometries = new Map(); // geometry hash -> feature IDs
        const duplicateNames = new Map(); // name -> feature IDs
        
        // Analyze each feature
        geojson.features.forEach((feature, index) => {
            if (!feature.geometry || !feature.properties) return;
            
            const geomHash = JSON.stringify(feature.geometry);
            const name = feature.properties.name || feature.properties.trail_name || `feature_${index}`;
            
            // Check for duplicate geometries
            if (duplicateGeometries.has(geomHash)) {
                duplicateGeometries.get(geomHash).push(index);
            } else {
                duplicateGeometries.set(geomHash, [index]);
            }
            
            // Check for duplicate names
            if (duplicateNames.has(name)) {
                duplicateNames.get(name).push(index);
            } else {
                duplicateNames.set(name, [index]);
            }
        });
        
        // Find actual overlaps using Turf.js
        console.log('🔍 Checking for geometric overlaps...');
        for (let i = 0; i < geojson.features.length; i++) {
            for (let j = i + 1; j < geojson.features.length; j++) {
                const feature1 = geojson.features[i];
                const feature2 = geojson.features[j];
                
                if (!feature1.geometry || !feature2.geometry) continue;
                
                try {
                    const overlap = turf.intersect(feature1, feature2);
                    if (overlap) {
                        overlaps.push({
                            feature1: {
                                index: i,
                                name: feature1.properties?.name || feature1.properties?.trail_name || `feature_${i}`,
                                id: feature1.properties?.id || feature1.properties?.app_uuid || `id_${i}`
                            },
                            feature2: {
                                index: j,
                                name: feature2.properties?.name || feature2.properties?.trail_name || `feature_${j}`,
                                id: feature2.properties?.id || feature2.properties?.app_uuid || `id_${j}`
                            },
                            overlapArea: turf.area(overlap)
                        });
                    }
                } catch (error) {
                    // Skip invalid geometries
                }
            }
        }
        
        // Report findings
        console.log('\n📋 ANALYSIS RESULTS:');
        console.log('===================');
        
        // Duplicate geometries
        const exactDuplicates = Array.from(duplicateGeometries.entries())
            .filter(([hash, indices]) => indices.length > 1);
        
        console.log(`\n🔍 EXACT DUPLICATE GEOMETRIES: ${exactDuplicates.length} sets`);
        exactDuplicates.forEach(([hash, indices], i) => {
            console.log(`\n  Set ${i + 1}: ${indices.length} features with identical geometry`);
            indices.forEach(idx => {
                const feature = geojson.features[idx];
                console.log(`    - Index ${idx}: ${feature.properties?.name || feature.properties?.trail_name || 'unnamed'} (ID: ${feature.properties?.id || feature.properties?.app_uuid || 'unknown'})`);
            });
        });
        
        // Duplicate names
        const nameDuplicates = Array.from(duplicateNames.entries())
            .filter(([name, indices]) => indices.length > 1);
        
        console.log(`\n🔍 DUPLICATE NAMES: ${nameDuplicates.length} sets`);
        nameDuplicates.forEach(([name, indices], i) => {
            console.log(`\n  Set ${i + 1}: "${name}" appears ${indices.length} times`);
            indices.forEach(idx => {
                const feature = geojson.features[idx];
                console.log(`    - Index ${idx}: ID ${feature.properties?.id || feature.properties?.app_uuid || 'unknown'}`);
            });
        });
        
        // Geometric overlaps
        console.log(`\n🔍 GEOMETRIC OVERLAPS: ${overlaps.length} pairs`);
        overlaps.forEach((overlap, i) => {
            console.log(`\n  Overlap ${i + 1}:`);
            console.log(`    Feature 1: "${overlap.feature1.name}" (ID: ${overlap.feature1.id})`);
            console.log(`    Feature 2: "${overlap.feature2.name}" (ID: ${overlap.feature2.id})`);
            console.log(`    Overlap Area: ${overlap.overlapArea.toFixed(2)} sq meters`);
        });
        
        // Root cause analysis
        console.log('\n🔍 ROOT CAUSE ANALYSIS:');
        console.log('======================');
        
        if (exactDuplicates.length > 0) {
            console.log('\n❌ ROOT CAUSE: EXACT DUPLICATE GEOMETRIES');
            console.log('   This indicates a data problem in the staging schema.');
            console.log('   Possible causes:');
            console.log('   - Duplicate records in staging.trails table');
            console.log('   - Failed deduplication in prepare_routing_network function');
            console.log('   - Multiple sources with identical geometries');
        } else if (overlaps.length > 0) {
            console.log('\n⚠️  ROOT CAUSE: GEOMETRIC OVERLAPS');
            console.log('   This could be either:');
            console.log('   - Data problem: Trails that actually overlap in reality');
            console.log('   - Processing problem: Failed intersection detection/splitting');
            console.log('   - Export problem: Incorrect feature selection');
        } else if (nameDuplicates.length > 0) {
            console.log('\n⚠️  ROOT CAUSE: DUPLICATE NAMES');
            console.log('   This suggests:');
            console.log('   - Multiple trails with same name but different geometries');
            console.log('   - Possible data quality issue in source data');
        } else {
            console.log('\n✅ NO OVERLAPS FOUND');
            console.log('   The GeoJSON appears to be clean with no overlapping geometries.');
        }
        
        // Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        console.log('===================');
        
        if (exactDuplicates.length > 0) {
            console.log('\n1. Check staging schema for duplicate records:');
            console.log('   SELECT COUNT(*) FROM staging.trails GROUP BY ST_AsText(geometry) HAVING COUNT(*) > 1;');
            console.log('\n2. Verify deduplication in prepare_routing_network function');
            console.log('\n3. Check if multiple data sources are creating duplicates');
        }
        
        if (overlaps.length > 0) {
            console.log('\n1. Verify intersection detection is working:');
            console.log('   SELECT COUNT(*) FROM staging.intersection_points;');
            console.log('\n2. Check if trail splitting is functioning:');
            console.log('   SELECT COUNT(*) FROM staging.split_trails;');
        }
        
        return {
            totalFeatures: geojson.features.length,
            exactDuplicates: exactDuplicates.length,
            nameDuplicates: nameDuplicates.length,
            geometricOverlaps: overlaps.length,
            hasIssues: exactDuplicates.length > 0 || overlaps.length > 0
        };
        
    } catch (error) {
        console.error('❌ Error analyzing GeoJSON:', error);
        throw error;
    }
}

// Run the analysis
const filePath = '/Users/shaydu/dev/carthorse/test-output/boulder-15km-500m-test-layer1-trails.geojson';
analyzeGeoJSONOverlaps(filePath)
    .then(result => {
        console.log('\n✅ Analysis complete');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Analysis failed:', error);
        process.exit(1);
    });
