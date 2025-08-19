const { Client } = require('pg');

async function checkStagingDuplicates() {
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
        console.log(`\n=== CHECKING STAGING SCHEMA: ${stagingSchema} ===`);

        // Check for trails with the same name but different app_uuid values
        const duplicateQuery = `
            WITH name_groups AS (
                SELECT 
                    name,
                    COUNT(DISTINCT app_uuid) as unique_uuids,
                    COUNT(*) as total_count,
                    ARRAY_AGG(DISTINCT app_uuid) as app_uuids,
                    ARRAY_AGG(DISTINCT original_trail_uuid) as original_uuids,
                    ARRAY_AGG(DISTINCT source) as sources
                FROM ${stagingSchema}.trails
                WHERE name IS NOT NULL 
                  AND app_uuid IS NOT NULL
                GROUP BY name
                HAVING COUNT(DISTINCT app_uuid) > 1
            )
            SELECT 
                name,
                unique_uuids,
                total_count,
                app_uuids,
                original_uuids,
                sources
            FROM name_groups
            ORDER BY unique_uuids DESC, name
            LIMIT 10
        `;
        
        const duplicateResult = await client.query(duplicateQuery);
        
        console.log(`\n=== DUPLICATE TRAILS BY NAME IN STAGING ===`);
        console.log(`Total duplicate name groups found: ${duplicateResult.rows.length}`);

        if (duplicateResult.rows.length > 0) {
            console.log('\n=== DUPLICATE DETAILS ===');
            
            duplicateResult.rows.forEach((row, index) => {
                console.log(`\nDuplicate Group ${index + 1}:`);
                console.log(`  Name: "${row.name}"`);
                console.log(`  Unique app_uuids: ${row.unique_uuids}`);
                console.log(`  Total instances: ${row.total_count}`);
                console.log(`  App UUIDs: ${row.app_uuids.join(', ')}`);
                console.log(`  Original UUIDs: ${row.original_uuids.join(', ')}`);
                console.log(`  Sources: ${row.sources.join(', ')}`);
            });
        }

        // Check the specific trail mentioned by the user
        const specificTrailQuery = `
            SELECT 
                app_uuid,
                original_trail_uuid,
                name,
                source,
                ST_AsText(ST_Transform(geometry, 4326)) as geometry_text
            FROM ${stagingSchema}.trails
            WHERE name = 'Green Mountain West Ridge Trail Segment 1'
            ORDER BY app_uuid
        `;
        
        const specificResult = await client.query(specificTrailQuery);
        
        console.log(`\n=== SPECIFIC TRAIL ANALYSIS ===`);
        console.log(`Trails with name "Green Mountain West Ridge Trail Segment 1": ${specificResult.rows.length}`);
        
        specificResult.rows.forEach((row, index) => {
            console.log(`\nInstance ${index + 1}:`);
            console.log(`  App UUID: ${row.app_uuid}`);
            console.log(`  Original UUID: ${row.original_trail_uuid}`);
            console.log(`  Source: ${row.source}`);
            console.log(`  Geometry: ${row.geometry_text.substring(0, 100)}...`);
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

checkStagingDuplicates();
