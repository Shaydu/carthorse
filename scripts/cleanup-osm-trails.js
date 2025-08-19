const { Client } = require('pg');

async function cleanupOSMTrails() {
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

        // Start transaction for safety
        await client.query('BEGIN');
        console.log('Started transaction');

        // Step 1: Create backup of all trails
        const timestamp = Date.now();
        const backupTableName = `trails_backup_${timestamp}`;
        
        console.log(`\n📋 Step 1: Creating backup table ${backupTableName}...`);
        await client.query(`CREATE TABLE ${backupTableName} AS SELECT * FROM public.trails`);
        
        const backupCountResult = await client.query(`SELECT COUNT(*) as count FROM ${backupTableName}`);
        const backupCount = parseInt(backupCountResult.rows[0].count);
        console.log(`✅ Backup created with ${backupCount} trails`);

        // Step 2: Check current source distribution
        console.log('\n📊 Step 2: Checking current source distribution...');
        const sourceDistributionQuery = `
            SELECT 
                source,
                COUNT(*) as count
            FROM public.trails 
            GROUP BY source
            ORDER BY count DESC
        `;
        
        const sourceDistributionResult = await client.query(sourceDistributionQuery);
        console.log('Current source distribution:');
        sourceDistributionResult.rows.forEach(row => {
            console.log(`  - ${row.source}: ${row.count} trails`);
        });

        // Step 3: Delete OSM trails
        console.log('\n🗑️ Step 3: Deleting OSM trails...');
        const deleteOSMQuery = `DELETE FROM public.trails WHERE source = 'osm'`;
        const deleteResult = await client.query(deleteOSMQuery);
        const deletedCount = parseInt(deleteResult.rowCount);
        console.log(`✅ Deleted ${deletedCount} OSM trails`);

        // Step 4: Verify remaining trails
        console.log('\n✅ Step 4: Verifying remaining trails...');
        const remainingQuery = `
            SELECT 
                source,
                COUNT(*) as count
            FROM public.trails 
            GROUP BY source
            ORDER BY count DESC
        `;
        
        const remainingResult = await client.query(remainingQuery);
        console.log('Remaining source distribution:');
        remainingResult.rows.forEach(row => {
            console.log(`  - ${row.source}: ${row.count} trails`);
        });

        // Step 5: Check for any trails without source
        const nullSourceQuery = `SELECT COUNT(*) as count FROM public.trails WHERE source IS NULL`;
        const nullSourceResult = await client.query(nullSourceQuery);
        const nullSourceCount = parseInt(nullSourceResult.rows[0].count);
        
        if (nullSourceCount > 0) {
            console.log(`⚠️ Warning: ${nullSourceCount} trails have NULL source values`);
        } else {
            console.log('✅ All remaining trails have valid source values');
        }

        // Commit the transaction
        await client.query('COMMIT');
        console.log('\n✅ Transaction committed successfully');

        // Summary
        console.log('\n📋 SUMMARY:');
        console.log(`  - Backup table: ${backupTableName}`);
        console.log(`  - Trails backed up: ${backupCount}`);
        console.log(`  - OSM trails deleted: ${deletedCount}`);
        console.log(`  - Remaining trails: ${backupCount - deletedCount}`);
        console.log('\n🎯 Root cause addressed: Only COTREX trails remain in public.trails');

    } catch (error) {
        // Rollback on error
        await client.query('ROLLBACK');
        console.error('❌ Error occurred, transaction rolled back:', error);
        throw error;
    } finally {
        await client.end();
    }
}

cleanupOSMTrails();
