const { Client } = require('pg');

async function checkPublicTrailsSchema() {
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

        // Check the column structure of the public.trails table
        const schemaQuery = `
            SELECT 
                column_name,
                data_type,
                is_nullable,
                column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' 
              AND table_name = 'trails'
            ORDER BY ordinal_position
        `;
        
        const schemaResult = await client.query(schemaQuery);
        
        console.log('\n=== PUBLIC.TRAILS TABLE SCHEMA ===');
        console.log('Column Name'.padEnd(25) + 'Data Type'.padEnd(20) + 'Nullable'.padEnd(10) + 'Default');
        console.log('-'.repeat(70));
        
        schemaResult.rows.forEach(row => {
            console.log(
                row.column_name.padEnd(25) + 
                row.data_type.padEnd(20) + 
                row.is_nullable.padEnd(10) + 
                (row.column_default || 'NULL')
            );
        });

        // Check for source-related columns specifically
        const sourceColumns = schemaResult.rows.filter(row => 
            row.column_name.toLowerCase().includes('source') || 
            row.column_name.toLowerCase().includes('data')
        );
        
        if (sourceColumns.length > 0) {
            console.log('\n=== SOURCE-RELATED COLUMNS ===');
            sourceColumns.forEach(row => {
                console.log(`- ${row.column_name}: ${row.data_type} (${row.is_nullable})`);
            });
        } else {
            console.log('\nNo source-related columns found');
        }

        // Check what values exist in the source column if it exists
        const sourceColumn = schemaResult.rows.find(row => row.column_name === 'source');
        if (sourceColumn) {
            console.log('\n=== SOURCE COLUMN VALUES ===');
            const sourceValuesQuery = `
                SELECT 
                    source,
                    COUNT(*) as count
                FROM public.trails 
                WHERE source IS NOT NULL
                GROUP BY source
                ORDER BY count DESC
            `;
            
            const sourceValuesResult = await client.query(sourceValuesQuery);
            sourceValuesResult.rows.forEach(row => {
                console.log(`- ${row.source}: ${row.count} trails`);
            });
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

checkPublicTrailsSchema();
