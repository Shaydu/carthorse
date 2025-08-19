const { Client } = require('pg');

async function analyzeDuplicatesBySource() {
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

        // First, let's see what sources we have
        const sourcesQuery = `
            SELECT 
                source,
                COUNT(*) as count
            FROM public.trails 
            WHERE source IS NOT NULL
            GROUP BY source
            ORDER BY count DESC
        `;
        
        const sourcesResult = await client.query(sourcesQuery);
        
        console.log('\n=== TRAIL SOURCES ===');
        sourcesResult.rows.forEach(row => {
            console.log(`${row.source}: ${row.count} trails`);
        });

        // Check for duplicates across ALL sources by 2D geometry
        const allSourcesDuplicateQuery = `
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
                FROM public.trails
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

        const allSourcesDuplicateResult = await client.query(allSourcesDuplicateQuery);
        
        console.log('\n=== DUPLICATES ACROSS ALL SOURCES (2D GEOMETRY) ===');
        console.log(`Total duplicate groups found: ${allSourcesDuplicateResult.rows.length}`);

        if (allSourcesDuplicateResult.rows.length > 0) {
            console.log('\n=== DUPLICATE DETAILS (ALL SOURCES) ===');
            
            let totalDuplicates = 0;
            allSourcesDuplicateResult.rows.forEach((row, index) => {
                console.log(`\nDuplicate Group ${index + 1}:`);
                console.log(`  Count: ${row.count} instances`);
                console.log(`  Trail IDs: ${row.trail_ids.join(', ')}`);
                console.log(`  Trail UUIDs: ${row.trail_uuids.join(', ')}`);
                console.log(`  Trail Names: ${row.trail_names.join(', ')}`);
                console.log(`  Sources: ${row.sources.join(', ')}`);
                console.log(`  Elevation Gains: ${row.elevation_gains.join(', ')}`);
                console.log(`  Elevation Losses: ${row.elevation_losses.join(', ')}`);
                console.log(`  Geometry (2D): ${row.geometry_2d_text.substring(0, 100)}...`);
                
                totalDuplicates += row.count;
            });
            
            console.log(`\nTotal duplicate trails: ${totalDuplicates}`);
        }

        // Now check for duplicates WITHIN each source separately
        console.log('\n=== DUPLICATES WITHIN EACH SOURCE ===');
        
        for (const sourceRow of sourcesResult.rows) {
            const source = sourceRow.source;
            console.log(`\n--- Checking duplicates within source: ${source} ---`);
            
            const sourceDuplicateQuery = `
                WITH geometry_groups AS (
                    SELECT 
                        ST_AsText(ST_Force2D(geometry)) as geometry_2d_text,
                        COUNT(*) as count,
                        ARRAY_AGG(id) as trail_ids,
                        ARRAY_AGG(app_uuid) as trail_uuids,
                        ARRAY_AGG(name) as trail_names,
                        ARRAY_AGG(elevation_gain) as elevation_gains,
                        ARRAY_AGG(elevation_loss) as elevation_losses
                    FROM public.trails
                    WHERE geometry IS NOT NULL AND source = $1
                    GROUP BY ST_AsText(ST_Force2D(geometry))
                    HAVING COUNT(*) > 1
                )
                SELECT 
                    geometry_2d_text,
                    count,
                    trail_ids,
                    trail_uuids,
                    trail_names,
                    elevation_gains,
                    elevation_losses
                FROM geometry_groups
                ORDER BY count DESC, geometry_2d_text
            `;

            const sourceDuplicateResult = await client.query(sourceDuplicateQuery, [source]);
            
            console.log(`Duplicate groups found: ${sourceDuplicateResult.rows.length}`);

            if (sourceDuplicateResult.rows.length > 0) {
                let totalDuplicates = 0;
                sourceDuplicateResult.rows.forEach((row, index) => {
                    console.log(`  Duplicate Group ${index + 1}:`);
                    console.log(`    Count: ${row.count} instances`);
                    console.log(`    Trail IDs: ${row.trail_ids.join(', ')}`);
                    console.log(`    Trail Names: ${row.trail_names.join(', ')}`);
                    console.log(`    Elevation Gains: ${row.elevation_gains.join(', ')}`);
                    console.log(`    Elevation Losses: ${row.elevation_losses.join(', ')}`);
                    
                    totalDuplicates += row.count;
                });
                
                console.log(`  Total duplicate trails in ${source}: ${totalDuplicates}`);
            } else {
                console.log(`  No duplicates found within ${source}`);
            }
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

analyzeDuplicatesBySource();
