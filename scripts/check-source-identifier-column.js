const { Client } = require('pg');

async function checkSourceIdentifierColumn() {
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

        // Check if source_identifier column exists
        const columnCheckQuery = `
            SELECT 
                column_name,
                data_type,
                is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' 
              AND table_name = 'trails'
              AND column_name LIKE '%identifier%'
            ORDER BY ordinal_position
        `;
        
        const columnResult = await client.query(columnCheckQuery);
        
        console.log('\n=== COLUMNS WITH "identifier" IN NAME ===');
        if (columnResult.rows.length === 0) {
            console.log('No columns found with "identifier" in the name');
        } else {
            columnResult.rows.forEach(row => {
                console.log(`${row.column_name} (${row.data_type}, nullable: ${row.is_nullable})`);
            });
        }

        // Check all columns in trails table
        const allColumnsQuery = `
            SELECT 
                column_name,
                data_type,
                is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' 
              AND table_name = 'trails'
            ORDER BY ordinal_position
        `;
        
        const allColumnsResult = await client.query(allColumnsQuery);
        
        console.log('\n=== ALL COLUMNS IN public.trails ===');
        allColumnsResult.rows.forEach(row => {
            console.log(`${row.column_name} (${row.data_type}, nullable: ${row.is_nullable})`);
        });

        // Check if there are any UUID-like columns that might be used as source identifiers
        const uuidColumnsQuery = `
            SELECT 
                column_name,
                data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' 
              AND table_name = 'trails'
              AND data_type = 'uuid'
            ORDER BY ordinal_position
        `;
        
        const uuidResult = await client.query(uuidColumnsQuery);
        
        console.log('\n=== UUID COLUMNS IN public.trails ===');
        if (uuidResult.rows.length === 0) {
            console.log('No UUID columns found');
        } else {
            uuidResult.rows.forEach(row => {
                console.log(`${row.column_name} (${row.data_type})`);
            });
        }

        // Check a sample trail to see what identifier-like fields exist
        const sampleQuery = `
            SELECT 
                app_uuid,
                osm_id,
                name,
                source
            FROM public.trails
            WHERE name = 'Green Mountain West Ridge Trail Segment 1'
            LIMIT 1
        `;
        
        const sampleResult = await client.query(sampleQuery);
        
        if (sampleResult.rows.length > 0) {
            console.log('\n=== SAMPLE TRAIL DATA ===');
            const sample = sampleResult.rows[0];
            console.log(`app_uuid: ${sample.app_uuid}`);
            console.log(`osm_id: ${sample.osm_id}`);
            console.log(`name: ${sample.name}`);
            console.log(`source: ${sample.source}`);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

checkSourceIdentifierColumn();
