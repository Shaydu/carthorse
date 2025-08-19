const { Client } = require('pg');

async function checkBearCanyonPublic() {
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

        // Check for Bear Canyon trails in public.trails
        const bearCanyonQuery = `
            SELECT 
                id,
                app_uuid,
                name,
                source,
                osm_id,
                ST_Length(geometry::geography) as length_meters,
                elevation_gain,
                elevation_loss
            FROM public.trails
            WHERE name LIKE '%Bear Canyon%'
            ORDER BY name, source
        `;
        
        const bearCanyonResult = await client.query(bearCanyonQuery);
        
        console.log('\n=== BEAR CANYON TRAILS IN PUBLIC.TRAILS ===');
        console.log(`Total instances found: ${bearCanyonResult.rows.length}`);
        
        if (bearCanyonResult.rows.length > 0) {
            console.log('\n=== DETAILS ===');
            
            bearCanyonResult.rows.forEach((row, index) => {
                console.log(`\nInstance ${index + 1}:`);
                console.log(`  ID: ${row.id}`);
                console.log(`  app_uuid: ${row.app_uuid}`);
                console.log(`  name: ${row.name}`);
                console.log(`  source: ${row.source}`);
                console.log(`  osm_id: ${row.osm_id || 'null'}`);
                console.log(`  length: ${row.length_meters.toFixed(2)}m`);
                console.log(`  elevation_gain: ${row.elevation_gain || 'null'}`);
                console.log(`  elevation_loss: ${row.elevation_loss || 'null'}`);
            });
            
            // Group by source
            const sourceGroups = {};
            bearCanyonResult.rows.forEach(row => {
                if (!sourceGroups[row.source]) {
                    sourceGroups[row.source] = [];
                }
                sourceGroups[row.source].push(row);
            });
            
            console.log('\n=== BY SOURCE ===');
            Object.keys(sourceGroups).forEach(source => {
                console.log(`\n${source.toUpperCase()} (${sourceGroups[source].length} instances):`);
                sourceGroups[source].forEach(row => {
                    console.log(`  - ${row.name} (${row.app_uuid})`);
                });
            });
        } else {
            console.log('No Bear Canyon trails found in public.trails');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

checkBearCanyonPublic();
