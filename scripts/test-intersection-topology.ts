import { Client } from 'pg';

const STAGING_SCHEMA = 'test_intersection_topology_1234567890';

async function testIntersectionTopology() {
  const client = new Client({
    host: 'localhost',
    user: 'carthorse',
    password: 'carthorse',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('🧪 Testing pgRouting topology creation...\n');

    // Step 1: Create fresh staging schema
    console.log(`📋 Creating fresh staging schema: ${STAGING_SCHEMA}`);
    await client.query(`DROP SCHEMA IF EXISTS ${STAGING_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${STAGING_SCHEMA}`);

    // Step 2: Create trails table
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails (
        id INTEGER PRIMARY KEY,
        old_id INTEGER,
        app_uuid TEXT,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        the_geom GEOMETRY(GEOMETRYZ, 4326),
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

    // Step 3: Copy COTREX trails from the bbox
    await client.query(`
      INSERT INTO ${STAGING_SCHEMA}.trails (
        id, old_id, app_uuid, name, trail_type, surface, difficulty,
        the_geom, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
      )
      SELECT 
        id, id as old_id, app_uuid, name, trail_type, surface, difficulty,
        geometry as the_geom, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
      FROM public.trails
      WHERE ST_Intersects(geometry, ST_MakeEnvelope(-105.29123174925316, 39.96928418458248, -105.28050515816028, 39.981172777276015, 4326))
        AND geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND source = 'cotrex'
        AND source = 'cotrex'
    `);

    const trailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails`);
    console.log(`✅ Copied ${trailCountResult.rows[0].count} COTREX trails`);
    
    // Check what original trails we have
    const originalTrails = await client.query(`
      SELECT name, ST_Length(the_geom::geography) as length_meters
      FROM ${STAGING_SCHEMA}.trails
      ORDER BY name
    `);
    console.log('\n📋 Original trails:');
    originalTrails.rows.forEach(row => {
      console.log(`   ${row.name}: ${row.length_meters.toFixed(1)}m`);
    });

    // Step 4: Preprocess geometries for pgRouting
    console.log('\n🔧 Step 4: Preprocessing geometries for pgRouting...');
    
    // Handle GeometryCollections
    await client.query(`
      UPDATE ${STAGING_SCHEMA}.trails
      SET the_geom = ST_CollectionExtract(the_geom, 2)
      WHERE GeometryType(the_geom) LIKE 'GEOMETRYCOLLECTION%'
    `);
    
    // Create a new table with individual LineStrings
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails_processed AS
      SELECT 
        ROW_NUMBER() OVER () as id,
        t.id as original_id,
        old_id,
        app_uuid,
        name,
        trail_type,
        surface,
        difficulty,
        (ST_Dump(ST_CollectionExtract(ST_MakeValid(the_geom), 2))).geom AS the_geom,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        region,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        t.source as data_source,
        source_tags,
        osm_id
      FROM ${STAGING_SCHEMA}.trails t
    `);
    
    // Simplify geometries to prevent complex intersection errors
    await client.query(`
      UPDATE ${STAGING_SCHEMA}.trails_processed
      SET the_geom = ST_Simplify(the_geom, 0.00001)
      WHERE ST_NumPoints(the_geom) > 10
    `);
    
    // Replace the original table
    await client.query(`DROP TABLE ${STAGING_SCHEMA}.trails`);
    await client.query(`ALTER TABLE ${STAGING_SCHEMA}.trails_processed RENAME TO trails`);
    
          const geometryCheck = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN GeometryType(the_geom) LIKE 'GEOMETRYCOLLECTION%' THEN 1 END) as geometrycollections,
        COUNT(CASE WHEN GeometryType(the_geom) = 'ST_MultiLineString' THEN 1 END) as multilinestrings,
        COUNT(CASE WHEN GeometryType(the_geom) = 'ST_LineString' THEN 1 END) as linestrings
      FROM ${STAGING_SCHEMA}.trails
    `);
    console.log(`📊 Geometry check: ${geometryCheck.rows[0].total} total, ${geometryCheck.rows[0].geometrycollections} GeometryCollections, ${geometryCheck.rows[0].multilinestrings} MultiLineStrings, ${geometryCheck.rows[0].linestrings} LineStrings`);

    // Step 5: Add source/target columns for pgRouting
    console.log('\n🔧 Step 5: Adding source/target columns for pgRouting...');
    await client.query(`
      ALTER TABLE ${STAGING_SCHEMA}.trails ADD COLUMN IF NOT EXISTS source BIGINT;
      ALTER TABLE ${STAGING_SCHEMA}.trails ADD COLUMN IF NOT EXISTS target BIGINT;
    `);

    // Step 6: Create topology using pgRouting
    console.log('\n🔧 Step 6: Creating pgRouting topology...');
    
    // Check data quality first
    const dataCheck = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN ST_IsValid(the_geom) THEN 1 END) as valid,
        COUNT(CASE WHEN ST_GeometryType(the_geom) = 'ST_LineString' THEN 1 END) as linestrings,
        COUNT(CASE WHEN ST_GeometryType(the_geom) = 'ST_MultiLineString' THEN 1 END) as multilinestrings
      FROM ${STAGING_SCHEMA}.trails
    `);
    console.log(`📊 Data check: ${dataCheck.rows[0].total} total, ${dataCheck.rows[0].valid} valid, ${dataCheck.rows[0].linestrings} LineStrings, ${dataCheck.rows[0].multilinestrings} MultiLineStrings`);
    
    try {
      // Check if we have any invalid geometries
      const invalidCheck = await client.query(`
        SELECT COUNT(*) as invalid FROM ${STAGING_SCHEMA}.trails WHERE NOT ST_IsValid(the_geom)
      `);
      console.log(`📊 Invalid geometries: ${invalidCheck.rows[0].invalid}`);
      
      // Check geometry types
      const typeCheck = await client.query(`
        SELECT ST_GeometryType(the_geom) as geom_type, COUNT(*) as count 
        FROM ${STAGING_SCHEMA}.trails 
        GROUP BY ST_GeometryType(the_geom)
      `);
      console.log(`📊 Geometry types:`, typeCheck.rows);
      
      // Check for intersections between trails
      const intersectionCheck = await client.query(`
        SELECT COUNT(*) as intersections
        FROM ${STAGING_SCHEMA}.trails a
        JOIN ${STAGING_SCHEMA}.trails b ON a.id < b.id
        WHERE ST_Intersects(a.the_geom, b.the_geom)
      `);
      console.log(`📊 Trail intersections: ${intersectionCheck.rows[0].intersections}`);
      
      // Since pgRouting functions are failing, let's use our custom splitting approach
      console.log('\n🔧 Using custom splitting approach...');
      
      // Create intersection points table - snap points to trails for splitting
      await client.query(`
        CREATE TABLE ${STAGING_SCHEMA}.trail_intersections AS
        WITH exact_intersections AS (
          SELECT (ST_Dump(ST_Intersection(a.the_geom, b.the_geom))).geom AS geometry
          FROM ${STAGING_SCHEMA}.trails a
          JOIN ${STAGING_SCHEMA}.trails b
          ON a.id < b.id  -- prevent self-join duplicates
          WHERE ST_Crosses(a.the_geom, b.the_geom)  -- trails that cross each other
        ),
        tolerance_intersections AS (
          SELECT ST_ClosestPoint(a.the_geom, b.the_geom) AS geometry
          FROM ${STAGING_SCHEMA}.trails a
          JOIN ${STAGING_SCHEMA}.trails b
          ON a.id < b.id  -- prevent self-join duplicates
          WHERE ST_DWithin(a.the_geom, b.the_geom, 0.0001)  -- trails within tolerance
            AND NOT ST_Crosses(a.the_geom, b.the_geom)      -- but not exactly crossing
        ),
        all_intersection_points AS (
          SELECT geometry FROM exact_intersections
          WHERE ST_GeometryType(geometry) = 'ST_Point'
          UNION ALL
          SELECT geometry FROM tolerance_intersections
          WHERE ST_GeometryType(geometry) = 'ST_Point'
        )
        SELECT DISTINCT ST_ClosestPoint(t.the_geom, ip.geometry) AS geometry
        FROM all_intersection_points ip
        JOIN ${STAGING_SCHEMA}.trails t ON ST_DWithin(t.the_geom, ip.geometry, 0.0001)
      `);
      
      const intersectionCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trail_intersections`);
      console.log(`📊 Created ${intersectionCount.rows[0].count} intersection points`);
      
      // Check which trails are intersecting with NCAR Water Tank Road
      const waterTankIntersections = await client.query(`
        SELECT COUNT(*) as intersections
        FROM ${STAGING_SCHEMA}.trail_intersections ti
        JOIN ${STAGING_SCHEMA}.trails t ON ST_Intersects(t.the_geom, ti.geometry)
        WHERE t.name = 'NCAR Water Tank Road'
      `);
      console.log(`📊 NCAR Water Tank Road intersections: ${waterTankIntersections.rows[0].intersections}`);
      
      // Check what trails intersect with NCAR Water Tank Road
      const waterTankIntersectingTrails = await client.query(`
        SELECT DISTINCT t.name, COUNT(*) as intersection_points
        FROM ${STAGING_SCHEMA}.trail_intersections ti
        JOIN ${STAGING_SCHEMA}.trails t ON ST_Intersects(t.the_geom, ti.geometry)
        WHERE EXISTS (
          SELECT 1 FROM ${STAGING_SCHEMA}.trails wt 
          WHERE wt.name = 'NCAR Water Tank Road' 
          AND ST_Intersects(wt.the_geom, ti.geometry)
        )
        GROUP BY t.name
        ORDER BY t.name
      `);
      console.log('\n📋 Trails intersecting with NCAR Water Tank Road:');
      waterTankIntersectingTrails.rows.forEach(row => {
        console.log(`   ${row.name}: ${row.intersection_points} intersection points`);
      });
      
      // Check Mesa Trail (ID 4) specifically
      const mesaTrail4Intersections = await client.query(`
        SELECT COUNT(*) as intersection_points
        FROM ${STAGING_SCHEMA}.trail_intersections ti
        JOIN ${STAGING_SCHEMA}.trails t ON ST_Intersects(t.the_geom, ti.geometry)
        WHERE t.id = 4
      `);
      console.log(`📊 Mesa Trail (ID 4) intersection points: ${mesaTrail4Intersections.rows[0].intersection_points}`);
      
      // Check which trails should be split by NCAR Water Tank Road
      const trailsSplitByWaterTank = await client.query(`
        SELECT DISTINCT t.name, t.id, COUNT(*) as intersection_points
        FROM ${STAGING_SCHEMA}.trail_intersections ti
        JOIN ${STAGING_SCHEMA}.trails t ON ST_Intersects(t.the_geom, ti.geometry)
        WHERE EXISTS (
          SELECT 1 FROM ${STAGING_SCHEMA}.trails wt 
          WHERE wt.name = 'NCAR Water Tank Road' 
          AND ST_Intersects(wt.the_geom, ti.geometry)
        )
        GROUP BY t.name, t.id
        ORDER BY t.name
      `);
      console.log('\n📋 Trails that should be split by NCAR Water Tank Road:');
      trailsSplitByWaterTank.rows.forEach(row => {
        console.log(`   ${row.name} (ID ${row.id}): ${row.intersection_points} intersection points`);
      });
      
      // Check if NCAR Water Tank Road intersects with NCAR Trail directly
      const directIntersection = await client.query(`
        SELECT COUNT(*) as direct_intersections
        FROM ${STAGING_SCHEMA}.trails a
        JOIN ${STAGING_SCHEMA}.trails b ON a.id < b.id
        WHERE a.name = 'NCAR Water Tank Road' AND b.name LIKE 'NCAR Trail%'
          AND ST_Intersects(a.the_geom, b.the_geom)
      `);
      console.log(`📊 Direct intersections between NCAR Water Tank Road and NCAR Trail: ${directIntersection.rows[0].direct_intersections}`);
      
      // Check all trail pairs that should intersect
      const allIntersections = await client.query(`
        SELECT a.name as trail1, b.name as trail2, 
               ST_Intersects(a.the_geom, b.the_geom) as intersects,
               ST_Crosses(a.the_geom, b.the_geom) as crosses,
               ST_Touches(a.the_geom, b.the_geom) as touches,
               ST_DWithin(a.the_geom, b.the_geom, 0.0001) as within_tolerance
        FROM ${STAGING_SCHEMA}.trails a
        JOIN ${STAGING_SCHEMA}.trails b ON a.id < b.id
        WHERE (a.name = 'NCAR Water Tank Road' OR b.name = 'NCAR Water Tank Road')
          AND (a.name LIKE 'NCAR Trail%' OR b.name LIKE 'NCAR Trail%')
        ORDER BY a.name, b.name
      `);
      console.log('\n📋 All potential NCAR Water Tank Road intersections:');
      allIntersections.rows.forEach(row => {
        console.log(`   ${row.trail1} <-> ${row.trail2}: intersects=${row.intersects}, crosses=${row.crosses}, touches=${row.touches}, within_tolerance=${row.within_tolerance}`);
      });
      
      // Create split trails table - use manual splitting with ST_LineSubstring
      await client.query(`
        CREATE TABLE ${STAGING_SCHEMA}.trails_split AS
        WITH trail_intersections AS (
          SELECT 
            t.id as trail_id,
            t.the_geom as trail_geom,
            ARRAY_AGG(ti.geometry ORDER BY ST_LineLocatePoint(t.the_geom, ti.geometry)) as intersection_points
          FROM ${STAGING_SCHEMA}.trails t
          LEFT JOIN ${STAGING_SCHEMA}.trail_intersections ti ON ST_Intersects(t.the_geom, ti.geometry)
          GROUP BY t.id, t.the_geom
          HAVING COUNT(ti.geometry) > 0
        ),
        split_segments AS (
          SELECT 
            ti.trail_id as orig_id,
            CASE 
              WHEN array_length(ti.intersection_points, 1) = 1 THEN
                -- Single intersection point - split into 2 segments
                ARRAY[
                  ST_LineSubstring(ti.trail_geom, 0, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1]), 1)
                ]
              ELSE
                -- Multiple intersection points - split into multiple segments
                ARRAY[ti.trail_geom]  -- For now, keep original if multiple points
            END as segments
          FROM trail_intersections ti
        ),
        unnest_segments AS (
          SELECT 
            orig_id,
            unnest(segments) as the_geom
          FROM split_segments
        )
        SELECT 
          orig_id,
          the_geom
        FROM unnest_segments
        WHERE ST_GeometryType(the_geom) = 'ST_LineString'
          AND ST_Length(the_geom::geography) > 1
      `);
      
      // Check what happened with the splitting for specific trails
      const splitDebug = await client.query(`
        SELECT orig_id, COUNT(*) as segments, 
               MIN(ST_Length(the_geom::geography)) as min_length,
               MAX(ST_Length(the_geom::geography)) as max_length
        FROM ${STAGING_SCHEMA}.trails_split
        WHERE orig_id IN (4, 8)  -- Mesa Trail ID 4 and NCAR Water Tank Road ID 8
        GROUP BY orig_id
        ORDER BY orig_id
      `);
      console.log('\n📋 Split debugging for Mesa Trail (ID 4) and NCAR Water Tank Road (ID 8):');
      splitDebug.rows.forEach(row => {
        console.log(`   Original ID ${row.orig_id}: ${row.segments} segments, length range: ${row.min_length.toFixed(1)}m - ${row.max_length.toFixed(1)}m`);
      });
      
      // Test ST_Split manually for Mesa Trail (ID 4)
      const manualSplitTest = await client.query(`
        SELECT COUNT(*) as split_segments
        FROM (
          SELECT (ST_Dump(ST_Split(t.the_geom, ST_Collect(ti.geometry)))).geom AS split_geom
          FROM ${STAGING_SCHEMA}.trails t
          LEFT JOIN ${STAGING_SCHEMA}.trail_intersections ti ON ST_Intersects(t.the_geom, ti.geometry)
          WHERE t.id = 4
          GROUP BY t.the_geom
        ) AS split_test
        WHERE ST_GeometryType(split_geom) = 'ST_LineString'
      `);
      console.log(`📊 Manual ST_Split test for Mesa Trail (ID 4): ${manualSplitTest.rows[0].split_segments} segments`);
      
      // Check if intersection points are actually on the trail
      const pointOnTrailTest = await client.query(`
        SELECT COUNT(*) as points_on_trail
        FROM ${STAGING_SCHEMA}.trail_intersections ti
        JOIN ${STAGING_SCHEMA}.trails t ON ST_Intersects(t.the_geom, ti.geometry)
        WHERE t.id = 4
      `);
      console.log(`📊 Intersection points on Mesa Trail (ID 4): ${pointOnTrailTest.rows[0].points_on_trail}`);
      
      // Add non-intersecting trails back
      await client.query(`
        INSERT INTO ${STAGING_SCHEMA}.trails_split (orig_id, the_geom)
        SELECT a.id AS orig_id, a.the_geom
        FROM ${STAGING_SCHEMA}.trails a
        WHERE NOT EXISTS (
          SELECT 1 FROM ${STAGING_SCHEMA}.trail_intersections ti
          WHERE ST_Intersects(a.the_geom, ti.geometry)
        )
      `);
      
      // Check which trails made it to the split table
      const splitTrailsCheck = await client.query(`
        SELECT DISTINCT orig_id, COUNT(*) as segments
        FROM ${STAGING_SCHEMA}.trails_split
        GROUP BY orig_id
        ORDER BY orig_id
      `);
      console.log('\n📋 Trails in split table:');
      splitTrailsCheck.rows.forEach(row => {
        console.log(`   Original ID ${row.orig_id}: ${row.segments} segments`);
      });
      
      const splitCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_split`);
      console.log(`📊 Created ${splitCount.rows[0].count} split trail segments`);
      
      // Add metadata to split trails
      await client.query(`
        CREATE TABLE ${STAGING_SCHEMA}.trails_split_with_metadata AS
        SELECT 
          ROW_NUMBER() OVER () as id,
          s.orig_id,
          t.name, t.region, t.trail_type, t.surface, t.difficulty,
          t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
          t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat, t.data_source, t.source_tags, t.osm_id,
          s.the_geom
        FROM ${STAGING_SCHEMA}.trails_split s
        JOIN ${STAGING_SCHEMA}.trails t ON s.orig_id = t.id
        WHERE ST_GeometryType(s.the_geom) = 'ST_LineString'
          AND ST_Length(s.the_geom::geography) > 1
      `);
      
      const finalCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_split_with_metadata`);
      console.log(`📊 Final split trails: ${finalCount.rows[0].count}`);
      
      // Check which trails made it through the filtering
      const filteredTrailsCheck = await client.query(`
        SELECT DISTINCT orig_id, COUNT(*) as segments
        FROM ${STAGING_SCHEMA}.trails_split_with_metadata
        GROUP BY orig_id
        ORDER BY orig_id
      `);
      console.log('\n📋 Trails after filtering:');
      filteredTrailsCheck.rows.forEach(row => {
        console.log(`   Original ID ${row.orig_id}: ${row.segments} segments`);
      });
      
      // Check what trails we have in the final result
      const trailNames = await client.query(`
        SELECT DISTINCT name, COUNT(*) as segments
        FROM ${STAGING_SCHEMA}.trails_split_with_metadata
        GROUP BY name
        ORDER BY name
      `);
      console.log('\n📋 Trail names in final result:');
      trailNames.rows.forEach(row => {
        console.log(`   ${row.name}: ${row.segments} segments`);
      });
      
      // Replace original table with split results
      await client.query(`DROP TABLE ${STAGING_SCHEMA}.trails`);
      await client.query(`ALTER TABLE ${STAGING_SCHEMA}.trails_split_with_metadata RENAME TO trails`);
      
      // Add source/target columns back since we replaced the table
      await client.query(`
        ALTER TABLE ${STAGING_SCHEMA}.trails ADD COLUMN IF NOT EXISTS source BIGINT;
        ALTER TABLE ${STAGING_SCHEMA}.trails ADD COLUMN IF NOT EXISTS target BIGINT;
      `);
      
      // Now try pgRouting topology on the split trails
      console.log('\n🔧 Trying pgRouting topology on split trails...');
      const topologyResult = await client.query(`
        SELECT pgr_createTopology('${STAGING_SCHEMA}.trails', 0.0001, 'the_geom', 'id', 'source', 'target');
      `);
      console.log(`📊 Topology creation result: ${JSON.stringify(topologyResult.rows[0])}`);
      
      // Check if topology creation failed
      if (topologyResult.rows[0].pgr_createtopology === 'FAIL') {
        console.log(`❌ Topology creation returned FAIL`);
        
        // Check what tables exist
        const tablesCheck = await client.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = '${STAGING_SCHEMA}' 
          AND table_name LIKE '%pgr%'
          ORDER BY table_name
        `);
        console.log(`📊 Existing pgRouting tables: ${tablesCheck.rows.map(r => r.table_name).join(', ')}`);
        
        // Check if we can create the vertices table manually
        console.log('\n🔧 Attempting to create vertices table manually...');
        try {
          await client.query(`
            CREATE TABLE ${STAGING_SCHEMA}.trails_vertices_pgr (
              id BIGINT PRIMARY KEY,
              cnt INTEGER,
              chk INTEGER,
              ein INTEGER,
              eout INTEGER,
              the_geom GEOMETRY(POINT, 4326)
            )
          `);
          console.log(`✅ Created vertices table manually`);
          
          // Try to populate it with trail endpoints (force 2D)
          await client.query(`
            INSERT INTO ${STAGING_SCHEMA}.trails_vertices_pgr (id, cnt, chk, ein, eout, the_geom)
            SELECT 
              ROW_NUMBER() OVER () as id,
              0 as cnt, 0 as chk, 0 as ein, 0 as eout,
              ST_Force2D(ST_StartPoint(the_geom)) as the_geom
            FROM ${STAGING_SCHEMA}.trails
            UNION
            SELECT 
              ROW_NUMBER() OVER () + (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.trails) as id,
              0 as cnt, 0 as chk, 0 as ein, 0 as eout,
              ST_Force2D(ST_EndPoint(the_geom)) as the_geom
            FROM ${STAGING_SCHEMA}.trails
          `);
          console.log(`✅ Populated vertices table with trail endpoints`);
          
        } catch (manualError) {
          console.log(`❌ Manual vertices table creation failed: ${(manualError as Error).message}`);
        }
      }
      
      // Step 7: Check topology results
      console.log('\n📊 Step 7: Checking topology results...');
      const edgesResult = await client.query(`SELECT COUNT(*) as edges FROM ${STAGING_SCHEMA}.trails`);
      const verticesResult = await client.query(`SELECT COUNT(*) as vertices FROM ${STAGING_SCHEMA}.trails_vertices_pgr`);
      
      console.log(`📊 Topology created: ${edgesResult.rows[0].edges} edges, ${verticesResult.rows[0].vertices} vertices`);
    } catch (error) {
      console.log(`❌ Topology creation failed: ${(error as Error).message}`);
      
      // Try with a larger tolerance
      console.log('\n🔧 Trying with larger tolerance (0.001)...');
      try {
        const topologyResult2 = await client.query(`
          SELECT pgr_createTopology('${STAGING_SCHEMA}.trails', 0.001, 'the_geom', 'id', 'source', 'target');
        `);
        console.log(`📊 Topology creation result (tolerance 0.001): ${JSON.stringify(topologyResult2.rows[0])}`);
        
        const edgesResult = await client.query(`SELECT COUNT(*) as edges FROM ${STAGING_SCHEMA}.trails`);
        const verticesResult = await client.query(`SELECT COUNT(*) as vertices FROM ${STAGING_SCHEMA}.trails_vertices_pgr`);
        
        console.log(`📊 Topology created: ${edgesResult.rows[0].edges} edges, ${verticesResult.rows[0].vertices} vertices`);
      } catch (error2) {
        console.log(`❌ Topology creation with larger tolerance also failed: ${(error2 as Error).message}`);
      }
    }

    // Step 8: Check for any isolated edges
    const isolatedResult = await client.query(`
      SELECT COUNT(*) as isolated FROM ${STAGING_SCHEMA}.trails 
      WHERE source::text = target::text OR source IS NULL OR target IS NULL
    `);
    console.log(`📊 Isolated edges: ${isolatedResult.rows[0].isolated}`);

    // Step 9: Show detailed results
    console.log('\n📋 Step 9: Showing detailed results...');
    const resultsDetails = await client.query(`
      SELECT id, name, source, target, 
             ST_Length(the_geom::geography) as length_meters,
             ST_NumPoints(the_geom) as num_points, 
             ST_IsValid(the_geom) as is_valid
      FROM ${STAGING_SCHEMA}.trails
      ORDER BY id
    `);

    console.log('\n📋 Trail details after topology creation:');
    resultsDetails.rows.forEach(row => {
      console.log(`   ID ${row.id}: ${row.name} - ${row.length_meters.toFixed(1)}m (${row.num_points} points, valid: ${row.is_valid}, source: ${row.source}, target: ${row.target})`);
    });

    // Step 10: Test routing connectivity
    console.log('\n🔍 Step 10: Testing routing connectivity...');
    try {
      const routingTest = await client.query(`
        SELECT COUNT(*) as routes FROM pgr_dijkstra(
          'SELECT id, source, target, ST_Length(the_geom::geography) as cost FROM ${STAGING_SCHEMA}.trails WHERE source IS NOT NULL AND target IS NOT NULL',
          (SELECT MIN(id) FROM ${STAGING_SCHEMA}.trails_vertices_pgr),
          (SELECT MAX(id) FROM ${STAGING_SCHEMA}.trails_vertices_pgr),
          directed := false
        )
      `);
      console.log(`📊 Routing test: ${routingTest.rows[0].routes} path segments found`);
    } catch (error) {
      console.log(`⚠️ Routing test failed: ${(error as Error).message}`);
    }

    // Step 11: Export results for visualization
    console.log('\n📤 Step 11: Exporting results for visualization...');
    await exportResults(client);

  } catch (error) {
    console.error('❌ Error in test:', error);
  } finally {
    console.log(`🔍 Keeping schema ${STAGING_SCHEMA} for debugging`);
    await client.end();
  }
}

async function exportResults(client: Client) {
  try {
    const fs = require('fs');
    
    const result = await client.query(`
      SELECT 
        id,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        length_km,
        source,
        target,
        ST_AsGeoJSON(ST_Force2D(the_geom)) as geometry_json
      FROM ${STAGING_SCHEMA}.trails
      WHERE the_geom IS NOT NULL 
        AND ST_IsValid(the_geom)
      ORDER BY id
    `);
    
    console.log(`📊 Found ${result.rows.length} trails in results`);
    
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row, index) => ({
        type: 'Feature',
        id: index,
        properties: {
          id: row.id,
          name: row.name,
          region: row.region,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          source: row.source,
          target: row.target,
          is_split: row.source !== null && row.target !== null ? 'Yes' : 'No'
        },
        geometry: JSON.parse(row.geometry_json)
      }))
    };
    
    const outputFile = 'test-output/intersection-topology-results.geojson';
    fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported ${result.rows.length} trails to ${outputFile}`);
    
    const splitTrails = result.rows.filter(r => r.source !== null && r.target !== null).length;
    const unsplitTrails = result.rows.filter(r => r.source === null || r.target === null).length;
    
    console.log('\n📋 Summary:');
    console.log(`   - Total trails: ${result.rows.length}`);
    console.log(`   - Split trails: ${splitTrails}`);
    console.log(`   - Unsplit trails: ${unsplitTrails}`);
    
  } catch (error) {
    console.error('❌ Error exporting results:', error);
  }
}

// Run the test
testIntersectionTopology().catch(console.error);
