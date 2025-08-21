const { Pool } = require('pg');

const pool = new Pool({
  user: 'carthorse',
  host: 'localhost',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

async function debugConnectorDisappearance() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Debugging connector trail disappearance...');
    
    // Find the most recent staging schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%'
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Step 1: Check if the connector trail exists in public.trails
    console.log('\n📊 Step 1: Checking if connector trail exists in public.trails...');
    const publicResult = await client.query(`
      SELECT 
        id,
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_IsValid(geometry) as is_valid,
        ST_GeometryType(geometry) as geometry_type,
        ST_NumPoints(geometry) as num_points
      FROM public.trails
      WHERE app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336'
    `);
    
    if (publicResult.rows.length > 0) {
      const trail = publicResult.rows[0];
      console.log(`   ✅ Found in public.trails:`);
      console.log(`      - ID: ${trail.id}`);
      console.log(`      - App UUID: ${trail.app_uuid}`);
      console.log(`      - Name: ${trail.name}`);
      console.log(`      - Length: ${trail.length_meters.toFixed(2)}m`);
      console.log(`      - Is Valid: ${trail.is_valid}`);
      console.log(`      - Geometry Type: ${trail.geometry_type}`);
      console.log(`      - Num Points: ${trail.num_points}`);
    } else {
      console.log(`   ❌ NOT found in public.trails`);
      return;
    }
    
    // Step 2: Check if it was copied to staging initially
    console.log('\n📊 Step 2: Checking if connector trail was copied to staging...');
    const stagingResult = await client.query(`
      SELECT 
        id,
        app_uuid,
        original_trail_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_IsValid(geometry) as is_valid,
        ST_GeometryType(geometry) as geometry_type,
        ST_NumPoints(geometry) as num_points
      FROM ${stagingSchema}.trails
      WHERE app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336'
         OR original_trail_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336'
         OR (name = 'North Sky Trail' AND ST_Length(geometry::geography) BETWEEN 100 AND 110)
    `);
    
    if (stagingResult.rows.length > 0) {
      console.log(`   ✅ Found ${stagingResult.rows.length} matching trails in staging:`);
      for (const trail of stagingResult.rows) {
        console.log(`      - ID: ${trail.id}`);
        console.log(`      - App UUID: ${trail.app_uuid}`);
        console.log(`      - Original UUID: ${trail.original_trail_uuid || 'N/A'}`);
        console.log(`      - Name: ${trail.name}`);
        console.log(`      - Length: ${trail.length_meters.toFixed(2)}m`);
        console.log(`      - Is Valid: ${trail.is_valid}`);
        console.log(`      - Geometry Type: ${trail.geometry_type}`);
        console.log(`      - Num Points: ${trail.num_points}`);
        console.log('');
      }
    } else {
      console.log(`   ❌ NOT found in staging - it was never copied or was removed early`);
    }
    
    // Step 3: Check if it's a non-simple geometry that might be getting split
    console.log('\n📊 Step 3: Checking if connector trail is non-simple...');
    const nonSimpleResult = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_IsSimple(geometry) as is_simple,
        ST_NumPoints(geometry) as num_points,
        ST_GeometryType(geometry) as geometry_type
      FROM public.trails
      WHERE app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336'
    `);
    
    if (nonSimpleResult.rows.length > 0) {
      const trail = nonSimpleResult.rows[0];
      console.log(`   📋 Non-simple analysis:`);
      console.log(`      - Is Simple: ${trail.is_simple}`);
      console.log(`      - Geometry Type: ${trail.geometry_type}`);
      console.log(`      - Num Points: ${trail.num_points}`);
      
      if (!trail.is_simple) {
        console.log(`   ⚠️ Trail is NOT simple - it will be split during processing`);
      } else {
        console.log(`   ✅ Trail is simple - should not be split`);
      }
    }
    
    // Step 4: Check if it intersects with the lollipop trail
    console.log('\n📊 Step 4: Checking intersection with lollipop trail...');
    const intersectionResult = await client.query(`
      SELECT 
        t1.app_uuid as connector_uuid,
        t1.name as connector_name,
        t1.length_meters as connector_length,
        t2.app_uuid as lollipop_uuid,
        t2.name as lollipop_name,
        t2.length_meters as lollipop_length,
        ST_Intersects(t1.geometry, t2.geometry) as intersects,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type
      FROM (
        SELECT 
          app_uuid,
          name,
          ST_Length(geometry::geography) as length_meters,
          geometry
        FROM public.trails
        WHERE app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336'
      ) t1
      JOIN (
        SELECT 
          app_uuid,
          name,
          ST_Length(geometry::geography) as length_meters,
          geometry
        FROM public.trails
        WHERE app_uuid = 'b43a9490-6651-428e-b5e4-fb2ffce3b220'
      ) t2 ON ST_Intersects(t1.geometry, t2.geometry)
    `);
    
    if (intersectionResult.rows.length > 0) {
      const row = intersectionResult.rows[0];
      console.log(`   🔗 Intersection found:`);
      console.log(`      - Connector: ${row.connector_name} (${row.connector_length.toFixed(2)}m)`);
      console.log(`      - Lollipop: ${row.lollipop_name} (${row.lollipop_length.toFixed(2)}m)`);
      console.log(`      - Intersects: ${row.intersects}`);
      console.log(`      - Intersection Type: ${row.intersection_type}`);
    } else {
      console.log(`   ❌ No intersection found between connector and lollipop trails`);
    }
    
  } catch (error) {
    console.error('❌ Error debugging connector disappearance:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

debugConnectorDisappearance();
