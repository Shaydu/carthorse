const { Client } = require('pg');

async function analyzeDuplicateTrailsGeometry() {
    const client = new Client({
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE || 'trail_master_db',
        user: process.env.PGUSER || 'tester',
        password: process.env.PGPASSWORD || ''
    });

    try {
        await client.connect();
        console.log('Connected to database');

        // First, find the latest staging schema
        const schemaQuery = `
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE 'carthorse_%' 
               OR schema_name LIKE 'staging_%'
            ORDER BY schema_name DESC 
            LIMIT 1
        `;
        
        const schemaResult = await client.query(schemaQuery);
        if (schemaResult.rows.length === 0) {
            console.log('No staging schemas found');
            return;
        }
        
        const latestSchema = schemaResult.rows[0].schema_name;
        console.log(`Analyzing staging schema: ${latestSchema}`);

        // Check for duplicate trails by 2D geometry (ignoring elevation)
        const duplicateQuery = `
            WITH geometry_groups AS (
                SELECT 
                    ST_AsText(ST_Force2D(geometry)) as geometry_2d_text,
                    COUNT(*) as count,
                    ARRAY_AGG(id) as trail_ids,
                    ARRAY_AGG(app_uuid) as trail_uuids,
                    ARRAY_AGG(name) as trail_names,
                    ARRAY_AGG(elevation_gain) as elevation_gains,
                    ARRAY_AGG(elevation_loss) as elevation_losses,
                    ARRAY_AGG(length_km) as lengths_km
                FROM ${latestSchema}.trails
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
                elevation_gains,
                elevation_losses,
                lengths_km
            FROM geometry_groups
            ORDER BY count DESC, geometry_2d_text
        `;

        const duplicateResult = await client.query(duplicateQuery);
        
        console.log('\n=== DUPLICATE TRAILS BY 2D GEOMETRY ANALYSIS ===');
        console.log(`Schema: ${latestSchema}`);
        console.log(`Total duplicate groups found: ${duplicateResult.rows.length}`);

        if (duplicateResult.rows.length > 0) {
            console.log('\n=== DUPLICATE DETAILS ===');
            
            let totalDuplicates = 0;
            duplicateResult.rows.forEach((row, index) => {
                console.log(`\nDuplicate Group ${index + 1}:`);
                console.log(`  Count: ${row.count} instances`);
                console.log(`  Trail IDs: ${row.trail_ids.join(', ')}`);
                console.log(`  Trail UUIDs: ${row.trail_uuids.join(', ')}`);
                console.log(`  Trail Names: ${row.trail_names.join(', ')}`);
                console.log(`  Elevation Gains: ${row.elevation_gains.join(', ')}`);
                console.log(`  Elevation Losses: ${row.elevation_losses.join(', ')}`);
                console.log(`  Lengths (km): ${row.lengths_km.join(', ')}`);
                console.log(`  2D Geometry: ${row.geometry_2d_text.substring(0, 100)}...`);
                
                totalDuplicates += row.count;
            });
            
            console.log(`\nTotal duplicate trails: ${totalDuplicates}`);
        } else {
            console.log('\n✅ No duplicate trails found by 2D geometry!');
        }

        // Also check for trails with same name but different geometry
        const sameNameQuery = `
            WITH name_groups AS (
                SELECT 
                    name,
                    COUNT(*) as count,
                    COUNT(DISTINCT ST_AsText(geometry)) as unique_geometries,
                    ARRAY_AGG(id) as trail_ids,
                    ARRAY_AGG(app_uuid) as trail_uuids
                FROM ${latestSchema}.trails
                WHERE name IS NOT NULL AND geometry IS NOT NULL
                GROUP BY name
                HAVING COUNT(*) > 1
            )
            SELECT 
                name,
                count,
                unique_geometries,
                trail_ids,
                trail_uuids
            FROM name_groups
            ORDER BY count DESC, name
        `;

        const sameNameResult = await client.query(sameNameQuery);
        
        console.log('\n=== TRAILS WITH SAME NAME ANALYSIS ===');
        console.log(`Total name groups with multiple trails: ${sameNameResult.rows.length}`);

        if (sameNameResult.rows.length > 0) {
            console.log('\n=== SAME NAME DETAILS ===');
            sameNameResult.rows.forEach((row, index) => {
                console.log(`\nName Group ${index + 1}: "${row.name}"`);
                console.log(`  Total trails: ${row.count}`);
                console.log(`  Unique geometries: ${row.unique_geometries}`);
                console.log(`  Trail IDs: ${row.trail_ids.join(', ')}`);
                console.log(`  Trail UUIDs: ${row.trail_uuids.join(', ')}`);
            });
        }

        // Get total trail count for context
        const totalQuery = `SELECT COUNT(*) as total FROM ${latestSchema}.trails`;
        const totalResult = await client.query(totalQuery);
        console.log(`\nTotal trails in ${latestSchema}: ${totalResult.rows[0].total}`);

    } catch (error) {
        console.error('Error analyzing duplicate trails:', error);
    } finally {
        await client.end();
    }
}

// Run the analysis
analyzeDuplicateTrailsGeometry()
    .then(() => {
        console.log('\nAnalysis complete');
        process.exit(0);
    })
    .catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
