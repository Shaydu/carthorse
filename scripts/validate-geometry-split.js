const { Pool } = require('pg');
require('dotenv').config();

/**
 * Validation script for testing specific geometry splitting
 * Tests the provided geometry to see if it gets split into three segments
 */
async function validateGeometrySplit() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    user: 'carthorse', // Use carthorse user directly
    database: 'trail_master_db',
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
  });

  try {
    console.log('🧪 VALIDATING SPECIFIC GEOMETRY SPLITTING');
    console.log('=========================================\n');

    // Get the most recent schema
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.log('❌ No carthorse schema found. Please run an export first.');
      return;
    }

    const schema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using schema: ${schema}\n`);

    // The original test geometry provided by the user (40 coordinates)
    const originalGeometry = {
      type: "LineString",
      coordinates: [
        [-105.282675, 39.977775, 1906.789917],
        [-105.282263, 39.977701, 1908.59314],
        [-105.282111, 39.977648, 1904.772583],
        [-105.28204, 39.977684, 1904.772583],
        [-105.281888, 39.977657, 1905.878052],
        [-105.281524, 39.977478, 1909.56897],
        [-105.281384, 39.977433, 1909.808716],
        [-105.281091, 39.977452, 1907.965088],
        [-105.281009, 39.977497, 1906.440186],
        [-105.280576, 39.977489, 1899.100586],
        [-105.280553, 39.977579, 1893.661255],
        [-105.280588, 39.977642, 1893.661255],
        [-105.280565, 39.977732, 1891.204346],
        [-105.280577, 39.977877, 1886.838257],
        [-105.28053, 39.977877, 1882.651245],
        [-105.280472, 39.977796, 1884.990845],
        [-105.280448, 39.977823, 1881.362549],
        [-105.280484, 39.978003, 1881.096924],
        [-105.280485, 39.978165, 1877.971313],
        [-105.28045, 39.978174, 1877.971313],
        [-105.280297, 39.977949, 1875.174805],
        [-105.28005, 39.977806, 1869.715698],
        [-105.279698, 39.977726, 1867.943359],
        [-105.279546, 39.977636, 1868.482788],
        [-105.279369, 39.977393, 1869.390381],
        [-105.279052, 39.977141, 1873.847778],
        [-105.278935, 39.977115, 1870.749268],
        [-105.278724, 39.977133, 1876.052002],
        [-105.278513, 39.977116, 1873.077881],
        [-105.278408, 39.977134, 1877.102905],
        [-105.278373, 39.977161, 1877.102905],
        [-105.278572, 39.977251, 1882.291504],
        [-105.278338, 39.97735, 1883.835205],
        [-105.27822, 39.977415, 1883.185913]
      ]
    };

    // The prototype's expected output - THREE split segments
    const prototypeSegments = [
      {
        name: "Segment 1",
        coordinates: [
          [-105.283429706, 39.971088891],
          [-105.283594431, 39.971147943],
          [-105.28366469, 39.971147772],
          [-105.283676327, 39.971129724],
          [-105.283699561, 39.971084617],
          [-105.283663573, 39.970877479],
          [-105.283616213, 39.970751458],
          [-105.283498331, 39.970562539],
          [-105.283438963, 39.970364468],
          [-105.283461713, 39.970202236],
          [-105.283531338, 39.970048898],
          [-105.283507211, 39.96987777],
          [-105.283448029, 39.969724748],
          [-105.283375714, 39.969627032]
        ]
      },
      {
        name: "Segment 2", 
        coordinates: [
          [-105.283375714, 39.969627032],
          [-105.283294947, 39.969517896],
          [-105.283130675, 39.969437209],
          [-105.282427941, 39.969402884],
          [-105.282015558, 39.969433911]
        ]
      },
      {
        name: "Segment 3",
        coordinates: [
          [-105.282015558, 39.969433911],
          [-105.282015558, 39.969433911],
          [-105.281561676, 39.96946806],
          [-105.281397703, 39.969459448],
          [-105.281257334, 39.969495828],
          [-105.281094023, 39.969649391],
          [-105.280999183, 39.96976225],
          [-105.280896687, 39.969838346]
        ]
      }
    ];

    // Create a test trail with the original geometry
    const testTrailId = 'test-geometry-trail-' + Date.now();
    
    console.log('📍 Inserting original test geometry...');
    await pool.query(`
      INSERT INTO ${schema}.trails (
        app_uuid, 
        name, 
        geometry, 
        trail_type,
        source_region,
        source_id,
        length_km
      ) VALUES (
        $1, 
        'Test Geometry Trail (Original)', 
        ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
        'Trail',
        'test',
        $3,
        ST_Length(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography) / 1000
      )
    `, [testTrailId, JSON.stringify(originalGeometry), testTrailId]);

    console.log('✅ Original test geometry inserted\n');

    // Check initial state
    console.log('📊 INITIAL STATE:');
    const initialCount = await pool.query(`
      SELECT COUNT(*) as count FROM ${schema}.trails WHERE app_uuid = $1
    `, [testTrailId]);
    console.log(`   - Test trail count: ${initialCount.rows[0].count}`);

    const initialLength = await pool.query(`
      SELECT ST_Length(geometry::geography) as length_m 
      FROM ${schema}.trails 
      WHERE app_uuid = $1
    `, [testTrailId]);
    console.log(`   - Initial length: ${parseFloat(initialLength.rows[0].length_m).toFixed(2)}m`);
    console.log(`   - Original coordinates: ${originalGeometry.coordinates.length}`);
    console.log(`   - Expected segments: ${prototypeSegments.length}`);
    prototypeSegments.forEach((seg, i) => {
      console.log(`     Segment ${i+1}: ${seg.coordinates.length} coordinates`);
    });
    console.log('');

    // Check for trails that match each prototype segment
    console.log('🎯 CHECKING FOR PROTOTYPE SEGMENT MATCHES:');
    
    for (let i = 0; i < prototypeSegments.length; i++) {
      const segment = prototypeSegments[i];
      console.log(`\n   Checking ${segment.name} (${segment.coordinates.length} points):`);
      
      const segmentMatches = await pool.query(`
        SELECT 
          app_uuid,
          name,
          ST_Length(geometry::geography) as length_m,
          ST_NPoints(geometry) as point_count,
          ST_AsGeoJSON(geometry) as geometry_json
        FROM ${schema}.trails 
        WHERE ST_NPoints(geometry) = $1
        AND ST_Length(geometry::geography) BETWEEN 50 AND 500
        ORDER BY ST_Length(geometry::geography)
      `, [segment.coordinates.length]);

      if (segmentMatches.rows.length > 0) {
        console.log(`     Found ${segmentMatches.rows.length} trails with ${segment.coordinates.length} points:`);
        segmentMatches.rows.forEach((row, j) => {
          console.log(`     ${j + 1}. ${row.name} (${row.length_m.toFixed(2)}m)`);
          
          // Check if the geometry matches the prototype segment
          const geom = JSON.parse(row.geometry_json);
          if (geom.coordinates.length === segment.coordinates.length) {
            // Check if start and end points match
            const startMatch = geom.coordinates[0][0] === segment.coordinates[0][0] && 
                              geom.coordinates[0][1] === segment.coordinates[0][1];
            const endMatch = geom.coordinates[geom.coordinates.length-1][0] === segment.coordinates[segment.coordinates.length-1][0] && 
                            geom.coordinates[geom.coordinates.length-1][1] === segment.coordinates[segment.coordinates.length-1][1];
            
            if (startMatch && endMatch) {
              console.log(`        ✅ PERFECT MATCH! Start and end points match prototype`);
            } else if (startMatch) {
              console.log(`        ⚠️  Start point matches, but end point differs`);
            } else if (endMatch) {
              console.log(`        ⚠️  End point matches, but start point differs`);
            } else {
              console.log(`        ❌ Start and end points don't match prototype`);
            }
          }
        });
      } else {
        console.log(`     ❌ No trails found with exactly ${segment.coordinates.length} points`);
      }
    }

    // Check for trails that match the prototype output exactly
    console.log('\n🔍 CHECKING FOR EXACT PROTOTYPE MATCHES:');
    
    const exactMatches = await pool.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_m,
        ST_NPoints(geometry) as point_count,
        ST_AsGeoJSON(geometry) as geometry_json
      FROM ${schema}.trails 
      WHERE ST_NPoints(geometry) IN (${prototypeSegments.map(s => s.coordinates.length).join(',')})
      AND ST_Length(geometry::geography) BETWEEN 50 AND 500
      ORDER BY ST_NPoints(geometry), ST_Length(geometry::geography)
    `);

    if (exactMatches.rows.length > 0) {
      console.log(`   Found ${exactMatches.rows.length} trails with matching point counts:`);
      exactMatches.rows.forEach((row, i) => {
        const geom = JSON.parse(row.geometry_json);
        console.log(`   ${i + 1}. ${row.name} (${row.length_m.toFixed(2)}m, ${row.point_count} points)`);
        
        // Find which prototype segment this matches
        const matchingSegment = prototypeSegments.find(seg => seg.coordinates.length === geom.coordinates.length);
        if (matchingSegment) {
          console.log(`      Matches ${matchingSegment.name}`);
        }
      });
    } else {
      console.log(`   No trails found with matching point counts`);
    }

    // Export the test geometry and similar trails for visual inspection
    console.log('\n📤 EXPORTING FOR VISUAL INSPECTION:');
    const testExport = await pool.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsGeoJSON(geometry) as geometry,
        ST_Length(geometry::geography) as length_m,
        ST_NPoints(geometry) as point_count
      FROM ${schema}.trails 
      WHERE app_uuid = $1 OR ST_DWithin(
        geometry::geography, 
        ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography, 
        100
      )
      ORDER BY ST_Length(geometry::geography)
    `, [testTrailId, JSON.stringify(originalGeometry)]);

    if (testExport.rows.length > 0) {
      const fs = require('fs');
      const exportData = {
        type: "FeatureCollection",
        features: testExport.rows.map(row => ({
          type: "Feature",
          properties: {
            id: row.app_uuid,
            name: row.name,
            length_m: parseFloat(row.length_m),
            point_count: row.point_count,
            is_test: row.app_uuid === testTrailId
          },
          geometry: JSON.parse(row.geometry)
        }))
      };

      fs.writeFileSync('test-output/test-geometry-validation.geojson', JSON.stringify(exportData, null, 2));
      console.log('   ✅ Exported to: test-output/test-geometry-validation.geojson');
    }

    // Also export the prototype segments for comparison
    const prototypeExport = {
      type: "FeatureCollection",
      features: prototypeSegments.map((segment, i) => ({
        type: "Feature",
        properties: {
          id: `prototype-segment-${i+1}`,
          name: `Prototype ${segment.name}`,
          length_m: 324.37, // Approximate length
          point_count: segment.coordinates.length,
          is_prototype: true,
          segment_number: i+1
        },
        geometry: {
          type: "LineString",
          coordinates: segment.coordinates
        }
      }))
    };

    fs.writeFileSync('test-output/prototype-expected-segments.geojson', JSON.stringify(prototypeExport, null, 2));
    console.log('   ✅ Prototype segments exported to: test-output/prototype-expected-segments.geojson');

    console.log('\n🎯 VALIDATION SUMMARY:');
    console.log('   - Original geometry: 40 coordinates');
    console.log('   - Prototype output: 3 segments (15 + 5 + 8 = 28 total coordinates)');
    console.log('   - Expected: Double split creating 3 segments');
    console.log('   - Check exported GeoJSON files for visual comparison');
    console.log('   - Look for trails with 15, 5, and 8 points that match prototype segments');

  } catch (error) {
    console.error('❌ Error during validation:', error);
  } finally {
    await pool.end();
  }
}

// Run the validation
validateGeometrySplit().catch(console.error);
