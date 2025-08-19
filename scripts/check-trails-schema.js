const { Client } = require('pg');

async function checkTrailsSchema() {
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

        // Check the column structure of the trails table
        const schemaQuery = `
            SELECT 
                column_name,
                data_type,
                is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' 
              AND table_name = 'trails'
            ORDER BY ordinal_position
        `;
        
        const schemaResult = await client.query(schemaQuery);
        
        console.log('\n=== TRAILS TABLE SCHEMA ===');
        schemaResult.rows.forEach(row => {
            console.log(`${row.column_name} (${row.data_type}, nullable: ${row.is_nullable})`);
        });

        // Also check a few sample rows to see the data
        const sampleQuery = `
            SELECT *
            FROM public.trails
            WHERE name = 'Green Mountain West Ridge Trail Segment 1'
            LIMIT 1
        `;
        
        const sampleResult = await client.query(sampleQuery);
        
        if (sampleResult.rows.length > 0) {
            console.log('\n=== SAMPLE TRAIL DATA ===');
            const sample = sampleResult.rows[0];
            Object.keys(sample).forEach(key => {
                console.log(`${key}: ${sample[key]}`);
            });
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

checkTrailsSchema();
