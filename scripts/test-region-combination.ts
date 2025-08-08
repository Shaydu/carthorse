#!/usr/bin/env ts-node

import { Client } from 'pg';
import * as fs from 'fs';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

async function testRegionCombinationTheory() {
  try {
    await client.connect();
    console.log('🔍 Testing region combination theory...');

    // Define different geographic regions
    const regions = [
      {
        name: 'northwest',
        bbox: [-105.32047300758535, 40.01589890417776, -105.26687332281577, 40.01589890417776, -105.26687332281577, 39.97645469545003, -105.32047300758535, 39.97645469545003]
      },
      {
        name: 'northeast', 
        bbox: [-105.26687332281577, 40.01589890417776, -105.21327363704619, 40.01589890417776, -105.21327363704619, 39.97645469545003, -105.26687332281577, 39.97645469545003]
      },
      {
        name: 'southwest',
        bbox: [-105.32047300758535, 39.97645469545003, -105.26687332281577, 39.97645469545003, -105.26687332281577, 39.93701048672230, -105.32047300758535, 39.93701048672230]
      },
      {
        name: 'southeast',
        bbox: [-105.26687332281577, 39.97645469545003, -105.21327363704619, 39.97645469545003, -105.21327363704619, 39.93701048672230, -105.26687332281577, 39.93701048672230]
      }
    ];

    // Test each region individually
    console.log('\n📊 Testing individual regions...');
    for (const region of regions) {
      const result = await testRegion(region);
      console.log(`  ${region.name}: ${result.success ? '✅' : '❌'} (${result.trailCount} trails)`);
    }

    // Test combinations of regions
    console.log('\n🔗 Testing region combinations...');
    const combinations = [
      ['northwest', 'northeast'],
      ['northwest', 'southwest'], 
      ['northeast', 'southeast'],
      ['southwest', 'southeast'],
      ['northwest', 'northeast', 'southwest'],
      ['northwest', 'northeast', 'southeast'],
      ['northwest', 'southwest', 'southeast'],
      ['northeast', 'southwest', 'southeast'],
      ['northwest', 'northeast', 'southwest', 'southeast']
    ];

    for (const combo of combinations) {
      const result = await testRegionCombination(combo);
      console.log(`  ${combo.join('+')}: ${result.success ? '✅' : '❌'} (${result.trailCount} trails)`);
    }

    // Test the actual problematic batches to see if they span disconnected regions
    console.log('\n🎯 Testing actual problematic batches...');
    
    // Test first 1700 trails (the ones that cause GeometryCollection error)
    const first1700 = await testSpecificTrailRange(0, 1700);
    console.log(`  First 1700 trails: ${first1700.success ? '✅' : '❌'} (${first1700.trailCount} trails)`);
    
    // Test second batch (trails 1601-2542, the ones that cause linear intersection error)
    const secondBatch = await testSpecificTrailRange(1600, 942);
    console.log(`  Second batch (1601-2542): ${secondBatch.success ? '✅' : '❌'} (${secondBatch.trailCount} trails)`);

    // Analyze geographic distribution of problematic batches
    console.log('\n🗺️  Analyzing geographic distribution...');
    await analyzeGeographicDistribution();

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function testRegion(region: any) {
  const query = `
    CREATE TEMP TABLE ways_test AS
    SELECT 
      ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
      app_uuid as trail_uuid,
      name,
      CASE
        WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
        ELSE ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
      END as the_geom
    FROM staging_boulder_1754318437837.trails 
    WHERE geometry IS NOT NULL 
      AND ST_IsValid(geometry)
      AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
  `;

  try {
    await client.query('DROP TABLE IF EXISTS ways_test');
    await client.query(query, [region.bbox[0], region.bbox[1], region.bbox[2], region.bbox[3]]);
    
    const countResult = await client.query('SELECT COUNT(*) as count FROM ways_test');
    const trailCount = parseInt(countResult.rows[0].count);
    
    if (trailCount === 0) {
      return { success: true, trailCount: 0 };
    }

    await client.query(`SELECT pgr_nodeNetwork('ways_test', 0.000001, 'id', 'the_geom')`);
    
    return { success: true, trailCount };
  } catch (error) {
    return { success: false, trailCount: 0, error: (error as Error).message };
  }
}

async function testRegionCombination(regionNames: string[]) {
  const bboxes = regionNames.map(name => {
    switch(name) {
      case 'northwest': return [-105.32047300758535, 39.97645469545003, -105.26687332281577, 40.01589890417776];
      case 'northeast': return [-105.26687332281577, 39.97645469545003, -105.21327363704619, 40.01589890417776];
      case 'southwest': return [-105.32047300758535, 39.93701048672230, -105.26687332281577, 39.97645469545003];
      case 'southeast': return [-105.26687332281577, 39.93701048672230, -105.21327363704619, 39.97645469545003];
      default: return null;
    }
  }).filter(bbox => bbox !== null);

  const query = `
    CREATE TEMP TABLE ways_test AS
    SELECT 
      ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
      app_uuid as trail_uuid,
      name,
      CASE
        WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
        ELSE ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
      END as the_geom
    FROM staging_boulder_1754318437837.trails 
    WHERE geometry IS NOT NULL 
      AND ST_IsValid(geometry)
      AND (
        ${bboxes.map((_, i) => `ST_Intersects(geometry, ST_MakeEnvelope($${i*4+1}, $${i*4+2}, $${i*4+3}, $${i*4+4}, 4326))`).join(' OR ')}
      )
  `;

  try {
    await client.query('DROP TABLE IF EXISTS ways_test');
    await client.query(query, bboxes.flat());
    
    const countResult = await client.query('SELECT COUNT(*) as count FROM ways_test');
    const trailCount = parseInt(countResult.rows[0].count);
    
    if (trailCount === 0) {
      return { success: true, trailCount: 0 };
    }

    await client.query(`SELECT pgr_nodeNetwork('ways_test', 0.000001, 'id', 'the_geom')`);
    
    return { success: true, trailCount };
  } catch (error) {
    return { success: false, trailCount: 0, error: (error as Error).message };
  }
}

async function testSpecificTrailRange(offset: number, limit: number) {
  const query = `
    CREATE TEMP TABLE ways_test AS
    SELECT 
      ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
      app_uuid as trail_uuid,
      name,
      CASE
        WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
        ELSE ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
      END as the_geom
    FROM staging_boulder_1754318437837.trails 
    WHERE geometry IS NOT NULL 
      AND ST_IsValid(geometry)
    ORDER BY app_uuid
    LIMIT $1 OFFSET $2
  `;

  try {
    await client.query('DROP TABLE IF EXISTS ways_test');
    await client.query(query, [limit, offset]);
    
    const countResult = await client.query('SELECT COUNT(*) as count FROM ways_test');
    const trailCount = parseInt(countResult.rows[0].count);
    
    if (trailCount === 0) {
      return { success: true, trailCount: 0 };
    }

    await client.query(`SELECT pgr_nodeNetwork('ways_test', 0.000001, 'id', 'the_geom')`);
    
    return { success: true, trailCount };
  } catch (error) {
    return { success: false, trailCount: 0, error: (error as Error).message };
  }
}

async function analyzeGeographicDistribution() {
  // Analyze the geographic distribution of trails in the problematic batches
  const queries = [
    {
      name: 'First 1700 trails (GeometryCollection error)',
      query: `
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN ST_X(ST_Centroid(geometry)) < -105.26687332281577 THEN 1 END) as west_of_center,
          COUNT(CASE WHEN ST_X(ST_Centroid(geometry)) >= -105.26687332281577 THEN 1 END) as east_of_center,
          COUNT(CASE WHEN ST_Y(ST_Centroid(geometry)) < 39.97645469545003 THEN 1 END) as south_of_center,
          COUNT(CASE WHEN ST_Y(ST_Centroid(geometry)) >= 39.97645469545003 THEN 1 END) as north_of_center
        FROM staging_boulder_1754318437837.trails 
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
        ORDER BY app_uuid
        LIMIT 1700
      `
    },
    {
      name: 'Second batch (1601-2542, linear intersection error)',
      query: `
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN ST_X(ST_Centroid(geometry)) < -105.26687332281577 THEN 1 END) as west_of_center,
          COUNT(CASE WHEN ST_X(ST_Centroid(geometry)) >= -105.26687332281577 THEN 1 END) as east_of_center,
          COUNT(CASE WHEN ST_Y(ST_Centroid(geometry)) < 39.97645469545003 THEN 1 END) as south_of_center,
          COUNT(CASE WHEN ST_Y(ST_Centroid(geometry)) >= 39.97645469545003 THEN 1 END) as north_of_center
        FROM staging_boulder_1754318437837.trails 
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
        ORDER BY app_uuid
        LIMIT 942 OFFSET 1600
      `
    }
  ];

  for (const { name, query } of queries) {
    const result = await client.query(query);
    const row = result.rows[0];
    console.log(`  ${name}:`);
    console.log(`    Total: ${row.total_trails}`);
    console.log(`    West/East: ${row.west_of_center}/${row.east_of_center}`);
    console.log(`    South/North: ${row.south_of_center}/${row.north_of_center}`);
  }
}

testRegionCombinationTheory(); 