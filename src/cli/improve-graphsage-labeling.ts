import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

async function improveGraphSAGELabeling() {
  console.log('🔧 Improving GraphSAGE Labeling Logic');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node src/cli/improve-graphsage-labeling.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Analyze current network topology
    console.log(`\n🔍 Analyzing network topology in ${schema}...`);
    
    const topologyQuery = `
      SELECT 
        degree,
        COUNT(*) as node_count,
        AVG(avg_edge_length) as avg_edge_length
      FROM (
        SELECT 
          v.id,
          COUNT(e.id) as degree,
          AVG(COALESCE(e.length_km, 0.1)) as avg_edge_length
        FROM ${schema}.ways_noded_vertices_pgr v
        LEFT JOIN ${schema}.ways_noded e ON (e.source = v.id OR e.target = v.id)
        GROUP BY v.id
      ) node_stats
      GROUP BY degree
      ORDER BY degree
    `;
    
    const topology = await pgClient.query(topologyQuery);
    
    console.log('\n📊 Current Network Topology:');
    for (const row of topology.rows) {
      console.log(`   • Degree ${row.degree}: ${row.node_count} nodes (avg edge length: ${row.avg_edge_length.toFixed(3)}km)`);
    }

    // Check for potential Y/T intersections that should be split
    console.log('\n🔍 Identifying potential Y/T intersections...');
    
    const yIntersectionQuery = `
      SELECT 
        v.id,
        ST_X(v.the_geom) as x,
        ST_Y(v.the_geom) as y,
        ST_Z(v.the_geom) as z,
        COUNT(e.id) as degree,
        AVG(COALESCE(e.length_km, 0.1)) as avg_edge_length,
        MIN(COALESCE(e.length_km, 0.1)) as min_edge_length,
        MAX(COALESCE(e.length_km, 0.1)) as max_edge_length
      FROM ${schema}.ways_noded_vertices_pgr v
      LEFT JOIN ${schema}.ways_noded e ON (e.source = v.id OR e.target = v.id)
      GROUP BY v.id, v.the_geom
      HAVING COUNT(e.id) >= 3
      ORDER BY COUNT(e.id) DESC, AVG(COALESCE(e.length_km, 0.1))
    `;
    
    const yIntersections = await pgClient.query(yIntersectionQuery);
    
    console.log(`\n🎯 Found ${yIntersections.rows.length} potential Y/T intersections (degree >= 3):`);
    
    for (const node of yIntersections.rows.slice(0, 10)) { // Show top 10
      console.log(`   • Node ${node.id}: degree ${node.degree}, location (${node.x.toFixed(6)}, ${node.y.toFixed(6)}, ${node.z.toFixed(1)}m)`);
      console.log(`     Edge lengths: ${node.min_edge_length.toFixed(3)}-${node.max_edge_length.toFixed(3)}km (avg: ${node.avg_edge_length.toFixed(3)}km)`);
      
      // Check current prediction
      const predQuery = `SELECT prediction, confidence FROM ${schema}.graphsage_predictions WHERE node_id = $1`;
      const predResult = await pgClient.query(predQuery, [node.id]);
      
      if (predResult.rows.length > 0) {
        const pred = predResult.rows[0];
        const predLabel = pred.prediction === 0 ? 'Keep as-is' : pred.prediction === 1 ? 'Merge degree-2' : 'Split Y/T';
        console.log(`     Current prediction: ${predLabel} (confidence: ${pred.confidence.toFixed(3)})`);
      }
      console.log('');
    }

    // Suggest improved labeling rules
    console.log('\n💡 Suggested Improved Labeling Rules:');
    console.log('   1. Degree-2 nodes: Merge (current: ✅)');
    console.log('   2. Degree-3 nodes: Consider for Y/T splitting based on:');
    console.log('      - Edge length variance (high variance = likely Y/T)');
    console.log('      - Geographic context (trail intersections)');
    console.log('      - Manual override capability');
    console.log('   3. Degree-4+ nodes: Split Y/T (current: ✅)');
    
    // Show specific node 8 that you mentioned
    console.log('\n🎯 Analysis of Node 8 (your example):');
    const node8Query = `
      SELECT 
        v.id,
        ST_X(v.the_geom) as x,
        ST_Y(v.the_geom) as y,
        ST_Z(v.the_geom) as z,
        COUNT(e.id) as degree,
        ARRAY_AGG(e.length_km ORDER BY e.length_km) as edge_lengths,
        ARRAY_AGG(e.id ORDER BY e.length_km) as edge_ids
      FROM ${schema}.ways_noded_vertices_pgr v
      LEFT JOIN ${schema}.ways_noded e ON (e.source = v.id OR e.target = v.id)
      WHERE v.id = 8
      GROUP BY v.id, v.the_geom
    `;
    
    const node8 = await pgClient.query(node8Query);
    
    if (node8.rows.length > 0) {
      const n8 = node8.rows[0];
      console.log(`   • Node 8: degree ${n8.degree}, location (${n8.x.toFixed(6)}, ${n8.y.toFixed(6)}, ${n8.z.toFixed(1)}m)`);
      console.log(`   • Edge lengths: ${n8.edge_lengths.map((l: number) => l.toFixed(3)).join(', ')}km`);
      console.log(`   • Edge IDs: ${n8.edge_ids.join(', ')}`);
      
      // Calculate edge length variance
      const lengths = n8.edge_lengths.filter((l: number) => l !== null);
      const avgLength = lengths.reduce((a: number, b: number) => a + b, 0) / lengths.length;
      const variance = lengths.reduce((sum: number, l: number) => sum + Math.pow(l - avgLength, 2), 0) / lengths.length;
      const stdDev = Math.sqrt(variance);
      
      console.log(`   • Edge length stats: avg=${avgLength.toFixed(3)}km, std_dev=${stdDev.toFixed(3)}km`);
      console.log(`   • Coefficient of variation: ${(stdDev/avgLength).toFixed(3)}`);
      
      if (stdDev/avgLength > 0.5) {
        console.log(`   💡 High variance suggests this IS a Y/T intersection that should be split!`);
      } else {
        console.log(`   💡 Low variance suggests this might be a regular intersection`);
      }
    }

    console.log('\n🔧 Recommendations:');
    console.log('   1. Update labeling logic to consider degree-3 nodes for Y/T splitting');
    console.log('   2. Add edge length variance as a feature');
    console.log('   3. Add manual override capability for specific nodes');
    console.log('   4. Retrain GraphSAGE with improved labels');
    console.log('   5. Test on node 8 and similar cases');

  } catch (error) {
    console.error('❌ Error analyzing labeling:', error);
  } finally {
    await pgClient.end();
  }
}

improveGraphSAGELabeling().catch(console.error);

