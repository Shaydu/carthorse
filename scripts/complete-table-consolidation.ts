#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface ConsolidationConfig {
  stagingSchema: string;
  pgClient: Pool;
}

export class TableConsolidationFixer {
  private config: ConsolidationConfig;

  constructor(config: ConsolidationConfig) {
    this.config = config;
  }

  async completeConsolidation(): Promise<void> {
    console.log('🔄 Starting table consolidation fix...');
    
    try {
      // Step 1: Check current state
      await this.analyzeCurrentState();
      
      // Step 2: Find missing edges in ways_noded
      const missingEdges = await this.findMissingEdges();
      
      if (missingEdges.length === 0) {
        console.log('✅ No missing edges found - consolidation already complete');
        return;
      }
      
      console.log(`🔍 Found ${missingEdges.length} missing edges in ways_noded`);
      
      // Step 3: Add missing edges to ways_noded
      await this.addMissingEdges(missingEdges);
      
      // Step 4: Recreate topology
      await this.recreateTopology();
      
      // Step 5: Verify consolidation
      await this.verifyConsolidation();
      
      // Step 6: Remove routing_edges table (optional - keep for now)
      // await this.removeRoutingEdgesTable();
      
      console.log('✅ Table consolidation completed successfully!');
      
    } catch (error) {
      console.error('❌ Error during consolidation:', error);
      throw error;
    }
  }

  private async analyzeCurrentState(): Promise<void> {
    console.log('📊 Analyzing current table state...');
    
    const stats = await this.config.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded) as ways_noded_count,
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.routing_edges) as routing_edges_count,
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr) as vertices_count,
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.routing_nodes) as routing_nodes_count
    `);
    
    const row = stats.rows[0];
    console.log(`📈 Current counts:`);
    console.log(`  - ways_noded: ${row.ways_noded_count}`);
    console.log(`  - routing_edges: ${row.routing_edges_count}`);
    console.log(`  - ways_noded_vertices_pgr: ${row.vertices_count}`);
    console.log(`  - routing_nodes: ${row.routing_nodes_count}`);
  }

  private async findMissingEdges(): Promise<any[]> {
    console.log('🔍 Finding missing edges in ways_noded...');
    
    const missingEdges = await this.config.pgClient.query(`
      SELECT 
        re.id,
        re.from_node_id as source,
        re.to_node_id as target,
        re.trail_id,
        re.trail_name,
        re.length_km as cost,
        re.length_km as reverse_cost,
        re.elevation_gain,
        re.elevation_loss,
        re.geometry as the_geom,
        re.trail_id as app_uuid,
        re.trail_name as name,
        re.trail_id as original_trail_uuid,
        re.trail_name as original_trail_name,
        'Trail' as trail_type,
        'dirt' as surface,
        'yes' as difficulty,
        'cotrex' as trail_source,
        re.trail_id as trail_uuid,
        re.trail_name as trail_name
      FROM ${this.config.stagingSchema}.routing_edges re
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.config.stagingSchema}.ways_noded wn 
        WHERE wn.source = re.from_node_id AND wn.target = re.to_node_id
      )
      AND re.from_node_id IS NOT NULL 
      AND re.to_node_id IS NOT NULL
      AND re.length_km > 0
    `);
    
    console.log(`🔍 Found ${missingEdges.rows.length} missing edges`);
    
    // Log some examples
    if (missingEdges.rows.length > 0) {
      console.log('📋 Example missing edges:');
      missingEdges.rows.slice(0, 5).forEach(edge => {
        console.log(`  - ${edge.source} → ${edge.target}: ${edge.trail_name} (${edge.cost}km)`);
      });
    }
    
    return missingEdges.rows;
  }

  private async addMissingEdges(missingEdges: any[]): Promise<void> {
    if (missingEdges.length === 0) {
      console.log('✅ No missing edges to add');
      return;
    }
    
    console.log(`➕ Adding ${missingEdges.length} missing edges to ways_noded...`);
    
    // Get the next available ID
    const maxIdResult = await this.config.pgClient.query(`
      SELECT COALESCE(MAX(id), 0) as max_id FROM ${this.config.stagingSchema}.ways_noded
    `);
    const maxId = maxIdResult.rows[0].max_id;
    
    // Insert missing edges
    for (let i = 0; i < missingEdges.length; i++) {
      const edge = missingEdges[i];
      const newId = maxId + i + 1;
      
      await this.config.pgClient.query(`
        INSERT INTO ${this.config.stagingSchema}.ways_noded (
          id, source, target, cost, reverse_cost, elevation_gain, elevation_loss,
          the_geom, app_uuid, name, original_trail_uuid, original_trail_name,
          trail_type, surface, difficulty, trail_source, trail_uuid, trail_name,
          length_km
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `, [
        newId, edge.source, edge.target, edge.cost, edge.reverse_cost,
        edge.elevation_gain, edge.elevation_loss, edge.the_geom, edge.app_uuid,
        edge.name, edge.original_trail_uuid, edge.original_trail_name,
        edge.trail_type, edge.surface, edge.difficulty, edge.trail_source,
        edge.trail_uuid, edge.trail_name, edge.cost
      ]);
    }
    
    console.log(`✅ Added ${missingEdges.length} edges to ways_noded`);
  }

  private async recreateTopology(): Promise<void> {
    console.log('🔄 Recreating pgRouting topology...');
    
    // Drop existing topology
    await this.config.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways_noded_vertices_pgr CASCADE
    `);
    
    // Recreate topology
    await this.config.pgClient.query(`
      SELECT pgr_createTopology('${this.config.stagingSchema}.ways_noded', 0.000001, 'the_geom', 'id')
    `);
    
    console.log('✅ Topology recreated successfully');
  }

  private async verifyConsolidation(): Promise<void> {
    console.log('🔍 Verifying consolidation...');
    
    // Check if all routing_edges are now in ways_noded
    const verification = await this.config.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.routing_edges) as routing_edges_count,
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded) as ways_noded_count,
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.routing_edges re
         WHERE NOT EXISTS (
           SELECT 1 FROM ${this.config.stagingSchema}.ways_noded wn 
           WHERE wn.source = re.from_node_id AND wn.target = re.to_node_id
         )) as still_missing_count
    `);
    
    const row = verification.rows[0];
    console.log(`📊 Verification results:`);
    console.log(`  - routing_edges: ${row.routing_edges_count}`);
    console.log(`  - ways_noded: ${row.ways_noded_count}`);
    console.log(`  - still missing: ${row.still_missing_count}`);
    
    if (row.still_missing_count > 0) {
      throw new Error(`❌ Still missing ${row.still_missing_count} edges after consolidation`);
    }
    
    console.log('✅ Consolidation verified successfully');
  }

  private async removeRoutingEdgesTable(): Promise<void> {
    console.log('🗑️ Removing routing_edges table...');
    
    await this.config.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.routing_edges CASCADE
    `);
    
    console.log('✅ routing_edges table removed');
  }
}

// CLI execution
async function main() {
  const stagingSchema = process.argv[2];
  
  if (!stagingSchema) {
    console.error('❌ Usage: ts-node scripts/complete-table-consolidation.ts <staging_schema>');
    process.exit(1);
  }
  
  const pgClient = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  
  const fixer = new TableConsolidationFixer({
    stagingSchema,
    pgClient
  });
  
  try {
    await fixer.completeConsolidation();
  } catch (error) {
    console.error('❌ Consolidation failed:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  main();
}
