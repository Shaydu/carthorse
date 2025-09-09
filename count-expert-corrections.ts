import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function countExpertCorrections() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);
  
  try {
    await pgClient.connect();
    console.log('✅ Connected to database');
    console.log('🔍 Checking expert corrections...');
    
    // Count nodes with confidence = 1.0 (these are our expert corrections)
    const result = await pgClient.query(`
      SELECT 
        prediction,
        COUNT(*) as count,
        CASE 
          WHEN prediction = 0 THEN 'Keep as-is'
          WHEN prediction = 1 THEN 'Merge degree-2'
          WHEN prediction = 2 THEN 'Split Y/T'
        END as label
      FROM ${schema}.graphsage_predictions 
      WHERE confidence = 1.0
      GROUP BY prediction
      ORDER BY prediction
    `);
    
    console.log('\n📊 Expert corrections (confidence = 1.0):');
    let total = 0;
    result.rows.forEach(row => {
      console.log(`   • ${row.label}: ${row.count} nodes`);
      total += parseInt(row.count);
    });
    console.log(`\nTotal expert corrections: ${total}`);
    
    // Also check the specific problem nodes we identified
    const problemNodes = [231, 181, 182, 185, 177, 106, 105, 23];
    console.log('\n🎯 Checking specific problem nodes:');
    
    for (const nodeId of problemNodes) {
      const nodeResult = await pgClient.query(`
        SELECT prediction, confidence, 
               CASE 
                 WHEN prediction = 0 THEN 'Keep as-is'
                 WHEN prediction = 1 THEN 'Merge degree-2'
                 WHEN prediction = 2 THEN 'Split Y/T'
               END as label
        FROM ${schema}.graphsage_predictions 
        WHERE node_id = $1
      `, [nodeId]);
      
      if (nodeResult.rows.length > 0) {
        const node = nodeResult.rows[0];
        console.log(`   • Node ${nodeId}: ${node.label} (confidence: ${node.confidence})`);
      } else {
        console.log(`   • Node ${nodeId}: No prediction found`);
      }
    }

    // Check all predictions by confidence level
    console.log('\n📈 All predictions by confidence:');
    const confidenceResult = await pgClient.query(`
      SELECT 
        confidence,
        COUNT(*) as count,
        CASE 
          WHEN confidence = 1.0 THEN 'Expert corrections'
          WHEN confidence = 0.8 THEN 'Model predictions'
          ELSE 'Other'
        END as type
      FROM ${schema}.graphsage_predictions 
      GROUP BY confidence
      ORDER BY confidence DESC
    `);
    
    confidenceResult.rows.forEach(row => {
      console.log(`   • Confidence ${row.confidence}: ${row.count} nodes (${row.type})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

countExpertCorrections().catch(console.error);
