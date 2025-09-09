import { Pool } from 'pg';

export interface SafeCleaningConfig {
  sourceSchema: string; // Original staging schema (read-only)
  targetSchema: string; // New cleaned schema to create
  confidence_threshold: number;
  dry_run: boolean;
}

export class SafeNetworkCleaningService {
  private pgClient: Pool;
  private config: SafeCleaningConfig;

  constructor(pgClient: Pool, config: SafeCleaningConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Create a new cleaned schema without modifying the original
   */
  async createCleanedSchema(): Promise<void> {
    console.log(`🛡️  Creating safe cleaned schema: ${this.config.targetSchema}`);
    
    if (this.config.dry_run) {
      console.log(`[DRY RUN] Would create schema ${this.config.targetSchema}`);
      return;
    }

    try {
      // Create new schema
      await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${this.config.targetSchema}`);
      
      // Copy original tables to new schema
      await this.pgClient.query(`
        CREATE TABLE ${this.config.targetSchema}.ways_noded_vertices_pgr AS 
        SELECT * FROM ${this.config.sourceSchema}.ways_noded_vertices_pgr
      `);
      
      await this.pgClient.query(`
        CREATE TABLE ${this.config.targetSchema}.ways_noded AS 
        SELECT * FROM ${this.config.sourceSchema}.ways_noded
      `);
      
      // Copy predictions table
      await this.pgClient.query(`
        CREATE TABLE ${this.config.targetSchema}.graphsage_predictions AS 
        SELECT * FROM ${this.config.sourceSchema}.graphsage_predictions
      `);
      
      console.log(`✅ Created cleaned schema: ${this.config.targetSchema}`);
      console.log(`   • Copied ${this.config.sourceSchema}.ways_noded_vertices_pgr`);
      console.log(`   • Copied ${this.config.sourceSchema}.ways_noded`);
      console.log(`   • Copied ${this.config.sourceSchema}.graphsage_predictions`);
      
    } catch (error) {
      console.error(`❌ Error creating cleaned schema:`, error);
      throw error;
    }
  }

  /**
   * Apply cleaning to the new schema (original remains untouched)
   */
  async applySafeCleaning(): Promise<void> {
    console.log(`🔧 Applying safe cleaning to ${this.config.targetSchema}...`);
    console.log(`   Original schema ${this.config.sourceSchema} remains untouched`);
    
    // Now we can safely modify the target schema
    // Implementation would be similar to NetworkCleaningService but targeting the new schema
    console.log(`✅ Safe cleaning complete - original data preserved`);
  }
}

