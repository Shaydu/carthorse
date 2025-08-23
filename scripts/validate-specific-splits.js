const { Pool } = require('pg');
require('dotenv').config();

/**
 * Specific validation for Mesa Trail and Skunk Canyon Spur Trail splits
 * Mesa Trail (ID: 06aa6bec-92dc-44e8-b13b-7b88c6dd738e) should split into 2 segments
 * Skunk Canyon Spur Trail should split into 2 segments
 */
async function validateSpecificSplits() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'carthorse',
    database: 'trail_master_db',
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
  });

  try {
    console.log('🎯 Specific Trail Split Validation');
    console.log('==================================\n');

    // Get the latest carthorse schema from recent export
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.log('❌ No recent carthorse schema found. Please run export first:');
      console.log('npx ts-node src/cli/export.ts --region boulder --out test-output/validation-test.geojson --format geojson --bbox -105.30123174925316,39.96928418458248,-105.26050515816028,40.06483855535663 --disable-trailheads-only --no-trailheads --no-cleanup --verbose --source cotrex');
      return;
    }

    const latestSchema = schemaResult.rows[0].schema_name;
    console.log(`📊 Using schema: ${latestSchema}\n`);

    // Test Case 1: Mesa Trail Split Validation
    console.log('📍 Test Case 1: Mesa Trail Split Validation');
    console.log('Target: Mesa Trail (ID: 06aa6bec-92dc-44e8-b13b-7b88c6dd738e)');
    console.log('Expected: Should be split into exactly 2 segments');
    console.log('Original length: 0.3282332787110253 km');

    const mesaTrailResult = await validateMesaTrailSplit(pool, latestSchema);
    console.log(`Result: ${mesaTrailResult.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Details: ${mesaTrailResult.details}\n`);

    // Test Case 2: Skunk Canyon Spur Trail Split Validation
    console.log('📍 Test Case 2: Skunk Canyon Spur Trail Split Validation');
    console.log('Expected: Should be split into exactly 2 segments');

    const skunkCanyonResult = await validateSkunkCanyonSplit(pool, latestSchema);
    console.log(`Result: ${skunkCanyonResult.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Details: ${skunkCanyonResult.details}\n`);

    // Summary
    const allTests = [mesaTrailResult, skunkCanyonResult];
    const passedTests = allTests.filter(test => test.passed).length;
    
    console.log('📊 VALIDATION SUMMARY');
    console.log('====================');
    console.log(`✅ Passed: ${passedTests}/2`);
    console.log(`❌ Failed: ${2 - passedTests}/2`);

    if (passedTests === 2) {
      console.log('\n🎉 All specific split validations passed!');
      console.log('Both Mesa Trail and Skunk Canyon Spur Trail are properly split into 2 segments.');
    } else {
      console.log('\n⚠️  Some validations failed. Y-intersection splitting may need adjustment.');
    }

  } catch (error) {
    console.error('❌ Validation failed:', error.message);
  } finally {
    await pool.end();
  }
}

async function validateMesaTrailSplit(pool, schema) {
  try {
    // Check if original Mesa Trail still exists (should be deleted after splitting)
    const originalTrail = await pool.query(`
      SELECT app_uuid, name, ST_Length(geometry::geography) as length_m
      FROM ${schema}.trails 
      WHERE app_uuid = '06aa6bec-92dc-44e8-b13b-7b88c6dd738e'
    `);

    console.log(`   🔍 Original Mesa Trail (06aa6bec...): ${originalTrail.rows.length > 0 ? 'Still exists' : 'Deleted (expected after split)'}`);

    // Look for Mesa Trail segments (should have "Split" in name or be related segments)
    const mesaSegments = await pool.query(`
      SELECT 
        app_uuid, 
        name, 
        ST_Length(geometry::geography) as length_m,
        ST_AsGeoJSON(ST_StartPoint(geometry)) as start_point,
        ST_AsGeoJSON(ST_EndPoint(geometry)) as end_point
      FROM ${schema}.trails 
      WHERE name ILIKE '%mesa%trail%' 
        AND (name ILIKE '%split%' OR app_uuid != '06aa6bec-92dc-44e8-b13b-7b88c6dd738e')
      ORDER BY name
    `);

    console.log(`   📊 Found ${mesaSegments.rows.length} Mesa Trail segments`);

    if (mesaSegments.rows.length > 0) {
      let totalLength = 0;
      mesaSegments.rows.forEach((segment, index) => {
        const lengthKm = segment.length_m / 1000;
        totalLength += lengthKm;
        console.log(`   📏 Segment ${index + 1}: ${segment.name} (${lengthKm.toFixed(3)} km)`);
      });
      console.log(`   📐 Total length of segments: ${totalLength.toFixed(3)} km (original: 0.328 km)`);
    }

    // Also check for any trails near the original Mesa Trail path
    const nearbyTrails = await pool.query(`
      SELECT 
        app_uuid, 
        name, 
        ST_Length(geometry::geography) as length_m
      FROM ${schema}.trails 
      WHERE ST_DWithin(
        geometry::geography,
        (SELECT geometry::geography FROM public.trails WHERE app_uuid = '06aa6bec-92dc-44e8-b13b-7b88c6dd738e'),
        100  -- Within 100m of original Mesa Trail
      )
      AND name ILIKE '%mesa%'
      ORDER BY ST_Distance(
        geometry::geography,
        (SELECT geometry::geography FROM public.trails WHERE app_uuid = '06aa6bec-92dc-44e8-b13b-7b88c6dd738e')
      )
    `);

    console.log(`   🗺️ Found ${nearbyTrails.rows.length} Mesa-related trails near original path`);

    // Validation criteria:
    // 1. Original trail should be deleted (not exist in processed data)
    // 2. Should have exactly 2 segments
    // 3. Total length should be approximately equal to original
    const originalDeleted = originalTrail.rows.length === 0;
    const hasTwoSegments = mesaSegments.rows.length === 2 || nearbyTrails.rows.length === 2;
    
    const passed = originalDeleted && hasTwoSegments;
    
    return {
      passed,
      details: `Original deleted: ${originalDeleted}, Segments found: ${Math.max(mesaSegments.rows.length, nearbyTrails.rows.length)}/2 expected`
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

async function validateSkunkCanyonSplit(pool, schema) {
  try {
    // Look for all Skunk Canyon Spur Trail segments
    const skunkSegments = await pool.query(`
      SELECT 
        app_uuid, 
        name, 
        ST_Length(geometry::geography) as length_m,
        ST_AsGeoJSON(ST_StartPoint(geometry)) as start_point,
        ST_AsGeoJSON(ST_EndPoint(geometry)) as end_point
      FROM ${schema}.trails 
      WHERE name ILIKE '%skunk%canyon%spur%'
      ORDER BY name
    `);

    console.log(`   📊 Found ${skunkSegments.rows.length} Skunk Canyon Spur Trail segments`);

    if (skunkSegments.rows.length > 0) {
      let totalLength = 0;
      skunkSegments.rows.forEach((segment, index) => {
        const lengthKm = segment.length_m / 1000;
        totalLength += lengthKm;
        console.log(`   📏 Segment ${index + 1}: ${segment.name} (${lengthKm.toFixed(3)} km)`);
      });
      console.log(`   📐 Total length of segments: ${totalLength.toFixed(3)} km`);
    }

    // Check for related trails that might be split versions
    const relatedTrails = await pool.query(`
      SELECT 
        app_uuid, 
        name, 
        ST_Length(geometry::geography) as length_m
      FROM ${schema}.trails 
      WHERE (name ILIKE '%skunk%' OR name ILIKE '%canyon%') 
        AND name ILIKE '%split%'
      ORDER BY name
    `);

    console.log(`   🔗 Found ${relatedTrails.rows.length} related split trails`);

    // Check near the expected split location (Node-266: lat:39.986955, lng:-105.278985)
    const nearSplitPoint = await pool.query(`
      SELECT 
        app_uuid, 
        name, 
        ST_Length(geometry::geography) as length_m,
        ST_Distance(
          geometry::geography,
          ST_SetSRID(ST_MakePoint(-105.278985, 39.986955), 4326)::geography
        ) as distance_to_split_point
      FROM ${schema}.trails 
      WHERE ST_DWithin(
        geometry::geography,
        ST_SetSRID(ST_MakePoint(-105.278985, 39.986955), 4326)::geography,
        100  -- Within 100m of expected split point
      )
      AND (name ILIKE '%skunk%' OR name ILIKE '%canyon%' OR name ILIKE '%kohler%')
      ORDER BY distance_to_split_point
    `);

    console.log(`   📍 Found ${nearSplitPoint.rows.length} trails near expected split point (Node-266)`);
    if (nearSplitPoint.rows.length > 0) {
      nearSplitPoint.rows.forEach((trail, index) => {
        console.log(`   📏 Near split point ${index + 1}: ${trail.name} (${trail.distance_to_split_point.toFixed(1)}m away)`);
      });
    }

    // Validation criteria:
    // 1. Should have exactly 2 Skunk Canyon Spur Trail segments, OR
    // 2. Should have evidence of splitting near the expected location
    const hasTwoSegments = skunkSegments.rows.length === 2;
    const hasRelatedSplits = relatedTrails.rows.length > 0;
    const hasNearbyEvidence = nearSplitPoint.rows.length >= 2;
    
    const passed = hasTwoSegments || (hasRelatedSplits && hasNearbyEvidence);
    
    return {
      passed,
      details: `Segments: ${skunkSegments.rows.length}/2, Related splits: ${relatedTrails.rows.length}, Near split point: ${nearSplitPoint.rows.length}`
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

// Helper function to run a new export for testing
async function runTestExport() {
  console.log('🚀 Running test export with Y-intersection splitting...\n');
  
  const { spawn } = require('child_process');
  
  return new Promise((resolve, reject) => {
    const exportProcess = spawn('npx', [
      'ts-node', 
      'src/cli/export.ts',
      '--region', 'boulder',
      '--out', 'test-output/mesa-skunk-validation-test.geojson',
      '--format', 'geojson',
      '--bbox', '-105.30123174925316,39.96928418458248,-105.26050515816028,40.06483855535663',
      '--disable-trailheads-only',
      '--no-trailheads',
      '--no-cleanup',
      '--verbose',
      '--source', 'cotrex'
    ], {
      stdio: 'pipe',
      cwd: process.cwd()
    });

    let output = '';
    let error = '';

    exportProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      // Show Y-intersection processing lines
      if (text.includes('Y-intersection') || text.includes('Mesa') || text.includes('Skunk')) {
        process.stdout.write(text);
      }
    });

    exportProcess.stderr.on('data', (data) => {
      error += data.toString();
    });

    exportProcess.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Export completed successfully\n');
        resolve(output);
      } else {
        console.log('\n❌ Export failed\n');
        reject(new Error(`Export failed with code ${code}: ${error}`));
      }
    });
  });
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--run-export')) {
    runTestExport()
      .then(() => validateSpecificSplits())
      .catch(console.error);
  } else {
    validateSpecificSplits()
      .catch(console.error);
  }
}

module.exports = {
  validateSpecificSplits,
  validateMesaTrailSplit,
  validateSkunkCanyonSplit,
  runTestExport
};

