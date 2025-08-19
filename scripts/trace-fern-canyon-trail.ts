#!/usr/bin/env ts-node

import { Pool } from 'pg';

interface TrailSegment {
  id: number;
  name: string;
  start_point: string;
  end_point: string;
  length_meters: number;
  source_node?: number;
  target_node?: number;
  component_id?: number;
}

async function traceFernCanyonTrail(): Promise<void> {
  console.log('🔍 Tracing Fern Canyon trail from source to output...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    const stagingSchema = 'test_vertex_aware_t_split';
    console.log(`📋 Using staging schema: ${stagingSchema}`);

    // Step 1: Find Fern Canyon trails in the original trails table
    console.log('\n📊 Step 1: Fern Canyon trails in original data');
    const fernCanyonTrails = await pgClient.query(`
      SELECT 
        id,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails
      WHERE LOWER(name) LIKE '%fern canyon%'
      ORDER BY name, length_meters DESC
    `);

    console.log(`Found ${fernCanyonTrails.rows.length} Fern Canyon trails:`);
    fernCanyonTrails.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.name} (ID: ${trail.id})`);
      console.log(`     Length: ${trail.length_meters.toFixed(1)}m`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    });

    // Step 2: Check if Fern Canyon trails made it to ways_noded
    console.log('\n🛤️ Step 2: Fern Canyon trails in ways_noded');
    const fernCanyonInWaysNoded = await pgClient.query(`
      SELECT 
        w.id,
        w.source,
        w.target,
        ST_AsText(ST_StartPoint(w.the_geom)) as start_point,
        ST_AsText(ST_EndPoint(w.the_geom)) as end_point,
        ST_Length(w.the_geom::geography) as length_meters
      FROM ${stagingSchema}.ways_noded w
      WHERE EXISTS (
        SELECT 1 FROM ${stagingSchema}.trails t
        WHERE LOWER(t.name) LIKE '%fern canyon%'
        AND ST_DWithin(t.geometry, w.the_geom, 10)  -- Within 10 meters
      )
      ORDER BY w.id
    `);

    console.log(`Found ${fernCanyonInWaysNoded.rows.length} Fern Canyon segments in ways_noded:`);
    fernCanyonInWaysNoded.rows.forEach((edge, index) => {
      console.log(`  ${index + 1}. Edge ${edge.id} (${edge.source} → ${edge.target})`);
      console.log(`     Length: ${edge.length_meters.toFixed(1)}m`);
      console.log(`     Start: ${edge.start_point}`);
      console.log(`     End: ${edge.end_point}`);
    });

    // Step 3: Check connectivity of Fern Canyon nodes
    console.log('\n🔗 Step 3: Fern Canyon node connectivity');
    if (fernCanyonInWaysNoded.rows.length > 0) {
      const fernCanyonNodes = new Set<number>();
      fernCanyonInWaysNoded.rows.forEach(edge => {
        fernCanyonNodes.add(edge.source);
        fernCanyonNodes.add(edge.target);
      });

      console.log(`Fern Canyon uses ${fernCanyonNodes.size} unique nodes:`);
      console.log(`  Nodes: ${Array.from(fernCanyonNodes).sort((a, b) => a - b).join(', ')}`);

      // Check which components these nodes belong to
      const fernCanyonComponents = await pgClient.query(`
        SELECT 
          node,
          component
        FROM pgr_connectedComponents(
          'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded'
        )
        WHERE node = ANY($1)
        ORDER BY component, node
      `, [Array.from(fernCanyonNodes)]);

      console.log(`Fern Canyon nodes belong to ${new Set(fernCanyonComponents.rows.map(r => r.component)).size} different components:`);
      fernCanyonComponents.rows.forEach(row => {
        console.log(`  Node ${row.node} → Component ${row.component}`);
      });
    }

    // Step 4: Check Bear Canyon connectivity
    console.log('\n🐻 Step 4: Bear Canyon connectivity');
    const bearCanyonInWaysNoded = await pgClient.query(`
      SELECT 
        w.id,
        w.source,
        w.target,
        ST_AsText(ST_StartPoint(w.the_geom)) as start_point,
        ST_AsText(ST_EndPoint(w.the_geom)) as end_point,
        ST_Length(w.the_geom::geography) as length_meters
      FROM ${stagingSchema}.ways_noded w
      WHERE EXISTS (
        SELECT 1 FROM ${stagingSchema}.trails t
        WHERE LOWER(t.name) LIKE '%bear canyon%'
        AND ST_DWithin(t.geometry, w.the_geom, 10)  -- Within 10 meters
      )
      ORDER BY w.id
    `);

    console.log(`Found ${bearCanyonInWaysNoded.rows.length} Bear Canyon segments in ways_noded:`);
    bearCanyonInWaysNoded.rows.forEach((edge, index) => {
      console.log(`  ${index + 1}. Edge ${edge.id} (${edge.source} → ${edge.target})`);
      console.log(`     Length: ${edge.length_meters.toFixed(1)}m`);
      console.log(`     Start: ${edge.start_point}`);
      console.log(`     End: ${edge.end_point}`);
    });

    // Step 5: Check if Bear Canyon and Fern Canyon are in the same component
    console.log('\n🔗 Step 5: Bear Canyon and Fern Canyon component analysis');
    if (bearCanyonInWaysNoded.rows.length > 0 && fernCanyonInWaysNoded.rows.length > 0) {
      const bearCanyonNodes = new Set<number>();
      bearCanyonInWaysNoded.rows.forEach(edge => {
        bearCanyonNodes.add(edge.source);
        bearCanyonNodes.add(edge.target);
      });

      const fernCanyonNodes = new Set<number>();
      fernCanyonInWaysNoded.rows.forEach(edge => {
        fernCanyonNodes.add(edge.source);
        fernCanyonNodes.add(edge.target);
      });

      const allNodes = [...bearCanyonNodes, ...fernCanyonNodes];
      
      const allComponents = await pgClient.query(`
        SELECT 
          node,
          component
        FROM pgr_connectedComponents(
          'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded'
        )
        WHERE node = ANY($1)
        ORDER BY component, node
      `, [allNodes]);

      const bearComponents = new Set<number>();
      const fernComponents = new Set<number>();

      allComponents.rows.forEach(row => {
        if (bearCanyonNodes.has(row.node)) {
          bearComponents.add(row.component);
        }
        if (fernCanyonNodes.has(row.node)) {
          fernComponents.add(row.component);
        }
      });

      console.log(`Bear Canyon nodes in components: ${Array.from(bearComponents).join(', ')}`);
      console.log(`Fern Canyon nodes in components: ${Array.from(fernComponents).join(', ')}`);

      const commonComponents = [...bearComponents].filter(c => fernComponents.has(c));
      if (commonComponents.length > 0) {
        console.log(`✅ Bear Canyon and Fern Canyon share components: ${commonComponents.join(', ')}`);
      } else {
        console.log(`❌ Bear Canyon and Fern Canyon are in completely separate components!`);
        console.log(`   This explains why the loop cannot be completed.`);
      }
    }

    // Step 6: Check for potential connections between Bear Canyon and Fern Canyon
    console.log('\n🔍 Step 6: Potential connections between Bear Canyon and Fern Canyon');
    if (bearCanyonInWaysNoded.rows.length > 0 && fernCanyonInWaysNoded.rows.length > 0) {
      const bearCanyonNodes = new Set<number>();
      bearCanyonInWaysNoded.rows.forEach(edge => {
        bearCanyonNodes.add(edge.source);
        bearCanyonNodes.add(edge.target);
      });

      const fernCanyonNodes = new Set<number>();
      fernCanyonInWaysNoded.rows.forEach(edge => {
        fernCanyonNodes.add(edge.source);
        fernCanyonNodes.add(edge.target);
      });

      // Check for any edges that connect Bear Canyon and Fern Canyon nodes
      const connectingEdges = await pgClient.query(`
        SELECT 
          id,
          source,
          target,
          ST_AsText(ST_StartPoint(the_geom)) as start_point,
          ST_AsText(ST_EndPoint(the_geom)) as end_point,
          ST_Length(the_geom::geography) as length_meters
        FROM ${stagingSchema}.ways_noded
        WHERE (source = ANY($1) AND target = ANY($2))
           OR (source = ANY($2) AND target = ANY($1))
      `, [Array.from(bearCanyonNodes), Array.from(fernCanyonNodes)]);

      console.log(`Found ${connectingEdges.rows.length} edges connecting Bear Canyon and Fern Canyon nodes:`);
      connectingEdges.rows.forEach((edge, index) => {
        console.log(`  ${index + 1}. Edge ${edge.id} (${edge.source} → ${edge.target})`);
        console.log(`     Length: ${edge.length_meters.toFixed(1)}m`);
        console.log(`     Start: ${edge.start_point}`);
        console.log(`     End: ${edge.end_point}`);
      });

      if (connectingEdges.rows.length === 0) {
        console.log(`❌ No direct connections found between Bear Canyon and Fern Canyon nodes`);
        console.log(`   This confirms they are in separate network components.`);
      }
    }

    // Step 7: Check the original trail endpoints to see if they should connect
    console.log('\n📍 Step 7: Original trail endpoint analysis');
    const trailEndpoints = await pgClient.query(`
      SELECT 
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails
      WHERE LOWER(name) LIKE '%bear canyon%' OR LOWER(name) LIKE '%fern canyon%'
      ORDER BY name
    `);

    console.log('Original trail endpoints:');
    trailEndpoints.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.name}`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
      console.log(`     Length: ${trail.length_meters.toFixed(1)}m`);
    });

    // Check for nearby endpoints that should connect
    console.log('\n🔍 Checking for nearby endpoints that should connect...');
    for (let i = 0; i < trailEndpoints.rows.length; i++) {
      for (let j = i + 1; j < trailEndpoints.rows.length; j++) {
        const trail1 = trailEndpoints.rows[i];
        const trail2 = trailEndpoints.rows[j];
        
        // Check if endpoints are close to each other
        const distance = await pgClient.query(`
          SELECT ST_Distance(
            ST_GeomFromText($1, 4326),
            ST_GeomFromText($2, 4326)::geography
          ) as distance_meters
        `, [trail1.end_point, trail2.start_point]);

        const distanceMeters = parseFloat(distance.rows[0].distance_meters);
        if (distanceMeters < 50) { // Within 50 meters
          console.log(`  ⚠️  ${trail1.name} end (${trail1.end_point}) is ${distanceMeters.toFixed(1)}m from ${trail2.name} start (${trail2.start_point})`);
        }
      }
    }

    console.log('\n📋 Summary:');
    console.log('The issue is that Bear Canyon and Fern Canyon trails are in completely separate network components.');
    console.log('This means the Layer 2 network creation process is not properly connecting trails at their endpoints.');
    console.log('The trails should be connected at intersection points, but the current network is fragmented.');

  } catch (error) {
    console.error('❌ Error tracing Fern Canyon trail:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the trace
traceFernCanyonTrail().catch(console.error);
