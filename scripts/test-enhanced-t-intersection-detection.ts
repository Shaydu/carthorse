#!/usr/bin/env ts-node

import { Client } from 'pg';

async function testEnhancedTIntersectionDetection() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'tester'
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Create a test schema and table
    const testSchema = 'test_t_intersection_' + Date.now();
    console.log(`Creating test schema: ${testSchema}`);
    
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Create trails table
    await client.query(`
      CREATE TABLE ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        geometry GEOMETRY(LINESTRING, 4326)
      )
    `);

    // Create intersection_points table
    await client.query(`
      CREATE TABLE ${testSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326),
        point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters FLOAT
      )
    `);

    // Insert test data - two trails that form a T-intersection
    await client.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, geometry) VALUES
      ('trail1', 'Enchanted Mesa Trail', ST_GeomFromText('LINESTRING(-105.2824 39.9886, -105.2820 39.9888)', 4326)),
      ('trail2', 'Enchanted-Kohler Spur Trail', ST_GeomFromText('LINESTRING(-105.2822 39.9884, -105.2823931909462 39.98859709804337)', 4326))
    `);

    console.log('Test data created');

    // Test the enhanced detect_trail_intersections function
    console.log('\n=== Testing Enhanced T-Intersection Detection ===');
    const result = await client.query(`
      SELECT 
        ST_AsText(intersection_point) as point_text,
        connected_trail_names,
        node_type,
        distance_meters
      FROM detect_trail_intersections($1, 'trails', 3.0)
      ORDER BY distance_meters
    `, [testSchema]);

    console.log('Enhanced detection results:');
    if (result.rows.length === 0) {
      console.log('  No intersections detected');
    } else {
      result.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. Point: ${row.point_text}`);
        console.log(`     Trails: ${row.connected_trail_names.join(' <-> ')}`);
        console.log(`     Type: ${row.node_type}`);
        console.log(`     Distance: ${row.distance_meters.toFixed(2)}m`);
        console.log('');
      });
    }

    // Test with a smaller tolerance
    console.log('\n=== Testing with 2.0m tolerance ===');
    const result2 = await client.query(`
      SELECT 
        ST_AsText(intersection_point) as point_text,
        connected_trail_names,
        node_type,
        distance_meters
      FROM detect_trail_intersections($1, 'trails', 2.0)
      ORDER BY distance_meters
    `, [testSchema]);

    console.log('Results with 2.0m tolerance:');
    if (result2.rows.length === 0) {
      console.log('  No intersections detected');
    } else {
      result2.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. Point: ${row.point_text}`);
        console.log(`     Trails: ${row.connected_trail_names.join(' <-> ')}`);
        console.log(`     Type: ${row.node_type}`);
        console.log(`     Distance: ${row.distance_meters.toFixed(2)}m`);
        console.log('');
      });
    }

    // Clean up
    await client.query(`DROP SCHEMA ${testSchema} CASCADE`);
    console.log(`\nCleaned up test schema: ${testSchema}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testEnhancedTIntersectionDetection().catch(console.error);
