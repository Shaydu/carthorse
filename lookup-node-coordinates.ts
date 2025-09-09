import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function lookupNodeCoordinates() {
  const schema = process.argv[2];
  const nodeId = process.argv[3];
  
  if (!schema || !nodeId) {
    console.error('❌ Please provide schema name and node ID as arguments');
    console.log('Usage: npx ts-node lookup-node-coordinates.ts <schema_name> <node_id>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Look up node coordinates from the ways_noded_vertices_pgr table
    const query = `
      SELECT 
        id as node_id,
        ST_X(the_geom) as lng,
        ST_Y(the_geom) as lat,
        ST_Z(the_geom) as elevation,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = v.id OR e.target = v.id) as degree
      FROM ${schema}.ways_noded_vertices_pgr v
      WHERE v.id = $1
    `;
    
    const result = await pgClient.query(query, [nodeId]);
    
    if (result.rows.length === 0) {
      console.log(`❌ Node ${nodeId} not found in schema ${schema}`);
    } else {
      const node = result.rows[0];
      console.log(`✅ Found node ${nodeId}:`);
      console.log(`   • Coordinates: (${node.lat}, ${node.lng})`);
      console.log(`   • Elevation: ${node.elevation}`);
      console.log(`   • Degree: ${node.degree}`);
      console.log(`   • Node type: ${node.degree === 1 ? 'endpoint' : node.degree === 2 ? 'connector' : 'intersection'}`);
    }

    // Also check if there are any similar nodes nearby
    if (result.rows.length > 0) {
      const node = result.rows[0];
      const nearbyQuery = `
        SELECT 
          id as node_id,
          ST_X(the_geom) as lng,
          ST_Y(the_geom) as lat,
          ST_Distance(the_geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as distance_meters
        FROM ${schema}.ways_noded_vertices_pgr
        WHERE ST_DWithin(the_geom, ST_SetSRID(ST_MakePoint($1, $2), 4326), 0.001)
          AND id != $3
        ORDER BY ST_Distance(the_geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        LIMIT 5
      `;
      
      const nearbyResult = await pgClient.query(nearbyQuery, [node.lng, node.lat, nodeId]);
      
      if (nearbyResult.rows.length > 0) {
        console.log(`\n📍 Nearby nodes (within ~100m):`);
        for (const nearby of nearbyResult.rows) {
          console.log(`   • Node ${nearby.node_id}: (${nearby.lat}, ${nearby.lng}) - ${nearby.distance_meters.toFixed(2)}m away`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error looking up node coordinates:', error);
  } finally {
    await pgClient.end();
  }
}

lookupNodeCoordinates().catch(console.error);
