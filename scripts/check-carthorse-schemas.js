const { Client } = require('pg');

async function checkCarthorseSchemas() {
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

        // Find all carthorse schemas
        const schemaQuery = `
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE 'carthorse_%' 
            ORDER BY schema_name DESC
        `;
        
        const schemaResult = await client.query(schemaQuery);
        
        console.log('\n=== CARTHORSE STAGING SCHEMAS ===');
        if (schemaResult.rows.length === 0) {
            console.log('No carthorse staging schemas found');
            return;
        }
        
        schemaResult.rows.forEach(row => {
            console.log(`Found schema: ${row.schema_name}`);
        });

        // Check each carthorse schema for duplicates
        for (const schemaRow of schemaResult.rows) {
            const schema = schemaRow.schema_name;
            console.log(`\n--- Checking schema: ${schema} ---`);
            
            // Check if trails table exists
            const tableCheckQuery = `
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = $1 AND table_name = 'trails'
            `;
            
            const tableResult = await client.query(tableCheckQuery, [schema]);
            if (tableResult.rows.length === 0) {
                console.log(`  No trails table found in ${schema}`);
                continue;
            }

            // Check trail count
            const countQuery = `SELECT COUNT(*) as count FROM ${schema}.trails`;
            const countResult = await client.query(countQuery);
            console.log(`  Total trails: ${countResult.rows[0].count}`);

            // Check for duplicates by 2D geometry
            const duplicateQuery = `
                WITH geometry_groups AS (
                    SELECT 
                        ST_AsText(ST_Force2D(geometry)) as geometry_2d_text,
                        COUNT(*) as count,
                        ARRAY_AGG(id) as trail_ids,
                        ARRAY_AGG(app_uuid) as trail_uuids,
                        ARRAY_AGG(name) as trail_names,
                        ARRAY_AGG(source) as sources,
                        ARRAY_AGG(elevation_gain) as elevation_gains,
                        ARRAY_AGG(elevation_loss) as elevation_losses
                    FROM ${schema}.trails
                    WHERE geometry IS NOT NULL
                    GROUP BY ST_AsText(ST_Force2D(geometry))
                    HAVING COUNT(*) > 1
                )
                SELECT 
                    geometry_2d_text,
                    count,
                    trail_ids,
                    trail_uuids,
                    trail_names,
                    sources,
                    elevation_gains,
                    elevation_losses
                FROM geometry_groups
                ORDER BY count DESC, geometry_2d_text
            `;

            const duplicateResult = await client.query(duplicateQuery);
            
            console.log(`  Duplicate groups found: ${duplicateResult.rows.length}`);

            if (duplicateResult.rows.length > 0) {
                console.log(`  === DUPLICATE DETAILS FOR ${schema} ===`);
                
                let totalDuplicates = 0;
                duplicateResult.rows.forEach((row, index) => {
                    console.log(`    Duplicate Group ${index + 1}:`);
                    console.log(`      Count: ${row.count} instances`);
                    console.log(`      Trail IDs: ${row.trail_ids.join(', ')}`);
                    console.log(`      Trail Names: ${row.trail_names.join(', ')}`);
                    console.log(`      Sources: ${row.sources.join(', ')}`);
                    console.log(`      Elevation Gains: ${row.elevation_gains.join(', ')}`);
                    console.log(`      Elevation Losses: ${row.elevation_losses.join(', ')}`);
                    
                    totalDuplicates += row.count;
                });
                
                console.log(`    Total duplicate trails in ${schema}: ${totalDuplicates}`);
            }
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

checkCarthorseSchemas();
