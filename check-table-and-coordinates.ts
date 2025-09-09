import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function checkTableAndCoordinates() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Check graphsage_predictions table structure
    console.log('\n🔍 Checking graphsage_predictions table structure...');
    
    const result = await pgClient.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 
      AND table_name = 'graphsage_predictions'
      ORDER BY ordinal_position
    `, [schema]);
    
    if (result.rows.length === 0) {
      console.log('❌ graphsage_predictions table does not exist');
      return;
    }
    
    console.log('Columns in graphsage_predictions:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    });
    
    // Check if there are any rows
    const countResult = await pgClient.query(`SELECT COUNT(*) FROM ${schema}.graphsage_predictions`);
    console.log(`\nTotal rows: ${countResult.rows[0].count}`);

    // Now let's look up coordinates for some of the problematic nodes
    console.log('\n🔍 Looking up coordinates for problematic nodes...');
    
    const problematicNodeIds = [237, 165, 351, 413, 606, 589, 612, 580, 553, 552, 537, 77];
    
    for (const nodeId of problematicNodeIds) {
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
      
      const nodeResult = await pgClient.query(query, [nodeId]);
      
      if (nodeResult.rows.length === 0) {
        console.log(`❌ Node ${nodeId}: NOT FOUND`);
        continue;
      }

      const node = nodeResult.rows[0];
      const nodeType = node.degree === 1 ? 'endpoint' : node.degree === 2 ? 'connector' : 'intersection';
      
      console.log(`✅ Node ${nodeId}: (${node.lat}, ${node.lng}) - degree ${node.degree} (${nodeType})`);
      
      // Check if this node has a prediction
      try {
        // Try different possible column names
        const possibleColumns = ['node_id', 'id', 'vertex_id'];
        let predResult = null;
        
        for (const col of possibleColumns) {
          try {
            const predQuery = `SELECT prediction, confidence FROM ${schema}.graphsage_predictions WHERE ${col} = $1`;
            predResult = await pgClient.query(predQuery, [nodeId]);
            if (predResult.rows.length > 0) {
              console.log(`   📊 Prediction found using column '${col}': ${predResult.rows[0].prediction} (confidence: ${predResult.rows[0].confidence})`);
              break;
            }
          } catch (e) {
            // Column doesn't exist, try next one
          }
        }
        
        if (!predResult || predResult.rows.length === 0) {
          console.log(`   ⚠️  No prediction found for node ${nodeId}`);
        }
        
      } catch (error) {
        console.log(`   ❌ Error checking predictions: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Let's also check what the actual data looks like in the predictions table
    console.log('\n🔍 Sample data from graphsage_predictions:');
    try {
      const sampleQuery = `SELECT * FROM ${schema}.graphsage_predictions LIMIT 3`;
      const sampleResult = await pgClient.query(sampleQuery);
      
      if (sampleResult.rows.length > 0) {
        console.log('Sample rows:');
        sampleResult.rows.forEach((row, i) => {
          console.log(`  Row ${i + 1}:`, row);
        });
      } else {
        console.log('No data in predictions table');
      }
    } catch (error) {
      console.log(`Error getting sample data: ${error instanceof Error ? error.message : String(error)}`);
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

checkTableAndCoordinates().catch(console.error);
