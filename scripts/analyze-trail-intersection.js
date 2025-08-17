#!/usr/bin/env node

const { Client } = require('pg');

// Mock trail data from the user's request
const mockTrail1 = {
  "type": "Feature",
  "properties": {
    "id": "981e650b-7550-40ad-91c6-eeafe6331218",
    "name": "Enchanted Mesa Trail",
    "region": "boulder",
    "source_identifier": "981e650b-7550-40ad-91c6-eeafe6331218",
    "trail_type": "Trail",
    "surface_type": "dirt",
    "difficulty": "yes",
    "length_km": 1.5468119218245782,
    "elevation_gain": 119.36,
    "elevation_loss": 0,
    "max_elevation": 1878.07,
    "min_elevation": 1758.71,
    "avg_elevation": 1814.44,
    "bbox_min_lng": -105.285645475611,
    "bbox_max_lng": -105.278140217597,
    "bbox_min_lat": 39.9875739690295,
    "bbox_max_lat": 39.9957024166702,
    "type": "trail",
    "color": "#228B22",
    "stroke": "#228B22",
    "strokeWidth": 2,
    "fillOpacity": 0.6
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-105.281535, 39.994968, 0],
      [-105.281456, 39.995011, 0],
      [-105.281023, 39.995156, 0],
      [-105.280708, 39.995391, 0],
      [-105.280509, 39.995473, 0],
      [-105.280275, 39.995528, 0],
      [-105.279584, 39.995565, 0],
      [-105.278753, 39.995702, 0],
      [-105.278612, 39.995676, 0],
      [-105.278518, 39.995622, 0],
      [-105.278271, 39.995352, 0],
      [-105.278141, 39.995028, 0],
      [-105.27814, 39.994929, 0],
      [-105.278187, 39.99483, 0],
      [-105.27828, 39.994712, 0],
      [-105.279016, 39.99417, 0],
      [-105.279261, 39.993935, 0],
      [-105.279669, 39.993628, 0],
      [-105.280313, 39.993329, 0],
      [-105.280663, 39.993193, 0],
      [-105.281049, 39.993075, 0],
      [-105.281119, 39.993012, 0],
      [-105.281457, 39.992488, 0],
      [-105.281655, 39.992263, 0],
      [-105.281667, 39.9922, 0],
      [-105.28169, 39.992181, 0],
      [-105.281689, 39.991884, 0],
      [-105.281757, 39.991298, 0],
      [-105.281707, 39.990596, 0],
      [-105.281718, 39.990524, 0],
      [-105.281788, 39.990406, 0],
      [-105.281764, 39.990253, 0],
      [-105.281869, 39.990127, 0],
      [-105.281881, 39.990082, 0],
      [-105.281891, 39.989856, 0],
      [-105.281855, 39.989622, 0],
      [-105.28189, 39.989505, 0],
      [-105.28203, 39.989352, 0],
      [-105.282087, 39.989054, 0],
      [-105.282168, 39.988793, 0],
      [-105.282261, 39.988675, 0],
      [-105.282331, 39.988621, 0],
      [-105.282396, 39.988596, 0],
      [-105.282425, 39.988585, 0],
      [-105.282647, 39.98853, 0],
      [-105.282858, 39.988503, 0],
      [-105.283104, 39.988502, 0],
      [-105.283385, 39.988456, 0],
      [-105.283595, 39.988303, 0],
      [-105.284156, 39.988049, 0],
      [-105.284332, 39.98794, 0],
      [-105.28439, 39.987859, 0],
      [-105.284448, 39.987715, 0],
      [-105.284494, 39.987661, 0],
      [-105.284623, 39.987597, 0],
      [-105.284717, 39.987579, 0],
      [-105.285361, 39.987596, 0],
      [-105.285645, 39.987574, 0]
    ]
  }
};

const mockTrail2 = {
  "type": "Feature",
  "properties": {
    "id": "dc70e7d2-980b-4650-bfc5-9a82da4b7870",
    "name": "Enchanted-Kohler Spur Trail",
    "region": "boulder",
    "source_identifier": "dc70e7d2-980b-4650-bfc5-9a82da4b7870",
    "trail_type": "Trail",
    "surface_type": "dirt",
    "difficulty": "yes",
    "length_km": 0.24676314805711302,
    "elevation_gain": 13.59,
    "elevation_loss": 5.08,
    "max_elevation": 1836.24,
    "min_elevation": 1827.7,
    "avg_elevation": 1831.79,
    "bbox_min_lng": -105.282386771794,
    "bbox_max_lng": -105.280213207035,
    "bbox_min_lat": 39.9878360082293,
    "bbox_max_lat": 39.988580539265,
    "type": "trail",
    "color": "#228B22",
    "stroke": "#228B22",
    "strokeWidth": 2,
    "fillOpacity": 0.6
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-105.280213, 39.987924, 0],
      [-105.28033, 39.987927, 0],
      [-105.280452, 39.987899, 0],
      [-105.280589, 39.987885, 0],
      [-105.280674, 39.987892, 0],
      [-105.280816, 39.987867, 0],
      [-105.280881, 39.987874, 0],
      [-105.281039, 39.987855, 0],
      [-105.281202, 39.987849, 0],
      [-105.281358, 39.987886, 0],
      [-105.281479, 39.987875, 0],
      [-105.281601, 39.987875, 0],
      [-105.281648, 39.987865, 0],
      [-105.281702, 39.987842, 0],
      [-105.281749, 39.987836, 0],
      [-105.281859, 39.98784, 0],
      [-105.281927, 39.987858, 0],
      [-105.282005, 39.987866, 0],
      [-105.282025, 39.987875, 0],
      [-105.282037, 39.987898, 0],
      [-105.28206, 39.987993, 0],
      [-105.282056, 39.988036, 0],
      [-105.282078, 39.988102, 0],
      [-105.282084, 39.988191, 0],
      [-105.282109, 39.988239, 0],
      [-105.282114, 39.988305, 0],
      [-105.282124, 39.988335, 0],
      [-105.282185, 39.988407, 0],
      [-105.282257, 39.988433, 0],
      [-105.282313, 39.98847, 0],
      [-105.282387, 39.988581, 0]
    ]
  }
};

async function analyzeIntersection() {
  let client;
  
  try {
    console.log('🔍 Analyzing intersection between Enchanted Mesa Trail and Enchanted-Kohler Spur Trail...');
    
    // Connect to database
    client = new Client({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'trail_master_db',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres'
    });
    
    await client.connect();
    console.log('✅ Connected to database');
    
    // Convert coordinates to WKT format
    function coordinatesToWKT(coordinates) {
      const wktCoordinates = coordinates.map(coord => 
        `${coord[0]} ${coord[1]} ${coord[2] || 0}`
      ).join(', ');
      return `LINESTRINGZ(${wktCoordinates})`;
    }
    
    const wkt1 = coordinatesToWKT(mockTrail1.geometry.coordinates);
    const wkt2 = coordinatesToWKT(mockTrail2.geometry.coordinates);
    
    console.log('\n📊 Trail 1 (Enchanted Mesa Trail):');
    console.log(`   - Name: ${mockTrail1.properties.name}`);
    console.log(`   - Length: ${mockTrail1.properties.length_km}km`);
    console.log(`   - Coordinates: ${mockTrail1.geometry.coordinates.length} points`);
    console.log(`   - Start: [${mockTrail1.geometry.coordinates[0][0]}, ${mockTrail1.geometry.coordinates[0][1]}]`);
    console.log(`   - End: [${mockTrail1.geometry.coordinates[mockTrail1.geometry.coordinates.length-1][0]}, ${mockTrail1.geometry.coordinates[mockTrail1.geometry.coordinates.length-1][1]}]`);
    
    console.log('\n📊 Trail 2 (Enchanted-Kohler Spur Trail):');
    console.log(`   - Name: ${mockTrail2.properties.name}`);
    console.log(`   - Length: ${mockTrail2.properties.length_km}km`);
    console.log(`   - Coordinates: ${mockTrail2.geometry.coordinates.length} points`);
    console.log(`   - Start: [${mockTrail2.geometry.coordinates[0][0]}, ${mockTrail2.geometry.coordinates[0][1]}]`);
    console.log(`   - End: [${mockTrail2.geometry.coordinates[mockTrail2.geometry.coordinates.length-1][0]}, ${mockTrail2.geometry.coordinates[mockTrail2.geometry.coordinates.length-1][1]}]`);
    
    // Test intersection detection
    console.log('\n🔍 Testing intersection detection...');
    
    const intersectionQuery = `
      SELECT 
        ST_Intersects(ST_GeomFromText($1, 4326), ST_GeomFromText($2, 4326)) as intersects,
        ST_GeometryType(ST_Intersection(ST_GeomFromText($1, 4326), ST_GeomFromText($2, 4326))) as intersection_type,
        ST_AsText(ST_Intersection(ST_GeomFromText($1, 4326), ST_GeomFromText($2, 4326))) as intersection_point,
        ST_Distance(ST_GeomFromText($1, 4326)::geography, ST_GeomFromText($2, 4326)::geography) as distance_meters,
        ST_Length(ST_GeomFromText($1, 4326)::geography) as length1_meters,
        ST_Length(ST_GeomFromText($2, 4326)::geography) as length2_meters
    `;
    
    const result = await client.query(intersectionQuery, [wkt1, wkt2]);
    const row = result.rows[0];
    
    console.log('\n📊 Intersection Analysis Results:');
    console.log(`   - Intersects: ${row.intersects}`);
    console.log(`   - Intersection type: ${row.intersection_type}`);
    console.log(`   - Intersection point: ${row.intersection_point}`);
    console.log(`   - Distance between trails: ${row.distance_meters} meters`);
    console.log(`   - Trail 1 length: ${row.length1_meters} meters`);
    console.log(`   - Trail 2 length: ${row.length2_meters} meters`);
    
    if (row.intersects) {
      console.log('\n✅ Trails intersect! This should trigger splitting.');
      
      // Test ST_Node functionality
      console.log('\n🔧 Testing ST_Node functionality...');
      const nodeQuery = `
        SELECT 
          ST_AsText((ST_Dump(ST_Node(ST_Collect(ST_GeomFromText($1, 4326), ST_GeomFromText($2, 4326))))).geom) as noded_geometry,
          (ST_Dump(ST_Node(ST_Collect(ST_GeomFromText($1, 4326), ST_GeomFromText($2, 4326))))).path as path
        FROM (SELECT 1) as dummy
        LIMIT 10
      `;
      
      const nodeResult = await client.query(nodeQuery, [wkt1, wkt2]);
      console.log(`   - ST_Node produced ${nodeResult.rows.length} segments`);
      
      nodeResult.rows.forEach((segment, index) => {
        console.log(`   - Segment ${index + 1}: ${segment.noded_geometry}`);
      });
      
    } else {
      console.log('\n❌ Trails do not intersect! This might be the problem.');
      console.log('   - The trails might be too far apart or have precision issues.');
      console.log(`   - Distance: ${row.distance_meters} meters`);
      
      // Test with different tolerances
      console.log('\n🔧 Testing with different tolerances...');
      const tolerances = [0.1, 1.0, 5.0, 10.0, 50.0];
      
      for (const tolerance of tolerances) {
        const toleranceQuery = `
          SELECT 
            ST_DWithin(ST_GeomFromText($1, 4326)::geography, ST_GeomFromText($2, 4326)::geography, $3) as within_tolerance
        `;
        
        const toleranceResult = await client.query(toleranceQuery, [wkt1, wkt2, tolerance]);
        console.log(`   - Tolerance ${tolerance}m: ${toleranceResult.rows[0].within_tolerance ? 'YES' : 'NO'}`);
      }
    }
    
    // Test individual trail properties
    console.log('\n🔍 Testing individual trail properties...');
    const trail1Query = `
      SELECT 
        ST_IsValid(ST_GeomFromText($1, 4326)) as is_valid,
        ST_GeometryType(ST_GeomFromText($1, 4326)) as geometry_type,
        ST_NDims(ST_GeomFromText($1, 4326)) as dimensions,
        ST_NumPoints(ST_GeomFromText($1, 4326)) as num_points
    `;
    
    const trail1Result = await client.query(trail1Query, [wkt1]);
    const trail2Result = await client.query(trail1Query, [wkt2]);
    
    console.log('\n📊 Trail 1 Properties:');
    console.log(`   - Valid: ${trail1Result.rows[0].is_valid}`);
    console.log(`   - Type: ${trail1Result.rows[0].geometry_type}`);
    console.log(`   - Dimensions: ${trail1Result.rows[0].dimensions}D`);
    console.log(`   - Points: ${trail1Result.rows[0].num_points}`);
    
    console.log('\n📊 Trail 2 Properties:');
    console.log(`   - Valid: ${trail2Result.rows[0].is_valid}`);
    console.log(`   - Type: ${trail2Result.rows[0].geometry_type}`);
    console.log(`   - Dimensions: ${trail2Result.rows[0].dimensions}D`);
    console.log(`   - Points: ${trail2Result.rows[0].num_points}`);
    
    console.log('\n✅ Intersection analysis completed!');
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

// Run the analysis if this script is executed directly
if (require.main === module) {
  analyzeIntersection().catch(console.error);
}

module.exports = { analyzeIntersection };
