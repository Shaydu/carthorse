#!/usr/bin/env node

const { Pool } = require('pg');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trail_master_db',
  user: process.env.DB_USER || 'carthorse',
  password: process.env.DB_PASSWORD || process.env.DB_PASSWORD,
};

async function analyzeBearCanyonNode() {
  const client = new Pool(config);
  
  try {
    console.log('🔍 Analyzing Bear Canyon node at lat:39.96963, lng:-105.28339...\n');
    
    // Find the latest staging schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}\n`);
    
    // Step 1: Find the specific node at those coordinates
    console.log('📍 Step 1: Finding node at coordinates...');
          const nodeResult = await client.query(`
        SELECT 
          id,
          node_uuid,
          lat,
          lng,
          elevation,
          node_type,
          connected_trails as degree
        FROM ${stagingSchema}.routing_nodes 
        WHERE ABS(lat - 39.96963) < 0.0001 
          AND ABS(lng - (-105.28339)) < 0.0001
      `);
    
    if (nodeResult.rows.length === 0) {
      console.log('❌ No node found at those exact coordinates');
      
      // Look for nearby nodes
             const nearbyResult = await client.query(`
         SELECT 
           id,
           node_uuid,
           lat,
           lng,
           elevation,
           node_type,
           connected_trails as degree,
           ST_Distance(
             ST_MakePoint(lng, lat)::geography,
             ST_MakePoint(-105.28339, 39.96963)::geography
           ) as distance_meters
         FROM ${stagingSchema}.routing_nodes 
         WHERE ST_DWithin(
           ST_MakePoint(lng, lat)::geography,
           ST_MakePoint(-105.28339, 39.96963)::geography,
           50
         )
         ORDER BY distance_meters ASC
         LIMIT 5
       `);
      
      console.log('🔍 Nearby nodes:');
      nearbyResult.rows.forEach(node => {
        console.log(`   Node ${node.id}: ${node.lat}, ${node.lng} (${node.distance_meters.toFixed(1)}m away) - Degree: ${node.degree}, Type: ${node.node_type}`);
      });
    } else {
      const node = nodeResult.rows[0];
             console.log(`✅ Found node ${node.id} (${node.node_uuid}):`);
      console.log(`   Coordinates: ${node.lat}, ${node.lng}`);
      console.log(`   Type: ${node.node_type}, Degree: ${node.degree}\n`);
      
      // Step 2: Check what edges connect to this node
      console.log('🔗 Step 2: Checking connected edges...');
             const edgesResult = await client.query(`
         SELECT 
           id,
           trail_id,
           trail_name,
           from_node_id as source_node_id,
           to_node_id as target_node_id,
           distance_km as length_km,
           elevation_gain,
           elevation_loss
         FROM ${stagingSchema}.routing_edges 
         WHERE from_node_id = $1 OR to_node_id = $1
         ORDER BY trail_name
       `, [node.id]);
      
      console.log(`📊 Connected edges (${edgesResult.rows.length}):`);
      edgesResult.rows.forEach(edge => {
        const isSource = edge.source_node_id === node.id;
        const otherNode = isSource ? edge.target_node_id : edge.source_node_id;
        console.log(`   Edge ${edge.id}: ${edge.trail_name}`);
        console.log(`     Length: ${edge.length_km.toFixed(2)}km, Elevation: +${edge.elevation_gain}m/-${edge.elevation_loss}m`);
        console.log(`     ${isSource ? 'Source' : 'Target'} of node ${node.id} → ${otherNode}\n`);
      });
    }
    
    // Step 3: Check what trails should be converging at this area
    console.log('🗺️ Step 3: Checking trails that should converge in this area...');
    const trailsResult = await client.query(`
      SELECT 
        id,
        app_uuid,
        name,
        length_km,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%Bear Canyon%' 
         OR name ILIKE '%Bear Peak West Ridge%'
         OR name ILIKE '%Fern Canyon%'
         OR name ILIKE '%Mesa Trail%'
         OR name ILIKE '%NCAR%'
      ORDER BY name
    `);
    
    console.log(`📋 Relevant trails (${trailsResult.rows.length}):`);
    trailsResult.rows.forEach(trail => {
      console.log(`   ${trail.name} (${trail.length_km.toFixed(2)}km)`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}\n`);
    });
    
    // Step 4: Check if trails are close to the intersection point
    console.log('📍 Step 4: Checking trail proximity to intersection point...');
    const proximityResult = await client.query(`
      SELECT 
        id,
        name,
        ST_Distance(
          ST_StartPoint(geometry)::geography,
          ST_MakePoint(-105.28339, 39.96963)::geography
        ) as start_distance,
        ST_Distance(
          ST_EndPoint(geometry)::geography,
          ST_MakePoint(-105.28339, 39.96963)::geography
        ) as end_distance
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%Bear Canyon%' 
         OR name ILIKE '%Bear Peak West Ridge%'
         OR name ILIKE '%Fern Canyon%'
         OR name ILIKE '%Mesa Trail%'
         OR name ILIKE '%NCAR%'
      ORDER BY LEAST(
        ST_Distance(ST_StartPoint(geometry)::geography, ST_MakePoint(-105.28339, 39.96963)::geography),
        ST_Distance(ST_EndPoint(geometry)::geography, ST_MakePoint(-105.28339, 39.96963)::geography)
      )
    `);
    
    console.log('📏 Trail proximity to intersection point:');
    proximityResult.rows.forEach(trail => {
      const minDistance = Math.min(trail.start_distance, trail.end_distance);
      console.log(`   ${trail.name}: ${minDistance.toFixed(1)}m (start: ${trail.start_distance.toFixed(1)}m, end: ${trail.end_distance.toFixed(1)}m)`);
    });
    
    // Step 5: Check current intersection splitting results
    console.log('\n🔍 Step 5: Checking intersection splitting results...');
    const intersectionResult = await client.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${stagingSchema}.trails 
      WHERE name LIKE '%split%'
    `);
    
    console.log(`📊 Split trails created: ${intersectionResult.rows[0].intersection_count}`);
    
    // Step 6: Check network connectivity
    console.log('\n🔗 Step 6: Checking network connectivity...');
           const connectivityResult = await client.query(`
         WITH RECURSIVE connected_components AS (
           SELECT 
             id as node_id,
             id as component_id
           FROM ${stagingSchema}.routing_nodes
           WHERE connected_trails > 0
           
           UNION ALL
           
           SELECT 
             e.to_node_id as node_id,
             cc.component_id
           FROM ${stagingSchema}.routing_edges e
           JOIN connected_components cc ON e.from_node_id = cc.node_id
           
           UNION ALL
           
           SELECT 
             e.from_node_id as node_id,
             cc.component_id
           FROM ${stagingSchema}.routing_edges e
           JOIN connected_components cc ON e.to_node_id = cc.node_id
         ),
      component_sizes AS (
        SELECT 
          component_id,
          COUNT(*) as size
        FROM connected_components
        GROUP BY component_id
        ORDER BY size DESC
      )
      SELECT 
        COUNT(*) as total_components,
        MAX(size) as largest_component,
        AVG(size) as avg_component_size
      FROM component_sizes
    `);
    
    console.log('📊 Network connectivity:');
    console.log(`   Total components: ${connectivityResult.rows[0].total_components}`);
    console.log(`   Largest component: ${connectivityResult.rows[0].largest_component} nodes`);
    console.log(`   Average component size: ${connectivityResult.rows[0].avg_component_size.toFixed(1)} nodes`);
    
  } catch (error) {
    console.error('❌ Error analyzing Bear Canyon node:', error);
  } finally {
    await client.end();
  }
}

// Run the analysis
analyzeBearCanyonNode().catch(console.error);
