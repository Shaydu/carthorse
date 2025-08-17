#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config();

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

async function createTestSchema(client, schemaName) {
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    console.log(`✅ Created test schema: ${schemaName}`);
  } catch (error) {
    console.log(`⚠️  Failed to create schema ${schemaName}: ${error.message}`);
  }
}

async function createTestTrailsTable(client, schemaName) {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.trails (
        id SERIAL PRIMARY KEY,
        original_trail_id INTEGER,
        original_trail_uuid TEXT,
        segment_number INTEGER,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        osm_id TEXT,
        elevation_gain REAL CHECK(elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss >= 0),
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        length_km REAL CHECK(length_km > 0),
        source TEXT,
        source_tags JSONB,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        region TEXT DEFAULT 'boulder'
      )
    `);
    console.log(`✅ Created trails table in schema: ${schemaName}`);
  } catch (error) {
    console.log(`⚠️  Failed to create trails table in ${schemaName}: ${error.message}`);
  }
}

async function insertMockTrail(client, schemaName, geojsonFeature) {
  const properties = geojsonFeature.properties;
  const coordinates = geojsonFeature.geometry.coordinates;
  
  // Convert coordinates to WKT format
  const wktCoordinates = coordinates.map(coord => 
    `${coord[0]} ${coord[1]} ${coord[2] || 0}`
  ).join(', ');
  
  const wktGeometry = `LINESTRINGZ(${wktCoordinates})`;
  
  const query = `
    INSERT INTO ${schemaName}.trails (
      app_uuid, name, region, trail_type, surface, difficulty,
      elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      length_km, geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ST_GeomFromText($13, 4326), $14, $15, $16, $17)
  `;
  
  await client.query(query, [
    properties.id,
    properties.name,
    properties.region,
    properties.trail_type,
    properties.surface_type,
    properties.difficulty,
    properties.elevation_gain,
    properties.elevation_loss,
    properties.max_elevation,
    properties.min_elevation,
    properties.avg_elevation,
    properties.length_km,
    wktGeometry,
    properties.bbox_min_lng,
    properties.bbox_max_lng,
    properties.bbox_min_lat,
    properties.bbox_max_lat
  ]);
  
  console.log(`✅ Inserted mock trail: ${properties.name}`);
}

async function cleanupTestSchema(client, schemaName) {
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    console.log(`✅ Cleaned up test schema: ${schemaName}`);
  } catch (error) {
    console.log(`⚠️  Failed to cleanup schema ${schemaName}: ${error.message}`);
  }
}

function generateTestSchemaName(prefix = 'test') {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}_${randomSuffix}`;
}

async function debugIntersectionAnalysis() {
  let client;
  let testSchema;
  
  try {
    console.log('🔍 Debugging intersection analysis...');
    
    // Connect to database
    client = new Client({
      host: process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.PGPORT || process.env.POSTGRES_PORT || '5432'),
      database: 'trail_master_db',
      user: process.env.PGUSER || process.env.POSTGRES_USER || 'carthorse',
      password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'carthorse'
    });
    
    await client.connect();
    console.log('✅ Connected to database');
    
    // Create test schema
    testSchema = generateTestSchemaName('debug_intersection');
    await createTestSchema(client, testSchema);
    await createTestTrailsTable(client, testSchema);
    
    // Insert mock trails
    console.log('\n📝 Inserting mock trails...');
    await insertMockTrail(client, testSchema, mockTrail1);
    await insertMockTrail(client, testSchema, mockTrail2);
    
    // Analyze trail endpoints
    console.log('\n📍 Analyzing trail endpoints...');
    const endpoints = await client.query(`
      SELECT 
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry) as length_meters
      FROM ${testSchema}.trails
      ORDER BY name
    `);
    
    console.log('\nTrail Endpoints:');
    endpoints.rows.forEach(row => {
      console.log(`  ${row.name}:`);
      console.log(`    Start: ${row.start_point}`);
      console.log(`    End: ${row.end_point}`);
      console.log(`    Length: ${row.length_meters.toFixed(2)} meters`);
    });
    
    // Check for intersections
    console.log('\n🔍 Checking for intersections...');
    const intersections = await client.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_Distance(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry)) as start_to_start_distance,
        ST_Distance(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry)) as start_to_end_distance,
        ST_Distance(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry)) as end_to_start_distance,
        ST_Distance(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry)) as end_to_end_distance
      FROM ${testSchema}.trails t1
      JOIN ${testSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
    `);
    
    if (intersections.rows.length > 0) {
      console.log('\nIntersections found:');
      intersections.rows.forEach(row => {
        console.log(`  ${row.trail1_name} <-> ${row.trail2_name}:`);
        console.log(`    Intersection: ${row.intersection_point}`);
        console.log(`    Type: ${row.intersection_type}`);
        console.log(`    Distances:`);
        console.log(`      Start1 to Start2: ${row.start_to_start_distance.toFixed(6)}`);
        console.log(`      Start1 to End2: ${row.start_to_end_distance.toFixed(6)}`);
        console.log(`      End1 to Start2: ${row.end_to_start_distance.toFixed(6)}`);
        console.log(`      End1 to End2: ${row.end_to_end_distance.toFixed(6)}`);
      });
    } else {
      console.log('\n❌ No intersections found!');
    }
    
    // Check for near misses with different tolerances
    console.log('\n🔍 Checking for near misses...');
    const tolerances = [0.1, 0.5, 1.0, 5.0, 10.0]; // meters
    
    for (const tolerance of tolerances) {
      const nearMisses = await client.query(`
        SELECT 
          t1.name as trail1_name,
          t2.name as trail2_name,
          ST_Distance(t1.geometry, t2.geometry) as distance_meters,
          ST_AsText(ST_ClosestPoint(t1.geometry, t2.geometry)) as closest_point_on_t1,
          ST_AsText(ST_ClosestPoint(t2.geometry, t1.geometry)) as closest_point_on_t2
        FROM ${testSchema}.trails t1
        JOIN ${testSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_DWithin(t1.geometry, t2.geometry, $1)
        ORDER BY ST_Distance(t1.geometry, t2.geometry)
      `, [tolerance]);
      
      if (nearMisses.rows.length > 0) {
        console.log(`\nNear misses within ${tolerance}m tolerance:`);
        nearMisses.rows.forEach(row => {
          console.log(`  ${row.trail1_name} <-> ${row.trail2_name}:`);
          console.log(`    Distance: ${row.distance_meters.toFixed(6)} meters`);
          console.log(`    Closest on ${row.trail1_name}: ${row.closest_point_on_t1}`);
          console.log(`    Closest on ${row.trail2_name}: ${row.closest_point_on_t2}`);
        });
      }
    }
    
    // Test the improved splitting function with different tolerances
    console.log('\n🔧 Testing improved splitting with different tolerances...');
    for (const tolerance of [0.1, 0.5, 1.0, 5.0]) {
      console.log(`\nTesting with tolerance: ${tolerance}m`);
      
      const result = await client.query(`
        SELECT * FROM improved_trail_splitting_simple($1, $2)
      `, [testSchema, tolerance]);
      
      const splitResult = result.rows[0];
      console.log(`  Original: ${splitResult.original_count}, Split: ${splitResult.split_count}`);
      
      // Check the split segments
      const splitSegments = await client.query(`
        SELECT 
          original_trail_uuid,
          name,
          ST_Length(geometry) as length_meters,
          ST_NumPoints(geometry) as num_points
        FROM ${testSchema}.trails
        WHERE original_trail_uuid IS NOT NULL
        ORDER BY original_trail_uuid, length_meters DESC
      `);
      
      console.log(`  Split segments:`);
      splitSegments.rows.forEach(row => {
        console.log(`    ${row.name}: ${row.length_meters.toFixed(2)}m (${row.num_points} points)`);
      });
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    if (client) {
      if (testSchema) {
        await cleanupTestSchema(client, testSchema);
      }
      await client.end();
    }
  }
}

// Run the debug if this script is executed directly
if (require.main === module) {
  debugIntersectionAnalysis().catch(console.error);
}

module.exports = { debugIntersectionAnalysis };

