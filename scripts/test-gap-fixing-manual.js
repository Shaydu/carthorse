#!/usr/bin/env node

const { Pool } = require('pg');
const { TrailGapFixingService } = require('../src/utils/services/trail-gap-fixing-service.ts');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

async function testGapFixingManual() {
  try {
    // Get the most recent staging schema
    const schemaResult = await pool.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC LIMIT 1
    `);
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`Testing gap fixing in schema: ${stagingSchema}`);
    
    // Create gap fixing service
    const gapFixingService = new TrailGapFixingService(
      pool,
      stagingSchema,
      {
        minGapDistance: 1,
        maxGapDistance: 30,
        verbose: true
      }
    );
    
    // Call the gap fixing service
    const result = await gapFixingService.fixTrailGaps();
    
    console.log('Gap fixing result:', result);
    
  } catch (error) {
    console.error('Error testing gap fixing:', error);
  } finally {
    await pool.end();
  }
}

testGapFixingManual();
