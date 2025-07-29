const { Client } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

async function testNebelHornSqliteSplitting() {
    console.log('🧪 Testing Nebel Horn trail splitting in SQLite database...');
    
    const pgClient = new Client({
        database: 'trail_master_db_test'
    });
    
    try {
        await pgClient.connect();
        
        // Step 1: Create test SQLite database
        console.log('\n📋 Step 1: Creating test SQLite database...');
        const testDbPath = './test-nebel-horn-splitting.db';
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        
        // Step 2: Run export with trail splitting enabled
        console.log('\n📋 Step 2: Running export with trail splitting...');
        const { execSync } = require('child_process');
        
        try {
            execSync(`npx ts-node src/cli/export.ts --region boulder --out ${testDbPath} --use-split-trails`, {
                stdio: 'inherit',
                env: { ...process.env, PGDATABASE: 'trail_master_db_test' }
            });
            console.log('✅ Export completed successfully');
        } catch (error) {
            console.error('❌ Export failed:', error.message);
            return false;
        }
        
        // Step 3: Check if SQLite database was created
        console.log('\n📋 Step 3: Checking SQLite database...');
        if (!fs.existsSync(testDbPath)) {
            console.error('❌ SQLite database was not created');
            return false;
        }
        
        // Step 4: Check Nebel Horn trails in SQLite
        console.log('\n📋 Step 4: Checking Nebel Horn trails in SQLite...');
        const db = new sqlite3.Database(testDbPath);
        
        return new Promise((resolve, reject) => {
            db.all(`SELECT name, app_uuid, length_km FROM trails WHERE name LIKE '%Nebel%' OR name LIKE '%Fern Canyon%' ORDER BY name`, (err, rows) => {
                if (err) {
                    console.error('❌ Error querying SQLite:', err.message);
                    db.close();
                    resolve(false);
                    return;
                }
                
                console.log(`   Found ${rows.length} trails with Nebel/Fern Canyon in name:`);
                rows.forEach((row, index) => {
                    console.log(`     ${index + 1}. ${row.name} (${row.app_uuid}) - ${row.length_km.toFixed(2)}km`);
                });
                
                // Step 5: Check if Nebel Horn was split
                console.log('\n📋 Step 5: Checking if Nebel Horn was split...');
                const nebelHornTrails = rows.filter(row => row.name.includes('Nebel'));
                const fernCanyonTrails = rows.filter(row => row.name.includes('Fern Canyon'));
                
                console.log(`   Nebel Horn trails: ${nebelHornTrails.length}`);
                console.log(`   Fern Canyon trails: ${fernCanyonTrails.length}`);
                
                // Check if we have more than 1 segment for either trail
                const nebelHornSplit = nebelHornTrails.length > 1;
                const fernCanyonSplit = fernCanyonTrails.length > 1;
                
                console.log(`   Nebel Horn split: ${nebelHornSplit ? '✅ YES' : '❌ NO'}`);
                console.log(`   Fern Canyon split: ${fernCanyonSplit ? '✅ YES' : '❌ NO'}`);
                
                // Step 6: Final validation
                console.log('\n📋 Step 6: Final validation...');
                const success = nebelHornSplit || fernCanyonSplit;
                
                if (success) {
                    console.log('✅ SUCCESS: At least one trail was split at intersections');
                } else {
                    console.log('❌ FAILURE: No trails were split at intersections');
                    console.log('   This means trail splitting is NOT working in SQLite export');
                }
                
                db.close();
                resolve(success);
            });
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return false;
    } finally {
        await pgClient.end();
    }
}

// Run the test
testNebelHornSqliteSplitting()
    .then(success => {
        console.log(`\n🎯 Test Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
        if (!success) {
            console.log('\n🚨 TRAIL SPLITTING IS NOT WORKING IN SQLITE EXPORT!');
            process.exit(1);
        } else {
            console.log('\n✅ Trail splitting is working correctly in SQLite export!');
            process.exit(0);
        }
    })
    .catch(error => {
        console.error('❌ Test failed:', error);
        process.exit(1);
    });