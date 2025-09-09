import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

async function showGraphSAGEPredictions() {
  console.log('🔍 GraphSAGE Predictions Analysis');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node src/cli/show-graphsage-predictions.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Check if predictions exist
    const predictionsExistQuery = `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'graphsage_predictions'
      )
    `;
    
    const predictionsExist = await pgClient.query(predictionsExistQuery, [schema]);
    
    if (!predictionsExist.rows[0].exists) {
      console.log(`❌ No GraphSAGE predictions found in schema ${schema}`);
      console.log('   Run the training script first:');
      console.log(`   python scripts/graphsage/train_graphsage_direct.py ${schema} --user carthorse`);
      return;
    }

    // Get prediction summary
    console.log(`\n📊 GraphSAGE Predictions Summary for ${schema}:`);
    
    const summaryQuery = `
      SELECT 
        prediction,
        COUNT(*) as count,
        AVG(confidence) as avg_confidence,
        MIN(confidence) as min_confidence,
        MAX(confidence) as max_confidence
      FROM ${schema}.graphsage_predictions
      GROUP BY prediction
      ORDER BY prediction
    `;
    
    const summary = await pgClient.query(summaryQuery);
    
    const predictionLabels = {
      0: 'Keep as-is',
      1: 'Merge degree-2',
      2: 'Split Y/T intersection'
    };
    
    console.log('\n🏷️  Prediction Distribution:');
    for (const row of summary.rows) {
      const label = predictionLabels[row.prediction as keyof typeof predictionLabels];
      console.log(`   • ${label} (${row.prediction}): ${row.count} nodes`);
      console.log(`     Confidence: ${row.avg_confidence.toFixed(3)} avg (${row.min_confidence.toFixed(3)}-${row.max_confidence.toFixed(3)})`);
    }

    // Show detailed predictions for each category
    for (const row of summary.rows) {
      const prediction = row.prediction;
      const label = predictionLabels[prediction as keyof typeof predictionLabels];
      
      console.log(`\n🔍 Detailed ${label} Predictions:`);
      
      const detailQuery = `
        SELECT 
          p.node_id,
          p.prediction,
          p.confidence,
          v.the_geom,
          ST_X(v.the_geom) as x,
          ST_Y(v.the_geom) as y,
          ST_Z(v.the_geom) as z,
          (SELECT COUNT(*) FROM ${schema}.ways_noded e 
           WHERE e.source = p.node_id OR e.target = p.node_id) as degree
        FROM ${schema}.graphsage_predictions p
        LEFT JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
        WHERE p.prediction = $1
        ORDER BY p.confidence DESC
        LIMIT 10
      `;
      
      const details = await pgClient.query(detailQuery, [prediction]);
      
      if (details.rows.length === 0) {
        console.log(`   No ${label} predictions found`);
        continue;
      }
      
      console.log(`   Top ${Math.min(10, details.rows.length)} predictions by confidence:`);
      
      for (const detail of details.rows) {
        console.log(`   • Node ${detail.node_id}: confidence ${detail.confidence.toFixed(3)}, degree ${detail.degree}`);
        if (detail.x && detail.y && detail.z !== null) {
          console.log(`     Location: (${detail.x.toFixed(6)}, ${detail.y.toFixed(6)}, ${detail.z.toFixed(1)}m)`);
        } else {
          console.log(`     Location: (coordinates not available)`);
        }
        
        // Show connected edges for context
        const edgesQuery = `
          SELECT 
            e.id,
            e.source,
            e.target,
            e.length_km,
            CASE 
              WHEN e.source = $1 THEN 'outgoing'
              WHEN e.target = $1 THEN 'incoming'
            END as direction
          FROM ${schema}.ways_noded e
          WHERE e.source = $1 OR e.target = $1
          ORDER BY e.length_km
        `;
        
        const edges = await pgClient.query(edgesQuery, [detail.node_id]);
        
        if (edges.rows.length > 0) {
          console.log(`     Connected edges:`);
          for (const edge of edges.rows) {
            const otherNode = edge.source === detail.node_id ? edge.target : edge.source;
            console.log(`       - Edge ${edge.id}: ${detail.node_id} → ${otherNode} (${edge.length_km.toFixed(3)}km, ${edge.direction})`);
          }
        }
        console.log('');
      }
      
      if (details.rows.length === 10) {
        console.log(`   ... and ${row.count - 10} more ${label} predictions`);
      }
    }

    // Show what would be cleaned
    console.log('\n🧹 What Would Be Cleaned:');
    
    const mergeCount = summary.rows.find(r => r.prediction === 1)?.count || 0;
    const splitCount = summary.rows.find(r => r.prediction === 2)?.count || 0;
    
    if (mergeCount > 0) {
      console.log(`   • ${mergeCount} degree-2 nodes would be merged`);
      console.log(`     - ${mergeCount} nodes removed`);
      console.log(`     - ${mergeCount * 2} edges removed`);
      console.log(`     - ${mergeCount} new edges created`);
    }
    
    if (splitCount > 0) {
      console.log(`   • ${splitCount} Y/T intersections would be split`);
      console.log(`     - ${splitCount} new nodes created`);
      console.log(`     - ${splitCount} new edges created`);
    }
    
    if (mergeCount === 0 && splitCount === 0) {
      console.log('   • No cleaning actions would be performed');
    }

    // Show confidence distribution
    console.log('\n📈 Confidence Distribution:');
    
    const confidenceQuery = `
      SELECT 
        CASE 
          WHEN confidence >= 0.9 THEN 'Very High (0.9-1.0)'
          WHEN confidence >= 0.8 THEN 'High (0.8-0.9)'
          WHEN confidence >= 0.7 THEN 'Medium (0.7-0.8)'
          WHEN confidence >= 0.6 THEN 'Low (0.6-0.7)'
          ELSE 'Very Low (<0.6)'
        END as confidence_range,
        COUNT(*) as count
      FROM ${schema}.graphsage_predictions
      GROUP BY 
        CASE 
          WHEN confidence >= 0.9 THEN 'Very High (0.9-1.0)'
          WHEN confidence >= 0.8 THEN 'High (0.8-0.9)'
          WHEN confidence >= 0.7 THEN 'Medium (0.7-0.8)'
          WHEN confidence >= 0.6 THEN 'Low (0.6-0.7)'
          ELSE 'Very Low (<0.6)'
        END
      ORDER BY MIN(confidence) DESC
    `;
    
    const confidenceDist = await pgClient.query(confidenceQuery);
    
    for (const row of confidenceDist.rows) {
      console.log(`   • ${row.confidence_range}: ${row.count} predictions`);
    }

    console.log('\n💡 Next Steps:');
    console.log('   1. Review the predictions above');
    console.log('   2. Adjust confidence threshold if needed');
    console.log('   3. Run safe cleaning to create a cleaned copy');
    console.log('   4. Compare original vs cleaned network');

  } catch (error) {
    console.error('❌ Error analyzing predictions:', error);
  } finally {
    await pgClient.end();
  }
}

showGraphSAGEPredictions().catch(console.error);
