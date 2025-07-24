import { Client, ClientConfig } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Canonical DB config loader for Carthorse
// Always use this for all DB connections in tests and orchestrator

export function getTestDbConfig() {
  return {
    host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
    port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
    database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
    password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
    ssl: false
  };
}

// Load environment variables from multiple possible locations
const envFiles = [
  '.env',                    // Standard .env file
  'env.local',              // Local environment (common setup)
  'api-service/.env.api.local', // API-specific environment
  '.env.local',             // Alternative local environment
];

// Try each file in order, later files override earlier ones
envFiles.forEach(envFile => {
  const envPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(envPath)) {
    console.log(`📋 Loading environment from: ${envFile}`);
    dotenv.config({ path: envPath });
  }
});

// Log the database user being used for debugging
console.log(`🔗 Database user: ${process.env.PGUSER || 'not set'}`);

import type { DatabaseConfig, EnvironmentConfig } from '../types';

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private client: Client | null = null;
  private currentEnvironment: string = 'default';

  private constructor() {}

  static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  /**
   * Get configuration for a specific environment
   */
  getEnvironmentConfig(environment: string = 'default'): EnvironmentConfig {
    const env = environment.toLowerCase();
    
    switch (env) {
      case 'bbox-phase2':
        return {
          name: 'bbox-phase2',
          database: {
            host: process.env.BBOX_PHASE2_PGHOST || process.env.PGHOST || 'localhost',
            port: parseInt(process.env.BBOX_PHASE2_PGPORT || process.env.PGPORT || '5432'),
            database: process.env.BBOX_PHASE2_PGDATABASE || process.env.PGDATABASE || 'trail_master_db',
            user: process.env.BBOX_PHASE2_PGUSER || process.env.PGUSER || 'tester',
            password: process.env.BBOX_PHASE2_PGPASSWORD || process.env.PGPASSWORD || '',
            ssl: process.env.BBOX_PHASE2_PGSSL === 'true'
          },
          dataPaths: {
            sourceDataDir: process.env.BBOX_PHASE2_SOURCE_DATA_DIR || process.env.SOURCE_DATA_DIR || '/path/to/source-data',
            elevationTiffDir: process.env.BBOX_PHASE2_ELEVATION_TIFF_DIR || process.env.ELEVATION_TIFF_DIR || '/path/to/elevation-data',
            osmDataPath: process.env.BBOX_PHASE2_OSM_DATA_PATH || process.env.OSM_DATA_PATH || '/path/to/osm/data'
          },
          processing: {
            batchSize: parseInt(process.env.BBOX_PHASE2_BATCH_SIZE || process.env.CARTHORSE_BATCH_SIZE || '1000'),
            timeoutMs: parseInt(process.env.BBOX_PHASE2_TIMEOUT_MS || process.env.CARTHORSE_TIMEOUT_MS || '30000'),
            logLevel: process.env.BBOX_PHASE2_LOG_LEVEL || process.env.CARTHORSE_LOG_LEVEL || 'info',
            verbose: process.env.BBOX_PHASE2_VERBOSE === 'true' || process.env.CARTHORSE_VERBOSE === 'true'
          }
        };

      case 'test':
        return {
          name: 'test',
          database: {
            host: process.env.TEST_PGHOST || 'localhost',
            port: parseInt(process.env.TEST_PGPORT || '5432'),
            database: process.env.TEST_PGDATABASE || 'trail_master_db_test',
            user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
            password: process.env.TEST_PGPASSWORD || '',
            ssl: false
          },
          dataPaths: {
            sourceDataDir: process.env.TEST_SOURCE_DATA_DIR || '/tmp/test-data',
            elevationTiffDir: process.env.TEST_ELEVATION_TIFF_DIR || '/tmp/test-elevation',
            osmDataPath: process.env.TEST_OSM_DATA_PATH || '/tmp/test-osm'
          },
          processing: {
            batchSize: 100,
            timeoutMs: 10000,
            logLevel: 'debug',
            verbose: true
          }
        };

      case 'default':
      default:
        return {
          name: 'default',
          database: {
            host: process.env.PGHOST || 'localhost',
            port: parseInt(process.env.PGPORT || '5432'),
            database: process.env.PGDATABASE || 'trail_master_db_test',
            user: process.env.PGUSER || 'tester',
            password: process.env.PGPASSWORD || '',
            ssl: process.env.PGSSL === 'true'
          },
          dataPaths: {
            sourceDataDir: process.env.SOURCE_DATA_DIR || '/path/to/source-data',
            elevationTiffDir: process.env.ELEVATION_TIFF_DIR || '/path/to/elevation-data',
            osmDataPath: process.env.OSM_DATA_PATH || '/path/to/osm/data'
          },
          processing: {
            batchSize: parseInt(process.env.CARTHORSE_BATCH_SIZE || '1000'),
            timeoutMs: parseInt(process.env.CARTHORSE_TIMEOUT_MS || '30000'),
            logLevel: process.env.CARTHORSE_LOG_LEVEL || 'info',
            verbose: process.env.CARTHORSE_VERBOSE === 'true'
          }
        };
    }
  }

                /**
               * Create a new database client for the specified environment
               */
              async createClient(environment: string = 'default'): Promise<Client> {
                const config = this.getEnvironmentConfig(environment);
                this.currentEnvironment = environment;

                // Validate required environment variables
                const requiredEnvVars = ['PGUSER', 'PGHOST', 'PGDATABASE'];
                const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
                
                if (missingVars.length > 0) {
                  console.error('❌ Missing required environment variables:');
                  missingVars.forEach(varName => console.error(`   - ${varName}`));
                  console.error('');
                  console.error('💡 Make sure your environment variables are loaded correctly.');
                  console.error('   Try creating a .env file in the project root with:');
                  console.error('   PGUSER=your_username');
                  console.error('   PGHOST=localhost');
                  console.error('   PGDATABASE=your_database');
                  console.error('   PGPASSWORD=your_password');
                  process.exit(1);
                }

                const clientConfig: ClientConfig = {
                  host: config.database.host,
                  port: config.database.port,
                  database: config.database.database,
                  user: config.database.user,
                  password: config.database.password,
                  ssl: config.database.ssl ? { rejectUnauthorized: false } : false
                };

                const client = new Client(clientConfig);
                
                try {
                  await client.connect();
                  console.log(`✅ Connected to PostgreSQL (${environment} environment)`);
                  console.log(`   Host: ${config.database.host}:${config.database.port}`);
                  console.log(`   Database: ${config.database.database}`);
                  console.log(`   User: ${config.database.user}`);
                  
                  // Test PostGIS
                  const result = await client.query('SELECT PostGIS_Version()');
                  console.log(`🌍 PostGIS version: ${result.rows[0].postgis_version}`);
                  
                  this.client = client;
                  return client;
                } catch (error: any) {
                  if (error.message && error.message.includes('role "postgres" does not exist')) {
                    console.error('❌ Database connection failed:');
                    console.error('   - PGUSER is set to:', process.env.PGUSER || 'undefined');
                    console.error('   - PGHOST is set to:', process.env.PGHOST || 'undefined');
                    console.error('   - PGDATABASE is set to:', process.env.PGDATABASE || 'undefined');
                    console.error('');
                    console.error('💡 The database user does not exist in your database.');
                    console.error('   Make sure PGUSER is set to an existing database user.');
                    console.error('   Common values: "postgres", your system username, or create a new user');
                    process.exit(1);
                  }
                  console.error(`❌ Failed to connect to PostgreSQL (${environment} environment):`, error);
                  throw error;
                }
              }

  /**
   * Get the current database client
   */
  getClient(): Client | null {
    return this.client;
  }

  /**
   * Get the current environment name
   */
  getCurrentEnvironment(): string {
    return this.currentEnvironment;
  }

  /**
   * Get the current environment configuration
   */
  getCurrentConfig(): EnvironmentConfig {
    return this.getEnvironmentConfig(this.currentEnvironment);
  }

  /**
   * Disconnect the current client
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
      console.log('🔌 Disconnected from PostgreSQL');
    }
  }

  /**
   * Test the connection to a specific environment
   */
  async testConnection(environment: string = 'default'): Promise<boolean> {
    try {
      const client = await this.createClient(environment);
      await client.end();
      return true;
    } catch (error) {
      console.error(`❌ Connection test failed for ${environment}:`, error);
      return false;
    }
  }
}

// Export singleton instance
export const dbConnection = DatabaseConnection.getInstance(); 