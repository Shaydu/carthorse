#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as fs from 'fs';

async function exportSplitRecommendationsGeoJSON() {
  console.log('🗺️  Creating GeoJSON export of split/snap recommendations...');
  
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
    
    // Load the balanced model predictions
    const predictionsData = JSON.parse(fs.readFileSync('test-output/balanced_graphsage_predictions.json', 'utf8'));
    const predictions = predictionsData.predictions;
    
    console.log(`📈 Loaded ${predictions.length} predictions from balanced model`);
    
    // Get node information from the database
    const nodesQuery = `
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
      ORDER BY v.id
    `;
    
    const nodesResult = await pgClient.query(nodesQuery);
    console.log(`📍 Found ${nodesResult.rows.length} nodes in database`);
    
    // Create GeoJSON for all recommendations
    const allRecommendations = {
      type: "FeatureCollection",
      features: []
    };
    
    // Create GeoJSON for split recommendations only
    const splitRecommendations = {
      type: "FeatureCollection",
      features: []
    };
    
    // Create GeoJSON for merge recommendations only
    const mergeRecommendations = {
      type: "FeatureCollection",
      features: []
    };
    
    let splitCount = 0;
    let mergeCount = 0;
    let keepCount = 0;
    
    // Process each prediction
    for (let i = 0; i < predictions.length; i++) {
      const prediction = predictions[i];
      const node = nodesResult.rows[i];
      
      if (!node) {
        console.log(`⚠️  No database node found for prediction index ${i}`);
        continue;
      }
      
      const feature = {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [node.lng, node.lat, node.elevation]
        },
        properties: {
          node_id: node.id,
          prediction: prediction,
          label: prediction === 0 ? 'Keep as-is' : 
                 prediction === 1 ? 'Merge degree-2' : 
                 prediction === 2 ? 'Split Y/T' : 'Unknown',
          degree: node.degree,
          avg_incident_edge_length: node.avg_incident_edge_length,
          action_required: prediction !== 0,
          priority: prediction === 2 ? 'high' : prediction === 1 ? 'medium' : 'low',
          color: prediction === 0 ? "#00FF00" : // Green for keep
                 prediction === 1 ? "#FFA500" : // Orange for merge
                 prediction === 2 ? "#FF0000" : "#000000", // Red for split
          marker_size: prediction === 0 ? "small" : "large",
          marker_symbol: prediction === 0 ? "circle" : 
                        prediction === 1 ? "triangle" : "square"
        }
      };
      
      // Add to all recommendations
      allRecommendations.features.push(feature);
      
      // Add to specific collections
      if (prediction === 2) {
        splitRecommendations.features.push(feature);
        splitCount++;
      } else if (prediction === 1) {
        mergeRecommendations.features.push(feature);
        mergeCount++;
      } else {
        keepCount++;
      }
    }
    
    // Save all recommendations
    const allPath = `test-output/all-model-recommendations-${Date.now()}.geojson`;
    fs.writeFileSync(allPath, JSON.stringify(allRecommendations, null, 2));
    
    // Save split recommendations only
    const splitPath = `test-output/split-recommendations-${Date.now()}.geojson`;
    fs.writeFileSync(splitPath, JSON.stringify(splitRecommendations, null, 2));
    
    // Save merge recommendations only
    const mergePath = `test-output/merge-recommendations-${Date.now()}.geojson`;
    fs.writeFileSync(mergePath, JSON.stringify(mergeRecommendations, null, 2));
    
    console.log(`\n📊 Recommendations Summary:`);
    console.log(`   • Keep as-is: ${keepCount} nodes (${(keepCount/predictions.length*100).toFixed(1)}%)`);
    console.log(`   • Merge degree-2: ${mergeCount} nodes (${(mergeCount/predictions.length*100).toFixed(1)}%)`);
    console.log(`   • Split Y/T: ${splitCount} nodes (${(splitCount/predictions.length*100).toFixed(1)}%)`);
    
    console.log(`\n💾 GeoJSON exports saved:`);
    console.log(`   🗺️  All recommendations: ${allPath}`);
    console.log(`   ✂️  Split recommendations only: ${splitPath}`);
    console.log(`   🔗 Merge recommendations only: ${mergePath}`);
    
    // Show some examples of split recommendations
    if (splitCount > 0) {
      console.log(`\n✂️  Y/T Split Recommendations (first 10):`);
      splitRecommendations.features.slice(0, 10).forEach((feature, index) => {
        const props = feature.properties;
        console.log(`   ${index + 1}. Node ${props.node_id}: degree=${props.degree}, pos=(${feature.geometry.coordinates[1]}, ${feature.geometry.coordinates[0]})`);
      });
    }
    
    // Show some examples of merge recommendations
    if (mergeCount > 0) {
      console.log(`\n🔗 Merge Recommendations (first 10):`);
      mergeRecommendations.features.slice(0, 10).forEach((feature, index) => {
        const props = feature.properties;
        console.log(`   ${index + 1}. Node ${props.node_id}: degree=${props.degree}, pos=(${feature.geometry.coordinates[1]}, ${feature.geometry.coordinates[0]})`);
      });
    } else {
      console.log(`\n🔗 No merge recommendations (no class 1 examples in training data)`);
    }
    
    // Create a summary report
    const summaryReport = {
      export_timestamp: new Date().toISOString(),
      staging_schema: stagingSchema,
      model_type: 'BalancedGraphSAGE',
      total_nodes: predictions.length,
      recommendations: {
        keep_as_is: keepCount,
        merge_degree2: mergeCount,
        split_yt: splitCount
      },
      percentages: {
        keep_as_is: (keepCount/predictions.length*100).toFixed(1),
        merge_degree2: (mergeCount/predictions.length*100).toFixed(1),
        split_yt: (splitCount/predictions.length*100).toFixed(1)
      },
      files: {
        all_recommendations: allPath,
        split_recommendations: splitPath,
        merge_recommendations: mergePath
      }
    };
    
    const summaryPath = `test-output/recommendations-summary-${Date.now()}.json`;
    fs.writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2));
    
    console.log(`\n📋 Summary report: ${summaryPath}`);
    
    return {
      allPath,
      splitPath,
      mergePath,
      summaryPath,
      counts: { keepCount, mergeCount, splitCount }
    };
    
  } catch (error) {
    console.error('❌ Error exporting split recommendations:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the function
if (require.main === module) {
  exportSplitRecommendationsGeoJSON()
    .then(result => {
      console.log('\n🎉 GeoJSON export complete!');
      console.log(`📊 Split recommendations: ${result.counts.splitCount} nodes`);
      console.log(`📊 Merge recommendations: ${result.counts.mergeCount} nodes`);
    })
    .catch(error => {
      console.error('❌ Failed to export split recommendations:', error);
      process.exit(1);
    });
}

export { exportSplitRecommendationsGeoJSON };

