import { Client } from 'pg';
import Database from 'better-sqlite3';
import * as fs from 'fs';

export interface SchemaVersion {
  version: number;
  description?: string;
  applied_at?: string;
  created_at?: string;
  updated_at?: string;
}

export class SchemaVersionChecker {
  /**
   * Check schema version for PostgreSQL database
   */
  async checkPostgreSQLVersion(connectionConfig: {
    host: string;
    port: number;
    database: string;
    user: string;
    password?: string;
  }): Promise<SchemaVersion> {
    const client = new Client(connectionConfig);
    try {
      await client.connect();

      const result = await client.query(`
        SELECT version, created_at, updated_at 
        FROM schema_version 
        ORDER BY version DESC 
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        throw new Error('No schema version found in PostgreSQL database');
      }

      const row = result.rows[0];
      return {
        version: row.version,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    } finally {
      await client.end();
    }
  }

  /**
   * Check schema version for SpatiaLite database
   */
  checkSpatiaLiteVersion(filePath: string): SchemaVersion {
    if (!fs.existsSync(filePath)) {
      throw new Error(`SpatiaLite database file not found: ${filePath}`);
    }

    const db = new Database(filePath, { readonly: true });
    try {
      const result = db.prepare(`
        SELECT version, description, applied_at 
        FROM schema_version 
        ORDER BY version DESC 
        LIMIT 1
      `).get() as any;

      if (!result) {
        throw new Error('No schema version found in SpatiaLite database');
      }

      return {
        version: result.version,
        description: result.description,
        applied_at: result.applied_at
      };
    } finally {
      db.close();
    }
  }

  /**
   * Get expected schema version for current application
   */
  getExpectedSchemaVersion(): SchemaVersion {
    // This should match the version in the orchestrator
    return {
      version: 7,
      description: 'Enhanced PostgreSQL processed: split trails with routing graph and elevation field'
    };
  }

  /**
   * Validate that a PostgreSQL database has the expected schema version
   */
  async validatePostgreSQLSchema(connectionConfig: {
    host: string;
    port: number;
    database: string;
    user: string;
    password?: string;
  }): Promise<{ valid: boolean; message: string; actualVersion?: SchemaVersion }> {
    const expected = this.getExpectedSchemaVersion();
    
    try {
      const actualVersion = await this.checkPostgreSQLVersion(connectionConfig);
      const valid = actualVersion.version === expected.version;
      const message = valid
        ? `✅ PostgreSQL schema version is correct: ${actualVersion.version}`
        : `❌ PostgreSQL schema version mismatch. Expected: ${expected.version}, Actual: ${actualVersion.version}`;

      return { valid, message, actualVersion };
    } catch (error) {
      return {
        valid: false,
        message: `❌ Failed to check PostgreSQL schema version: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Validate that a SpatiaLite database has the expected schema version
   */
  validateSpatiaLiteSchema(filePath: string): { valid: boolean; message: string; actualVersion?: SchemaVersion } {
    const expected = this.getExpectedSchemaVersion();
    
    try {
      const actualVersion = this.checkSpatiaLiteVersion(filePath);
      const valid = actualVersion.version === expected.version;
      const message = valid
        ? `✅ SpatiaLite schema version is correct: ${actualVersion.version}`
        : `❌ SpatiaLite schema version mismatch. Expected: ${expected.version}, Actual: ${actualVersion.version}`;

      return { valid, message, actualVersion };
    } catch (error) {
      return {
        valid: false,
        message: `❌ Failed to check SpatiaLite schema version: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Print comprehensive schema version information for all databases
   */
  async printSchemaInfo(): Promise<void> {
    const expected = this.getExpectedSchemaVersion();
    console.log(`\n🎯 Expected Schema Version: ${expected.version}`);
    console.log(`📝 Description: ${expected.description}`);
    console.log('=' .repeat(80));
    
    // Check PostgreSQL if environment variables are set
    if (process.env.PGHOST && process.env.PGDATABASE) {
      console.log('\n📊 PostgreSQL Database:');
      const config = {
        host: process.env.PGHOST,
        port: parseInt(process.env.PGPORT || '5432'),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER || 'postgres'
      };
      
      // Only add password if it exists
      if (process.env.PGPASSWORD) {
        (config as any).password = process.env.PGPASSWORD;
      }
      
      const pgValidation = await this.validatePostgreSQLSchema(config);
      console.log(pgValidation.message);
      
      if (pgValidation.actualVersion) {
        console.log(`   Version: ${pgValidation.actualVersion.version}`);
        if (pgValidation.actualVersion.description) {
          console.log(`   Description: ${pgValidation.actualVersion.description}`);
        }
        if (pgValidation.actualVersion.applied_at) {
          console.log(`   Applied: ${pgValidation.actualVersion.applied_at}`);
        }
      }
    } else {
      console.log('\n📊 PostgreSQL Database: ⏭️  Not configured');
    }

    // Check all existing databases in data/ directory
    const dataDir = 'data';
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      const dbFiles = files.filter(file => file.endsWith('.db'));
      
      if (dbFiles.length > 0) {
        console.log('\n📊 Existing SpatiaLite Databases:');
        
        for (const dbFile of dbFiles) {
          const dbPath = `${dataDir}/${dbFile}`;
          console.log(`\n   📁 ${dbFile}:`);
          
          try {
            const validation = this.validateSpatiaLiteSchema(dbPath);
            console.log(`      ${validation.message}`);
            
            if (validation.actualVersion) {
              console.log(`      Version: ${validation.actualVersion.version}`);
              if (validation.actualVersion.description) {
                console.log(`      Description: ${validation.actualVersion.description}`);
              }
              if (validation.actualVersion.applied_at) {
                console.log(`      Applied: ${validation.actualVersion.applied_at}`);
              }
            }
          } catch (error) {
            console.log(`      ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      } else {
        console.log('\n📊 SpatiaLite Databases: ⏭️  No .db files found in data/ directory');
      }
    }

    // Summary
    console.log('\n' + '=' .repeat(80));
    console.log('📋 SCHEMA VERSION SUMMARY:');
    console.log(`   Expected Version: ${expected.version}`);
    console.log('   Status: Check individual databases above for compatibility');
    console.log('   Recommendation: Ensure all databases match expected version before running tests');
  }
}

// CLI utility for checking schema versions
export async function checkSchemaVersions() {
  const checker = new SchemaVersionChecker();
  await checker.printSchemaInfo();
}

// Export for use in tests
export { SchemaVersionChecker as default }; 