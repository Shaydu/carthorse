#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function identifyMergeCandidates() {
  console.log('🔍 Identifying degree-2 nodes that should be merged...');
  
  // Database connection
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here',
  });

  try {
    // Get the latest staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      throw new Error('No staging schema found');
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);
    
    // Find degree-2 nodes that are good candidates for merging
    const mergeCandidatesQuery = `
      WITH degree2_nodes AS (
        SELECT 
          v.id,
          v.the_geom,
          ST_X(v.the_geom) as lng,
          ST_Y(v.the_geom) as lat,
          ST_Z(v.the_geom) as elevation,
          COUNT(e.id) as degree,
          AVG(COALESCE(e.length_km, 0.1)) as avg_incident_edge_length
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${stagingSchema}.ways_noded e 
          ON (e.source = v.id OR e.target = v.id)
        GROUP BY v.id, v.the_geom
        HAVING COUNT(e.id) = 2
      ),
      edge_info AS (
        SELECT 
          d.id,
          d.lng,
          d.lat,
          d.elevation,
          d.avg_incident_edge_length,
          ARRAY_AGG(e.id ORDER BY e.id) as edge_ids,
          ARRAY_AGG(
            CASE 
              WHEN e.source = d.id THEN e.target 
              ELSE e.source 
            END 
            ORDER BY e.id
          ) as neighbor_ids,
          ARRAY_AGG(COALESCE(e.length_km, 0.1) ORDER BY e.id) as edge_lengths
        FROM degree2_nodes d
        JOIN ${stagingSchema}.ways_noded e 
          ON (e.source = d.id OR e.target = d.id)
        GROUP BY d.id, d.lng, d.lat, d.elevation, d.avg_incident_edge_length
      )
      SELECT 
        id,
        lng,
        lat,
        elevation,
        avg_incident_edge_length,
        edge_ids,
        neighbor_ids,
        edge_lengths,
        -- Calculate total length of incident edges
        (edge_lengths[1] + edge_lengths[2]) as total_incident_length,
        -- Check if both edges are relatively short (good candidates for merging)
        CASE 
          WHEN edge_lengths[1] < 0.05 AND edge_lengths[2] < 0.05 THEN 'very_short'
          WHEN edge_lengths[1] < 0.1 AND edge_lengths[2] < 0.1 THEN 'short'
          ELSE 'normal'
        END as edge_length_category
      FROM edge_info
      ORDER BY total_incident_length ASC
      LIMIT 20;
    `;
    
    const candidatesResult = await pgClient.query(mergeCandidatesQuery);
    
    console.log(`\n🎯 Found ${candidatesResult.rows.length} degree-2 merge candidates:`);
    
    const mergeCandidates = [];
    
    for (const candidate of candidatesResult.rows) {
      console.log(`\n📍 Node ${candidate.id}:`);
      console.log(`   Position: (${candidate.lng}, ${candidate.lat}, ${candidate.elevation})`);
      console.log(`   Edge lengths: ${candidate.edge_lengths[0].toFixed(3)}km, ${candidate.edge_lengths[1].toFixed(3)}km`);
      console.log(`   Total incident length: ${candidate.total_incident_length.toFixed(3)}km`);
      console.log(`   Category: ${candidate.edge_length_category}`);
      console.log(`   Neighbors: ${candidate.neighbor_ids.join(', ')}`);
      
      // These are good candidates for merging
      if (candidate.edge_length_category === 'very_short' || candidate.edge_length_category === 'short') {
        mergeCandidates.push({
          node_id: candidate.id,
          coordinates: {
            lat: candidate.lat,
            lng: candidate.lng,
            elevation: candidate.elevation
          },
          features: {
            degree: 2,
            avg_incident_edge_length: candidate.avg_incident_edge_length
          },
          prediction: {
            value: 1,
            label: "Merge degree-2",
            confidence: 0.9
          },
          reason: `Short incident edges (${candidate.edge_length_category})`
        });
      }
    }
    
    console.log(`\n✅ Identified ${mergeCandidates.length} good merge candidates`);
    
    // Also find some Y/T intersection examples that should be split
    const ytCandidatesQuery = `
      WITH high_degree_nodes AS (
        SELECT 
          v.id,
          v.the_geom,
          ST_X(v.the_geom) as lng,
          ST_Y(v.the_geom) as lat,
          ST_Z(v.the_geom) as elevation,
          COUNT(e.id) as degree,
          AVG(COALESCE(e.length_km, 0.1)) as avg_incident_edge_length
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${stagingSchema}.ways_noded e 
          ON (e.source = v.id OR e.target = v.id)
        GROUP BY v.id, v.the_geom
        HAVING COUNT(e.id) >= 3
      )
      SELECT 
        id,
        lng,
        lat,
        elevation,
        degree,
        avg_incident_edge_length
      FROM high_degree_nodes
      ORDER BY degree DESC, avg_incident_edge_length ASC
      LIMIT 10;
    `;
    
    const ytResult = await pgClient.query(ytCandidatesQuery);
    
    console.log(`\n🔀 Found ${ytResult.rows.length} high-degree nodes (potential Y/T intersections):`);
    
    const ytCandidates = [];
    
    for (const candidate of ytResult.rows) {
      console.log(`\n📍 Node ${candidate.id}:`);
      console.log(`   Position: (${candidate.lng}, ${candidate.lat}, ${candidate.elevation})`);
      console.log(`   Degree: ${candidate.degree}`);
      console.log(`   Avg incident edge length: ${candidate.avg_incident_edge_length.toFixed(3)}km`);
      
      // High-degree nodes with short incident edges are good candidates for splitting
      if (candidate.degree >= 4 || (candidate.degree >= 3 && candidate.avg_incident_edge_length < 0.1)) {
        ytCandidates.push({
          node_id: candidate.id,
          coordinates: {
            lat: candidate.lat,
            lng: candidate.lng,
            elevation: candidate.elevation
          },
          features: {
            degree: candidate.degree,
            avg_incident_edge_length: candidate.avg_incident_edge_length
          },
          prediction: {
            value: 2,
            label: "Split Y/T",
            confidence: 0.9
          },
          reason: `High degree (${candidate.degree}) with short incident edges`
        });
      }
    }
    
    console.log(`\n✅ Identified ${ytCandidates.length} good Y/T split candidates`);
    
    // Combine all candidates
    const allCandidates = [...mergeCandidates, ...ytCandidates];
    
    console.log(`\n📊 Summary:`);
    console.log(`   • Merge candidates: ${mergeCandidates.length}`);
    console.log(`   • Y/T split candidates: ${ytCandidates.length}`);
    console.log(`   • Total new training examples: ${allCandidates.length}`);
    
    return allCandidates;
    
  } catch (error) {
    console.error('❌ Error identifying merge candidates:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the function
if (require.main === module) {
  identifyMergeCandidates()
    .then(candidates => {
      console.log('\n🎉 Merge candidate identification complete!');
      console.log(`Found ${candidates.length} new training examples to add.`);
    })
    .catch(error => {
      console.error('❌ Failed to identify merge candidates:', error);
      process.exit(1);
    });
}

export { identifyMergeCandidates };

