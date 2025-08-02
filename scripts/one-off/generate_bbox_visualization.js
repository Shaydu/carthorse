const { Client } = require('pg');
const fs = require('fs');

async function generateBboxVisualization() {
  const client = new Client({
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const stagingSchema = 'staging_boulder_1754082558091';

    // Generate GeoJSON for nodes (red points)
    console.log('Generating nodes GeoJSON...');
    const nodesResult = await client.query(`
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', json_build_object(
                'type', 'Point',
                'coordinates', ARRAY[lng, lat]
              ),
              'properties', json_build_object(
                'id', id,
                'node_uuid', node_uuid,
                'elevation', elevation,
                'node_type', node_type,
                'connected_trails', connected_trails,
                'color', '#FF0000',
                'feature_type', 'node'
              )
            )
          )
        ) as geojson
      FROM ${stagingSchema}.routing_nodes
    `);

    // Generate GeoJSON for edges (blue lines)
    console.log('Generating edges GeoJSON...');
    const edgesResult = await client.query(`
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', json_build_object(
                'type', 'LineString',
                'coordinates', ST_AsGeoJSON(geometry)::json->'coordinates'
              ),
              'properties', json_build_object(
                'source', source,
                'target', target,
                'trail_id', trail_id,
                'trail_name', trail_name,
                'distance_km', distance_km,
                'elevation_gain', elevation_gain,
                'elevation_loss', elevation_loss,
                'color', '#0000FF',
                'feature_type', 'edge'
              )
            )
          )
        ) as geojson
      FROM ${stagingSchema}.routing_edges
    `);

    // Generate GeoJSON for trails (green lines)
    console.log('Generating trails GeoJSON...');
    const trailsResult = await client.query(`
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', json_build_object(
                'type', 'LineString',
                'coordinates', ST_AsGeoJSON(geometry)::json->'coordinates'
              ),
              'properties', json_build_object(
                'app_uuid', app_uuid,
                'name', name,
                'length_km', length_km,
                'elevation_gain', elevation_gain,
                'elevation_loss', elevation_loss,
                'color', '#00FF00',
                'feature_type', 'trail'
              )
            )
          )
        ) as geojson
      FROM ${stagingSchema}.trails
    `);

    // Combine all features into one GeoJSON
    const nodesFeatures = nodesResult.rows[0].geojson.features || [];
    const edgesFeatures = edgesResult.rows[0].geojson.features || [];
    const trailsFeatures = trailsResult.rows[0].geojson.features || [];

    const combinedGeoJSON = {
      type: 'FeatureCollection',
      features: [
        ...nodesFeatures,
        ...edgesFeatures,
        ...trailsFeatures
      ]
    };

    // Write to file
    const filename = 'bbox_visualization.json';
    fs.writeFileSync(filename, JSON.stringify(combinedGeoJSON, null, 2));
    
    console.log(`✅ Generated ${filename}`);
    console.log(`📊 Summary:`);
    console.log(`   - Nodes (red): ${nodesFeatures.length}`);
    console.log(`   - Edges (blue): ${edgesFeatures.length}`);
    console.log(`   - Trails (green): ${trailsFeatures.length}`);
    console.log(`   - Total features: ${combinedGeoJSON.features.length}`);

    // Get bbox info
    const bboxResult = await client.query(`
      SELECT 
        ST_XMin(ST_Collect(geometry)) as min_lng,
        ST_YMin(ST_Collect(geometry)) as min_lat,
        ST_XMax(ST_Collect(geometry)) as max_lng,
        ST_YMax(ST_Collect(geometry)) as max_lat
      FROM ${stagingSchema}.trails
    `);

    if (bboxResult.rows[0]) {
      const bbox = bboxResult.rows[0];
      console.log(`🗺️  BBOX: [${bbox.min_lng}, ${bbox.min_lat}, ${bbox.max_lng}, ${bbox.max_lat}]`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

generateBboxVisualization(); 