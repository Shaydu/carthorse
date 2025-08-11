const Database = require('better-sqlite3');
const fs = require('fs');

function validate3D2DData(dbPath) {
  console.log('🔍 Validating 3D trails and 2D edges in database...');
  console.log(`📁 Database: ${dbPath}`);
  
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database file not found: ${dbPath}`);
    return false;
  }
  
  const db = new Database(dbPath);
  
  try {
    // Check trails table for 3D data
    console.log('\n🗺️  Validating Trails (should be 3D):');
    const trailsResult = db.prepare(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN json_extract(geojson, '$.coordinates[0][2]') IS NOT NULL THEN 1 END) as trails_with_3d,
        COUNT(CASE WHEN json_extract(geojson, '$.coordinates[0][2]') IS NULL THEN 1 END) as trails_without_3d
      FROM trails
    `).get();
    
    console.log(`   Total trails: ${trailsResult.total_trails}`);
    console.log(`   Trails with 3D data: ${trailsResult.trails_with_3d}`);
    console.log(`   Trails without 3D data: ${trailsResult.trails_without_3d}`);
    
    if (trailsResult.trails_without_3d > 0) {
      console.log(`   ❌ Found ${trailsResult.trails_without_3d} trails without 3D data`);
      
      // Show examples of trails without 3D data
      const examplesWithout3D = db.prepare(`
        SELECT name, app_uuid, json_extract(geojson, '$.coordinates[0]') as first_coord
        FROM trails 
        WHERE json_extract(geojson, '$.coordinates[0][2]') IS NULL
        LIMIT 5
      `).all();
      
      console.log('   Examples of trails without 3D data:');
      examplesWithout3D.forEach(trail => {
        console.log(`     - ${trail.name} (${trail.app_uuid}): ${trail.first_coord}`);
      });
    } else {
      console.log('   ✅ All trails have 3D data');
    }
    
    // Check routing_edges table for 2D data
    console.log('\n🛤️  Validating Routing Edges (should be 2D):');
    const edgesResult = db.prepare(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN json_extract(geojson, '$.coordinates[0][2]') IS NULL THEN 1 END) as edges_with_2d,
        COUNT(CASE WHEN json_extract(geojson, '$.coordinates[0][2]') IS NOT NULL THEN 1 END) as edges_with_3d
      FROM routing_edges
    `).get();
    
    console.log(`   Total edges: ${edgesResult.total_edges}`);
    console.log(`   Edges with 2D data: ${edgesResult.edges_with_2d}`);
    console.log(`   Edges with 3D data: ${edgesResult.edges_with_3d}`);
    
    if (edgesResult.edges_with_3d > 0) {
      console.log(`   ❌ Found ${edgesResult.edges_with_3d} edges with 3D data (should be 2D)`);
      
      // Show examples of edges with 3D data
      const examplesWith3D = db.prepare(`
        SELECT trail_name, trail_id, json_extract(geojson, '$.coordinates[0]') as first_coord
        FROM routing_edges 
        WHERE json_extract(geojson, '$.coordinates[0][2]') IS NOT NULL
        LIMIT 5
      `).all();
      
      console.log('   Examples of edges with 3D data:');
      examplesWith3D.forEach(edge => {
        console.log(`     - ${edge.trail_name} (${edge.trail_id}): ${edge.first_coord}`);
      });
    } else {
      console.log('   ✅ All edges have 2D data');
    }
    
    // Check routing_nodes table for 2D data
    console.log('\n📍 Validating Routing Nodes (should be 2D):');
    const nodesResult = db.prepare(`
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN elevation = 0 OR elevation IS NULL THEN 1 END) as nodes_without_elevation,
        COUNT(CASE WHEN elevation > 0 THEN 1 END) as nodes_with_elevation
      FROM routing_nodes
    `).get();
    
    console.log(`   Total nodes: ${nodesResult.total_nodes}`);
    console.log(`   Nodes without elevation: ${nodesResult.nodes_without_elevation}`);
    console.log(`   Nodes with elevation: ${nodesResult.nodes_with_elevation}`);
    
    // Sample coordinate validation
    console.log('\n🔍 Sample Coordinate Validation:');
    
    // Sample trail coordinates (should be 3D)
    const sampleTrail = db.prepare(`
      SELECT name, json_extract(geojson, '$.coordinates[0]') as first_coord,
             json_extract(geojson, '$.coordinates[1]') as second_coord
      FROM trails 
      LIMIT 1
    `).get();
    
    if (sampleTrail) {
      console.log(`   Sample trail (${sampleTrail.name}):`);
      console.log(`     First coord: ${sampleTrail.first_coord}`);
      console.log(`     Second coord: ${sampleTrail.second_coord}`);
      
      const firstCoord = JSON.parse(sampleTrail.first_coord);
      const secondCoord = JSON.parse(sampleTrail.second_coord);
      
      console.log(`     First coord dimensions: ${firstCoord.length}D`);
      console.log(`     Second coord dimensions: ${secondCoord.length}D`);
    }
    
    // Sample edge coordinates (should be 2D)
    const sampleEdge = db.prepare(`
      SELECT trail_name, json_extract(geojson, '$.coordinates[0]') as first_coord,
             json_extract(geojson, '$.coordinates[1]') as second_coord
      FROM routing_edges 
      LIMIT 1
    `).get();
    
    if (sampleEdge) {
      console.log(`   Sample edge (${sampleEdge.trail_name}):`);
      console.log(`     First coord: ${sampleEdge.first_coord}`);
      console.log(`     Second coord: ${sampleEdge.second_coord}`);
      
      const firstCoord = JSON.parse(sampleEdge.first_coord);
      const secondCoord = JSON.parse(sampleEdge.second_coord);
      
      console.log(`     First coord dimensions: ${firstCoord.length}D`);
      console.log(`     Second coord dimensions: ${secondCoord.length}D`);
    }
    
    // Summary
    console.log('\n📊 Validation Summary:');
    const trailsValid = trailsResult.trails_without_3d === 0;
    const edgesValid = edgesResult.edges_with_3d === 0;
    
    console.log(`   Trails 3D validation: ${trailsValid ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Edges 2D validation: ${edgesValid ? '✅ PASS' : '❌ FAIL'}`);
    
    const overallValid = trailsValid && edgesValid;
    console.log(`   Overall validation: ${overallValid ? '✅ PASS' : '❌ FAIL'}`);
    
    return overallValid;
    
  } catch (error) {
    console.error('❌ Validation error:', error);
    return false;
  } finally {
    db.close();
  }
}

// Run validation if called directly
if (require.main === module) {
  const dbPath = process.argv[2] || 'test-fixes-4.db';
  validate3D2DData(dbPath);
}

module.exports = { validate3D2DData };
