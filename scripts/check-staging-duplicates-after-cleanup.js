const { Client } = require('pg');

async function checkStagingDuplicatesAfterCleanup() {
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
            console.log('No carthorse staging schemas found');
            return;
        }
        
        const latestSchema = schemaResult.rows[0].schema_name;
        console.log(`Latest staging schema: ${latestSchema}`);

        // Check for duplicates by 2D geometry
        const duplicateQuery = `
            WITH geometry_groups AS (
                SELECT 
                    ST_AsText(ST_Force2D(geometry)) as geometry_2d,
                    COUNT(*) as count,
                    ARRAY_AGG(id) as trail_ids,
                    ARRAY_AGG(app_uuid) as trail_uuids,
                    ARRAY_AGG(original_trail_uuid) as original_uuids,
                    ARRAY_AGG(name) as trail_names
                FROM ${latestSchema}.trails
                WHERE geometry IS NOT NULL
                GROUP BY ST_AsText(ST_Force2D(geometry))
                HAVING COUNT(*) > 1
            )
            SELECT 
                geometry_2d,
                count,
                trail_ids,
                trail_uuids,
                original_uuids,
                trail_names
            FROM geometry_groups
            ORDER BY count DESC, geometry_2d
            LIMIT 10
        `;
        
        const duplicateResult = await client.query(duplicateQuery);
        
        console.log(`\n=== DUPLICATES IN STAGING SCHEMA ===`);
        console.log(`Schema: ${latestSchema}`);
        console.log(`Total duplicate groups found: ${duplicateResult.rows.length}`);

        if (duplicateResult.rows.length > 0) {
            console.log('\n=== TOP 10 DUPLICATE GROUPS ===');
            
            let totalDuplicates = 0;
            duplicateResult.rows.forEach((row, index) => {
                console.log(`\nDuplicate Group ${index + 1}:`);
                console.log(`  Count: ${row.count} instances`);
                console.log(`  Trail IDs: ${row.trail_ids.join(', ')}`);
                console.log(`  Trail UUIDs: ${row.trail_uuids.join(', ')}`);
                console.log(`  Original UUIDs: ${row.original_uuids.join(', ')}`);
                console.log(`  Trail Names: ${row.trail_names.join(', ')}`);
                console.log(`  Geometry: ${row.geometry_2d.substring(0, 100)}...`);
                
                totalDuplicates += row.count;
            });
            
            console.log(`\n📊 SUMMARY:`);
            console.log(`  - Total duplicate groups: ${duplicateResult.rows.length}`);
            console.log(`  - Total duplicate instances: ${totalDuplicates}`);
            
            // Check if there are still duplicates with different original_trail_uuid values
            const differentOriginalUuids = duplicateResult.rows.filter(row => {
                const uniqueOriginalUuids = new Set(row.original_uuids);
                return uniqueOriginalUuids.size > 1;
            });
            
            console.log(`  - Groups with different original UUIDs: ${differentOriginalUuids.length}`);
            
        } else {
            console.log('✅ No duplicates found in staging schema!');
        }

        // Also check total trail count
        const totalCountQuery = `SELECT COUNT(*) as count FROM ${latestSchema}.trails`;
        const totalCountResult = await client.query(totalCountQuery);
        const totalCount = parseInt(totalCountResult.rows[0].count);
        
        console.log(`\n📊 Total trails in staging: ${totalCount}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

checkStagingDuplicatesAfterCleanup();
