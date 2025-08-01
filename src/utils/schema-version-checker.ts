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
              version: 14,
      description: 'Carthorse SQLite Export v14.0 (Enhanced Route Recommendations + Trail Composition)'
    };
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