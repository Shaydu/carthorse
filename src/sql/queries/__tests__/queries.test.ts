import { StagingQueries, RoutingQueries, ExportQueries, ValidationQueries, CleanupQueries } from '../index';

describe('SQL Queries', () => {
  describe('StagingQueries', () => {
    it('should generate createSchema query', () => {
      const query = StagingQueries.createSchema('test_schema');
      expect(query).toContain('CREATE SCHEMA IF NOT EXISTS test_schema');
    });

    it('should generate copyTrails query without bbox', () => {
      const query = StagingQueries.copyTrails('public', 'staging', 'boulder');
      expect(query).toContain('INSERT INTO staging.trails');
      expect(query).toContain('SELECT * FROM public.trails');
      expect(query).toContain('WHERE region = $1');
      expect(query).not.toContain('ST_Intersects');
    });

    it('should generate copyTrails query with bbox', () => {
      const bbox = { minLng: -105, minLat: 40, maxLng: -104, maxLat: 41 };
      const query = StagingQueries.copyTrails('public', 'staging', 'boulder', bbox);
      expect(query).toContain('ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))');
    });

    it('should generate validateStagingData query', () => {
      const query = StagingQueries.validateStagingData('test_schema');
      expect(query).toContain('SELECT');
      expect(query).toContain('FROM test_schema.trails');
      expect(query).toContain('total_trails');
      expect(query).toContain('null_geometry');
    });
  });

  describe('RoutingQueries', () => {
    it('should generate detectIntersections query', () => {
      const query = RoutingQueries.detectIntersections('test_schema', 2.0);
      expect(query).toContain('SELECT * FROM detect_trail_intersections($1, \'trails\', $2)');
    });

    it('should generate generateNodes query', () => {
      const query = RoutingQueries.generateNodes('test_schema', 2.0);
      expect(query).toContain('INSERT INTO test_schema.ways_noded_vertices_pgr');
      expect(query).toContain('WITH valid_trails AS');
      expect(query).toContain('trail_endpoints AS');
    });

    it('should generate generateEdges query', () => {
      const query = RoutingQueries.generateEdges('test_schema', 20.0);
      expect(query).toContain('INSERT INTO test_schema.routing_edges');
      expect(query).toContain('source, target, trail_id');
    });

    it('should generate validateNetwork query', () => {
      const query = RoutingQueries.validateNetwork('test_schema');
      expect(query).toContain('WITH node_degrees AS');
      expect(query).toContain('total_nodes');
      expect(query).toContain('isolated_nodes');
    });
  });

  describe('ExportQueries', () => {
    it('should generate getTrailsForExport query', () => {
      const query = ExportQueries.getTrailsForExport('test_schema');
      expect(query).toContain('SELECT');
      expect(query).toContain('FROM test_schema.trails');
      expect(query).toContain('surface as surface_type');
      expect(query).toContain('ST_AsGeoJSON(geometry, 6, 0) AS geojson');
    });

    it('should generate getRoutingNodesForExport query', () => {
      const query = ExportQueries.getRoutingNodesForExport('test_schema');
      expect(query).toContain('SELECT');
      expect(query).toContain('FROM test_schema.ways_noded_vertices_pgr');
      expect(query).toContain('node_uuid');
      expect(query).toContain('lat');
      expect(query).toContain('lng');
    });

    it('should generate getRoutingEdgesForExport query', () => {
      const query = ExportQueries.getRoutingEdgesForExport('test_schema');
      expect(query).toContain('SELECT');
      expect(query).toContain('FROM test_schema.routing_edges');
      expect(query).toContain('source');
      expect(query).toContain('target');
      expect(query).toContain('trail_id');
      expect(query).toContain('WHERE source IS NOT NULL AND target IS NOT NULL');
    });
  });

  describe('ValidationQueries', () => {
    it('should generate checkSchemaVersion query', () => {
      const query = ValidationQueries.checkSchemaVersion();
      expect(query).toContain('SELECT version FROM schema_version');
    });

    it('should generate checkRequiredFunctions query', () => {
      const query = ValidationQueries.checkRequiredFunctions(['func1', 'func2']);
      expect(query).toContain('SELECT proname FROM pg_proc WHERE proname = ANY($1)');
    });

    it('should generate checkDataAvailability query without bbox', () => {
      const result = ValidationQueries.checkDataAvailability('boulder');
      expect(result.query).toContain('SELECT COUNT(*) as count FROM public.trails WHERE region = $1');
      expect(result.params).toEqual(['boulder']);
    });

    it('should generate checkDataAvailability query with bbox', () => {
      const bbox: [number, number, number, number] = [-105, 40, -104, 41];
      const result = ValidationQueries.checkDataAvailability('boulder', bbox);
      expect(result.query).toContain('ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))');
      expect(result.params).toEqual(['boulder', -105, 40, -104, 41]);
    });
  });

  describe('CleanupQueries', () => {
    it('should generate cleanupStagingSchema query', () => {
      const query = CleanupQueries.cleanupStagingSchema('test_schema');
      expect(query).toContain('DROP SCHEMA IF EXISTS test_schema CASCADE');
    });

    it('should generate findAllStagingSchemas query', () => {
      const query = CleanupQueries.findAllStagingSchemas();
      expect(query).toContain('SELECT nspname');
      expect(query).toContain('FROM pg_namespace');
      expect(query).toContain("WHERE nspname LIKE 'staging_%'");
    });

    it('should generate cleanupOrphanedNodes query', () => {
      const query = CleanupQueries.cleanupOrphanedNodes('test_schema');
      expect(query).toContain('DELETE FROM test_schema.ways_noded_vertices_pgr');
      expect(query).toContain('WHERE id NOT IN');
    });
  });
}); 