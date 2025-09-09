#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as fs from 'fs';

async function exportModelRecommendations() {
  console.log('📊 Exporting complete model recommendations...');
  
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
    
    // Load the improved model predictions
    const predictionsData = JSON.parse(fs.readFileSync('test-output/improved_graphsage_predictions.json', 'utf8'));
    const predictions = predictionsData.predictions;
    
    console.log(`📈 Loaded ${predictions.length} predictions from improved model`);
    
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
    
    // Create comprehensive recommendations export
    const recommendations = {
      metadata: {
        export_timestamp: new Date().toISOString(),
        staging_schema: stagingSchema,
        model_type: 'ImprovedGraphSAGE',
        total_nodes: predictions.length,
        model_performance: predictionsData.metadata
      },
      summary: {
        keep_as_is: 0,
        merge_degree2: 0,
        split_yt: 0
      },
      recommendations: []
    };
    
    // Process each prediction
    for (let i = 0; i < predictions.length; i++) {
      const prediction = predictions[i];
      const node = nodesResult.rows[i];
      
      if (!node) {
        console.log(`⚠️  No database node found for prediction index ${i}`);
        continue;
      }
      
      const recommendation = {
        node_id: node.id,
        coordinates: {
          lat: node.lat,
          lng: node.lng,
          elevation: node.elevation
        },
        features: {
          degree: node.degree,
          avg_incident_edge_length: node.avg_incident_edge_length
        },
        prediction: {
          value: prediction,
          label: prediction === 0 ? 'Keep as-is' : 
                 prediction === 1 ? 'Merge degree-2' : 
                 prediction === 2 ? 'Split Y/T' : 'Unknown',
          confidence: 0.9 // Placeholder - could be extracted from model if available
        },
        action_required: prediction !== 0,
        priority: prediction === 2 ? 'high' : prediction === 1 ? 'medium' : 'low'
      };
      
      recommendations.recommendations.push(recommendation);
      
      // Update summary
      if (prediction === 0) recommendations.summary.keep_as_is++;
      else if (prediction === 1) recommendations.summary.merge_degree2++;
      else if (prediction === 2) recommendations.summary.split_yt++;
    }
    
    // Save comprehensive export
    const exportPath = `test-output/complete-model-recommendations-${Date.now()}.json`;
    fs.writeFileSync(exportPath, JSON.stringify(recommendations, null, 2));
    
    console.log(`\n📊 Model Recommendations Summary:`);
    console.log(`   • Keep as-is: ${recommendations.summary.keep_as_is} nodes`);
    console.log(`   • Merge degree-2: ${recommendations.summary.merge_degree2} nodes`);
    console.log(`   • Split Y/T: ${recommendations.summary.split_yt} nodes`);
    console.log(`   • Total actions required: ${recommendations.summary.merge_degree2 + recommendations.summary.split_yt}`);
    
    // Show some examples of Y/T split recommendations
    const ytRecommendations = recommendations.recommendations.filter(r => r.prediction.value === 2);
    console.log(`\n✂️  Y/T Split Recommendations (first 10):`);
    ytRecommendations.slice(0, 10).forEach((rec, index) => {
      console.log(`   ${index + 1}. Node ${rec.node_id}: degree=${rec.features.degree}, pos=(${rec.coordinates.lat}, ${rec.coordinates.lng})`);
    });
    
    // Show some examples of merge recommendations
    const mergeRecommendations = recommendations.recommendations.filter(r => r.prediction.value === 1);
    if (mergeRecommendations.length > 0) {
      console.log(`\n🔗 Merge Recommendations (first 10):`);
      mergeRecommendations.slice(0, 10).forEach((rec, index) => {
        console.log(`   ${index + 1}. Node ${rec.node_id}: degree=${rec.features.degree}, pos=(${rec.coordinates.lat}, ${rec.coordinates.lng})`);
      });
    } else {
      console.log(`\n🔗 No merge recommendations (no class 1 examples in training data)`);
    }
    
    // Create a GeoJSON export for visualization
    const geojson = {
      type: "FeatureCollection",
      features: recommendations.recommendations.map(rec => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [rec.coordinates.lng, rec.coordinates.lat, rec.coordinates.elevation]
        },
        properties: {
          node_id: rec.node_id,
          prediction: rec.prediction.value,
          label: rec.prediction.label,
          degree: rec.features.degree,
          avg_incident_edge_length: rec.features.avg_incident_edge_length,
          action_required: rec.action_required,
          priority: rec.priority,
          color: rec.prediction.value === 0 ? "#00FF00" : // Green for keep
                 rec.prediction.value === 1 ? "#FFA500" : // Orange for merge
                 rec.prediction.value === 2 ? "#FF0000" : "#000000" // Red for split
        }
      }))
    };
    
    const geojsonPath = `test-output/model-recommendations-visualization-${Date.now()}.geojson`;
    fs.writeFileSync(geojsonPath, JSON.stringify(geojson, null, 2));
    
    console.log(`\n💾 Exports saved:`);
    console.log(`   📄 Complete recommendations: ${exportPath}`);
    console.log(`   🗺️  GeoJSON visualization: ${geojsonPath}`);
    
    return {
      recommendationsPath: exportPath,
      geojsonPath,
      summary: recommendations.summary
    };
    
  } catch (error) {
    console.error('❌ Error exporting model recommendations:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the function
if (require.main === module) {
  exportModelRecommendations()
    .then(result => {
      console.log('\n🎉 Model recommendations export complete!');
      console.log(`📊 Summary: ${result.summary.split_yt} Y/T splits, ${result.summary.merge_degree2} merges`);
    })
    .catch(error => {
      console.error('❌ Failed to export model recommendations:', error);
      process.exit(1);
    });
}

export { exportModelRecommendations };

