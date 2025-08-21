#!/usr/bin/env node

const { Pool } = require('pg');

// Configuration
const config = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu',
  stagingSchema: 'carthorse_1755735378966'
};

async function consolidateHogbackSegments() {
  const client = new Pool(config);
  
  try {
    await client.connect();
    console.log('🔧 Consolidating Hogback segments...');

    // Step 1: Analyze current state
    console.log('\n📊 Current Hogback segments:');
    const currentSegments = await client.query(`
      SELECT 
        name,
        COUNT(*) as segment_count,
        SUM(length_km) as total_length_km,
        AVG(length_km) as avg_length_km
      FROM ${config.stagingSchema}.trails 
      WHERE name LIKE '%Hogback%'
      GROUP BY name
      ORDER BY segment_count DESC
    `);

    console.log('Current segment breakdown:');
    currentSegments.rows.forEach((segment, i) => {
      console.log(`  ${i + 1}. ${segment.name}: ${segment.segment_count} segments, ${segment.total_length_km.toFixed(2)}km total`);
    });

    // Step 2: Create a consolidated version
    console.log('\n🔄 Creating consolidated Hogback trail...');
    
    // First, let's create a new consolidated trail by merging all segments
    await client.query(`
      INSERT INTO ${config.stagingSchema}.trails (
        app_uuid, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        source_tags, osm_id, source, created_at, updated_at
      )
      SELECT 
        gen_random_uuid() as app_uuid,
        'Hogback Ridge Trail (Consolidated)' as name,
        'boulder' as region,
        'hiking' as trail_type,
        'dirt' as surface,
        'moderate' as difficulty,
        SUM(length_km) as length_km,
        SUM(elevation_gain) as elevation_gain,
        SUM(elevation_loss) as elevation_loss,
        MAX(max_elevation) as max_elevation,
        MIN(min_elevation) as min_elevation,
        AVG(avg_elevation) as avg_elevation,
        ST_LineMerge(ST_Collect(geometry)) as geometry,
        MIN(bbox_min_lng) as bbox_min_lng,
        MAX(bbox_max_lng) as bbox_max_lng,
        MIN(bbox_min_lat) as bbox_min_lat,
        MAX(bbox_max_lat) as bbox_max_lat,
        '{"consolidated": true}' as source_tags,
        NULL as osm_id,
        'consolidated' as source,
        NOW() as created_at,
        NOW() as updated_at
      FROM ${config.stagingSchema}.trails 
      WHERE name LIKE '%Hogback%'
    `);

    console.log('✅ Created consolidated Hogback trail');

    // Step 3: Create a simpler split version (split only at major intersections)
    console.log('\n🔄 Creating simplified split version...');
    
    // Get the consolidated trail geometry
    const consolidatedTrail = await client.query(`
      SELECT geometry FROM ${config.stagingSchema}.trails 
      WHERE name = 'Hogback Ridge Trail (Consolidated)'
    `);

    if (consolidatedTrail.rows.length > 0) {
      const geometry = consolidatedTrail.rows[0].geometry;
      
      // Split only at major intersections (not at every small intersection)
      await client.query(`
        INSERT INTO ${config.stagingSchema}.trails (
          app_uuid, name, region, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source_tags, osm_id, source, created_at, updated_at
        )
        WITH major_intersections AS (
          SELECT 
            ST_Intersection($1::geometry, t.geometry) as intersection_point
          FROM ${config.stagingSchema}.trails t
          WHERE t.name NOT LIKE '%Hogback%'
            AND ST_Intersects($1::geometry, t.geometry)
            AND ST_GeometryType(ST_Intersection($1::geometry, t.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t.geometry::geography) > 100  -- Only major trails (>100m)
        ),
        split_segments AS (
          SELECT 
            (ST_Dump(ST_Split($1::geometry, ST_Collect(intersection_point)))).geom as segment_geometry,
            generate_series(1, ST_NumGeometries(ST_Split($1::geometry, ST_Collect(intersection_point)))) as segment_index
          FROM major_intersections
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          'Hogback Ridge Trail (Segment ' || segment_index || ')' as name,
          'boulder' as region,
          'hiking' as trail_type,
          'dirt' as surface,
          'moderate' as difficulty,
          ST_Length(segment_geometry::geography) / 1000.0 as length_km,
          0 as elevation_gain,
          0 as elevation_loss,
          0 as max_elevation,
          0 as min_elevation,
          0 as avg_elevation,
          segment_geometry as geometry,
          ST_XMin(segment_geometry) as bbox_min_lng,
          ST_XMax(segment_geometry) as bbox_max_lng,
          ST_YMin(segment_geometry) as bbox_min_lat,
          ST_YMax(segment_geometry) as bbox_max_lat,
          '{"simplified_split": true}' as source_tags,
          NULL as osm_id,
          'simplified_split' as source,
          NOW() as created_at,
          NOW() as updated_at
        FROM split_segments
        WHERE ST_GeometryType(segment_geometry) = 'ST_LineString'
          AND ST_Length(segment_geometry::geography) > 50  -- Only segments >50m
      `, [geometry]);

      console.log('✅ Created simplified split version');
    }

    // Step 4: Show the results
    console.log('\n📊 Final Hogback trails:');
    const finalTrails = await client.query(`
      SELECT 
        name,
        length_km,
        ST_NumPoints(geometry) as num_points,
        source
      FROM ${config.stagingSchema}.trails 
      WHERE name LIKE '%Hogback%'
      ORDER BY name
    `);

    console.log('Final trails:');
    finalTrails.rows.forEach((trail, i) => {
      console.log(`  ${i + 1}. ${trail.name}: ${trail.length_km.toFixed(2)}km, ${trail.num_points} points (${trail.source})`);
    });

    // Step 5: Recommendations
    console.log('\n💡 Recommendations:');
    console.log('  1. Use the consolidated version for simple routing');
    console.log('  2. Use the simplified split version for intersection-aware routing');
    console.log('  3. Consider removing the original over-split segments');
    console.log('  4. Re-run routing node and edge generation');

    console.log('\n✅ Hogback segment consolidation complete!');

  } catch (error) {
    console.error('❌ Error consolidating Hogback segments:', error);
  } finally {
    await client.end();
  }
}

// Run the consolidation
consolidateHogbackSegments().catch(console.error);
