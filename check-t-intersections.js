const { Client } = require('pg');

async function checkTIntersections() {
    const client = new Client({
        host: 'localhost',
        port: 5432,
        database: 'trail_master_db',
        user: 'tester',
        password: 'tester'
    });

    try {
        await client.connect();
        console.log('Connected to database');

        // First, find available staging schemas
        const schemas = await client.query(`
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE 'carthorse_%'
            ORDER BY schema_name DESC
            LIMIT 5
        `);

        console.log('Available staging schemas:');
        schemas.rows.forEach(row => {
            console.log(`  ${row.schema_name}`);
        });

        if (schemas.rows.length === 0) {
            console.log('No staging schemas found. Run the export first.');
            return;
        }

        const latestSchema = schemas.rows[0].schema_name;
        console.log(`\nUsing latest schema: ${latestSchema}`);

        // Check what tables exist in the staging schema
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = '${latestSchema}'
            ORDER BY table_name
        `);

        console.log('Tables in staging schema:');
        tables.rows.forEach(row => {
            console.log(`  ${row.table_name}`);
        });

        // Check if intersection_points table exists
        const hasIntersectionPoints = tables.rows.some(row => row.table_name === 'intersection_points');
        if (!hasIntersectionPoints) {
            console.log('\n❌ intersection_points table does not exist!');
            console.log('This means the T-intersection detection function is not being called or is failing.');
            return;
        }

        // Check for T-intersections in the staging schema
        const result = await client.query(`
            SELECT 
                point,
                ST_AsText(point) as point_text,
                connected_trail_names,
                node_type,
                distance_meters
            FROM ${latestSchema}.intersection_points 
            WHERE node_type = 't_intersection'
            ORDER BY distance_meters
        `);

        console.log(`Found ${result.rows.length} T-intersections:`);
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ${row.connected_trail_names.join(' <-> ')}`);
            console.log(`   Point: ${row.point_text}`);
            console.log(`   Distance: ${row.distance_meters} meters`);
            console.log('');
        });

        // Also check for any intersection points
        const allIntersections = await client.query(`
            SELECT 
                node_type,
                COUNT(*) as count
            FROM staging_20241220_143022.intersection_points 
            GROUP BY node_type
        `);

        console.log('All intersection types:');
        allIntersections.rows.forEach(row => {
            console.log(`  ${row.node_type}: ${row.count}`);
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

checkTIntersections();
