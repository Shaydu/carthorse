const { Client } = require('pg');

async function testTrailSplitting() {
    console.log('🧪 Testing trail splitting functionality...');
    
    const client = new Client({
        database: 'trail_master_db_test'
    });
    
    try {
        await client.connect();
        
        // Step 1: Check original trail counts
        console.log('\n📋 Step 1: Checking original trail counts...');
        const originalCount = await client.query(`
            SELECT COUNT(*) as count FROM trails 
            WHERE name ILIKE '%nebel%' OR name ILIKE '%fern canyon%'
        `);
        console.log(`Original trails: ${originalCount.rows[0].count}`);
        
        // Step 2: Check if trails intersect
        console.log('\n📋 Step 2: Checking for intersections...');
        const intersections = await client.query(`
            SELECT t1.name as trail1_name, t2.name as trail2_name, 
                   ST_AsText(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) as intersection_point
            FROM trails t1 
            JOIN trails t2 ON t1.id < t2.id 
            WHERE (t1.name ILIKE '%nebel%' OR t1.name ILIKE '%fern canyon%') 
            AND (t2.name ILIKE '%nebel%' OR t2.name ILIKE '%fern canyon%') 
            AND ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))
        `);
        
        if (intersections.rows.length > 0) {
            console.log('✅ Found intersections:');
            intersections.rows.forEach(row => {
                console.log(`  - ${row.trail1_name} intersects ${row.trail2_name} at ${row.intersection_point}`);
            });
        } else {
            console.log('❌ No intersections found');
            return;
        }
        
        // Step 3: Create a test staging schema
        console.log('\n📋 Step 3: Creating test staging schema...');
        const stagingSchema = `test_staging_${Date.now()}`;
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
        
        // Copy trails to staging
        await client.query(`
            CREATE TABLE ${stagingSchema}.trails AS 
            SELECT * FROM trails 
            WHERE name ILIKE '%nebel%' OR name ILIKE '%fern canyon%'
        `);
        
        // Step 4: Run trail splitting
        console.log('\n📋 Step 4: Running trail splitting...');
        
        // First, let's check if intersection points are being detected
        console.log('   Checking intersection detection...');
        const intersectionPoints = await client.query(`
            SELECT COUNT(*) as count FROM ${stagingSchema}.intersection_points
        `);
        console.log(`   Intersection points found: ${intersectionPoints.rows[0].count}`);
        
        if (intersectionPoints.rows[0].count === 0) {
            console.log('   ❌ No intersection points detected - this is the problem!');
            console.log('   Let\'s manually detect intersections...');
            
            // Manually detect intersections
            await client.query(`
                INSERT INTO ${stagingSchema}.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
                SELECT DISTINCT
                    ST_Force2D(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) as point,
                    ST_Force3D(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) as point_3d,
                    ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
                    ARRAY[t1.name, t2.name] as connected_trail_names,
                    'intersection' as node_type,
                    2.0 as distance_meters
                FROM ${stagingSchema}.trails t1
                JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
                WHERE ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))
                  AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) = 'ST_Point'
            `);
            
            const manualIntersections = await client.query(`
                SELECT COUNT(*) as count FROM ${stagingSchema}.intersection_points
            `);
            console.log(`   Manual intersection points created: ${manualIntersections.rows[0].count}`);
        }
        
        const splitResult = await client.query(`
            SELECT replace_trails_with_split_trails($1, $2)
        `, [stagingSchema, 2.0]);
        
        console.log(`Split result: ${splitResult.rows[0].replace_trails_with_split_trails} segments created`);
        
        // Step 5: Check split trail counts
        console.log('\n📋 Step 5: Checking split trail counts...');
        const splitCount = await client.query(`
            SELECT COUNT(*) as count FROM ${stagingSchema}.trails
        `);
        console.log(`Split trails: ${splitCount.rows[0].count}`);
        
        // Step 6: Check individual trail segments
        console.log('\n📋 Step 6: Checking individual trail segments...');
        const segments = await client.query(`
            SELECT name, app_uuid, length_km, ST_AsText(geometry) as geometry_text
            FROM ${stagingSchema}.trails
            ORDER BY name, app_uuid
        `);
        
        console.log('Split trail segments:');
        segments.rows.forEach(row => {
            console.log(`  - ${row.name} (${row.app_uuid}): ${row.length_km}km`);
        });
        
        // Step 7: Cleanup
        console.log('\n📋 Step 7: Cleaning up...');
        await client.query(`DROP SCHEMA ${stagingSchema} CASCADE`);
        
        console.log('\n✅ Trail splitting test completed!');
        
    } catch (error) {
        console.error('❌ Error during trail splitting test:', error);
        throw error;
    } finally {
        await client.end();
    }
}

// Run the test
testTrailSplitting().catch(console.error);