#!/usr/bin/env ts-node

import { Pool } from 'pg';

// Database connection
const client = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: process.env.PGPASSWORD || 'your_password_here'
});

const STAGING_SCHEMA = 'test_intersecting_trails_1234567890';

async function testIntersectingTrails() {
  console.log('🧪 Testing pgr_separateTouching on intersecting trails...');
  
  try {
    // Create fresh staging schema for testing
    console.log(`📋 Creating fresh staging schema: ${STAGING_SCHEMA}`);
    
    // Drop and recreate schema
    await client.query(`DROP SCHEMA IF EXISTS ${STAGING_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${STAGING_SCHEMA}`);
    
    // Create trails table
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails (
        id SERIAL PRIMARY KEY,
        old_id INTEGER,
        app_uuid TEXT,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        region TEXT,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        source TEXT,
        source_tags JSONB,
        osm_id TEXT
      )
    `);
    
    // Copy all trails from the specified bbox
    await client.query(`
      INSERT INTO ${STAGING_SCHEMA}.trails (
        id, old_id, app_uuid, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
      )
      SELECT 
        id, id as old_id, app_uuid, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
      FROM public.trails
      WHERE ST_Intersects(geometry, ST_MakeEnvelope(-105.29123174925316, 39.96928418458248, -105.28050515816028, 39.981172777276015, 4326))
        AND geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND source = 'cotrex'
    `);
    
    const trailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails`);
    console.log(`✅ Copied ${trailCountResult.rows[0].count} intersecting trails`);
    
    // Show what we have
    const trailDetailsResult = await client.query(`
      SELECT id, name, ST_Length(geometry::geography) as length_meters, 
             ST_NumPoints(geometry) as num_points,
             ST_IsValid(geometry) as is_valid, ST_GeometryType(geometry) as geom_type
      FROM ${STAGING_SCHEMA}.trails 
      ORDER BY name, id
    `);
    console.log('\n📋 Trail details before processing:');
    trailDetailsResult.rows.forEach(row => {
      console.log(`   ID ${row.id}: ${row.name} - ${row.length_meters.toFixed(1)}m (${row.num_points} points, valid: ${row.is_valid}, type: ${row.geom_type})`);
    });
    
    // Check for intersections
    const intersectionResult = await client.query(`
      SELECT t1.name as trail1, t2.name as trail2, 
             ST_Intersects(t1.geometry, t2.geometry) as intersects,
             ST_Touches(t1.geometry, t2.geometry) as touches,
             ST_Crosses(t1.geometry, t2.geometry) as crosses
      FROM ${STAGING_SCHEMA}.trails t1 
      CROSS JOIN ${STAGING_SCHEMA}.trails t2 
      WHERE t1.id < t2.id AND ST_Intersects(t1.geometry, t2.geometry)
    `);
    console.log('\n🔗 Intersections found:');
    intersectionResult.rows.forEach(row => {
      console.log(`   ${row.trail1} <-> ${row.trail2}: intersects=${row.intersects}, touches=${row.touches}, crosses=${row.crosses}`);
    });
    
    // Step 1: Apply T-intersection snapping (like production code)
    console.log('\n🔧 Step 1: Applying T-intersection snapping...');
    
    const toleranceMeters = 2.0; // 2 meter tolerance for T-intersection detection
    console.log(`   📏 Using T-intersection tolerance: ${toleranceMeters}m`);
    
    // Find trail endpoints that are close to other trails (T-intersection candidates)
    const tIntersectionGapsResult = await client.query(`
      WITH trail_endpoints AS (
        -- Get start and end points of all trails
        SELECT 
          id,
          name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          geometry as trail_geometry
        FROM ${STAGING_SCHEMA}.trails
        WHERE ST_IsValid(geometry) AND ST_GeometryType(geometry) = 'ST_LineString'
      ),
      endpoint_to_trail_gaps AS (
        -- Find endpoints that are close to other trails (but not their own trail)
        SELECT 
          e1.id as endpoint_trail_id,
          e1.name as endpoint_trail_name,
          e1.start_point as endpoint_point,
          'start' as endpoint_type,
          e2.id as target_trail_id,
          e2.name as target_trail_name,
          e2.trail_geometry as target_trail_geometry,
          ST_Distance(e1.start_point::geography, e2.trail_geometry::geography) as distance_meters,
          ST_ClosestPoint(e2.trail_geometry, e1.start_point) as closest_point_on_target
        FROM trail_endpoints e1
        JOIN trail_endpoints e2 ON e1.id != e2.id
        WHERE ST_DWithin(e1.start_point::geography, e2.trail_geometry::geography, $1)
          AND ST_Distance(e1.start_point::geography, e2.trail_geometry::geography) > 0
          AND ST_Distance(e1.start_point::geography, e2.trail_geometry::geography) <= $1
        
        UNION ALL
        
        SELECT 
          e1.id as endpoint_trail_id,
          e1.name as endpoint_trail_name,
          e1.end_point as endpoint_point,
          'end' as endpoint_type,
          e2.id as target_trail_id,
          e2.name as target_trail_name,
          e2.trail_geometry as target_trail_geometry,
          ST_Distance(e1.end_point::geography, e2.trail_geometry::geography) as distance_meters,
          ST_ClosestPoint(e2.trail_geometry, e1.end_point) as closest_point_on_target
        FROM trail_endpoints e1
        JOIN trail_endpoints e2 ON e1.id != e2.id
        WHERE ST_DWithin(e1.end_point::geography, e2.trail_geometry::geography, $1)
          AND ST_Distance(e1.end_point::geography, e2.trail_geometry::geography) > 0
          AND ST_Distance(e1.end_point::geography, e2.trail_geometry::geography) <= $1
      )
      SELECT * FROM endpoint_to_trail_gaps
      ORDER BY distance_meters ASC
    `, [toleranceMeters]);

    console.log(`   📊 Found ${tIntersectionGapsResult.rowCount || 0} T-intersection gap candidates`);
    
    if ((tIntersectionGapsResult.rowCount || 0) > 0) {
      let gapsFixed = 0;
      const processedTrails = new Set<number>();

      for (const gap of tIntersectionGapsResult.rows) {
        const visitorTrailId = gap.endpoint_trail_id;
        const endpointType = gap.endpoint_type;
        const intersectionPoint = gap.closest_point_on_target;

        // Skip if we've already processed this trail
        if (processedTrails.has(visitorTrailId)) {
          continue;
        }

        // Snap the visitor trail endpoint to the intersection point
        console.log(`   🔧 Snapping visitor trail "${gap.endpoint_trail_name}" endpoint to intersection point`);
        
        // Get the snapped geometry for the visitor trail
        const snappedVisitorGeometry = await client.query(`
          SELECT 
            CASE 
              WHEN $2 = 'start' THEN ST_AddPoint(geometry, $1, 0)
              WHEN $2 = 'end' THEN ST_AddPoint(geometry, $1, -1)
              ELSE geometry
            END as snapped_geometry
          FROM ${STAGING_SCHEMA}.trails 
          WHERE id = $3
        `, [intersectionPoint, endpointType, visitorTrailId]);

        if (!snappedVisitorGeometry.rows[0] || !snappedVisitorGeometry.rows[0].snapped_geometry) {
          console.log(`   ❌ Failed to generate snapped geometry for visitor trail "${gap.endpoint_trail_name}"`);
          continue;
        }
        
        // Update the visitor trail with the snapped geometry
        await client.query(`
          UPDATE ${STAGING_SCHEMA}.trails 
          SET geometry = $1
          WHERE id = $2
        `, [snappedVisitorGeometry.rows[0].snapped_geometry, visitorTrailId]);
        
        console.log(`   ✅ Successfully snapped visitor trail "${gap.endpoint_trail_name}" to intersection point`);
        
        gapsFixed++;
        processedTrails.add(visitorTrailId);
      }
      
      console.log(`✅ Snapped ${gapsFixed} T-intersection gaps`);
    } else {
      console.log('✅ No T-intersection gaps found');
    }
    
    // Step 2: Create temporary table for results
    console.log('\n📋 Step 2: Creating temporary table for results...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails_split_results (
        original_id INTEGER,
        sub_id INTEGER,
        osm_id TEXT,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        source TEXT,
        source_tags JSONB,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Step 3: Test with dry run first
    console.log('\n🔍 Step 3: Testing with dry run...');
    const dryRunResult = await client.query(`
      SELECT * FROM pgr_separateTouching(
        'SELECT id, ST_Force2D(geometry) as geom FROM ${STAGING_SCHEMA}.trails',
        0.001,
        true
      )
    `);
    console.log(`📊 Dry run found ${dryRunResult.rows.length} potential segments`);
    
    if (dryRunResult.rows.length > 0) {
      console.log('\n📋 Dry run results:');
      dryRunResult.rows.forEach(row => {
        console.log(`   Original ID ${row.id}, Sub ${row.sub_id}`);
      });
    }
    
    // Step 4: Apply pgr_separateTouching with GeometryCollection handling
    console.log('\n🔍 Step 4: Applying pgr_separateTouching...');
    const toleranceDegrees = 0.5 / 111320; // ~0.5 meters in degrees (tighter tolerance after snapping)
    
    try {
      // Step 4a: Create backup table (like working service)
      console.log('\n🔧 Step 4a: Creating backup table...');
      await client.query(`
        CREATE TABLE ${STAGING_SCHEMA}.trails_backup AS 
        SELECT * FROM ${STAGING_SCHEMA}.trails
      `);
      
      // Step 4b: Using CTE to handle GeometryCollections at query time
      console.log('\n🔧 Step 4b: Using CTE to handle GeometryCollections at query time...');
      
      // Step 4c: Apply pgr_separateTouching with fallback (like working service)
      console.log('\n🔍 Step 4c: Applying pgr_separateTouching...');
      
              // Try with original tolerance first
        try {
          // First, insert all trails that were split by pgr_separateTouching
          await client.query(`
            INSERT INTO ${STAGING_SCHEMA}.trails_split_results (
              original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
              length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
              bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags,
              geometry, created_at
            )
            SELECT 
              t.id as original_id,
              st.sub_id,
              t.osm_id,
              t.name,
              t.region,
              t.trail_type,
              t.surface,
              t.difficulty,
              t.length_km,
              t.elevation_gain,
              t.elevation_loss,
              t.max_elevation,
              t.min_elevation,
              t.avg_elevation,
              t.bbox_min_lng,
              t.bbox_max_lng,
              t.bbox_min_lat,
              t.bbox_max_lat,
              t.source,
              t.source_tags,
              st.geom as geometry,
              NOW() as created_at
            FROM pgr_separateTouching(
              $$
              WITH cleaned AS (
                  SELECT id,
                         ST_Force2D(
                             ST_Multi(
                                 ST_Union(d.geom)
                             )
                         ) AS geom
                  FROM (
                      SELECT id,
                             (ST_Dump(
                                 ST_CollectionExtract(
                                     ST_MakeValid(geometry), 2
                                 )
                             )).geom
                      FROM ${STAGING_SCHEMA}.trails
                      WHERE ST_IsValid(geometry)
                  ) AS d
                  GROUP BY id
              )
              SELECT id, geom
              FROM cleaned
              WHERE ST_GeometryType(geom) = 'ST_LineString'
              $$,
              $1
            ) st
            JOIN ${STAGING_SCHEMA}.trails t ON st.id = t.id
          WHERE ST_GeometryType(st.geom) = 'ST_LineString'
            AND ST_Length(st.geom::geography) > 0
          ORDER BY st.id, st.sub_id
        `, [toleranceDegrees]);
        
        console.log(`✅ Successfully applied with original tolerance: 2m`);
        
      } catch (error) {
        // If original tolerance fails, try with a much smaller tolerance
        console.log(`⚠️ Original tolerance failed, trying with much smaller tolerance...`);
        const smallerToleranceDegrees = 0.1 / 111320; // 0.1 meter
        
        // First, insert all trails that were split by pgr_separateTouching
        await client.query(`
          INSERT INTO ${STAGING_SCHEMA}.trails_split_results (
            original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags,
            geometry, created_at
          )
          SELECT 
            t.id as original_id,
            st.sub_id,
            t.osm_id,
            t.name,
            t.region,
            t.trail_type,
            t.surface,
            t.difficulty,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.max_elevation,
            t.min_elevation,
            t.avg_elevation,
            t.bbox_min_lng,
            t.bbox_max_lng,
            t.bbox_min_lat,
            t.bbox_max_lat,
            t.source,
            t.source_tags,
            st.geom as geometry,
            NOW() as created_at
          FROM pgr_separateTouching(
            $$
            WITH cleaned AS (
                SELECT id,
                       ST_Force2D(
                           ST_Multi(
                               ST_Union(d.geom)
                           )
                       ) AS geom
                FROM (
                    SELECT id,
                           (ST_Dump(
                               ST_CollectionExtract(
                                   ST_MakeValid(geometry), 2
                               )
                           )).geom
                    FROM ${STAGING_SCHEMA}.trails
                    WHERE ST_IsValid(geometry)
                ) AS d
                GROUP BY id
            )
            SELECT id, geom
            FROM cleaned
            WHERE ST_GeometryType(geom) = 'ST_LineString'
            $$,
            $1
          ) st
          JOIN ${STAGING_SCHEMA}.trails t ON st.id = t.id
          WHERE ST_GeometryType(st.geom) = 'ST_LineString'
            AND ST_Length(st.geom::geography) > 0
          ORDER BY st.id, st.sub_id
        `, [smallerToleranceDegrees]);
        
        console.log(`✅ Successfully applied with smaller tolerance: 1m`);
      }
      
      // Then, insert all trails that were NOT split (preserve unsplit trails)
      await client.query(`
        INSERT INTO ${STAGING_SCHEMA}.trails_split_results (
          original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags,
          geometry, created_at
        )
        SELECT 
          t.id as original_id,
          1 as sub_id,  -- Single segment for unsplit trails
          t.osm_id,
          t.name,
          t.region,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation,
          t.bbox_min_lng,
          t.bbox_max_lng,
          t.bbox_min_lat,
          t.bbox_max_lat,
          t.source,
          t.source_tags,
          t.geometry,
          NOW() as created_at
        FROM ${STAGING_SCHEMA}.trails_backup t
        WHERE t.id NOT IN (
          SELECT DISTINCT original_id 
          FROM ${STAGING_SCHEMA}.trails_split_results
        )
        AND ST_IsValid(t.geometry) 
        AND ST_GeometryType(t.geometry) = 'ST_LineString'
        AND ST_Length(t.geometry::geography) > 0
      `);
      
      console.log(`✅ Preserved unsplit trails`);
      
    } catch (error) {
      console.log(`❌ pgr_separateTouching failed: ${(error as Error).message}`);
    }
    
    // Step 5: Check results
    const resultsCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_split_results`);
    console.log(`\n📊 Results: ${resultsCount.rows[0].count} segments in trails_split_results`);
    
    // Show detailed results
    const resultsDetails = await client.query(`
      SELECT original_id, sub_id, name, ST_Length(geometry::geography) as length_meters,
             ST_NumPoints(geometry) as num_points, ST_IsValid(geometry) as is_valid
      FROM ${STAGING_SCHEMA}.trails_split_results
      ORDER BY original_id, sub_id
    `);
    
    console.log('\n📋 Split results:');
    resultsDetails.rows.forEach(row => {
      console.log(`   Original ID ${row.original_id}, Sub ${row.sub_id}: ${row.name} - ${row.length_meters.toFixed(1)}m (${row.num_points} points, valid: ${row.is_valid})`);
    });
    
    // Export results for visualization
    console.log('\n📤 Exporting results for visualization...');
    await exportResults();
    
  } catch (error) {
    console.error('❌ Error in test:', error);
  } finally {
    // Don't cleanup - keep schema for debugging
    console.log(`🔍 Keeping schema ${STAGING_SCHEMA} for debugging`);
    await client.end();
  }
}

async function exportResults() {
  try {
    const fs = require('fs');
    
    // Get all trails from the temporary results table
    const result = await client.query(`
      SELECT 
        original_id,
        sub_id,
        osm_id,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        length_km,
        ST_AsGeoJSON(ST_Force2D(geometry)) as geometry_json
      FROM ${STAGING_SCHEMA}.trails_split_results
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
      ORDER BY original_id, sub_id
    `);
    
    console.log(`📊 Found ${result.rows.length} trails in results`);
    
    // Create GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row, index) => ({
        type: 'Feature',
        id: index,
        properties: {
          original_id: row.original_id,
          sub_id: row.sub_id,
          osm_id: row.osm_id,
          name: row.name,
          region: row.region,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          is_split: row.sub_id > 1 ? 'Yes' : 'No'
        },
        geometry: JSON.parse(row.geometry_json)
      }))
    };
    
    // Write to file
    const outputFile = 'test-output/intersecting-trails-separate-touching-results.geojson';
    fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported ${result.rows.length} trails to ${outputFile}`);
    
    // Show summary
    const originalTrails = new Set(result.rows.map(r => r.original_id).filter(id => id !== null));
    const splitTrails = result.rows.filter(r => r.sub_id > 1).length;
    const unsplitTrails = result.rows.filter(r => r.sub_id === 1).length;
    
    console.log('\n📋 Summary:');
    console.log(`   - Total segments: ${result.rows.length}`);
    console.log(`   - Original trail IDs: ${originalTrails.size}`);
    console.log(`   - Split segments: ${splitTrails}`);
    console.log(`   - Unsplit trails: ${unsplitTrails}`);
    
  } catch (error) {
    console.error('❌ Error exporting results:', error);
  }
}

// Run the test
testIntersectingTrails().catch(console.error);
