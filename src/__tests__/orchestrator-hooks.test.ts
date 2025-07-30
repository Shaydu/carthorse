import { Client } from 'pg';
import { OrchestratorHooks, OrchestratorContext } from '../orchestrator/orchestrator-hooks';
import { ElevationService } from '../utils/elevation-service';
import { ValidationService } from '../utils/validation-service';
import { getTestDbConfig } from '../database/connection';

describe('OrchestratorHooks', () => {
  let pgClient: Client;
  let hooks: OrchestratorHooks;
  let elevationService: ElevationService;
  let validationService: ValidationService;
  let context: OrchestratorContext;

  beforeAll(async () => {
    pgClient = new Client(getTestDbConfig());
    await pgClient.connect();
    elevationService = new ElevationService(pgClient);
    validationService = new ValidationService(pgClient);
    hooks = new OrchestratorHooks();
  });

  afterAll(async () => {
    await pgClient.end();
  });

  beforeEach(async () => {
    // Create a test schema for each test
    const testSchema = `test_hooks_${Date.now()}`;
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Create test trails table
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        osm_id TEXT,
        osm_type TEXT,
        length_km REAL CHECK(length_km > 0),
        elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        difficulty TEXT,
        surface_type TEXT,
        trail_type TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    context = {
      pgClient,
      schemaName: testSchema,
      region: 'test-region',
      config: {
        region: 'test-region',
        outputPath: './test-output.db',
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: false,
        validate: true,
        verbose: false,
        skipBackup: false,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: 400,
        skipIncompleteTrails: false
      },
      elevationService,
      validationService
    };
  });

  afterEach(async () => {
    // Clean up test schemas
    const schemas = await pgClient.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'test_hooks_%'
    `);
    
    for (const schema of schemas.rows) {
      await pgClient.query(`DROP SCHEMA IF EXISTS "${schema.schema_name}" CASCADE`);
    }
  });

  describe('hook registration and execution', () => {
    it('should register and execute custom hooks', async () => {
      let hookExecuted = false;
      
      hooks.registerHook({
        name: 'test-custom-hook',
        execute: async (ctx) => {
          hookExecuted = true;
          expect(ctx.schemaName).toBe(context.schemaName);
          expect(ctx.region).toBe('test-region');
        }
      });

      await hooks.executeHook('test-custom-hook', context);
      
      expect(hookExecuted).toBe(true);
    });

    it('should throw error for non-existent hook', async () => {
      await expect(
        hooks.executeHook('non-existent-hook', context)
      ).rejects.toThrow("Hook 'non-existent-hook' not found");
    });

    it('should execute multiple hooks in sequence', async () => {
      const executionOrder: string[] = [];
      
      hooks.registerHook({
        name: 'hook-1',
        execute: async () => {
          executionOrder.push('hook-1');
        }
      });

      hooks.registerHook({
        name: 'hook-2',
        execute: async () => {
          executionOrder.push('hook-2');
        }
      });

      await hooks.executeHooks(['hook-1', 'hook-2'], context);
      
      expect(executionOrder).toEqual(['hook-1', 'hook-2']);
    });
  });

  describe('default hooks', () => {
    it('should have all default hooks registered', () => {
      const availableHooks = hooks.getAvailableHooks();
      
      expect(availableHooks).toContain('initialize-elevation-data');
      expect(availableHooks).toContain('validate-trail-data');
      expect(availableHooks).toContain('validate-bbox-data');
      expect(availableHooks).toContain('validate-geometry-data');
      expect(availableHooks).toContain('process-elevation-data');
      expect(availableHooks).toContain('validate-elevation-data');
      expect(availableHooks).toContain('validate-routing-graph');
      expect(availableHooks).toContain('show-elevation-stats');
    });

    it('should execute initialize-elevation-data hook', async () => {
      // Insert test trail with existing elevation data
      await pgClient.query(`
        INSERT INTO ${context.schemaName}.trails (
          app_uuid, name, region, elevation_gain, elevation_loss, 
          max_elevation, min_elevation, avg_elevation
        ) VALUES (
          'test-uuid-1', 'Test Trail', 'test-region', 100, 50, 2000, 1800, 1900
        )
      `);

      await hooks.executeHook('initialize-elevation-data', context);

      // Verify elevation data was reset to null
      const result = await pgClient.query(`
        SELECT elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
        FROM ${context.schemaName}.trails WHERE app_uuid = 'test-uuid-1'
      `);

      expect(result.rows[0].elevation_gain).toBeNull();
      expect(result.rows[0].elevation_loss).toBeNull();
      expect(result.rows[0].max_elevation).toBeNull();
      expect(result.rows[0].min_elevation).toBeNull();
      expect(result.rows[0].avg_elevation).toBeNull();
    });

    it('should execute validate-trail-data hook successfully', async () => {
      // Insert test trail with valid data
      await pgClient.query(`
        INSERT INTO ${context.schemaName}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          geometry, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
        ) VALUES (
          'test-uuid-2', 'Test Trail 2', 'test-region', -105.0, -104.0, 40.0, 41.0,
          ST_GeomFromText('LINESTRING(-105.0 40.0 1800, -104.0 41.0 1900)', 4326),
          100, 50, 2000, 1800, 1900
        )
      `);

      await hooks.executeHook('validate-trail-data', context);
      // Should not throw if validation passes
    });

    it('should fail validate-trail-data hook with invalid data', async () => {
      // Insert test trail with invalid data (missing required fields)
      await pgClient.query(`
        INSERT INTO ${context.schemaName}.trails (
          app_uuid, name, region
        ) VALUES (
          'test-uuid-3', '', 'test-region'
        )
      `);

      await expect(
        hooks.executeHook('validate-trail-data', context)
      ).rejects.toThrow('Trail data validation failed');
    });

    it('should execute validate-bbox-data hook successfully', async () => {
      // Insert test trail with valid bbox data
      await pgClient.query(`
        INSERT INTO ${context.schemaName}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES (
          'test-uuid-4', 'Test Trail 4', 'test-region', -105.0, -104.0, 40.0, 41.0
        )
      `);

      await hooks.executeHook('validate-bbox-data', context);
      // Should not throw if validation passes
    });

    it('should fail validate-bbox-data hook with invalid bbox', async () => {
      // Insert test trail with invalid bbox data (identical coordinates but short length)
      await pgClient.query(`
        INSERT INTO ${context.schemaName}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, geometry
        ) VALUES (
          'test-uuid-5', 'Test Trail 5', 'test-region', -104.0, -104.0, 40.0, 40.0,
          ST_GeomFromText('LINESTRING(-104.0 40.0, -104.0 40.0)', 4326)
        )
      `);

      await expect(
        hooks.executeHook('validate-bbox-data', context)
      ).rejects.toThrow('Bbox data validation failed');
    });

    it('should execute validate-geometry-data hook successfully', async () => {
      // Insert test trail with valid geometry
      await pgClient.query(`
        INSERT INTO ${context.schemaName}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-6', 'Test Trail 6', 'test-region',
          ST_GeomFromText('LINESTRING(-105.0 40.0 1800, -104.0 41.0 1900)', 4326)
        )
      `);

      await hooks.executeHook('validate-geometry-data', context);
      // Should not throw if validation passes
    });

    it('should fail validate-geometry-data hook with invalid geometry', async () => {
      // Instead of trying to insert invalid geometry (which violates DB constraints),
      // we'll test the validation logic by checking what happens when geometry is null
      
      // Insert test trail with null geometry
      await pgClient.query(`
        INSERT INTO ${context.schemaName}.trails (
          app_uuid, name, region
        ) VALUES (
          'test-uuid-7', 'Test Trail 7', 'test-region'
        )
      `);

      await expect(
        hooks.executeHook('validate-geometry-data', context)
      ).rejects.toThrow('Geometry data validation failed');
    });

    it('should execute show-elevation-stats hook', async () => {
      // Insert test trails with different elevation states
      await pgClient.query(`
        INSERT INTO ${context.schemaName}.trails (app_uuid, name, region, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation) VALUES
        ('test-uuid-8', 'Test Trail 8', 'test-region', 100, 50, 2000, 1800, 1900),
        ('test-uuid-9', 'Test Trail 9', 'test-region', NULL, NULL, NULL, NULL, NULL)
      `);

      await hooks.executeHook('show-elevation-stats', context);
      // Should not throw and should log elevation statistics
    });
  });

  describe('hook context', () => {
    it('should provide correct context to hooks', async () => {
      let receivedContext: OrchestratorContext | null = null;
      
      hooks.registerHook({
        name: 'context-test-hook',
        execute: async (ctx) => {
          receivedContext = ctx;
        }
      });

      await hooks.executeHook('context-test-hook', context);
      
      expect(receivedContext).toBeDefined();
      expect(receivedContext!.pgClient).toBe(pgClient);
      expect(receivedContext!.schemaName).toBe(context.schemaName);
      expect(receivedContext!.region).toBe('test-region');
      expect(receivedContext!.elevationService).toBe(elevationService);
      expect(receivedContext!.validationService).toBe(validationService);
    });
  });

  describe('hook error handling', () => {
    it('should propagate errors from hooks', async () => {
      hooks.registerHook({
        name: 'error-test-hook',
        execute: async () => {
          throw new Error('Test hook error');
        }
      });

      await expect(
        hooks.executeHook('error-test-hook', context)
      ).rejects.toThrow('Test hook error');
    });

    it('should stop execution when a hook fails', async () => {
      let secondHookExecuted = false;
      
      hooks.registerHook({
        name: 'failing-hook',
        execute: async () => {
          throw new Error('Hook failed');
        }
      });

      hooks.registerHook({
        name: 'second-hook',
        execute: async () => {
          secondHookExecuted = true;
        }
      });

      await expect(
        hooks.executeHooks(['failing-hook', 'second-hook'], context)
      ).rejects.toThrow('Hook failed');
      
      expect(secondHookExecuted).toBe(false);
    });
  });
});