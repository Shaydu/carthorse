const { Client } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

async function testTrailSplittingSimple() {
    console.log('🧪 Testing trail splitting (simple version)...');
    
    const pgClient = new Client({
        database: 'trail_master_db_test'
    });
    
    try {
        await pgClient.connect();
        
        // Step 1: Create test SQLite database
        console.log('\n📋 Step 1: Creating test SQLite database...');
        const testDbPath = './test-trail-splitting-simple.db';
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        
        // Step 2: Run export with trail splitting enabled but skip routing graph
        console.log('\n📋 Step 2: Running export with trail splitting...');
        const { execSync } = require('child_process');
        
        try {
            // Use a simpler export that doesn't generate routing graph
            execSync(`npx ts-node src/cli/export.ts --region boulder --out ${testDbPath} --use-split-trails --no-intersection-nodes --intersection-tolerance 0`, {
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
        
        // Step 4: Test trail splitting
        console.log('\n📋 Step 4: Testing trail splitting...');
        const db = new sqlite3.Database(testDbPath);
        
        return new Promise((resolve, reject) => {
            // Test Nebel Horn and Fern Canyon splitting
            console.log('\n🔍 Testing Nebel Horn and Fern Canyon splitting...');
            db.all(`SELECT name, app_uuid, length_km FROM trails WHERE name LIKE '%Fern Canyon%' OR name LIKE '%Nebel%' ORDER BY name`, (err, rows) => {
                if (err) {
                    console.error('❌ Error querying SQLite:', err.message);
                    db.close();
                    resolve(false);
                    return;
                }
                
                console.log(`   Found ${rows.length} trails with Fern Canyon/Nebel in name:`);
                rows.forEach((row, index) => {
                    console.log(`     ${index + 1}. ${row.name} (${row.app_uuid}) - ${row.length_km.toFixed(2)}km`);
                });
                
                const fernCanyonTrails = rows.filter(row => row.name.includes('Fern Canyon'));
                const nebelHornTrails = rows.filter(row => row.name.includes('Nebel'));
                
                console.log(`   Fern Canyon trails: ${fernCanyonTrails.length}`);
                console.log(`   Nebel Horn trails: ${nebelHornTrails.length}`);
                
                const trailsWereSplit = fernCanyonTrails.length > 1 || nebelHornTrails.length > 1;
                console.log(`   Trails were split: ${trailsWereSplit ? '✅ YES' : '❌ NO'}`);
                
                // Step 5: Final validation
                console.log('\n📋 Step 5: Final validation...');
                if (trailsWereSplit) {
                    console.log('✅ SUCCESS: Trail splitting is working!');
                } else {
                    console.log('❌ FAILURE: Trail splitting is NOT working');
                    console.log('   This means the PostGIS trail splitting function is not working correctly');
                }
                
                db.close();
                resolve(trailsWereSplit);
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
testTrailSplittingSimple()
    .then(success => {
        console.log(`\n🎯 Test Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
        if (!success) {
            console.log('\n🚨 TRAIL SPLITTING IS NOT WORKING!');
            process.exit(1);
        } else {
            console.log('\n✅ Trail splitting is working correctly!');
            process.exit(0);
        }
    })
    .catch(error => {
        console.error('❌ Test failed:', error);
        process.exit(1);
    });