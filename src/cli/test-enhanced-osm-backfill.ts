#!/usr/bin/env node

import { Pool } from 'pg';
import { EnhancedOSMBackfillService } from '../utils/services/network-creation/enhanced-osm-backfill-service';
import { getDatabaseConfig } from '../utils/config-loader';

async function testEnhancedOSMBackfill() {
  console.log('🧪 Testing Enhanced OSM Backfill Service...');
  
  // Database connection
  const dbConfig = getDatabaseConfig();
  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password
  });

  try {
    // Use the most recent staging schema
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schemas found. Please run an export first.');
      return;
    }

    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📁 Using staging schema: ${stagingSchema}`);

    // Create the service
    const service = new EnhancedOSMBackfillService(pool, stagingSchema);

    // Test bbox from user's coordinates
    const bbox: [number, number, number, number] = [
      39.96928418458248,  // south
      -105.29123174925316, // west
      39.981172777276015,  // north
      -105.28050515816028  // east
    ];

    console.log(`🗺️ Testing with bbox: [${bbox.join(', ')}]`);

    // Run enhanced OSM backfill
    const result = await service.backfillEnhancedTrails({
      bbox,
      maxTrails: 200, // Limit for testing
      timeoutMs: 60000 // 60 second timeout
    });

    // Display results
    console.log('\n📊 Enhanced OSM Backfill Results:');
    console.log(`   🛤️ Trails found: ${result.trailsFound}`);
    console.log(`   ✅ Trails added: ${result.trailsAdded}`);
    console.log(`   ❌ Errors: ${result.errors.length}`);

    if (result.details.length > 0) {
      console.log('\n📋 Added trails:');
      result.details.slice(0, 10).forEach(trail => {
        console.log(`   - ${trail.trailName} (${trail.trailType}, ${trail.length.toFixed(3)}km, OSM: ${trail.osmId})`);
      });
      
      if (result.details.length > 10) {
        console.log(`   ... and ${result.details.length - 10} more`);
      }
    }

    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.slice(0, 5).forEach(error => {
        console.log(`   - ${error}`);
      });
      
      if (result.errors.length > 5) {
        console.log(`   ... and ${result.errors.length - 5} more errors`);
      }
    }

    // Check final trail count
    const finalCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${stagingSchema}.trails
    `);
    
    console.log(`\n📈 Final trail count in ${stagingSchema}: ${finalCount.rows[0].count}`);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testEnhancedOSMBackfill().catch(console.error);
