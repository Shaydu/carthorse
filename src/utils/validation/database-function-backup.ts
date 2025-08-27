import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export interface FunctionDefinition {
  name: string;
  schema: string;
  definition: string;
  dependencies: string[];
  critical: boolean;
}

export interface BackupMetadata {
  timestamp: string;
  version: string;
  functions: FunctionDefinition[];
  totalFunctions: number;
  criticalFunctions: number;
}

export class DatabaseFunctionBackup {
  private pgClient: Pool;
  private backupDir: string;

  constructor(pgClient: Pool, backupDir: string = './backups/database-functions') {
    this.pgClient = pgClient;
    this.backupDir = backupDir;
    
    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
  }

  /**
   * Get all function definitions from the database
   */
  async getAllFunctionDefinitions(): Promise<FunctionDefinition[]> {
    console.log('🔍 Extracting function definitions from database...');
    
    const result = await this.pgClient.query(`
      SELECT 
        n.nspname as schema,
        p.proname as name,
        pg_get_functiondef(p.oid) as definition,
        array_agg(DISTINCT d.refobjid::regproc) as dependencies
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      LEFT JOIN pg_depend d ON p.oid = d.objid
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'calculate_route_similarity_score',
          'find_routes_recursive_configurable',
          'find_routes_recursive_configurable_uuid',
          'find_routes_recursive_pgrouting',
          'find_routes_recursive_pgrouting_simple',
          'find_routes_spatial',
          'find_out_and_back_spatial',
          'find_simple_loops_spatial',
          'find_simple_routes_with_logging',
          'generate_route_recommendations',
          'generate_route_recommendations_configurable',
          'generate_route_recommendations_deterministic',
          'generate_route_recommendations_uuid',
          'generate_route_recommendations_large_dataset',
          'get_route_patterns',
          'get_route_distance_limits',
          'get_elevation_gain_limits',
          'get_max_routes_per_bin',
          'get_min_route_score',
          'generate_route_name',
          'generate_route_name_from_edges',
          'generate_route_name_from_trails',
          'generate_deterministic_route_uuid',
          'calculate_route_connectivity_score',
          'calculate_route_cost',
          'calculate_route_difficulty',
          'calculate_route_elevation_stats',
          'calculate_route_estimated_time',
          'calculate_route_gain_rate',
          'calculate_route_parametric_metrics',
          'test_route_finding',
          'test_route_finding_configurable',
          'test_route_strategies'
        )
      GROUP BY n.nspname, p.proname, p.oid
      ORDER BY p.proname
    `);

    const criticalFunctions = [
      'calculate_route_similarity_score',
      'find_routes_recursive_configurable',
      'find_routes_recursive_configurable_uuid',
      'generate_route_recommendations',
      'generate_route_recommendations_configurable',
      'get_route_patterns',
      'get_route_distance_limits',
      'get_elevation_gain_limits',
      'get_max_routes_per_bin',
      'get_min_route_score'
    ];

    return result.rows.map(row => ({
      name: row.name,
      schema: row.schema,
      definition: row.definition,
      dependencies: row.dependencies || [],
      critical: criticalFunctions.includes(row.name)
    }));
  }

  /**
   * Create a backup of all functions
   */
  async createBackup(): Promise<string> {
    console.log('💾 Creating database function backup...');
    
    const functions = await this.getAllFunctionDefinitions();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.backupDir, `functions-backup-${timestamp}.json`);
    
    const metadata: BackupMetadata = {
      timestamp,
      version: '1.0.0',
      functions,
      totalFunctions: functions.length,
      criticalFunctions: functions.filter(f => f.critical).length
    };

    fs.writeFileSync(backupFile, JSON.stringify(metadata, null, 2));
    
    console.log(`✅ Backup created: ${backupFile}`);
    console.log(`   📊 Functions backed up: ${functions.length}`);
    console.log(`   🚨 Critical functions: ${functions.filter(f => f.critical).length}`);
    
    return backupFile;
  }

  /**
   * Get the latest backup file
   */
  getLatestBackup(): string | null {
    const files = fs.readdirSync(this.backupDir)
      .filter(file => file.startsWith('functions-backup-') && file.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) {
      return null;
    }

    return path.join(this.backupDir, files[0]);
  }

  /**
   * Load backup metadata from file
   */
  loadBackup(backupFile: string): BackupMetadata {
    const content = fs.readFileSync(backupFile, 'utf8');
    return JSON.parse(content) as BackupMetadata;
  }

  /**
   * Restore functions from backup
   */
  async restoreFromBackup(backupFile?: string): Promise<{
    restored: string[];
    failed: string[];
    errors: string[];
  }> {
    const fileToUse = backupFile || this.getLatestBackup();
    
    if (!fileToUse) {
      throw new Error('No backup file found');
    }

    console.log(`🔄 Restoring functions from backup: ${fileToUse}`);
    
    const metadata = this.loadBackup(fileToUse);
    const restored: string[] = [];
    const failed: string[] = [];
    const errors: string[] = [];

    // Sort functions by dependencies (critical functions first, then by dependency order)
    const sortedFunctions = this.sortFunctionsByDependencies(metadata.functions);

    for (const func of sortedFunctions) {
      try {
        console.log(`   🔧 Restoring function: ${func.name}`);
        
        // Drop function if it exists
        await this.pgClient.query(`DROP FUNCTION IF EXISTS ${func.name} CASCADE`);
        
        // Create function
        await this.pgClient.query(func.definition);
        
        restored.push(func.name);
        console.log(`   ✅ Restored: ${func.name}`);
      } catch (error) {
        const errorMsg = `Failed to restore ${func.name}: ${error}`;
        console.error(`   ❌ ${errorMsg}`);
        failed.push(func.name);
        errors.push(errorMsg);
      }
    }

    console.log(`\n📊 Function restoration complete:`);
    console.log(`   ✅ Restored: ${restored.length}`);
    console.log(`   ❌ Failed: ${failed.length}`);
    console.log(`   🚨 Critical restored: ${restored.filter(name => 
      metadata.functions.find(f => f.name === name)?.critical
    ).length}`);

    return { restored, failed, errors };
  }

  /**
   * Sort functions by dependencies to ensure proper restoration order
   */
  private sortFunctionsByDependencies(functions: FunctionDefinition[]): FunctionDefinition[] {
    const criticalFirst = functions.sort((a, b) => {
      if (a.critical && !b.critical) return -1;
      if (!a.critical && b.critical) return 1;
      return 0;
    });

    // Simple dependency sorting (functions with fewer dependencies first)
    return criticalFirst.sort((a, b) => a.dependencies.length - b.dependencies.length);
  }

  /**
   * Create a SQL script for manual restoration
   */
  async createRestorationScript(backupFile?: string): Promise<string> {
    const fileToUse = backupFile || this.getLatestBackup();
    
    if (!fileToUse) {
      throw new Error('No backup file found');
    }

    const metadata = this.loadBackup(fileToUse);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const scriptFile = path.join(this.backupDir, `restore-functions-${timestamp}.sql`);

    let sqlScript = `-- Database Function Restoration Script
-- Generated: ${timestamp}
-- Backup: ${fileToUse}
-- Total Functions: ${metadata.totalFunctions}
-- Critical Functions: ${metadata.criticalFunctions}

BEGIN;

`;

    const sortedFunctions = this.sortFunctionsByDependencies(metadata.functions);

    for (const func of sortedFunctions) {
      sqlScript += `-- Restoring function: ${func.name} (${func.critical ? 'CRITICAL' : 'optional'})
DROP FUNCTION IF EXISTS ${func.name} CASCADE;

${func.definition}

`;
    }

    sqlScript += `COMMIT;

-- Verification queries
SELECT 'Function restoration complete' as status;
SELECT count(*) as total_functions FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
`;

    fs.writeFileSync(scriptFile, sqlScript);
    
    console.log(`📝 Restoration script created: ${scriptFile}`);
    
    return scriptFile;
  }

  /**
   * List all available backups
   */
  listBackups(): Array<{ file: string; timestamp: string; functions: number; critical: number }> {
    const files = fs.readdirSync(this.backupDir)
      .filter(file => file.startsWith('functions-backup-') && file.endsWith('.json'))
      .sort()
      .reverse();

    return files.map(file => {
      const filePath = path.join(this.backupDir, file);
      const metadata = this.loadBackup(filePath);
      
      return {
        file,
        timestamp: metadata.timestamp,
        functions: metadata.totalFunctions,
        critical: metadata.criticalFunctions
      };
    });
  }

  /**
   * Validate that all critical functions exist in the database
   */
  async validateCriticalFunctions(): Promise<{
    missing: string[];
    present: string[];
    isValid: boolean;
  }> {
    const criticalFunctions = [
      'calculate_route_similarity_score',
      'find_routes_recursive_configurable',
      'find_routes_recursive_configurable_uuid',
      'generate_route_recommendations',
      'generate_route_recommendations_configurable',
      'get_route_patterns',
      'get_route_distance_limits',
      'get_elevation_gain_limits',
      'get_max_routes_per_bin',
      'get_min_route_score'
    ];

    const result = await this.pgClient.query(`
      SELECT proname 
      FROM pg_proc 
      WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        AND proname = ANY($1)
    `, [criticalFunctions]);

    const present = result.rows.map(row => row.proname);
    const missing = criticalFunctions.filter(func => !present.includes(func));

    return {
      missing,
      present,
      isValid: missing.length === 0
    };
  }

  /**
   * Auto-restore if critical functions are missing
   */
  async autoRestoreIfNeeded(): Promise<{
    restored: boolean;
    restoredFunctions: string[];
    errors: string[];
  }> {
    console.log('🔍 Checking for missing critical functions...');
    
    const validation = await this.validateCriticalFunctions();
    
    if (validation.isValid) {
      console.log('✅ All critical functions are present');
      return { restored: false, restoredFunctions: [], errors: [] };
    }

    console.log(`🚨 Missing critical functions: ${validation.missing.join(', ')}`);
    console.log('🔄 Attempting auto-restore...');

    try {
      const result = await this.restoreFromBackup();
      
      if (result.failed.length > 0) {
        console.log(`⚠️  Some functions failed to restore: ${result.failed.join(', ')}`);
      }

      return {
        restored: result.restored.length > 0,
        restoredFunctions: result.restored,
        errors: result.errors
      };
    } catch (error) {
      const errorMsg = `Auto-restore failed: ${error}`;
      console.error(`❌ ${errorMsg}`);
      return {
        restored: false,
        restoredFunctions: [],
        errors: [errorMsg]
      };
    }
  }
}
