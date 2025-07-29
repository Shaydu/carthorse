const { Client } = require('pg');

async function testNebelHornFernCanyonFix() {
    console.log('🧪 Testing Nebel Horn and Fern Canyon intersection detection fix...');
    
    const client = new Client({
        database: 'trail_master_db_test'
    });
    
    try {
        await client.connect();
        
        // Step 1: Create test staging schema
        console.log('\\n📋 Step 1: Creating test staging schema...');
        const stagingSchema = 'test_nebel_fern_staging';
        await client.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
        await client.query(`CREATE SCHEMA ${stagingSchema}`);
        
        // Step 2: Create tables in staging schema
        console.log('\\n📋 Step 2: Creating tables in staging schema...');
        await client.query(`
            CREATE TABLE ${stagingSchema}.trails (
                id SERIAL PRIMARY KEY,
                app_uuid TEXT NOT NULL,
                name TEXT,
                trail_type TEXT,
                surface TEXT,
                difficulty TEXT,
                source_tags JSONB,
                osm_id TEXT,
                elevation_gain REAL,
                elevation_loss REAL,
                max_elevation REAL,
                min_elevation REAL,
                avg_elevation REAL,
                length_km REAL,
                source TEXT,
                geometry GEOMETRY(LineStringZ, 4326),
                bbox_min_lng REAL,
                bbox_max_lng REAL,
                bbox_min_lat REAL,
                bbox_max_lat REAL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        await client.query(`
            CREATE TABLE ${stagingSchema}.intersection_points (
                id SERIAL PRIMARY KEY,
                point GEOMETRY(Point, 4326),
                point_3d GEOMETRY(PointZ, 4326),
                connected_trail_ids TEXT[],
                connected_trail_names TEXT[],
                node_type TEXT,
                distance_meters REAL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        // Step 3: Insert real Nebel Horn and Fern Canyon trails
        console.log('\\n📋 Step 3: Inserting real Nebel Horn and Fern Canyon trails...');
        await client.query(`
            INSERT INTO ${stagingSchema}.trails (app_uuid, name, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
            ('nebel-horn-trail', 'Nebel Horn Trail', 'hiking', 'dirt', 'moderate', 1.2, 150.0, 50.0, 2100.0, 1950.0, 2025.0, ST_GeomFromText('LINESTRING(-105.2918703 39.9656795 2000, -105.2918703 39.9756795 2100)', 4326)),
            ('fern-canyon-trail', 'Fern Canyon Trail', 'hiking', 'dirt', 'easy', 2.1, 100.0, 100.0, 2050.0, 1950.0, 2000.0, ST_GeomFromText('LINESTRING(-105.2818703 39.9706795 2000, -105.3018703 39.9706795 2050)', 4326))
        `);
        
        // Step 4: Test intersection detection
        console.log('\\n📋 Step 4: Testing intersection detection...');
        const intersectionResult = await client.query(`
            SELECT detect_trail_intersections($1, $2)
        `, [stagingSchema, 2.0]);
        console.log('   Intersection detection completed');
        
        // Step 5: Check intersection points
        console.log('\\n📋 Step 5: Checking intersection points...');
        const intersectionPoints = await client.query(`
            SELECT COUNT(*) as count FROM ${stagingSchema}.intersection_points
        `);
        console.log(`   Intersection points found: ${intersectionPoints.rows[0].count}`);
        
        if (intersectionPoints.rows[0].count > 0) {
            const intersectionDetails = await client.query(`
                SELECT 
                    connected_trail_names,
                    ST_AsText(point) as intersection_point
                FROM ${stagingSchema}.intersection_points
            `);
            console.log('   Intersection details:', intersectionDetails.rows);
        }
        
        // Step 6: Test trail splitting
        console.log('\\n📋 Step 6: Testing trail splitting...');
        const originalCount = await client.query(`
            SELECT COUNT(*) as count FROM ${stagingSchema}.trails
        `);
        console.log(`   Original trails: ${originalCount.rows[0].count}`);
        
        const splitResult = await client.query(`
            SELECT replace_trails_with_split_trails($1, $2)
        `, [stagingSchema, 2.0]);
        console.log(`   Trail splitting completed, segments created: ${splitResult.rows[0].replace_trails_with_split_trails}`);
        
        // Step 7: Check split results
        console.log('\\n📋 Step 7: Checking split results...');
        const splitCount = await client.query(`
            SELECT COUNT(*) as count FROM ${stagingSchema}.trails
        `);
        console.log(`   Split trails: ${splitCount.rows[0].count}`);
        
        const splitDetails = await client.query(`
            SELECT 
                name,
                app_uuid,
                ST_AsText(geometry) as geometry_text,
                length_km
            FROM ${stagingSchema}.trails
            ORDER BY name, app_uuid
        `);
        console.log('   Split trail details:');
        splitDetails.rows.forEach((row, index) => {
            console.log(`     ${index + 1}. ${row.name} (${row.app_uuid}) - ${row.length_km.toFixed(2)}km`);
        });
        
        // Step 8: Validate results
        console.log('\\n📋 Step 8: Validating results...');
        if (splitCount.rows[0].count > originalCount.rows[0].count) {
            console.log('   ✅ SUCCESS: Trails were split at intersections');
        } else {
            console.log('   ❌ FAILURE: No trail splitting occurred');
        }
        
        // Cleanup
        await client.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await client.end();
    }
}

testNebelHornFernCanyonFix();