#!/usr/bin/env node

const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

const STAGING_SCHEMA = 'carthorse_1754992253411';

async function analyzeAllGaps() {
  try {
    await client.connect();
    console.log('🔍 Analyzing all gaps in the trail network...');

    // Find all trail endpoint pairs that are close but not connected
    const gapAnalysis = await client.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt,
          ST_Length(geometry::geography) as length_meters
        FROM ${STAGING_SCHEMA}.trails 
        WHERE geometry IS NOT NULL
      ),
      endpoint_pairs AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          'start-to-start' as connection_type,
          ST_Distance(t1.start_pt, t2.start_pt) as distance_meters,
          t1.start_pt as point1,
          t2.start_pt as point2
        FROM trail_endpoints t1, trail_endpoints t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_DWithin(t1.start_pt, t2.start_pt, 0.001)  -- Within ~100m
        
        UNION ALL
        
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          'start-to-end' as connection_type,
          ST_Distance(t1.start_pt, t2.end_pt) as distance_meters,
          t1.start_pt as point1,
          t2.end_pt as point2
        FROM trail_endpoints t1, trail_endpoints t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_DWithin(t1.start_pt, t2.end_pt, 0.001)  -- Within ~100m
        
        UNION ALL
        
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          'end-to-start' as connection_type,
          ST_Distance(t1.end_pt, t2.start_pt) as distance_meters,
          t1.end_pt as point1,
          t2.start_pt as point2
        FROM trail_endpoints t1, trail_endpoints t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_DWithin(t1.end_pt, t2.start_pt, 0.001)  -- Within ~100m
        
        UNION ALL
        
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          'end-to-end' as connection_type,
          ST_Distance(t1.end_pt, t2.end_pt) as distance_meters,
          t1.end_pt as point1,
          t2.end_pt as point2
        FROM trail_endpoints t1, trail_endpoints t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_DWithin(t1.end_pt, t2.end_pt, 0.001)  -- Within ~100m
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail2_id,
        trail2_name,
        connection_type,
        distance_meters,
        ST_AsText(point1) as point1_coords,
        ST_AsText(point2) as point2_coords,
        CASE 
          WHEN distance_meters < 0.1 THEN 'very_small'
          WHEN distance_meters < 1.0 THEN 'small'
          WHEN distance_meters < 10.0 THEN 'medium'
          WHEN distance_meters < 50.0 THEN 'large'
          ELSE 'very_large'
        END as gap_size_category
      FROM endpoint_pairs
      WHERE distance_meters > 0.001  -- Exclude exact matches (already connected)
      ORDER BY distance_meters
    `);

    console.log(`📊 Found ${gapAnalysis.rows.length} potential gaps between trail endpoints`);

    // Group by gap size category
    const gapCategories = {};
    gapAnalysis.rows.forEach(gap => {
      const category = gap.gap_size_category;
      if (!gapCategories[category]) {
        gapCategories[category] = [];
      }
      gapCategories[category].push(gap);
    });

    console.log('\n📏 Gap Size Distribution:');
    Object.keys(gapCategories).forEach(category => {
      const gaps = gapCategories[category];
      const avgDistance = gaps.reduce((sum, gap) => sum + gap.distance_meters, 0) / gaps.length;
      console.log(`  ${category}: ${gaps.length} gaps (avg: ${avgDistance.toFixed(2)}m)`);
    });

    // Show examples of each category
    console.log('\n🎯 Example Gaps by Category:');
    Object.keys(gapCategories).forEach(category => {
      const gaps = gapCategories[category];
      if (gaps.length > 0) {
        console.log(`\n  ${category.toUpperCase()} GAPS:`);
        gaps.slice(0, 3).forEach(gap => {
          console.log(`    ${gap.trail1_name} ${gap.connection_type} ${gap.trail2_name}: ${gap.distance_meters.toFixed(3)}m`);
        });
        if (gaps.length > 3) {
          console.log(`    ... and ${gaps.length - 3} more`);
        }
      }
    });

    // Check which gaps are already bridged in the routing network
    console.log('\n🔗 Checking which gaps are already bridged...');
    
    const bridgedGaps = await client.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt
        FROM ${STAGING_SCHEMA}.trails 
        WHERE geometry IS NOT NULL
      ),
      endpoint_pairs AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t2.app_uuid as trail2_id,
          'end-to-start' as connection_type,
          ST_Distance(t1.end_pt, t2.start_pt) as distance_meters
        FROM trail_endpoints t1, trail_endpoints t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_DWithin(t1.end_pt, t2.start_pt, 0.001)  -- Within ~100m
          AND ST_Distance(t1.end_pt, t2.start_pt) > 0.001  -- Not exact match
      ),
      routing_connections AS (
        SELECT 
          e1.app_uuid as trail1_id,
          e2.app_uuid as trail2_id,
          ST_Distance(
            ST_EndPoint(e1.the_geom), 
            ST_StartPoint(e2.the_geom)
          ) as routing_distance
        FROM ${STAGING_SCHEMA}.ways_noded e1
        JOIN ${STAGING_SCHEMA}.ways_noded e2 ON 
          ST_DWithin(ST_EndPoint(e1.the_geom), ST_StartPoint(e2.the_geom), 0.001)
        WHERE e1.app_uuid < e2.app_uuid
      )
      SELECT 
        ep.trail1_id,
        ep.trail2_id,
        ep.distance_meters as original_gap,
        COALESCE(rc.routing_distance, 999) as routing_distance,
        CASE 
          WHEN rc.routing_distance IS NOT NULL THEN 'bridged'
          ELSE 'not_bridged'
        END as bridge_status
      FROM endpoint_pairs ep
      LEFT JOIN routing_connections rc ON 
        ep.trail1_id = rc.trail1_id AND ep.trail2_id = rc.trail2_id
      ORDER BY ep.distance_meters
    `);

    const bridgedCount = bridgedGaps.rows.filter(r => r.bridge_status === 'bridged').length;
    const notBridgedCount = bridgedGaps.rows.filter(r => r.bridge_status === 'not_bridged').length;

    console.log(`\n🌉 Bridge Status:`);
    console.log(`  Bridged gaps: ${bridgedCount}`);
    console.log(`  Unbridged gaps: ${notBridgedCount}`);
    console.log(`  Total gaps checked: ${bridgedGaps.rows.length}`);

    // Show examples of unbridged gaps
    const unbridgedGaps = bridgedGaps.rows.filter(r => r.bridge_status === 'not_bridged');
    if (unbridgedGaps.length > 0) {
      console.log('\n❌ Examples of Unbridged Gaps:');
      unbridgedGaps.slice(0, 5).forEach(gap => {
        console.log(`  Trail ${gap.trail1_id} → Trail ${gap.trail2_id}: ${gap.original_gap.toFixed(3)}m`);
      });
    }

    // Recommend approach for different gap sizes
    console.log('\n💡 Recommendations by Gap Size:');
    console.log('  Very Small (< 0.1m): SNAPPING - Merge vertices');
    console.log('  Small (0.1-1m): SNAPPING - Merge vertices');
    console.log('  Medium (1-10m): EXTENDING - Extend one trail to meet the other');
    console.log('  Large (10-50m): CONNECTOR - Create straight-line bridge');
    console.log('  Very Large (> 50m): MANUAL REVIEW - May need different approach');

    // Count how many would benefit from our approach
    const extendableGaps = gapAnalysis.rows.filter(gap => 
      gap.distance_meters >= 1.0 && gap.distance_meters < 50.0
    );
    
    const snappableGaps = gapAnalysis.rows.filter(gap => 
      gap.distance_meters < 1.0
    );

    console.log(`\n📋 Applicability of Our Approach:`);
    console.log(`  Gaps suitable for EXTENDING (1-50m): ${extendableGaps.length}`);
    console.log(`  Gaps suitable for SNAPPING (< 1m): ${snappableGaps.length}`);
    console.log(`  Total gaps that could be fixed: ${extendableGaps.length + snappableGaps.length}`);

  } catch (error) {
    console.error('❌ Error analyzing all gaps:', error);
  } finally {
    await client.end();
  }
}

analyzeAllGaps();
