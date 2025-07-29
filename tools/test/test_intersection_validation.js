const { Client } = require('pg');

async function validateIntersectionSplitting() {
    console.log('🧪 Validating intersection splitting test cases...');
    
    const client = new Client({
        database: 'trail_master_db_test'
    });
    
    try {
        await client.connect();
        
        // Test 1: Y Intersection Validation
        console.log('\n📋 Test 1: Y Intersection Validation');
        const yIntersections = await client.query(`
            SELECT 
                ip.id,
                ip.connected_trail_names,
                array_length(ip.connected_trail_names, 1) as trail_count,
                ST_AsText(ip.point) as intersection_point
            FROM intersection_points ip
            WHERE EXISTS (
                SELECT 1 FROM unnest(ip.connected_trail_names) AS trail_name 
                WHERE trail_name LIKE 'TEST_Y_%'
            )
            ORDER BY ip.id
        `);
        
        console.log(`   Found ${yIntersections.rows.length} Y intersection points:`);
        yIntersections.rows.forEach((row, i) => {
            console.log(`   ${i + 1}. Point ${row.id}: ${row.connected_trail_names.join(' ↔ ')} at ${row.intersection_point}`);
        });
        
        // Test 2: T Intersection Validation (Amphitheater trails)
        console.log('\n📋 Test 2: T Intersection Validation');
        const tIntersections = await client.query(`
            SELECT 
                ip.id,
                ip.connected_trail_names,
                array_length(ip.connected_trail_names, 1) as trail_count,
                ST_AsText(ip.point) as intersection_point
            FROM intersection_points ip
            WHERE EXISTS (
                SELECT 1 FROM unnest(ip.connected_trail_names) AS trail_name 
                WHERE trail_name LIKE 'TEST_AMPHITHEATER_%'
            )
            ORDER BY ip.id
        `);
        
        console.log(`   Found ${tIntersections.rows.length} T intersection points:`);
        tIntersections.rows.forEach((row, i) => {
            console.log(`   ${i + 1}. Point ${row.id}: ${row.connected_trail_names.join(' ↔ ')} at ${row.intersection_point}`);
        });
        
        // Test 3: X Intersection Validation (Mesa trails)
        console.log('\n📋 Test 3: X Intersection Validation');
        const xIntersections = await client.query(`
            SELECT 
                ip.id,
                ip.connected_trail_names,
                array_length(ip.connected_trail_names, 1) as trail_count,
                ST_AsText(ip.point) as intersection_point
            FROM intersection_points ip
            WHERE EXISTS (
                SELECT 1 FROM unnest(ip.connected_trail_names) AS trail_name 
                WHERE trail_name LIKE 'TEST_MESA_%' OR trail_name LIKE 'TEST_SHANAHAN_%'
            )
            ORDER BY ip.id
        `);
        
        console.log(`   Found ${xIntersections.rows.length} X intersection points:`);
        xIntersections.rows.forEach((row, i) => {
            console.log(`   ${i + 1}. Point ${row.id}: ${row.connected_trail_names.join(' ↔ ')} at ${row.intersection_point}`);
        });
        
        // Test 4: Split Trail Validation
        console.log('\n📋 Test 4: Split Trail Validation');
        const splitTrails = await client.query(`
            SELECT 
                name,
                original_trail_id,
                segment_number,
                ST_Length(geometry::geography) as length_meters
            FROM test_staging.trails
            WHERE name LIKE 'TEST_%'
            ORDER BY name, segment_number
        `);
        
        console.log(`   Split trail segments:`);
        splitTrails.rows.forEach((row, i) => {
            console.log(`   ${i + 1}. ${row.name} (segment ${row.segment_number}): ${row.length_meters.toFixed(1)}m`);
        });
        
        // Test 5: Routing Node Validation
        console.log('\n📋 Test 5: Routing Node Validation');
        const routingNodes = await client.query(`
            SELECT 
                rn.id,
                rn.node_type,
                rn.lat,
                rn.lng,
                COUNT(DISTINCT t.name) as connected_trail_count
            FROM routing_nodes rn
            JOIN trails t ON ST_DWithin(rn.geometry, t.geometry, 0.001)
            WHERE t.name LIKE 'TEST_%'
            GROUP BY rn.id, rn.node_type, rn.lat, rn.lng
            ORDER BY rn.id
        `);
        
        console.log(`   Found ${routingNodes.rows.length} routing nodes near test trails:`);
        routingNodes.rows.forEach((row, i) => {
            console.log(`   ${i + 1}. Node ${row.id} (${row.node_type}): ${row.lat.toFixed(4)}, ${row.lng.toFixed(4)} - ${row.connected_trail_count} trails`);
        });
        
        // Test 6: Routing Edge Validation
        console.log('\n📋 Test 6: Routing Edge Validation');
        const routingEdges = await client.query(`
            SELECT 
                re.id,
                re.trail_name,
                re.distance_km,
                re.from_node_id,
                re.to_node_id
            FROM routing_edges re
            JOIN trails t ON re.trail_id = t.app_uuid
            WHERE t.name LIKE 'TEST_%'
            ORDER BY re.id
        `);
        
        console.log(`   Found ${routingEdges.rows.length} routing edges for test trails:`);
        routingEdges.rows.forEach((row, i) => {
            console.log(`   ${i + 1}. Edge ${row.id}: ${row.trail_name} (${row.distance_km.toFixed(3)}km) from ${row.from_node_id} to ${row.to_node_id}`);
        });
        
        // Test 7: Intersection Analysis
        console.log('\n📋 Test 7: Intersection Analysis');
        
        // Y Intersection Analysis
        const yAnalysis = await client.query(`
            SELECT 
                COUNT(DISTINCT ip.id) as intersection_count,
                COUNT(DISTINCT t.name) as trail_count,
                COUNT(DISTINCT s.name) as split_segment_count
            FROM test_staging.intersection_points ip
            CROSS JOIN test_staging.trails t
            CROSS JOIN test_staging.trails s
            WHERE EXISTS (
                SELECT 1 FROM unnest(ip.connected_trail_names) AS trail_name 
                WHERE trail_name LIKE 'TEST_Y_%'
            )
            AND t.name LIKE 'TEST_Y_%'
            AND s.name LIKE 'TEST_Y_%'
        `);
        
        console.log(`   Y Intersection Analysis:`);
        console.log(`     - Intersection points: ${yAnalysis.rows[0]?.intersection_count || 0}`);
        console.log(`     - Original trails: ${yAnalysis.rows[0]?.trail_count || 0}`);
        console.log(`     - Split segments: ${yAnalysis.rows[0]?.split_segment_count || 0}`);
        
        // T Intersection Analysis
        const tAnalysis = await client.query(`
            SELECT 
                COUNT(DISTINCT ip.id) as intersection_count,
                COUNT(DISTINCT t.name) as trail_count,
                COUNT(DISTINCT s.name) as split_segment_count
            FROM test_staging.intersection_points ip
            CROSS JOIN test_staging.trails t
            CROSS JOIN test_staging.trails s
            WHERE EXISTS (
                SELECT 1 FROM unnest(ip.connected_trail_names) AS trail_name 
                WHERE trail_name LIKE 'TEST_T_%'
            )
            AND t.name LIKE 'TEST_T_%'
            AND s.name LIKE 'TEST_T_%'
        `);
        
        console.log(`   T Intersection Analysis:`);
        console.log(`     - Intersection points: ${tAnalysis.rows[0]?.intersection_count || 0}`);
        console.log(`     - Original trails: ${tAnalysis.rows[0]?.trail_count || 0}`);
        console.log(`     - Split segments: ${tAnalysis.rows[0]?.split_segment_count || 0}`);
        
        // X Intersection Analysis
        const xAnalysis = await client.query(`
            SELECT 
                COUNT(DISTINCT ip.id) as intersection_count,
                COUNT(DISTINCT t.name) as trail_count,
                COUNT(DISTINCT s.name) as split_segment_count
            FROM test_staging.intersection_points ip
            CROSS JOIN test_staging.trails t
            CROSS JOIN test_staging.trails s
            WHERE EXISTS (
                SELECT 1 FROM unnest(ip.connected_trail_names) AS trail_name 
                WHERE trail_name LIKE 'TEST_X_%'
            )
            AND t.name LIKE 'TEST_X_%'
            AND s.name LIKE 'TEST_X_%'
        `);
        
        console.log(`   X Intersection Analysis:`);
        console.log(`     - Intersection points: ${xAnalysis.rows[0]?.intersection_count || 0}`);
        console.log(`     - Original trails: ${xAnalysis.rows[0]?.trail_count || 0}`);
        console.log(`     - Split segments: ${xAnalysis.rows[0]?.split_segment_count || 0}`);
        
        // Summary
        console.log('\n📊 Test Summary:');
        console.log(`   ✅ Y Intersection: ${yIntersections.rows.length} points, ${splitTrails.rows.filter(t => t.name.includes('Y')).length} segments`);
        console.log(`   ✅ T Intersection: ${tIntersections.rows.length} points, ${splitTrails.rows.filter(t => t.name.includes('T')).length} segments`);
        console.log(`   ✅ X Intersection: ${xIntersections.rows.length} points, ${splitTrails.rows.filter(t => t.name.includes('X')).length} segments`);
        console.log(`   ✅ Routing Nodes: ${routingNodes.rows.length} nodes`);
        console.log(`   ✅ Routing Edges: ${routingEdges.rows.length} edges`);
        
        // Validation Results
        const results = {
            y_intersection: {
                intersection_points: yIntersections.rows.length,
                split_segments: splitTrails.rows.filter(t => t.name.includes('Y')).length,
                routing_nodes: routingNodes.rows.length,
                routing_edges: routingEdges.rows.length,
                success: yIntersections.rows.length > 0
            },
            t_intersection: {
                intersection_points: tIntersections.rows.length,
                split_segments: splitTrails.rows.filter(t => t.name.includes('T')).length,
                routing_nodes: routingNodes.rows.length,
                routing_edges: routingEdges.rows.length,
                success: tIntersections.rows.length > 0
            },
            x_intersection: {
                intersection_points: xIntersections.rows.length,
                split_segments: splitTrails.rows.filter(t => t.name.includes('X')).length,
                routing_nodes: routingNodes.rows.length,
                routing_edges: routingEdges.rows.length,
                success: xIntersections.rows.length > 0
            }
        };
        
        console.log('\n🎯 Validation Results:');
        console.log(`   Y Intersection: ${results.y_intersection.success ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`   T Intersection: ${results.t_intersection.success ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`   X Intersection: ${results.x_intersection.success ? '✅ PASS' : '❌ FAIL'}`);
        
        return results;
        
    } finally {
        await client.end();
    }
}

// Run the validation if called directly
if (require.main === module) {
    validateIntersectionSplitting()
        .then(results => {
            console.log('\n✅ Intersection validation complete!');
            console.log('🌐 View the visualization at: http://localhost:8082');
        })
        .catch(error => {
            console.error('❌ Error during validation:', error);
            process.exit(1);
        });
}

module.exports = { validateIntersectionSplitting }; 