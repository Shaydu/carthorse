const { Client } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

async function testTrailSplittingIntersectionCases() {
    console.log('🧪 Testing trail splitting with intersection cases (T, Y, X, Double T)...');
    
    const pgClient = new Client({
        database: 'trail_master_db_test'
    });
    
    try {
        await pgClient.connect();
        
        // Step 1: Create test SQLite database
        console.log('\n📋 Step 1: Creating test SQLite database...');
        const testDbPath = './test-trail-splitting-cases.db';
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
        
        // Step 4: Test each intersection case
        console.log('\n📋 Step 4: Testing intersection cases...');
        const db = new sqlite3.Database(testDbPath);
        
        return new Promise((resolve, reject) => {
            // Test Case 1: T Intersection - Fern Canyon and Nebel Horn
            console.log('\n🔍 Test Case 1: T Intersection - Fern Canyon and Nebel Horn');
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
                
                const tIntersectionSplit = fernCanyonTrails.length > 1 || nebelHornTrails.length > 1;
                console.log(`   T Intersection split: ${tIntersectionSplit ? '✅ YES' : '❌ NO'}`);
                
                // Test Case 2: Y Intersection - Shadow Canyon trails
                console.log('\n🔍 Test Case 2: Y Intersection - Shadow Canyon trails');
                db.all(`SELECT name, app_uuid, length_km FROM trails WHERE name LIKE '%Shadow Canyon%' ORDER BY name`, (err, shadowRows) => {
                    if (err) {
                        console.error('❌ Error querying Shadow Canyon trails:', err.message);
                        db.close();
                        resolve(false);
                        return;
                    }
                    
                    console.log(`   Found ${shadowRows.length} Shadow Canyon trails:`);
                    shadowRows.forEach((row, index) => {
                        console.log(`     ${index + 1}. ${row.name} (${row.app_uuid}) - ${row.length_km.toFixed(2)}km`);
                    });
                    
                    const yIntersectionSplit = shadowRows.length > 3; // Should have more than 3 segments if Y intersection is split
                    console.log(`   Y Intersection split: ${yIntersectionSplit ? '✅ YES' : '❌ NO'}`);
                    
                    // Test Case 3: X Intersection - Shanahan and Mesa Trail
                    console.log('\n🔍 Test Case 3: X Intersection - Shanahan and Mesa Trail');
                    db.all(`SELECT name, app_uuid, length_km FROM trails WHERE name LIKE '%Shanahan%' OR name LIKE '%Mesa Trail%' ORDER BY name`, (err, xRows) => {
                        if (err) {
                            console.error('❌ Error querying Shanahan/Mesa trails:', err.message);
                            db.close();
                            resolve(false);
                            return;
                        }
                        
                        console.log(`   Found ${xRows.length} Shanahan/Mesa trails:`);
                        xRows.forEach((row, index) => {
                            console.log(`     ${index + 1}. ${row.name} (${row.app_uuid}) - ${row.length_km.toFixed(2)}km`);
                        });
                        
                        const shanahanTrails = xRows.filter(row => row.name.includes('Shanahan'));
                        const mesaTrails = xRows.filter(row => row.name.includes('Mesa Trail'));
                        
                        console.log(`   Shanahan trails: ${shanahanTrails.length}`);
                        console.log(`   Mesa Trail segments: ${mesaTrails.length}`);
                        
                        const xIntersectionSplit = shanahanTrails.length > 1 || mesaTrails.length > 1;
                        console.log(`   X Intersection split: ${xIntersectionSplit ? '✅ YES' : '❌ NO'}`);
                        
                        // Test Case 4: Double T - Amphitheater trails
                        console.log('\n🔍 Test Case 4: Double T - Amphitheater trails');
                        db.all(`SELECT name, app_uuid, length_km FROM trails WHERE name LIKE '%Amphitheater%' ORDER BY name`, (err, amphitheaterRows) => {
                            if (err) {
                                console.error('❌ Error querying Amphitheater trails:', err.message);
                                db.close();
                                resolve(false);
                                return;
                            }
                            
                            console.log(`   Found ${amphitheaterRows.length} Amphitheater trails:`);
                            amphitheaterRows.forEach((row, index) => {
                                console.log(`     ${index + 1}. ${row.name} (${row.app_uuid}) - ${row.length_km.toFixed(2)}km`);
                            });
                            
                            const amphitheaterExpressTrails = amphitheaterRows.filter(row => row.name.includes('Express'));
                            const amphitheaterTrails = amphitheaterRows.filter(row => !row.name.includes('Express'));
                            
                            console.log(`   Amphitheater Express trails: ${amphitheaterExpressTrails.length}`);
                            console.log(`   Amphitheater Trail segments: ${amphitheaterTrails.length}`);
                            
                            const doubleTSplit = amphitheaterExpressTrails.length > 1 || amphitheaterTrails.length > 1;
                            console.log(`   Double T Intersection split: ${doubleTSplit ? '✅ YES' : '❌ NO'}`);
                            
                            // Step 5: Final validation
                            console.log('\n📋 Step 5: Final validation...');
                            const allCasesPassed = tIntersectionSplit && yIntersectionSplit && xIntersectionSplit && doubleTSplit;
                            
                            console.log('\n📊 Intersection Case Results:');
                            console.log(`   T Intersection (Fern Canyon/Nebel Horn): ${tIntersectionSplit ? '✅ PASS' : '❌ FAIL'}`);
                            console.log(`   Y Intersection (Shadow Canyon): ${yIntersectionSplit ? '✅ PASS' : '❌ FAIL'}`);
                            console.log(`   X Intersection (Shanahan/Mesa): ${xIntersectionSplit ? '✅ PASS' : '❌ FAIL'}`);
                            console.log(`   Double T (Amphitheater): ${doubleTSplit ? '✅ PASS' : '❌ FAIL'}`);
                            
                            if (allCasesPassed) {
                                console.log('\n✅ SUCCESS: All intersection cases were properly split!');
                            } else {
                                console.log('\n❌ FAILURE: Some intersection cases were not split properly');
                                console.log('   This means trail splitting is NOT working correctly for all intersection types');
                            }
                            
                            db.close();
                            resolve(allCasesPassed);
                        });
                    });
                });
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
testTrailSplittingIntersectionCases()
    .then(success => {
        console.log(`\n🎯 Test Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
        if (!success) {
            console.log('🚨 TRAIL SPLITTING IS NOT WORKING FOR ALL INTERSECTION TYPES!');
            process.exit(1);
        } else {
            console.log('✅ Trail splitting is working correctly for all intersection types!');
            process.exit(0);
        }
    })
    .catch(error => {
        console.error('❌ Test failed:', error);
        process.exit(1);
    });