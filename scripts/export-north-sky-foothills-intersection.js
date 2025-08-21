const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function exportNorthSkyFoothillsIntersection() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🗺️ Exporting trails from public.trails intersecting the specified bbox...');
    
    // User's specified bounding box coordinates
    const bboxCoords = [
      [-105.29349960749634, 40.07020761045467],
      [-105.29349960749634, 40.06857704268381],
      [-105.29020136663583, 40.06857704268381],
      [-105.29020136663583, 40.07020761045467],
      [-105.29349960749634, 40.07020761045467]
    ];
    
    // Create a polygon from the bbox coordinates
    const bboxPolygon = `ST_GeomFromText('POLYGON((${bboxCoords.map(coord => coord.join(' ')).join(',')}))', 4326)`;
    
    // Find trails that intersect with the bbox
    const trailsInArea = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsGeoJSON(geometry) as geojson,
        ST_Length(geometry::geography) as length_meters,
        ST_Distance(geometry, ${bboxPolygon}) as distance_to_bbox,
        CASE 
          WHEN LOWER(name) LIKE '%north sky%' THEN 'north_sky'
          WHEN LOWER(name) LIKE '%foothills north%' THEN 'foothills_north'
          ELSE 'other'
        END as trail_category
      FROM public.trails
      WHERE ST_Intersects(geometry, ${bboxPolygon})
      ORDER BY trail_category, name
    `);
    
    console.log(`📊 Found ${trailsInArea.rows.length} trails intersecting the bbox`);
    
    // Create GeoJSON features
    const features = trailsInArea.rows.map(row => ({
      type: 'Feature',
      properties: {
        id: row.app_uuid,
        name: row.name,
        length_meters: parseFloat(row.length_meters),
        distance_to_bbox: parseFloat(row.distance_to_bbox),
        trail_category: row.trail_category,
        // Color coding for visualization
        color: row.trail_category === 'north_sky' ? '#FF0000' : 
               row.trail_category === 'foothills_north' ? '#00FF00' : '#0000FF'
      },
      geometry: JSON.parse(row.geojson)
    }));
    
    // Create GeoJSON collection
    const geojson = {
      type: 'FeatureCollection',
      features: features
    };
    
    // Write to file
    const fs = require('fs');
    const outputPath = 'test-output/north-sky-foothills-bbox-intersection.geojson';
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported ${features.length} trails to ${outputPath}`);
    
    // Show summary by category
    const categoryCounts = {};
    trailsInArea.rows.forEach(row => {
      categoryCounts[row.trail_category] = (categoryCounts[row.trail_category] || 0) + 1;
    });
    
    console.log('📋 Summary by trail category:');
    Object.entries(categoryCounts).forEach(([category, count]) => {
      console.log(`   ${category}: ${count} trails`);
    });
    
    // Show shortest trails (potential connectors)
    const shortTrails = trailsInArea.rows
      .filter(row => parseFloat(row.length_meters) < 10)
      .sort((a, b) => parseFloat(a.length_meters) - parseFloat(b.length_meters));
    
    if (shortTrails.length > 0) {
      console.log('🔗 Short trails (potential connectors):');
      shortTrails.forEach(trail => {
        console.log(`   - ${trail.name} (${trail.trail_category}): ${parseFloat(trail.length_meters).toFixed(2)}m`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error exporting trails:', error);
  } finally {
    await pgClient.release();
    await pool.end();
  }
}

exportNorthSkyFoothillsIntersection();
