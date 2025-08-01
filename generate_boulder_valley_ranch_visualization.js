const { Client } = require('pg');
const fs = require('fs');

async function generateBoulderValleyRanchVisualization() {
  const client = new Client({
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const stagingSchema = 'staging_boulder_1754082558091';
    
    // Boulder Valley Ranch bbox coordinates
    const bbox = {
      minLng: -105.28122955793897,
      maxLng: -105.23604178494656,
      minLat: 40.068313334562816,
      maxLat: 40.098317098641445
    };

    console.log('Filtering to Boulder Valley Ranch bbox:', bbox);

    // Generate GeoJSON for nodes (red points) within bbox
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
      WHERE lng BETWEEN $1 AND $2 
      AND lat BETWEEN $3 AND $4
    `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat]);

    // Generate GeoJSON for edges (blue lines) within bbox
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
      WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $3, $2, $4, 4326))
    `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat]);

    // Generate GeoJSON for trails (green lines) within bbox
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
      WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $3, $2, $4, 4326))
    `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat]);

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
    const filename = 'boulder_valley_ranch_visualization.json';
    fs.writeFileSync(filename, JSON.stringify(combinedGeoJSON, null, 2));
    
    console.log(`✅ Generated ${filename}`);
    console.log(`📊 Boulder Valley Ranch Summary:`);
    console.log(`   - Nodes (red): ${nodesFeatures.length}`);
    console.log(`   - Edges (blue): ${edgesFeatures.length}`);
    console.log(`   - Trails (green): ${trailsFeatures.length}`);
    console.log(`   - Total features: ${combinedGeoJSON.features.length}`);
    console.log(`🗺️  BBOX: [${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}]`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

generateBoulderValleyRanchVisualization(); 