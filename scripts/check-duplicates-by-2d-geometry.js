const { Client } = require('pg');

async function checkDuplicatesBy2DGeometry() {
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

        // Find the most recent staging schema
        const schemaQuery = `
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE 'carthorse_%' 
            ORDER BY schema_name DESC 
            LIMIT 1
        `;
        
        const schemaResult = await client.query(schemaQuery);
        
        if (schemaResult.rows.length === 0) {
            console.log('No staging schemas found');
            return;
        }
        
        const stagingSchema = schemaResult.rows[0].schema_name;
        console.log(`\n=== CHECKING DUPLICATES BY 2D GEOMETRY IN: ${stagingSchema} ===`);

        // Check for duplicates by 2D geometry (ignoring Z elevation values)
        const duplicateQuery = `
            WITH geometry_groups AS (
                SELECT 
                    ST_AsText(ST_Force2D(geometry)) as geometry_2d_text,
                    COUNT(*) as count,
                    ARRAY_AGG(DISTINCT app_uuid) as app_uuids,
                    ARRAY_AGG(DISTINCT original_trail_uuid) as original_uuids,
                    ARRAY_AGG(DISTINCT name) as names,
                    ARRAY_AGG(DISTINCT source) as sources
                FROM ${stagingSchema}.trails
                WHERE geometry IS NOT NULL
                GROUP BY ST_AsText(ST_Force2D(geometry))
                HAVING COUNT(*) > 1
            )
            SELECT 
                geometry_2d_text,
                count,
                app_uuids,
                original_uuids,
                names,
                sources
            FROM geometry_groups
            ORDER BY count DESC, geometry_2d_text
            LIMIT 10
        `;
        
        const duplicateResult = await client.query(duplicateQuery);
        
        console.log(`\n=== DUPLICATE TRAILS BY 2D GEOMETRY ===`);
        console.log(`Total duplicate geometry groups found: ${duplicateResult.rows.length}`);

        if (duplicateResult.rows.length > 0) {
            console.log('\n=== DUPLICATE DETAILS ===');
            
            let totalDuplicates = 0;
            duplicateResult.rows.forEach((row, index) => {
                console.log(`\nDuplicate Group ${index + 1}:`);
                console.log(`  Count: ${row.count} instances`);
                console.log(`  App UUIDs: ${row.app_uuids.join(', ')}`);
                console.log(`  Original UUIDs: ${row.original_uuids.join(', ')}`);
                console.log(`  Names: ${row.names.join(', ')}`);
                console.log(`  Sources: ${row.sources.join(', ')}`);
                console.log(`  2D Geometry: ${row.geometry_2d_text.substring(0, 100)}...`);
                
                totalDuplicates += row.count;
            });
            
            console.log(`\nTotal duplicate trails: ${totalDuplicates}`);
        }

        // Also check for duplicates by original_trail_uuid to see if the same source trail is duplicated
        const originalUuidDuplicateQuery = `
            WITH original_uuid_groups AS (
                SELECT 
                    original_trail_uuid,
                    COUNT(*) as count,
                    ARRAY_AGG(app_uuid) as app_uuids,
                    ARRAY_AGG(DISTINCT name) as names,
                    ARRAY_AGG(DISTINCT source) as sources
                FROM ${stagingSchema}.trails
                WHERE original_trail_uuid IS NOT NULL
                GROUP BY original_trail_uuid
                HAVING COUNT(*) > 1
            )
            SELECT 
                original_trail_uuid,
                count,
                app_uuids,
                names,
                sources
            FROM original_uuid_groups
            ORDER BY count DESC
            LIMIT 10
        `;
        
        const originalUuidResult = await client.query(originalUuidDuplicateQuery);
        
        console.log(`\n=== DUPLICATES BY ORIGINAL TRAIL UUID ===`);
        console.log(`Total duplicate original UUID groups found: ${originalUuidResult.rows.length}`);

        if (originalUuidResult.rows.length > 0) {
            console.log('\n=== ORIGINAL UUID DUPLICATE DETAILS ===');
            
            originalUuidResult.rows.forEach((row, index) => {
                console.log(`\nOriginal UUID Group ${index + 1}:`);
                console.log(`  Original UUID: ${row.original_trail_uuid}`);
                console.log(`  Count: ${row.count} instances`);
                console.log(`  App UUIDs: ${row.app_uuids.join(', ')}`);
                console.log(`  Names: ${row.names.join(', ')}`);
                console.log(`  Sources: ${row.sources.join(', ')}`);
            });
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

checkDuplicatesBy2DGeometry();
