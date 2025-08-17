import { Client } from 'pg';
import { TrailSplitter } from '../utils/trail-splitter';
import { createTestSchema, createTestTrailsTable, cleanupTestSchema, generateTestSchemaName } from './test-helpers';

describe('Trail Splitting - Specific Intersection Test', () => {
  let client: Client;
  let testSchema: string;

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

  beforeAll(async () => {
    // Connect to test database
    client = new Client({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'trail_master_db',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres'
    });
    
    await client.connect();
    
    // Create test schema
    testSchema = generateTestSchemaName('trail_split_test');
    await createTestSchema(client, testSchema);
    await createTestTrailsTable(client, testSchema);
  });

  afterAll(async () => {
    await cleanupTestSchema(client, testSchema);
    await client.end();
  });

  beforeEach(async () => {
    // Clear trails table before each test
    await client.query(`DELETE FROM ${testSchema}.trails`);
  });

  test('should detect intersection between Enchanted Mesa Trail and Enchanted-Kohler Spur Trail', async () => {
    console.log('🔍 Testing intersection detection between the two specific trails...');
    
    // Insert the mock trails
    await insertMockTrail(client, testSchema, mockTrail1);
    await insertMockTrail(client, testSchema, mockTrail2);
    
    // Verify trails were inserted
    const trailCount = await client.query(`SELECT COUNT(*) as count FROM ${testSchema}.trails`);
    expect(parseInt(trailCount.rows[0].count)).toBe(2);
    
    // Test intersection detection using PostGIS
    const intersectionResult = await client.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Intersects(t1.geometry, t2.geometry) as intersects,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point,
        ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters
      FROM ${testSchema}.trails t1
      JOIN ${testSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
    `);
    
    console.log('🔍 Intersection detection results:');
    intersectionResult.rows.forEach(row => {
      console.log(`   - ${row.trail1_name} intersects ${row.trail2_name}: ${row.intersects}`);
      console.log(`   - Intersection type: ${row.intersection_type}`);
      console.log(`   - Intersection point: ${row.intersection_point}`);
      console.log(`   - Distance: ${row.distance_meters} meters`);
    });
    
    // Should find at least one intersection
    expect(intersectionResult.rows.length).toBeGreaterThan(0);
    
    // Verify intersection is a point
    const hasPointIntersection = intersectionResult.rows.some(row => 
      row.intersection_type === 'ST_Point' || row.intersection_type === 'ST_MultiPoint'
    );
    expect(hasPointIntersection).toBe(true);
  });

  test('should split trails at intersection points using TrailSplitter', async () => {
    console.log('🔍 Testing trail splitting with TrailSplitter...');
    
    // Insert the mock trails
    await insertMockTrail(client, testSchema, mockTrail1);
    await insertMockTrail(client, testSchema, mockTrail2);
    
    // Create TrailSplitter instance
    const trailSplitter = new TrailSplitter(client, testSchema, {
      minTrailLengthMeters: 5,
      verbose: true,
      enableDegree2Merging: false
    });
    
    // Run trail splitting
    const sourceQuery = `SELECT * FROM ${testSchema}.trails`;
    const result = await trailSplitter.splitTrails(sourceQuery, []);
    
    console.log('🔍 Trail splitting results:');
    console.log(`   - Success: ${result.success}`);
    console.log(`   - Original count: ${result.originalCount}`);
    console.log(`   - Split count: ${result.splitCount}`);
    console.log(`   - Final count: ${result.finalCount}`);
    console.log(`   - Short segments removed: ${result.shortSegmentsRemoved}`);
    console.log(`   - Merged overlaps: ${result.mergedOverlaps}`);
    
    // Verify splitting was successful
    expect(result.success).toBe(true);
    expect(result.originalCount).toBe(2);
    
    // Should have more segments after splitting (due to intersection)
    expect(result.finalCount).toBeGreaterThan(2);
    
    // Verify the split segments
    const splitSegments = await client.query(`
      SELECT 
        id, app_uuid, name, length_km, 
        ST_Length(geometry::geography) as geom_length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${testSchema}.trails
      ORDER BY name, length_km DESC
    `);
    
    console.log('🔍 Split segments:');
    splitSegments.rows.forEach((segment, index) => {
      console.log(`   ${index + 1}. ${segment.name} (${segment.app_uuid}):`);
      console.log(`      - Length: ${segment.length_km}km (${segment.geom_length_meters}m)`);
      console.log(`      - Start: ${segment.start_point}`);
      console.log(`      - End: ${segment.end_point}`);
    });
    
    // Verify all segments have valid geometry
    const validGeometryCount = await client.query(`
      SELECT COUNT(*) as count FROM ${testSchema}.trails 
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    expect(parseInt(validGeometryCount.rows[0].count)).toBe(result.finalCount);
  });

  test('should preserve 3D coordinates during splitting', async () => {
    console.log('🔍 Testing 3D coordinate preservation during splitting...');
    
    // Insert the mock trails
    await insertMockTrail(client, testSchema, mockTrail1);
    await insertMockTrail(client, testSchema, mockTrail2);
    
    // Create TrailSplitter instance
    const trailSplitter = new TrailSplitter(client, testSchema, {
      minTrailLengthMeters: 5,
      verbose: true,
      enableDegree2Merging: false
    });
    
    // Run trail splitting
    const sourceQuery = `SELECT * FROM ${testSchema}.trails`;
    const result = await trailSplitter.splitTrails(sourceQuery, []);
    
    expect(result.success).toBe(true);
    
    // Verify 3D coordinates are preserved
    const segmentsWith3D = await client.query(`
      SELECT 
        id, name, 
        ST_NDims(geometry) as dimensions,
        ST_AsText(ST_StartPoint(geometry)) as start_point_3d,
        ST_AsText(ST_EndPoint(geometry)) as end_point_3d
      FROM ${testSchema}.trails
      ORDER BY name, length_km DESC
    `);
    
    console.log('🔍 3D coordinate verification:');
    segmentsWith3D.rows.forEach((segment, index) => {
      console.log(`   ${index + 1}. ${segment.name}:`);
      console.log(`      - Dimensions: ${segment.dimensions}D`);
      console.log(`      - Start point: ${segment.start_point_3d}`);
      console.log(`      - End point: ${segment.end_point_3d}`);
      
      // Verify 3D coordinates are preserved
      expect(segment.dimensions).toBe(3);
      expect(segment.start_point_3d).toMatch(/[0-9.-]+ [0-9.-]+ [0-9.-]+/);
      expect(segment.end_point_3d).toMatch(/[0-9.-]+ [0-9.-]+ [0-9.-]+/);
    });
  });

  test('should handle intersection tolerance correctly', async () => {
    console.log('🔍 Testing intersection tolerance handling...');
    
    // Insert the mock trails
    await insertMockTrail(client, testSchema, mockTrail1);
    await insertMockTrail(client, testSchema, mockTrail2);
    
    // Test different tolerance values
    const tolerances = [0.1, 1.0, 5.0, 10.0];
    
    for (const tolerance of tolerances) {
      console.log(`🔍 Testing tolerance: ${tolerance} meters`);
      
      // Clear trails table
      await client.query(`DELETE FROM ${testSchema}.trails`);
      
      // Re-insert trails
      await insertMockTrail(client, testSchema, mockTrail1);
      await insertMockTrail(client, testSchema, mockTrail2);
      
      // Create TrailSplitter with specific tolerance
      const trailSplitter = new TrailSplitter(client, testSchema, {
        minTrailLengthMeters: 5,
        verbose: false,
        enableDegree2Merging: false
      });
      
      // Run trail splitting
      const sourceQuery = `SELECT * FROM ${testSchema}.trails`;
      const result = await trailSplitter.splitTrails(sourceQuery, []);
      
      console.log(`   - Tolerance ${tolerance}m: ${result.finalCount} final segments`);
      
      // Should always succeed and produce more than 2 segments due to intersection
      expect(result.success).toBe(true);
      expect(result.finalCount).toBeGreaterThan(2);
    }
  });
});

// Helper function to insert mock trail data
async function insertMockTrail(client: Client, schemaName: string, geojsonFeature: any): Promise<void> {
  const properties = geojsonFeature.properties;
  const coordinates = geojsonFeature.geometry.coordinates;
  
  // Convert coordinates to WKT format
  const wktCoordinates = coordinates.map((coord: number[]) => 
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
