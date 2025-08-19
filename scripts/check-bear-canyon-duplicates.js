const { Client } = require('pg');

async function checkBearCanyonDuplicates() {
    const client = new Client({
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        database: 'trail_master_db',
        user: process.env.PGUSER || 'shaydu',
        password: process.env.PGPASSWORD || ''
    });

    try {
        await client.connect();
        console.log('Connected to trail_master_db');

        // Find the latest staging schema
        const schemaQuery = `
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE 'carthorse_%' 
            ORDER BY schema_name DESC 
            LIMIT 1
        `;
        
        const schemaResult = await client.query(schemaQuery);
        
        if (schemaResult.rows.length === 0) {
            console.log('No carthorse staging schemas found');
            return;
        }
        
        const latestSchema = schemaResult.rows[0].schema_name;
        console.log(`Latest staging schema: ${latestSchema}`);

        // Check for "Bear Canyon Trail Segment 1" duplicates
        const duplicateQuery = `
            SELECT 
                id,
                app_uuid,
                original_trail_uuid,
                name,
                ST_AsText(ST_Force2D(geometry)) as geometry_2d,
                ST_Length(geometry::geography) as length_meters,
                elevation_gain,
                elevation_loss
            FROM ${latestSchema}.trails
            WHERE name = 'Bear Canyon Trail Segment 1'
            ORDER BY id
        `;
        
        const duplicateResult = await client.query(duplicateQuery);
        
        console.log(`\n=== BEAR CANYON TRAIL SEGMENT 1 DUPLICATES ===`);
        console.log(`Schema: ${latestSchema}`);
        console.log(`Total instances found: ${duplicateResult.rows.length}`);
        
        if (duplicateResult.rows.length > 0) {
            console.log('\n=== DETAILS ===');
            
            // Group by 2D geometry to identify true duplicates
            const geometryGroups = new Map();
            
            duplicateResult.rows.forEach((row, index) => {
                const geometryKey = row.geometry_2d;
                if (!geometryGroups.has(geometryKey)) {
                    geometryGroups.set(geometryKey, []);
                }
                geometryGroups.get(geometryKey).push(row);
            });
            
            console.log(`\nUnique 2D geometries: ${geometryGroups.size}`);
            
            geometryGroups.forEach((group, geometryKey) => {
                console.log(`\n--- Geometry Group (${group.length} instances) ---`);
                console.log(`2D Geometry: ${geometryKey.substring(0, 100)}...`);
                
                group.forEach((row, index) => {
                    console.log(`  Instance ${index + 1}:`);
                    console.log(`    ID: ${row.id}`);
                    console.log(`    app_uuid: ${row.app_uuid}`);
                    console.log(`    original_trail_uuid: ${row.original_trail_uuid}`);
                    console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
                    console.log(`    Elevation gain: ${row.elevation_gain || 'null'}`);
                    console.log(`    Elevation loss: ${row.elevation_loss || 'null'}`);
                });
            });
            
            // Check for different original_trail_uuid values
            const originalUuids = new Set(duplicateResult.rows.map(row => row.original_trail_uuid));
            console.log(`\nUnique original_trail_uuid values: ${originalUuids.size}`);
            if (originalUuids.size > 1) {
                console.log('Original UUIDs:', Array.from(originalUuids));
            }
            
        } else {
            console.log('No instances of "Bear Canyon Trail Segment 1" found');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

checkBearCanyonDuplicates();
