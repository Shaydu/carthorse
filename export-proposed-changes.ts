import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';
import * as fs from 'fs';
import * as path from 'path';

async function exportProposedChanges() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Get degree-3+ nodes that should be changed from "Keep as-is" → "Split Y/T"
    console.log('\n🔍 Getting degree-3+ nodes for "Keep as-is" → "Split Y/T"...');
    
    const degree3Query = `
      SELECT 
        p.node_id,
        p.prediction as current_prediction,
        p.confidence,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        ST_Z(v.the_geom) as elevation,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) as degree,
        ST_AsGeoJSON(v.the_geom) as geometry
      FROM ${schema}.graphsage_predictions p
      JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
      WHERE p.prediction = 0 
      AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) >= 3
      ORDER BY p.node_id
    `;
    
    const degree3Result = await pgClient.query(degree3Query);
    console.log(`   Found ${degree3Result.rows.length} degree-3+ nodes`);

    // Get degree-1 nodes that should be changed from "Merge degree-2" → "Keep as-is"
    console.log('\n🔍 Getting degree-1 nodes for "Merge degree-2" → "Keep as-is"...');
    
    const degree1Query = `
      SELECT 
        p.node_id,
        p.prediction as current_prediction,
        p.confidence,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        ST_Z(v.the_geom) as elevation,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) as degree,
        ST_AsGeoJSON(v.the_geom) as geometry
      FROM ${schema}.graphsage_predictions p
      JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
      WHERE p.prediction = 1 
      AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 1
      ORDER BY p.node_id
    `;
    
    const degree1Result = await pgClient.query(degree1Query);
    console.log(`   Found ${degree1Result.rows.length} degree-1 nodes`);

    // Get degree-2 nodes that might be changed from "Keep as-is" → "Merge degree-2"
    console.log('\n🔍 Getting degree-2 nodes for "Keep as-is" → "Merge degree-2"...');
    
    const degree2Query = `
      SELECT 
        p.node_id,
        p.prediction as current_prediction,
        p.confidence,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        ST_Z(v.the_geom) as elevation,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) as degree,
        ST_AsGeoJSON(v.the_geom) as geometry
      FROM ${schema}.graphsage_predictions p
      JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
      WHERE p.prediction = 0 
      AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 2
      ORDER BY p.node_id
    `;
    
    const degree2Result = await pgClient.query(degree2Query);
    console.log(`   Found ${degree2Result.rows.length} degree-2 nodes`);

    // Create GeoJSON features for each category
    const features: any[] = [];

    // Degree-3+ nodes (Keep as-is → Split Y/T)
    degree3Result.rows.forEach(node => {
      features.push({
        type: "Feature",
        properties: {
          node_id: node.node_id,
          current_prediction: node.current_prediction,
          current_label: "Keep as-is",
          proposed_prediction: 2,
          proposed_label: "Split Y/T",
          degree: node.degree,
          confidence: node.confidence,
          elevation: node.elevation,
          change_type: "degree3_to_split",
          change_description: `Degree-${node.degree} intersection should be split (Y/T)`
        },
        geometry: JSON.parse(node.geometry)
      });
    });

    // Degree-1 nodes (Merge degree-2 → Keep as-is)
    degree1Result.rows.forEach(node => {
      features.push({
        type: "Feature",
        properties: {
          node_id: node.node_id,
          current_prediction: node.current_prediction,
          current_label: "Merge degree-2",
          proposed_prediction: 0,
          proposed_label: "Keep as-is",
          degree: node.degree,
          confidence: node.confidence,
          elevation: node.elevation,
          change_type: "degree1_to_keep",
          change_description: `Degree-${node.degree} endpoint should be kept as-is`
        },
        geometry: JSON.parse(node.geometry)
      });
    });

    // Degree-2 nodes (Keep as-is → Merge degree-2)
    degree2Result.rows.forEach(node => {
      features.push({
        type: "Feature",
        properties: {
          node_id: node.node_id,
          current_prediction: node.current_prediction,
          current_label: "Keep as-is",
          proposed_prediction: 1,
          proposed_label: "Merge degree-2",
          degree: node.degree,
          confidence: node.confidence,
          elevation: node.elevation,
          change_type: "degree2_to_merge",
          change_description: `Degree-${node.degree} connector might be merged`
        },
        geometry: JSON.parse(node.geometry)
      });
    });

    // Create the GeoJSON
    const geojson = {
      type: "FeatureCollection",
      properties: {
        title: "Proposed GraphSAGE Prediction Changes",
        description: "Nodes that should have their predictions updated",
        schema: schema,
        generated_at: new Date().toISOString(),
        summary: {
          degree3_to_split: degree3Result.rows.length,
          degree1_to_keep: degree1Result.rows.length,
          degree2_to_merge: degree2Result.rows.length,
          total_changes: features.length
        }
      },
      features: features
    };

    // Save GeoJSON file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join('test-output', `proposed-graphsage-changes-${schema}-${timestamp}.geojson`);
    
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`\n✅ Exported proposed changes to: ${outputPath}`);
    console.log(`   • ${degree3Result.rows.length} degree-3+ nodes: "Keep as-is" → "Split Y/T"`);
    console.log(`   • ${degree1Result.rows.length} degree-1 nodes: "Merge degree-2" → "Keep as-is"`);
    console.log(`   • ${degree2Result.rows.length} degree-2 nodes: "Keep as-is" → "Merge degree-2"`);
    console.log(`   • Total: ${features.length} proposed changes`);

    // Also create a simple CSV for easy review
    const csvPath = path.join('test-output', `proposed-changes-${schema}-${timestamp}.csv`);
    const csvHeader = 'node_id,lat,lng,elevation,degree,current_prediction,current_label,proposed_prediction,proposed_label,confidence,change_type,change_description\n';
    const csvRows = features.map(f => {
      const props = f.properties;
      return `${props.node_id},${props.geometry.coordinates[1]},${props.geometry.coordinates[0]},${props.elevation},${props.degree},${props.current_prediction},"${props.current_label}",${props.proposed_prediction},"${props.proposed_label}",${props.confidence},${props.change_type},"${props.change_description}"`;
    }).join('\n');
    
    fs.writeFileSync(csvPath, csvHeader + csvRows);
    console.log(`   • Also exported CSV: ${csvPath}`);

    console.log(`\n🗺️  You can now:`);
    console.log(`   1. Open the GeoJSON in QGIS, ArcGIS, or online tools like geojson.io`);
    console.log(`   2. Review the CSV file for detailed information`);
    console.log(`   3. Confirm which changes you want to apply`);
    console.log(`   4. Run the fix script with your approved changes`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

exportProposedChanges().catch(console.error);
