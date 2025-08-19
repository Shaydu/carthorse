import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export interface NetworkAnalysisConfig {
  stagingSchema: string;
  outputPath: string;
}

export interface NetworkComponentStats {
  component: number;
  nodeCount: number;
  endpointCount: number;
  intersectionCount: number;
  edgeCount: number;
  uniqueTrails: number;
}

export class NetworkAnalysisService {
  private pool: Pool;
  private config: NetworkAnalysisConfig;

  constructor(pool: Pool, config: NetworkAnalysisConfig) {
    this.pool = pool;
    this.config = config;
  }

  async analyzeNetworkComponents(): Promise<{
    components: NetworkComponentStats[];
    totalFeatures: number;
    outputPath: string;
  }> {
    console.log('🔍 Finding staging schema...');
    console.log(`📁 Using staging schema: ${this.config.stagingSchema}`);

    // Run pgr_connectedComponents to identify network components
    console.log('🔗 Running pgr_connectedComponents...');
    await this.pool.query(`
      ALTER TABLE ${this.config.stagingSchema}.ways_noded_vertices_pgr 
      ADD COLUMN IF NOT EXISTS component INTEGER;
    `);

    await this.pool.query(`
      UPDATE ${this.config.stagingSchema}.ways_noded_vertices_pgr 
      SET component = NULL;
    `);

    const componentsResult = await this.pool.query(`
      SELECT (pgr_connectedComponents(
        'SELECT id, source, target, length_km as cost, length_km as reverse_cost 
         FROM ${this.config.stagingSchema}.ways_noded'
      )).*;
    `);

    // Update component column with results
    for (const row of componentsResult.rows) {
      await this.pool.query(`
        UPDATE ${this.config.stagingSchema}.ways_noded_vertices_pgr 
        SET component = $1 
        WHERE id = $2
      `, [row.component, row.node]);
    }

    // Get component statistics
    const componentStats = await this.pool.query(`
      SELECT 
        v.component,
        COUNT(*) as node_count,
        COUNT(CASE WHEN v.cnt = 1 THEN 1 END) as endpoint_count,
        COUNT(CASE WHEN v.cnt >= 3 THEN 1 END) as intersection_count
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
      WHERE v.component IS NOT NULL
      GROUP BY v.component
      ORDER BY v.component
    `);

    console.log('📊 Component statistics:');
    componentStats.rows.forEach(row => {
      console.log(`  Component ${row.component}: ${row.node_count} nodes (${row.endpoint_count} endpoints, ${row.intersection_count} intersections)`);
    });

    // Export edges with component colors
    console.log('🎨 Exporting edges with component colors...');
    const edgesResult = await this.pool.query(`
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
      FROM ${this.config.stagingSchema}.ways_noded wn
      JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr v1 ON wn.source = v1.id
      JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr v2 ON wn.target = v2.id
      LEFT JOIN ${this.config.stagingSchema}.edge_mapping em ON wn.id = em.pg_id
      WHERE v1.component IS NOT NULL AND v2.component IS NOT NULL
      ORDER BY edge_component, wn.id
    `);

    // Create color palette for components
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
      '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7BDE2'
    ];

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
    const nodesResult = await this.pool.query(`
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
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
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

    // Create GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      properties: {
        name: 'Network Components Analysis',
        description: 'Visualization of disconnected network components',
        generated_at: new Date().toISOString(),
        total_features: allFeatures.length,
        total_edges: features.length,
        total_nodes: nodeFeatures.length,
        components: componentStats.rows.map(row => ({
          component: row.component,
          node_count: parseInt(row.node_count),
          endpoint_count: parseInt(row.endpoint_count),
          intersection_count: parseInt(row.intersection_count)
        }))
      },
      features: allFeatures
    };

    // Ensure output directory exists
    const outputDir = path.dirname(this.config.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write GeoJSON file
    fs.writeFileSync(this.config.outputPath, JSON.stringify(geojson, null, 2));
    console.log(`✅ Exported network components visualization to: ${this.config.outputPath}`);

    // Get detailed component statistics
    const detailedStats = await this.pool.query(`
      SELECT 
        v.component,
        COUNT(DISTINCT v.id) as node_count,
        COUNT(CASE WHEN v.cnt = 1 THEN 1 END) as endpoint_count,
        COUNT(CASE WHEN v.cnt >= 3 THEN 1 END) as intersection_count,
        COUNT(DISTINCT wn.id) as edge_count,
        COUNT(DISTINCT em.trail_name) as unique_trails
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
      LEFT JOIN ${this.config.stagingSchema}.ways_noded wn ON v.id = wn.source OR v.id = wn.target
      LEFT JOIN ${this.config.stagingSchema}.edge_mapping em ON wn.id = em.pg_id
      WHERE v.component IS NOT NULL
      GROUP BY v.component
      ORDER BY v.component
    `);

    const components: NetworkComponentStats[] = detailedStats.rows.map(row => ({
      component: row.component,
      nodeCount: parseInt(row.node_count),
      endpointCount: parseInt(row.endpoint_count),
      intersectionCount: parseInt(row.intersection_count),
      edgeCount: parseInt(row.edge_count),
      uniqueTrails: parseInt(row.unique_trails)
    }));

    console.log(`📊 Total features: ${allFeatures.length} (${features.length} edges, ${nodeFeatures.length} nodes)`);
    console.log('\n📋 Component Summary:');
    components.forEach(comp => {
      console.log(`  Component ${comp.component}: ${comp.edgeCount} edges, ${comp.uniqueTrails} unique trails`);
    });

    return {
      components,
      totalFeatures: allFeatures.length,
      outputPath: this.config.outputPath
    };
  }
}
