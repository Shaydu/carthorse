const { Client } = require('pg');

async function checkStagingSchemas() {
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
            ORDER BY schema_name
        `;
        
        const schemaResult = await client.query(schemaQuery);
        
        console.log('\n=== ALL SCHEMAS IN DATABASE ===');
        schemaResult.rows.forEach(row => {
            console.log(`  ${row.schema_name}`);
        });

        // Look for staging-like schemas
        const stagingQuery = `
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE '%staging%' 
               OR schema_name LIKE '%boulder%'
               OR schema_name LIKE '%seattle%'
            ORDER BY schema_name
        `;
        
        const stagingResult = await client.query(stagingQuery);
        
        console.log('\n=== POTENTIAL STAGING SCHEMAS ===');
        if (stagingResult.rows.length > 0) {
            stagingResult.rows.forEach(row => {
                console.log(`  ${row.schema_name}`);
            });
        } else {
            console.log('  No staging-like schemas found');
        }

        // Check if any schemas have trails tables
        const trailsTableQuery = `
            SELECT 
                table_schema,
                table_name
            FROM information_schema.tables 
            WHERE table_name = 'trails'
            ORDER BY table_schema, table_name
        `;
        
        const trailsResult = await client.query(trailsTableQuery);
        
        console.log('\n=== SCHEMAS WITH TRAILS TABLES ===');
        if (trailsResult.rows.length > 0) {
            trailsResult.rows.forEach(row => {
                console.log(`  ${row.table_schema}.${row.table_name}`);
            });
        } else {
            console.log('  No trails tables found');
        }

    } catch (error) {
        console.error('Error checking schemas:', error);
    } finally {
        await client.end();
    }
}

// Run the check
checkStagingSchemas()
    .then(() => {
        console.log('\nSchema check complete');
        process.exit(0);
    })
    .catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
