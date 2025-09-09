import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function quickCheck() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);
  
  try {
    console.log('Connecting...');
    await pgClient.connect();
    console.log('✅ Connected');
    
    console.log('Running query...');
    const result = await pgClient.query(`
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN prediction = 0 THEN 1 END) as keep_as_is,
             COUNT(CASE WHEN prediction = 1 THEN 1 END) as merge_degree2,
             COUNT(CASE WHEN prediction = 2 THEN 1 END) as split_yt
      FROM ${schema}.graphsage_predictions
    `);
    
    console.log('Predictions summary:', result.rows[0]);
    
    // Check a few problematic cases
    console.log('\nChecking a few degree-3 nodes...');
    const degree3Result = await pgClient.query(`
      SELECT 
        p.node_id,
        p.prediction,
        p.confidence,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) as degree
      FROM ${schema}.graphsage_predictions p
      WHERE (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 3
      LIMIT 5
    `);
    
    console.log('Degree-3 nodes:');
    degree3Result.rows.forEach(row => {
      const label = ['Keep as-is', 'Merge degree-2', 'Split Y/T'][row.prediction];
      console.log(`  Node ${row.node_id}: ${label} (confidence: ${row.confidence})`);
    });
    
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

quickCheck();
