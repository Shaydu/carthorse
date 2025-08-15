import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function testConsolidatedIntersectionDetection() {
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: process.env.PGDATABASE || 'trail_master_db_test',
  });

  try {
    console.log('🧪 Testing consolidated intersection detection...');
    
    // Create a test staging schema
    const testSchema = `test_intersection_${Date.now()}`;
    console.log(`📁 Using test schema: ${testSchema}`);
    
    // Create staging environment
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Create trails table
    await pgClient.query(`
      CREATE TABLE ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
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
    
    // Create spatial index
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${testSchema}_trails_geom ON ${testSchema}.trails USING GIST(geometry)`);
    
    // Insert NCAR Trail
    await pgClient.query(`
      INSERT INTO ${testSchema}.trails (
        app_uuid, name, trail_type, surface, difficulty, geometry, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source
      ) VALUES (
        '60145864-ab31-42d8-8278-c33758971c62',
        'NCAR Trail',
        'Trail',
        'dirt',
        'yes',
        ST_GeomFromText('LINESTRINGZ(-105.282685 39.977781 1906.789917, -105.282263 39.977701 1908.59314, -105.282111 39.977648 1904.772583, -105.28204 39.977684 1904.772583, -105.281888 39.977657 1905.878052, -105.281524 39.977478 1909.56897, -105.281384 39.977433 1909.808716, -105.281091 39.977452 1907.965088, -105.281009 39.977497 1906.440186, -105.280576 39.977489 1899.100586, -105.280553 39.977579 1893.661255, -105.280588 39.977642 1893.661255, -105.280565 39.977732 1891.204346, -105.280577 39.977877 1886.838257, -105.28053 39.977877 1882.651245, -105.280472 39.977796 1884.990845, -105.280448 39.977823 1881.362549, -105.280484 39.978003 1881.096924, -105.280485 39.978165 1877.971313, -105.28045 39.978174 1877.971313, -105.280297 39.977949 1875.174805, -105.28005 39.977806 1869.715698, -105.279698 39.977726 1867.943359, -105.279546 39.977636 1868.482788, -105.279369 39.977393 1869.390381, -105.279052 39.977141 1873.847778, -105.278935 39.977115 1870.749268, -105.278724 39.977133 1876.052002, -105.278513 39.977116 1873.077881, -105.278408 39.977134 1877.102905, -105.278373 39.977161 1877.102905, -105.278572 39.977251 1882.291504, -105.278338 39.97735 1883.835205, -105.27821 39.977432 1883.185913)', 4326),
        0.5969164296533255,
        31.14,
        54.75,
        1909.81,
        1867.94,
        1887.15,
        'boulder',
        -105.282684,
        -105.27821,
        39.977116,
        39.978176,
        'cotrex'
      )
    `);
    
    // Insert NCAR Water Tank Road
    await pgClient.query(`
      INSERT INTO ${testSchema}.trails (
        app_uuid, name, trail_type, surface, difficulty, geometry, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source
      ) VALUES (
        'df6ad642-ba4e-4a0c-8952-648d9dcefe4d',
        'NCAR Water Tank Road',
        'Trail',
        'dirt',
        'yes',
        ST_GeomFromText('LINESTRINGZ(-105.280379 39.981349 1835.410522, -105.280638 39.981354 1837.654907, -105.280767 39.981318 1839.55188, -105.280802 39.981264 1839.55188, -105.280825 39.981165 1840.155029, -105.280812 39.98075 1846.274292, -105.28103 39.97984 1866.053345, -105.280993 39.979236 1874.661621, -105.281027 39.978966 1881.507446, -105.281014 39.978822 1880.745605, -105.280932 39.978588 1886.840332, -105.280884 39.978353 1888.782959, -105.280835 39.977912 1897.328735, -105.280846 39.977606 1902.492432, -105.280857 39.97757 1903.932007, -105.280962 39.977496 1906.440186)', 4326),
        0.47285948171047376,
        71.79,
        0.76,
        1906.44,
        1835.41,
        1870.46,
        'boulder',
        -105.28103,
        -105.28038,
        39.977497,
        39.981354,
        'cotrex'
      )
    `);
    
    console.log('✅ Test trails inserted');
    
    // Test intersection detection
    console.log('🔍 Testing intersection detection...');
    
    const intersectionQuery = `
      WITH trail_pairs AS (
        SELECT 
          t1.id as trail1_id, t1.app_uuid as trail1_uuid, t1.name as trail1_name, t1.geometry as trail1_geom,
          t2.id as trail2_id, t2.app_uuid as trail2_uuid, t2.name as trail2_name, t2.geometry as trail2_geom
        FROM ${testSchema}.trails t1
        JOIN ${testSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
      ),
      true_intersections AS (
        SELECT 
          ST_Intersection(tp.trail1_geom, tp.trail2_geom) as intersection_point,
          ST_Force3D(ST_Intersection(tp.trail1_geom, tp.trail2_geom)) as intersection_point_3d,
          ARRAY[tp.trail1_uuid, tp.trail2_uuid] as connected_trail_ids,
          ARRAY[tp.trail1_name, tp.trail2_name] as connected_trail_names,
          'intersection' as node_type,
          0.0 as distance_meters
        FROM trail_pairs tp
        WHERE ST_GeometryType(ST_Intersection(tp.trail1_geom, tp.trail2_geom)) = 'ST_Point'
      )
      SELECT * FROM true_intersections
    `;
    
    const intersectionResult = await pgClient.query(intersectionQuery);
    
    console.log(`🔍 Intersection detection result: ${intersectionResult.rows.length} intersections found`);
    
    if (intersectionResult.rows.length > 0) {
      console.log('✅ SUCCESS: Intersection detected between NCAR Trail and NCAR Water Tank Road!');
      
      intersectionResult.rows.forEach((intersection, index) => {
        console.log(`\n📍 Intersection ${index + 1}:`);
        console.log(`   Type: ${intersection.node_type}`);
        console.log(`   Connected trails: ${intersection.connected_trail_names.join(' ↔ ')}`);
        console.log(`   Point: ${intersection.intersection_point}`);
        console.log(`   Distance: ${intersection.distance_meters}m`);
      });
    } else {
      console.log('❌ FAILED: No intersection detected between NCAR Trail and NCAR Water Tank Road');
    }
    
    // Test trail splitting
    if (intersectionResult.rows.length > 0) {
      console.log('\n✂️ Testing trail splitting...');
      
      const intersection = intersectionResult.rows[0];
      
      // Test splitting NCAR Trail
      const splitResult = await pgClient.query(`
        WITH split_geoms AS (
          SELECT (ST_Dump(ST_Split(t.geometry, $1))).geom as split_geom
          FROM ${testSchema}.trails t
          WHERE t.name = 'NCAR Trail'
        )
        SELECT 
          split_geom,
          ST_NumPoints(split_geom) as num_points,
          ST_Length(split_geom::geography) as length_meters
        FROM split_geoms
        WHERE ST_NumPoints(split_geom) > 1
          AND ST_Length(split_geom::geography) > 1
        ORDER BY ST_Length(split_geom::geography) DESC
      `, [intersection.intersection_point]);
      
      console.log(`✂️ NCAR Trail split into ${splitResult.rows.length} segments`);
      
      if (splitResult.rows.length > 1) {
        console.log('✅ SUCCESS: Trail splitting works!');
        splitResult.rows.forEach((segment, index) => {
          console.log(`   Segment ${index + 1}: ${segment.num_points} points, ${segment.length_meters.toFixed(1)}m`);
        });
      } else {
        console.log('❌ FAILED: Trail splitting did not work properly');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testConsolidatedIntersectionDetection().catch(console.error);
