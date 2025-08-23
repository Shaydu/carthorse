#!/usr/bin/env node

const { Client } = require('pg');

async function testHogbackPreservation() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🧪 Testing Hogback Ridge preservation approach...');

    // Clear staging schema and copy some test data
    console.log('\n📊 Setting up test data...');
    await client.query('DELETE FROM staging.trails');
    
    // Copy some trails to staging for testing, including Hogback Ridge
    await client.query(`
      INSERT INTO staging.trails 
      SELECT * FROM public.trails 
      WHERE name ILIKE '%hogback%' 
         OR name ILIKE '%anemone%'
         OR name ILIKE '%north sky%'
      LIMIT 10
    `);

    // Check initial state
    console.log('\n📊 Initial state:');
    const beforeState = await client.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN NOT ST_IsSimple(geometry) THEN 1 END) as non_simple_count,
        COUNT(CASE WHEN name ILIKE '%hogback%' THEN 1 END) as hogback_count,
        COUNT(CASE WHEN name ILIKE '%hogback%' AND NOT ST_IsSimple(geometry) THEN 1 END) as hogback_non_simple
      FROM staging.trails
    `);
    
    console.log(`   Total trails: ${beforeState.rows[0].total_trails}`);
    console.log(`   Non-simple trails: ${beforeState.rows[0].non_simple_count}`);
    console.log(`   Hogback trails: ${beforeState.rows[0].hogback_count}`);
    console.log(`   Hogback non-simple: ${beforeState.rows[0].hogback_non_simple}`);

    // Test the new preservation approach
    console.log('\n🔄 Testing Hogback Ridge preservation approach...');
    
    // Import and use the new LoopSplittingService
    const { LoopSplittingService } = require('./src/services/layer1/LoopSplittingService.ts');
    
    const loopSplittingService = new LoopSplittingService(client, {
      stagingSchema: 'staging',
      verbose: true
    });
    
    const result = await loopSplittingService.handleSelfIntersectingLoops();
    
    if (result.success) {
      console.log('\n✅ Hogback Ridge preservation completed successfully!');
      console.log(`   Original trails: ${result.originalTrailCount}`);
      console.log(`   Final trails: ${result.splitTrailCount}`);
      
      // Check final state
      console.log('\n📊 Final state:');
      const afterState = await client.query(`
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN NOT ST_IsSimple(geometry) THEN 1 END) as non_simple_count,
          COUNT(CASE WHEN name ILIKE '%hogback%' THEN 1 END) as hogback_count,
          COUNT(CASE WHEN name ILIKE '%hogback%' AND NOT ST_IsSimple(geometry) THEN 1 END) as hogback_non_simple
        FROM staging.trails
      `);
      
      console.log(`   Total trails: ${afterState.rows[0].total_trails}`);
      console.log(`   Non-simple trails: ${afterState.rows[0].non_simple_count}`);
      console.log(`   Hogback trails: ${afterState.rows[0].hogback_count}`);
      console.log(`   Hogback non-simple: ${afterState.rows[0].hogback_non_simple}`);
      
      // Check if Hogback Ridge was preserved (not split)
      const hogbackPreserved = afterState.rows[0].hogback_non_simple > 0;
      if (hogbackPreserved) {
        console.log('\n✅ SUCCESS: Hogback Ridge self-intersecting loops were preserved!');
      } else {
        console.log('\n❌ FAILURE: Hogback Ridge self-intersecting loops were split');
      }
      
      // Show specific Hogback trails
      const hogbackTrails = await client.query(`
        SELECT 
          app_uuid, 
          name, 
          ST_IsSimple(geometry) as is_simple,
          ST_Length(geometry::geography) as length_meters
        FROM staging.trails 
        WHERE name ILIKE '%hogback%'
        ORDER BY name
      `);
      
      console.log('\n📋 Hogback Ridge trails after processing:');
      hogbackTrails.rows.forEach(trail => {
        const status = trail.is_simple ? 'simple' : 'self-intersecting (preserved)';
        console.log(`   - ${trail.name}: ${status} (${trail.length_meters.toFixed(1)}m)`);
      });
      
    } else {
      console.error('\n❌ Hogback Ridge preservation failed:', result.error);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  } finally {
    await client.end();
  }
}

testHogbackPreservation();
