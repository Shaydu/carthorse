const { Client } = require('pg');

async function analyzeSourceIdentifierDuplicates() {
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

        // Find trails with the same name but different source_identifiers
        const duplicateQuery = `
            WITH name_groups AS (
                SELECT 
                    name,
                    COUNT(DISTINCT source_identifier) as unique_identifiers,
                    COUNT(*) as total_count,
                    ARRAY_AGG(DISTINCT source_identifier) as source_identifiers,
                    ARRAY_AGG(DISTINCT source) as sources,
                    ARRAY_AGG(id) as trail_ids,
                    ARRAY_AGG(app_uuid) as app_uuids
                FROM public.trails
                WHERE name IS NOT NULL 
                  AND source_identifier IS NOT NULL
                GROUP BY name
                HAVING COUNT(DISTINCT source_identifier) > 1
            )
            SELECT 
                name,
                unique_identifiers,
                total_count,
                source_identifiers,
                sources,
                trail_ids,
                app_uuids
            FROM name_groups
            ORDER BY unique_identifiers DESC, name
        `;
        
        const duplicateResult = await client.query(duplicateQuery);
        
        console.log('\n=== DUPLICATE TRAILS BY NAME WITH DIFFERENT SOURCE IDENTIFIERS ===');
        console.log(`Total duplicate name groups found: ${duplicateResult.rows.length}`);

        if (duplicateResult.rows.length > 0) {
            console.log('\n=== DUPLICATE DETAILS ===');
            
            let totalDuplicates = 0;
            duplicateResult.rows.forEach((row, index) => {
                console.log(`\nDuplicate Group ${index + 1}:`);
                console.log(`  Name: "${row.name}"`);
                console.log(`  Unique source identifiers: ${row.unique_identifiers}`);
                console.log(`  Total instances: ${row.total_count}`);
                console.log(`  Source identifiers: ${row.source_identifiers.join(', ')}`);
                console.log(`  Sources: ${row.sources.join(', ')}`);
                console.log(`  Trail IDs: ${row.trail_ids.join(', ')}`);
                console.log(`  App UUIDs: ${row.app_uuids.join(', ')}`);
                
                totalDuplicates += row.total_count;
            });
            
            console.log(`\nTotal duplicate trails: ${totalDuplicates}`);
        }

        // Now let's look at the specific trail you mentioned
        const specificTrailQuery = `
            SELECT 
                id,
                app_uuid,
                name,
                source_identifier,
                source,
                created_at,
                updated_at,
                ST_AsText(ST_Transform(geometry, 4326)) as geometry_text
            FROM public.trails
            WHERE name = 'Green Mountain West Ridge Trail Segment 1'
            ORDER BY created_at
        `;
        
        const specificResult = await client.query(specificTrailQuery);
        
        console.log('\n=== SPECIFIC TRAIL ANALYSIS ===');
        console.log(`Trails with name "Green Mountain West Ridge Trail Segment 1": ${specificResult.rows.length}`);
        
        specificResult.rows.forEach((row, index) => {
            console.log(`\nInstance ${index + 1}:`);
            console.log(`  ID: ${row.id}`);
            console.log(`  App UUID: ${row.app_uuid}`);
            console.log(`  Source Identifier: ${row.source_identifier}`);
            console.log(`  Source: ${row.source}`);
            console.log(`  Created: ${row.created_at}`);
            console.log(`  Updated: ${row.updated_at}`);
            console.log(`  Geometry: ${row.geometry_text.substring(0, 100)}...`);
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

analyzeSourceIdentifierDuplicates();
