const { Pool } = require('pg');
const fs = require('fs');
const yaml = require('js-yaml');

// Load configuration from carthorse.config.yaml
let config;
try {
  const configPath = './configs/carthorse.config.yaml';
  const configFile = fs.readFileSync(configPath, 'utf8');
  const yamlConfig = yaml.load(configFile);
  config = yamlConfig.database.environments.development;
} catch (error) {
  console.error('❌ Error loading config:', error.message);
  process.exit(1);
}

const pool = new Pool(config);

async function exportNetworkComponents() {
  try {
    console.log('🔍 Finding most recent staging schema...');
    
    // Find the most recent staging schema
    const schemaResult = await pool.query(`
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
    console.log(`📁 Using staging schema: ${stagingSchema}`);
    
    // First, ensure we have component information
    console.log('🔗 Running pgr_connectedComponents...');
    await pool.query(`
      ALTER TABLE ${stagingSchema}.ways_noded_vertices_pgr 
      ADD COLUMN IF NOT EXISTS component INTEGER
    `);
    
    await pool.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr 
      SET component = NULL
    `);
    
    const componentsResult = await pool.query(`
      SELECT (pgr_connectedComponents(
        'SELECT id, source, target, length_km as cost, length_km as reverse_cost FROM ${stagingSchema}.ways_noded'
      )).* 
    `);
    
    // Update vertices with component information
    for (const row of componentsResult.rows) {
      await pool.query(`
        UPDATE ${stagingSchema}.ways_noded_vertices_pgr 
        SET component = $1 
        WHERE id = $2
      `, [row.component, row.node]);
    }
    
    // Get component statistics
    const componentStats = await pool.query(`
      SELECT 
        component,
        COUNT(*) as node_count,
        COUNT(CASE WHEN cnt = 1 THEN 1 END) as endpoint_count,
        COUNT(CASE WHEN cnt >= 2 THEN 1 END) as intersection_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE component IS NOT NULL
      GROUP BY component
      ORDER BY component
    `);
    
    console.log('📊 Component statistics:');
    componentStats.rows.forEach(row => {
      console.log(`  Component ${row.component}: ${row.node_count} nodes (${row.endpoint_count} endpoints, ${row.intersection_count} intersections)`);
    });
    
    // Export edges with component colors
    console.log('🎨 Exporting edges with component colors...');
    const edgesResult = await pool.query(`
      SELECT 
        wn.id,
        wn.source,
        wn.target,
        wn.length_km,
        wn.elevation_gain,
        wn.elevation_loss,
        ST_AsGeoJSON(wn.the_geom) as geojson_geom,
        v1.component as source_component,
        v2.component as target_component,
        CASE 
          WHEN v1.component = v2.component THEN v1.component
          ELSE -1  -- Edge connects different components (shouldn't happen in a properly connected graph)
        END as edge_component,
        em.trail_name
      FROM ${stagingSchema}.ways_noded wn
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v1 ON wn.source = v1.id
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON wn.target = v2.id
      LEFT JOIN ${stagingSchema}.edge_mapping em ON wn.id = em.pg_id
      WHERE v1.component IS NOT NULL AND v2.component IS NOT NULL
      ORDER BY edge_component, wn.id
    `);
    
    // Create color palette for components
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
      '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7BDE2'
    ];
    
    // Debug geometry format
    if (edgesResult.rows.length > 0) {
      console.log('🔍 Debug - sample geometry:', typeof edgesResult.rows[0].the_geom, edgesResult.rows[0].the_geom?.substring(0, 50));
    }
    
    // Create GeoJSON features
    const features = edgesResult.rows.map((row, index) => {
      const component = row.edge_component;
      const color = component >= 0 && component < colors.length ? colors[component] : '#FF0000';
      
      return {
        type: 'Feature',
        properties: {
          id: row.id,
          source: row.source,
          target: row.target,
          length_km: row.length_km,
          elevation_gain: row.elevation_gain,
          elevation_loss: row.elevation_loss,
          source_component: row.source_component,
          target_component: row.target_component,
          edge_component: row.edge_component,
          trail_name: row.trail_name,
          color: color,
          stroke: color,
          stroke_width: 2,
          type: 'edge'
        },
        geometry: JSON.parse(row.geojson_geom)
      };
    });
    
    // Add node features
    console.log('📍 Exporting nodes with component colors...');
    const nodesResult = await pool.query(`
      SELECT 
        id,
        cnt as degree,
        component,
        ST_AsGeoJSON(the_geom) as geojson_geom,
        CASE 
          WHEN cnt >= 3 THEN 'intersection'
          WHEN cnt = 2 THEN 'connector'
          WHEN cnt = 1 THEN 'endpoint'
          ELSE 'unknown'
        END as node_type
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE component IS NOT NULL
      ORDER BY component, id
    `);
    
    const nodeFeatures = nodesResult.rows.map(row => {
      const component = row.component;
      const color = component >= 0 && component < colors.length ? colors[component] : '#FF0000';
      
      return {
        type: 'Feature',
        properties: {
          id: row.id,
          degree: row.degree,
          component: row.component,
          node_type: row.node_type,
          color: color,
          type: 'node'
        },
        geometry: JSON.parse(row.geojson_geom)
      };
    });
    
    // Combine all features
    const allFeatures = [...features, ...nodeFeatures];
    
    const geojson = {
      type: 'FeatureCollection',
      features: allFeatures
    };
    
    // Write to file
    const outputPath = 'test-output/network-components-visualization.geojson';
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported network components visualization to: ${outputPath}`);
    console.log(`📊 Total features: ${allFeatures.length} (${features.length} edges, ${nodeFeatures.length} nodes)`);
    
    // Show component summary
    const componentSummary = {};
    edgesResult.rows.forEach(row => {
      const comp = row.edge_component;
      if (!componentSummary[comp]) {
        componentSummary[comp] = { edges: 0, trails: new Set() };
      }
      componentSummary[comp].edges++;
      if (row.trail_name) {
        componentSummary[comp].trails.add(row.trail_name);
      }
    });
    
    console.log('\n📋 Component Summary:');
    Object.entries(componentSummary).forEach(([component, data]) => {
      console.log(`  Component ${component}: ${data.edges} edges, ${data.trails.size} unique trails`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

exportNetworkComponents();
