import { Pool, PoolClient } from 'pg';
import { LollipopRouteGeneratorService } from './LollipopRouteGeneratorService';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface StandaloneLollipopConfig {
  stagingSchema: string;
  region: string;
  outputPath?: string;
}

export interface StandaloneLollipopResult {
  routes: any[];
  metadata: {
    schema: string;
    git_commit: string;
    git_branch: string;
    run_timestamp: string;
    script: string;
    target_distance_km: number;
    max_anchor_nodes: number;
  };
  filepath: string;
}

export class StandaloneLollipopService {
  private pgClient: Pool;
  private config: StandaloneLollipopConfig;

  constructor(pgClient: Pool, config: StandaloneLollipopConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Run the standalone lollipop script logic against the provided staging schema
   */
  async generateRoutes(): Promise<StandaloneLollipopResult> {
    console.log(`🍭 Running standalone lollipop script against schema: ${this.config.stagingSchema}`);

    const outputPath = this.config.outputPath || path.join(process.cwd(), 'test-output', `lollipop-routes-${this.config.stagingSchema}-${new Date().toISOString().replace(/[:.]/g, '-')}.geojson`);

    // Actually run the standalone script directly using child_process
    const scriptPath = path.join(process.cwd(), 'test-lollipop-integration-maximum.ts');
    
    console.log(`🚀 Executing standalone script: ${scriptPath} ${this.config.stagingSchema}`);
    
    try {
      const { stdout, stderr } = await execAsync(`npx ts-node ${scriptPath} ${this.config.stagingSchema}`);
      
      console.log('📋 Standalone script output:');
      console.log(stdout);
      
      if (stderr) {
        console.warn('⚠️ Standalone script warnings:');
        console.warn(stderr);
      }

      // The standalone script creates its own output file, so we need to find it
      // Look for the most recent lollipop routes file for this schema
      // If outputPath is provided, it's already the directory path from the orchestrator
      const outputDir = this.config.outputPath || path.dirname(outputPath);
      console.log(`🔍 Looking for lollipop files in: ${outputDir}`);
      console.log(`🔍 Looking for files matching: lollipop-routes-${this.config.stagingSchema}*.geojson`);
      
      const files = await fs.readdir(outputDir);
      console.log(`📁 Found ${files.length} files in output directory`);
      
      const lollipopFiles = files.filter(file => 
        file.startsWith(`lollipop-routes-${this.config.stagingSchema}`) && 
        file.endsWith('.geojson')
      ).sort().reverse(); // Most recent first

      console.log(`🍭 Found ${lollipopFiles.length} lollipop files for schema ${this.config.stagingSchema}:`, lollipopFiles);

      if (lollipopFiles.length === 0) {
        // Let's also check what files are actually there
        const allLollipopFiles = files.filter(file => file.includes('lollipop-routes') && file.endsWith('.geojson'));
        console.log(`❌ No lollipop files found for schema ${this.config.stagingSchema}`);
        console.log(`📋 All lollipop files in directory:`, allLollipopFiles);
        throw new Error(`No lollipop routes file found for schema ${this.config.stagingSchema}`);
      }

      const actualOutputPath = path.join(outputDir, lollipopFiles[0]);
      console.log(`📁 Found standalone script output: ${actualOutputPath}`);

      // Read the generated routes to get count
      const fileContent = await fs.readFile(actualOutputPath, 'utf-8');
      const geojson = JSON.parse(fileContent);
      const routes = geojson.features || [];

      // Get metadata information
      let gitCommit = 'unknown';
      let gitBranch = 'unknown';
      let runTimestamp = new Date().toISOString();
      
      try {
        const { execSync } = require('child_process');
        gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
        gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      } catch (error) {
        console.log('⚠️  Could not get git information');
      }

      // Simulate metadata from the original script
      const metadata = {
        schema: this.config.stagingSchema,
        git_commit: gitCommit,
        git_branch: gitBranch,
        run_timestamp: runTimestamp,
        script: 'test-lollipop-integration-maximum.ts',
        target_distance_km: 150,
        max_anchor_nodes: 50,
      };

      console.log(`✅ Standalone script completed: ${routes.length} routes generated`);

      return { routes, metadata, filepath: actualOutputPath };

    } catch (error) {
      console.error('❌ Failed to run standalone script:', error);
      throw error;
    }
  }
}
