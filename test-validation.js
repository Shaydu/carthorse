const { Pool } = require('pg');

async function testValidation() {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:password@localhost:5432/trail_master_db'
  });
  
  try {
    console.log('🔍 Validating trails in staging schema...');
    
    // Get all trails in staging schema
    const trailsResult = await pool.query(`
      SELECT app_uuid, name, length_km, geometry, 
             ST_Length(geometry::geography)/1000.0 as calculated_length_km,
             ST_Z(ST_StartPoint(geometry)) as start_z,
             ST_Z(ST_EndPoint(geometry)) as end_z
      FROM carthorse_1757003783331.trails
      WHERE geometry IS NOT NULL
    `);

    const totalTrails = trailsResult.rows.length;
    console.log(`📊 Found ${totalTrails} trails to validate`);

    let fixedTrails = 0;
    let invalidTrails = 0;
    const errors = [];

    for (const trail of trailsResult.rows) {
      const trailErrors = [];
      let needsUpdate = false;
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;

      // Check for NULL length_km
      if (trail.length_km === null || trail.length_km === undefined) {
        trailErrors.push('NULL length_km');
        updateFields.push(`length_km = $${paramCount}`);
        updateValues.push(trail.calculated_length_km);
        paramCount++;
        needsUpdate = true;
      }

      // Check for invalid Z=0 elevations
      if (trail.start_z === 0 || trail.end_z === 0) {
        trailErrors.push('Invalid Z=0 elevation values');
      }

      // Check for significant length discrepancies
      if (trail.length_km !== null && Math.abs(trail.length_km - trail.calculated_length_km) > 0.001) {
        trailErrors.push(`Length mismatch: stored=${trail.length_km}, calculated=${trail.calculated_length_km}`);
        updateFields.push(`length_km = $${paramCount}`);
        updateValues.push(trail.calculated_length_km);
        paramCount++;
        needsUpdate = true;
      }

      if (trailErrors.length > 0) {
        if (needsUpdate) {
          // Fix the trail
          updateValues.push(trail.app_uuid);
          await pool.query(`
            UPDATE carthorse_1757003783331.trails 
            SET ${updateFields.join(', ')}
            WHERE app_uuid = $${paramCount}
          `, updateValues);
          
          fixedTrails++;
          console.log(`✅ Fixed trail: ${trail.name} (${trail.app_uuid}) - ${trailErrors.join(', ')}`);
        } else {
          invalidTrails++;
          console.log(`⚠️ Invalid trail (cannot fix): ${trail.name} (${trail.app_uuid}) - ${trailErrors.join(', ')}`);
        }
        
        errors.push(`${trail.name} (${trail.app_uuid}): ${trailErrors.join(', ')}`);
      }
    }

    console.log(`\n✅ Validation complete:`);
    console.log(`   Total trails: ${totalTrails}`);
    console.log(`   Fixed trails: ${fixedTrails}`);
    console.log(`   Invalid trails: ${invalidTrails}`);
    console.log(`   Total errors found: ${errors.length}`);

    if (errors.length > 0) {
      console.log(`\n📋 Error summary:`);
      errors.slice(0, 10).forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`);
      }
    }

  } catch (error) {
    console.error('❌ Error validating staging trails:', error);
  } finally {
    await pool.end();
  }
}

testValidation();



