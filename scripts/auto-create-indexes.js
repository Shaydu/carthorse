#!/usr/bin/env node

/**
 * Auto-Create Indexes for Staging Schemas
 * 
 * This script automatically creates optimized indexes for new staging schemas
 * to ensure optimal performance for duplicate detection queries.
 * 
 * Usage:
 *   node scripts/auto-create-indexes.js [--schema=schema_name] [--dry-run]
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'carthorse',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'trail_master_db',
  port: process.env.DB_PORT || 5432
};

// Index creation SQL template
const INDEX_SQL_TEMPLATE = `
-- Create optimized indexes for staging schema: {SCHEMA_NAME}

-- Composite spatial index for bounding box + geometry operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_{SCHEMA_NAME}_trails_bbox_geom 
ON {SCHEMA_NAME}.trails 
USING gist (ST_Envelope(geometry), geometry);

-- Index on name for faster name matching
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_{SCHEMA_NAME}_trails_name 
ON {SCHEMA_NAME}.trails (name);

-- Index on app_uuid for faster lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_{SCHEMA_NAME}_trails_uuid 
ON {SCHEMA_NAME}.trails (app_uuid);

-- Index for geometry validity checks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_{SCHEMA_NAME}_trails_valid_geom 
ON {SCHEMA_NAME}.trails (id) 
WHERE geometry IS NOT NULL AND ST_IsValid(geometry);

-- Index for length calculations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_{SCHEMA_NAME}_trails_length 
ON {SCHEMA_NAME}.trails (ST_Length(geometry::geography));
`;

class IndexCreator {
  constructor(config) {
    this.pgClient = new Pool(config);
    this.dryRun = process.argv.includes('--dry-run');
  }

  async connect() {
    try {
      await this.pgClient.connect();
      console.log('✅ Connected to database');
    } catch (error) {
      console.error('❌ Failed to connect to database:', error.message);
      throw error;
    }
  }

  async disconnect() {
    try {
      await this.pgClient.end();
      console.log('✅ Disconnected from database');
    } catch (error) {
      console.error('❌ Error disconnecting:', error.message);
    }
  }

  async findLatestStagingSchema() {
    const query = `
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `;
    
    const result = await this.pgClient.query(query);
    return result.rows.length > 0 ? result.rows[0].schema_name : null;
  }

  async findStagingSchemas() {
    const query = `
      SELECT schema_name, 
             created_at 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC
    `;
    
    const result = await this.pgClient.query(query);
    return result.rows;
  }

  async checkIndexesExist(schemaName) {
    const query = `
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = $1 
        AND tablename = 'trails' 
        AND indexname LIKE 'idx_%'
      ORDER BY indexname
    `;
    
    const result = await this.pgClient.query(query, [schemaName]);
    return result.rows.map(row => row.indexname);
  }

  async createIndexes(schemaName) {
    console.log(`🔧 Creating indexes for schema: ${schemaName}`);
    
    const indexSql = INDEX_SQL_TEMPLATE.replace(/{SCHEMA_NAME}/g, schemaName);
    
    if (this.dryRun) {
      console.log('📝 DRY RUN - Would execute:');
      console.log(indexSql);
      return { success: true, dryRun: true };
    }

    try {
      // Split the SQL into individual statements
      const statements = indexSql
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

      for (const statement of statements) {
        if (statement.trim()) {
          console.log(`  Creating index: ${statement.split(' ')[5]}`);
          await this.pgClient.query(statement + ';');
        }
      }

      console.log(`✅ Successfully created indexes for schema: ${schemaName}`);
      return { success: true, dryRun: false };
    } catch (error) {
      console.error(`❌ Failed to create indexes for schema ${schemaName}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async verifyIndexes(schemaName) {
    const query = `
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE schemaname = $1 
        AND tablename = 'trails' 
        AND indexname LIKE 'idx_%'
      ORDER BY indexname
    `;
    
    const result = await this.pgClient.query(query, [schemaName]);
    return result.rows;
  }

  async getIndexStats(schemaName) {
    const query = `
      SELECT 
        indexname,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch
      FROM pg_stat_user_indexes 
      WHERE schemaname = $1 
        AND tablename = 'trails' 
        AND indexname LIKE 'idx_%'
      ORDER BY idx_scan DESC
    `;
    
    const result = await this.pgClient.query(query, [schemaName]);
    return result.rows;
  }

  async run() {
    try {
      await this.connect();

      // Check if specific schema was provided
      const schemaArg = process.argv.find(arg => arg.startsWith('--schema='));
      let targetSchema = schemaArg ? schemaArg.split('=')[1] : null;

      if (!targetSchema) {
        // Find the latest staging schema
        targetSchema = await this.findLatestStagingSchema();
        if (!targetSchema) {
          console.log('❌ No staging schema found with pattern carthorse_%');
          return;
        }
        console.log(`📁 Using latest staging schema: ${targetSchema}`);
      } else {
        console.log(`📁 Using specified schema: ${targetSchema}`);
      }

      // Check if indexes already exist
      const existingIndexes = await this.checkIndexesExist(targetSchema);
      if (existingIndexes.length > 0) {
        console.log(`ℹ️  Indexes already exist for schema ${targetSchema}:`);
        existingIndexes.forEach(index => console.log(`  - ${index}`));
        
        if (!this.dryRun) {
          console.log('🔄 Recreating indexes...');
        }
      }

      // Create indexes
      const result = await this.createIndexes(targetSchema);
      
      if (result.success && !result.dryRun) {
        // Verify indexes were created
        const indexes = await this.verifyIndexes(targetSchema);
        console.log(`\n📊 Indexes created for schema ${targetSchema}:`);
        indexes.forEach(index => {
          console.log(`  ✅ ${index.indexname}`);
        });

        // Show index statistics
        const stats = await this.getIndexStats(targetSchema);
        if (stats.length > 0) {
          console.log(`\n📈 Index statistics:`);
          stats.forEach(stat => {
            console.log(`  ${stat.indexname}: ${stat.idx_scan} scans, ${stat.idx_tup_read} tuples read`);
          });
        }
      }

      // Show all staging schemas for reference
      const allSchemas = await this.findStagingSchemas();
      console.log(`\n📋 All staging schemas:`);
      allSchemas.forEach(schema => {
        const hasIndexes = existingIndexes.length > 0 ? ' (has indexes)' : ' (no indexes)';
        console.log(`  ${schema.schema_name}${hasIndexes}`);
      });

    } catch (error) {
      console.error('❌ Error during index creation:', error);
      process.exit(1);
    } finally {
      await this.disconnect();
    }
  }
}

// Main execution
if (require.main === module) {
  const indexCreator = new IndexCreator(config);
  indexCreator.run().catch(console.error);
}

module.exports = IndexCreator;
