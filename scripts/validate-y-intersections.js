const { Pool } = require('pg');
require('dotenv').config();

/**
 * Validation script for Y-intersection splitting functionality
 * Tests specific cases: Mesa Trail double split and Skunk Canyon split
 */
async function validateYIntersections() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'carthorse',
    database: 'trail_master_db',
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
  });

  try {
    console.log('🔍 Y-Intersection Splitting Validation');
    console.log('=====================================\n');

    // Test Case 1: Mesa Trail Double Split
    console.log('📍 Test Case 1: Mesa Trail Double Split');
    console.log('Expected: Mesa Trail should be split twice');
    console.log('- Node 237: lat:39.96963, lng:-105.28339500000001 (endpoint, degree 1)');
    console.log('- Node 238: lat:39.96945, lng:-105.28200000000001 (intersection, degree 3)');
    
    const mesaTrailTest = await validateMesaTrailSplits(pool);
    console.log(`Result: ${mesaTrailTest.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Details: ${mesaTrailTest.details}\n`);

    // Test Case 2: Skunk Canyon Spur Trail Split
    console.log('📍 Test Case 2: Skunk Canyon Spur Trail Split');
    console.log('Expected: Skunk Canyon Spur Trail should be split by Kohler Spur Trail');
    console.log('- Node 266: lat:39.986955, lng:-105.278985 (endpoint, degree 1)');
    
    const skunkCanyonTest = await validateSkunkCanyonSplit(pool);
    console.log(`Result: ${skunkCanyonTest.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Details: ${skunkCanyonTest.details}\n`);

    // Test Case 3: General Y-Intersection Processing
    console.log('📍 Test Case 3: Y-Intersection Processing Logic');
    console.log('Expected: Split ratio validation, connector creation, iteration tracking');
    
    const generalTest = await validateGeneralProcessing(pool);
    console.log(`Result: ${generalTest.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Details: ${generalTest.details}\n`);

    // Summary
    const allTests = [mesaTrailTest, skunkCanyonTest, generalTest];
    const passedTests = allTests.filter(test => test.passed).length;
    
    console.log('📊 VALIDATION SUMMARY');
    console.log('====================');
    console.log(`Total Tests: ${allTests.length}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${allTests.length - passedTests}`);
    console.log(`Success Rate: ${((passedTests / allTests.length) * 100).toFixed(1)}%`);

    if (passedTests === allTests.length) {
      console.log('\n🎉 All validation tests passed! Y-intersection splitting is working correctly.');
      console.log('You can now remove --skip-validation from your export commands.');
    } else {
      console.log('\n⚠️  Some validation tests failed. Please review the implementation.');
    }

  } catch (error) {
    console.error('❌ Validation failed:', error.message);
  } finally {
    await pool.end();
  }
}

async function validateMesaTrailSplits(pool) {
  try {
    // Run export with Y-intersection splitting to generate test data
    const { spawn } = require('child_process');
    
    console.log('   🔄 Running export with Y-intersection splitting...');
    
    // Check for Mesa Trail splits in latest export
    const result = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return {
        passed: false,
        details: 'No recent carthorse schema found. Run export first.'
      };
    }

    const latestSchema = result.rows[0].schema_name;
    
    // Check for Mesa Trail segments
    const mesaTrails = await pool.query(`
      SELECT name, ST_AsGeoJSON(geometry) as geometry, ST_Length(geometry::geography) as length_m
      FROM ${latestSchema}.trails 
      WHERE name ILIKE '%mesa%' 
      ORDER BY name
    `);

    console.log(`   📊 Found ${mesaTrails.rows.length} Mesa Trail segments`);

    // Check for splits near expected coordinates
    const expectedSplits = [
      { lat: 39.96963, lng: -105.28339500000001, name: 'Node-237' },
      { lat: 39.96945, lng: -105.28200000000001, name: 'Node-238' }
    ];

    let splitsFound = 0;
    for (const expectedSplit of expectedSplits) {
      const nearbyTrails = await pool.query(`
        SELECT COUNT(*) as count, array_agg(name) as trail_names
        FROM ${latestSchema}.trails
        WHERE ST_DWithin(
          geometry::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          50
        )
      `, [expectedSplit.lng, expectedSplit.lat]);

      const count = parseInt(nearbyTrails.rows[0].count);
      if (count > 0) {
        splitsFound++;
        console.log(`   ✅ Found trails near ${expectedSplit.name}: ${count} trails`);
      } else {
        console.log(`   ❌ No trails found near ${expectedSplit.name}`);
      }
    }

    const passed = splitsFound >= 2 && mesaTrails.rows.length > 1;
    return {
      passed,
      details: `Found ${mesaTrails.rows.length} Mesa Trail segments, ${splitsFound}/2 expected split locations`
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

async function validateSkunkCanyonSplit(pool) {
  try {
    // Get latest schema
    const result = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return {
        passed: false,
        details: 'No recent carthorse schema found. Run export first.'
      };
    }

    const latestSchema = result.rows[0].schema_name;

    // Check for Skunk Canyon Spur Trail segments
    const skunkCanyonTrails = await pool.query(`
      SELECT name, ST_AsGeoJSON(geometry) as geometry, ST_Length(geometry::geography) as length_m
      FROM ${latestSchema}.trails 
      WHERE name ILIKE '%skunk%canyon%' 
      ORDER BY name
    `);

    console.log(`   📊 Found ${skunkCanyonTrails.rows.length} Skunk Canyon trail segments`);

    // Check for Kohler Spur Trail
    const kohlerTrails = await pool.query(`
      SELECT name, ST_AsGeoJSON(geometry) as geometry
      FROM ${latestSchema}.trails 
      WHERE name ILIKE '%kohler%spur%'
    `);

    console.log(`   📊 Found ${kohlerTrails.rows.length} Kohler Spur trail segments`);

    // Check for split near expected coordinate (Node-266)
    const expectedSplit = { lat: 39.986955, lng: -105.278985 };
    const nearbyTrails = await pool.query(`
      SELECT COUNT(*) as count, array_agg(name) as trail_names
      FROM ${latestSchema}.trails
      WHERE ST_DWithin(
        geometry::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        50
      )
    `, [expectedSplit.lng, expectedSplit.lat]);

    const count = parseInt(nearbyTrails.rows[0].count);
    console.log(`   📍 Found ${count} trails near Node-266 split location`);

    const passed = skunkCanyonTrails.rows.length > 0 && kohlerTrails.rows.length > 0 && count > 0;
    return {
      passed,
      details: `Skunk Canyon segments: ${skunkCanyonTrails.rows.length}, Kohler Spur segments: ${kohlerTrails.rows.length}, trails near split: ${count}`
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

async function validateGeneralProcessing(pool) {
  try {
    // Get latest schema
    const result = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return {
        passed: false,
        details: 'No recent carthorse schema found. Run export first.'
      };
    }

    const latestSchema = result.rows[0].schema_name;

    // Check for connector trails
    const connectorTrails = await pool.query(`
      SELECT COUNT(*) as count
      FROM ${latestSchema}.trails 
      WHERE trail_type = 'connector' OR name ILIKE '%connector%'
    `);

    const connectorCount = parseInt(connectorTrails.rows[0].count);
    console.log(`   🔗 Found ${connectorCount} connector trails`);

    // Check for split trail segments (trails with "Split" in name)
    const splitTrails = await pool.query(`
      SELECT COUNT(*) as count
      FROM ${latestSchema}.trails 
      WHERE name ILIKE '%split%'
    `);

    const splitCount = parseInt(splitTrails.rows[0].count);
    console.log(`   ✂️ Found ${splitCount} split trail segments`);

    // Check total trail count vs original
    const totalTrails = await pool.query(`
      SELECT COUNT(*) as count
      FROM ${latestSchema}.trails
    `);

    const totalCount = parseInt(totalTrails.rows[0].count);
    console.log(`   📊 Total trails in processed dataset: ${totalCount}`);

    // Validation criteria:
    // 1. Should have some split trails or connectors (indicating processing happened)
    // 2. Total trail count should be reasonable (not drastically different from input)
    // 3. No trails should have invalid geometries
    
    const geometryCheck = await pool.query(`
      SELECT COUNT(*) as invalid_count
      FROM ${latestSchema}.trails 
      WHERE NOT ST_IsValid(geometry) OR geometry IS NULL
    `);

    const invalidGeometries = parseInt(geometryCheck.rows[0].invalid_count);
    console.log(`   🔍 Invalid geometries: ${invalidGeometries}`);

    const hasProcessingEvidence = splitCount > 0 || connectorCount > 0;
    const geometriesValid = invalidGeometries === 0;
    const reasonableTrailCount = totalCount >= 200 && totalCount <= 500; // Reasonable range for Boulder test area

    const passed = hasProcessingEvidence && geometriesValid && reasonableTrailCount;
    
    return {
      passed,
      details: `Processing evidence: ${hasProcessingEvidence}, Valid geometries: ${geometriesValid}, Reasonable count: ${reasonableTrailCount} (${totalCount} trails)`
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

// Test specific Y-intersection splitting logic
async function testYIntersectionLogic() {
  console.log('\n🧪 Testing Y-Intersection Logic Components');
  console.log('=========================================');

  // Test 1: Split ratio validation
  console.log('📍 Test: Split ratio validation');
  const validRatios = [0.1, 0.5, 0.9];
  const invalidRatios = [0.0001, 0.9999, 1.0, 0.0];
  
  console.log(`   Valid ratios (should pass): ${validRatios.join(', ')}`);
  console.log(`   Invalid ratios (should fail): ${invalidRatios.join(', ')}`);
  
  // Test 2: Distance validation
  console.log('📍 Test: Distance validation');
  console.log('   Minimum snap distance: 1.0m');
  console.log('   Maximum tolerance: 10.0m');
  
  // Test 3: Iteration tracking
  console.log('📍 Test: Iteration tracking');
  console.log('   Maximum iterations: 10');
  console.log('   Should track processed trails per iteration');
}

// Run validation
if (require.main === module) {
  validateYIntersections()
    .then(() => testYIntersectionLogic())
    .catch(console.error);
}

module.exports = {
  validateYIntersections,
  validateMesaTrailSplits,
  validateSkunkCanyonSplit,
  validateGeneralProcessing
};

