#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');

// Configuration
const config = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu',
  stagingSchema: 'carthorse_1755735378966'
};

async function exportConsolidatedHogback() {
  const client = new Pool(config);
  
  try {
    await client.connect();
    console.log('📤 Exporting consolidated Hogback trails...');

    // Step 1: Create a consolidated export query
    const consolidatedQuery = `
      WITH consolidated_hogback AS (
        -- Consolidate all Hogback segments into a single trail
        SELECT 
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
          'consolidated' as source
        FROM ${config.stagingSchema}.trails 
        WHERE name LIKE '%Hogback Ridge Trail%'
      ),
      simplified_hogback AS (
        -- Create a simplified split version (only at major intersections)
        SELECT 
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
          'simplified_split' as source
        FROM (
          SELECT 
            (ST_Dump(ST_Split(consolidated.geometry, ST_Collect(intersection_point)))).geom as segment_geometry,
            generate_series(1, ST_NumGeometries(ST_Split(consolidated.geometry, ST_Collect(intersection_point)))) as segment_index
          FROM consolidated_hogback consolidated
          CROSS JOIN (
            SELECT 
              ST_Intersection(consolidated.geometry, t.geometry) as intersection_point
            FROM ${config.stagingSchema}.trails t
            WHERE t.name NOT LIKE '%Hogback%'
              AND ST_Intersects(consolidated.geometry, t.geometry)
              AND ST_GeometryType(ST_Intersection(consolidated.geometry, t.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t.geometry::geography) > 100  -- Only major trails (>100m)
          ) intersections
        ) segments
        WHERE ST_GeometryType(segment_geometry) = 'ST_LineString'
          AND ST_Length(segment_geometry::geography) > 50  -- Only segments >50m
      ),
      all_trails AS (
        -- Get all non-Hogback trails
        SELECT 
          name,
          region,
          trail_type,
          surface,
          difficulty,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          geometry,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          'original' as source
        FROM ${config.stagingSchema}.trails 
        WHERE name NOT LIKE '%Hogback%'
        
        UNION ALL
        
        -- Add consolidated Hogback
        SELECT 
          name,
          region,
          trail_type,
          surface,
          difficulty,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          geometry,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          source
        FROM consolidated_hogback
        
        UNION ALL
        
        -- Add simplified split Hogback
        SELECT 
          name,
          region,
          trail_type,
          surface,
          difficulty,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          geometry,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          source
        FROM simplified_hogback
      )
      SELECT 
        gen_random_uuid() as app_uuid,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        geometry,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        source,
        NOW() as created_at,
        NOW() as updated_at
      FROM all_trails
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND length_km > 0
    `;

    // Step 2: Execute the query and get results
    console.log('🔄 Generating consolidated trails...');
    const result = await client.query(consolidatedQuery);
    
    console.log(`✅ Generated ${result.rows.length} trails`);

    // Step 3: Create GeoJSON export
    console.log('📄 Creating GeoJSON export...');
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map(row => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: JSON.parse(row.geometry.coordinates || '[]')
        },
        properties: {
          app_uuid: row.app_uuid,
          name: row.name,
          region: row.region,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          elevation_gain: row.elevation_gain,
          elevation_loss: row.elevation_loss,
          max_elevation: row.max_elevation,
          min_elevation: row.min_elevation,
          avg_elevation: row.avg_elevation,
          bbox_min_lng: row.bbox_min_lng,
          bbox_max_lng: row.bbox_max_lng,
          bbox_min_lat: row.bbox_min_lat,
          bbox_max_lat: row.bbox_max_lat,
          source: row.source,
          created_at: row.created_at,
          updated_at: row.updated_at
        }
      }))
    };

    // Step 4: Write to file
    const outputPath = 'test-output/boulder-consolidated-hogback-trails.geojson';
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported to ${outputPath}`);

    // Step 5: Show summary
    console.log('\n📊 Export summary:');
    const summary = await client.query(`
      SELECT 
        source,
        COUNT(*) as trail_count,
        SUM(length_km) as total_length_km,
        AVG(length_km) as avg_length_km
      FROM (${consolidatedQuery}) as consolidated
      GROUP BY source
      ORDER BY source
    `);

    console.log('Trail breakdown:');
    summary.rows.forEach(row => {
      console.log(`  - ${row.source}: ${row.trail_count} trails, ${row.total_length_km.toFixed(2)}km total, ${row.avg_length_km.toFixed(2)}km avg`);
    });

    // Step 6: Show Hogback-specific info
    console.log('\n🛤️ Hogback trails in export:');
    const hogbackTrails = result.rows.filter(row => row.name.includes('Hogback'));
    hogbackTrails.forEach((trail, i) => {
      console.log(`  ${i + 1}. ${trail.name}: ${trail.length_km.toFixed(2)}km (${trail.source})`);
    });

    console.log('\n✅ Consolidated Hogback export complete!');

  } catch (error) {
    console.error('❌ Error exporting consolidated Hogback:', error);
  } finally {
    await client.end();
  }
}

// Run the export
exportConsolidatedHogback().catch(console.error);
