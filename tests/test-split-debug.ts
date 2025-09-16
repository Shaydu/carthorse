import { Pool } from 'pg';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'postgres',
  password: 'postgres'
});

async function testSpecificIntersection() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Testing specific intersection at node 67 location...');
    
    // Node 67 coordinates: -105.28239310097018, 39.98857348185412
    const node67Point = 'POINT(-105.28239310097018 39.98857348185412)';
    
    // Get the latest schema
    const schemaResult = await client.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No carthorse schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📁 Using schema: ${stagingSchema}`);
    
    // Find trails that should intersect at node 67
    console.log('\n🔍 Finding trails near node 67...');
    const trailsResult = await client.query(`
      SELECT old_id, name, ST_AsText(geom) as geom_text,
             ST_Distance(ST_GeomFromText($1, 4326), geom) as distance_m
      FROM ${stagingSchema}.ways_2d 
      WHERE ST_DWithin(ST_GeomFromText($1, 4326), geom, 0.01)
      ORDER BY distance_m
    `, [node67Point]);
    
    console.log('Trails near node 67:');
    trailsResult.rows.forEach(row => {
      console.log(`  - ${row.name} (ID: ${row.old_id}, distance: ${row.distance_m}m)`);
    });
    
    if (trailsResult.rows.length < 2) {
      console.log('❌ Not enough trails found for intersection test');
      return;
    }
    
    // Test ST_Split with different tolerances
    console.log('\n🧪 Testing ST_Split with different approaches...');
    
    // Approach 1: Direct ST_Intersects
    console.log('\n1️⃣ Testing ST_Intersects approach:');
    const intersectResult = await client.query(`
      SELECT a.name as trail_a, b.name as trail_b,
             ST_Intersects(a.geom, b.geom) as intersects,
             ST_Distance(a.geom, b.geom) as distance_m
      FROM ${stagingSchema}.ways_2d a, ${stagingSchema}.ways_2d b
      WHERE a.old_id < b.old_id
        AND a.name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND b.name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
    `);
    
    intersectResult.rows.forEach(row => {
      console.log(`  ${row.trail_a} x ${row.trail_b}: intersects=${row.intersects}, distance=${row.distance_m}m`);
    });
    
    // Approach 2: ST_DWithin with 2m tolerance
    console.log('\n2️⃣ Testing ST_DWithin (2m) approach:');
    const dwithinResult = await client.query(`
      SELECT a.name as trail_a, b.name as trail_b,
             ST_DWithin(a.geom, b.geom, 2.0) as within_2m,
             ST_Distance(a.geom, b.geom) as distance_m
      FROM ${stagingSchema}.ways_2d a, ${stagingSchema}.ways_2d b
      WHERE a.old_id < b.old_id
        AND a.name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND b.name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
    `);
    
    dwithinResult.rows.forEach(row => {
      console.log(`  ${row.trail_a} x ${row.trail_b}: within_2m=${row.within_2m}, distance=${row.distance_m}m`);
    });
    
    // Approach 3: Test actual ST_Split
    console.log('\n3️⃣ Testing actual ST_Split:');
    const splitResult = await client.query(`
      SELECT 
        a.name as trail_a, 
        b.name as trail_b,
        ST_NumGeometries(ST_Dump(ST_Split(a.geom, b.geom))) as num_pieces,
        ST_AsText((ST_Dump(ST_Split(a.geom, b.geom))).geom) as split_geom
      FROM ${stagingSchema}.ways_2d a, ${stagingSchema}.ways_2d b
      WHERE a.old_id < b.old_id
        AND a.name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND b.name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND ST_DWithin(a.geom, b.geom, 2.0)
    `);
    
    splitResult.rows.forEach(row => {
      console.log(`  ${row.trail_a} split by ${row.trail_b}: ${row.num_pieces} pieces`);
      console.log(`    First piece: ${row.split_geom.substring(0, 100)}...`);
    });
    
    // Approach 4: Check if we need to snap first
    console.log('\n4️⃣ Testing if snapping helps:');
    const snapResult = await client.query(`
      SELECT 
        a.name as trail_a, 
        b.name as trail_b,
        ST_Intersects(ST_SnapToGrid(a.geom, 0.00001), ST_SnapToGrid(b.geom, 0.00001)) as intersects_after_snap,
        ST_Distance(ST_SnapToGrid(a.geom, 0.00001), ST_SnapToGrid(b.geom, 0.00001)) as distance_after_snap
      FROM ${stagingSchema}.ways_2d a, ${stagingSchema}.ways_2d b
      WHERE a.old_id < b.old_id
        AND a.name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND b.name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
    `);
    
    snapResult.rows.forEach(row => {
      console.log(`  ${row.trail_a} x ${row.trail_b}: intersects_after_snap=${row.intersects_after_snap}, distance_after_snap=${row.distance_after_snap}m`);
    });
    
    // Check current network topology
    console.log('\n5️⃣ Current network topology at node 67:');
    const topologyResult = await client.query(`
      SELECT id, cnt as degree, ST_AsText(the_geom) as coordinates,
             ST_Distance(ST_GeomFromText($1, 4326), the_geom) as distance_m
      FROM ${stagingSchema}.ways_noded_vertices_pgr 
      WHERE ST_DWithin(ST_GeomFromText($1, 4326), the_geom, 0.01)
      ORDER BY distance_m
    `, [node67Point]);
    
    topologyResult.rows.forEach(row => {
      console.log(`  Node ${row.id}: degree=${row.degree}, distance=${row.distance_m}m`);
      console.log(`    Coordinates: ${row.coordinates}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

testSpecificIntersection().catch(console.error);


