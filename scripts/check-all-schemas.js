const { Client } = require('pg');

async function checkAllSchemas() {
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

        // List all schemas
        const schemaQuery = `
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'topology')
            ORDER BY schema_name
        `;
        
        const schemaResult = await client.query(schemaQuery);
        
        console.log('\n=== ALL USER SCHEMAS ===');
        schemaResult.rows.forEach(row => {
            console.log(`  ${row.schema_name}`);
        });

        // Check which schemas have trails tables
        const trailsTableQuery = `
            SELECT 
                table_schema,
                table_name,
                (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = t.table_schema AND table_name = t.table_name) as column_count
            FROM information_schema.tables t
            WHERE table_name = 'trails'
            ORDER BY table_schema
        `;
        
        const trailsResult = await client.query(trailsTableQuery);
        
        console.log('\n=== SCHEMAS WITH TRAILS TABLES ===');
        if (trailsResult.rows.length > 0) {
            trailsResult.rows.forEach(row => {
                console.log(`  ${row.table_schema}.${row.table_name} (${row.column_count} columns)`);
            });
        } else {
            console.log('  No trails tables found');
        }

        // Check for any schema with 'carthorse' in the name
        const carthorseQuery = `
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE '%carthorse%'
            ORDER BY schema_name
        `;
        
        const carthorseResult = await client.query(carthorseQuery);
        
        console.log('\n=== SCHEMAS WITH "CARTHORSE" IN NAME ===');
        if (carthorseResult.rows.length > 0) {
            carthorseResult.rows.forEach(row => {
                console.log(`  ${row.schema_name}`);
            });
        } else {
            console.log('  No carthorse schemas found');
        }

    } catch (error) {
        console.error('Error checking schemas:', error);
    } finally {
        await client.end();
    }
}

// Run the check
checkAllSchemas()
    .then(() => {
        console.log('\nSchema check complete');
        process.exit(0);
    })
    .catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
