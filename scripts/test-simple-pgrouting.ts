import { Pool } from 'pg';

async function testSimplePgRouting() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🧪 Testing simple pgRouting setup...');
    
    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'export_edges' 
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with export_edges found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check export_edges structure
    console.log('\n📊 Checking export_edges structure...');
    const structureResult = await pgClient.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = '${stagingSchema}' AND table_name = 'export_edges' 
      ORDER BY ordinal_position
    `);
    
    console.log('Export edges columns:');
    structureResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    });
    
    // Check if we have data
    console.log('\n📊 Checking export_edges data...');
    const countResult = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.export_edges
    `);
    console.log(`Total edges: ${countResult.rows[0].count}`);
    
    // Check if we have valid geometries
    console.log('\n📊 Checking valid geometries...');
    const geomResult = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.export_edges 
      WHERE geojson IS NOT NULL AND geojson != ''
    `);
    console.log(`Edges with valid GeoJSON: ${geomResult.rows[0].count}`);
    
    // Try to create a simple ways_noded table
    console.log('\n🔄 Creating simple ways_noded table...');
    await pgClient.query(`
      DROP TABLE IF EXISTS ${stagingSchema}.ways_noded
    `);
    
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.ways_noded AS
      SELECT 
        id,
        source,
        target,
        length_km as cost,
        length_km as reverse_cost,
        ST_Force2D(ST_GeomFromGeoJSON(geojson)) as the_geom
      FROM ${stagingSchema}.export_edges
      WHERE geojson IS NOT NULL 
        AND geojson != ''
        AND ST_IsValid(ST_GeomFromGeoJSON(geojson))
    `);
    
    const waysCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
    `);
    console.log(`Created ways_noded with ${waysCount.rows[0].count} edges`);
    
    // Try to create vertices table manually
    console.log('\n🔄 Creating vertices table manually...');
    await pgClient.query(`
      DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr
    `);
    
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY lat, lng) as id,
        lat,
        lng,
        0 as cnt,
        0 as chk,
        0 as ein,
        0 as eout,
        ST_SetSRID(ST_MakePoint(lng, lat), 4326) as the_geom
      FROM (
        SELECT DISTINCT ST_Y(ST_StartPoint(the_geom)) as lat, ST_X(ST_StartPoint(the_geom)) as lng
        FROM ${stagingSchema}.ways_noded
        UNION
        SELECT DISTINCT ST_Y(ST_EndPoint(the_geom)) as lat, ST_X(ST_EndPoint(the_geom)) as lng
        FROM ${stagingSchema}.ways_noded
      ) vertices
    `);
    
    const verticesCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded_vertices_pgr
    `);
    console.log(`Created vertices table with ${verticesCount.rows[0].count} vertices`);
    
    // Try a simple pgRouting function
    console.log('\n🔄 Testing simple pgRouting function...');
    const testResult = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
      WHERE source IS NOT NULL AND target IS NOT NULL
    `);
    console.log(`Edges with valid source/target: ${testResult.rows[0].count}`);
    
    // Try to find a simple loop
    console.log('\n🔄 Testing simple loop detection...');
    const loopResult = await pgClient.query(`
      WITH simple_loops AS (
        SELECT 
          e1.id as edge1_id,
          e2.id as edge2_id,
          e1.source as start_node,
          e2.target as end_node,
          e1.cost + e2.cost as total_distance
        FROM ${stagingSchema}.ways_noded e1
        JOIN ${stagingSchema}.ways_noded e2 ON e1.target = e2.source
        WHERE e1.source = e2.target  -- This creates a loop
          AND e1.id != e2.id  -- Not the same edge
      )
      SELECT * FROM simple_loops
      WHERE total_distance BETWEEN 1 AND 10
      ORDER BY total_distance
      LIMIT 5
    `);
    
    console.log(`Found ${loopResult.rows.length} simple loops`);
    loopResult.rows.forEach((loop, index) => {
      console.log(`  ${index + 1}. Loop: ${loop.edge1_id} -> ${loop.edge2_id} (${loop.total_distance.toFixed(2)}km)`);
    });
    
  } catch (error) {
    console.error('❌ Error during simple pgRouting test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testSimplePgRouting().catch(console.error);
