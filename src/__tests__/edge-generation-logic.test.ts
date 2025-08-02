import { Client } from 'pg';
import { getTestDbConfig } from '../database/connection';

describe('Edge Generation Logic - Failure Case Prevention', () => {
  let pgClient: Client;
  let testSchema: string;

  beforeAll(async () => {
    pgClient = new Client(getTestDbConfig());
    await pgClient.connect();
  });

  afterAll(async () => {
    await pgClient.end();
  });

  beforeEach(async () => {
    // Create unique test schema for each test
    testSchema = `test_edge_logic_${Date.now()}`;
    
    // Create test schema and tables
    await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Create trails table
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        length_km REAL CHECK(length_km > 0),
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        geometry GEOMETRY(LINESTRING, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create routing nodes table
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${testSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_uuid TEXT UNIQUE,
        lat REAL,
        lng REAL,
        elevation REAL,
        node_type TEXT,
        connected_trails TEXT,
        trail_ids TEXT[], -- Array of trail UUIDs associated with this node
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create routing edges table
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${testSchema}.routing_edges (
        id SERIAL PRIMARY KEY,
        source INTEGER NOT NULL,
        target INTEGER NOT NULL,
        trail_id TEXT NOT NULL,
        trail_name TEXT NOT NULL,
        length_km REAL NOT NULL,
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        is_bidirectional BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        geometry geometry(LineString, 4326),
        geojson TEXT,
        FOREIGN KEY (source) REFERENCES ${testSchema}.routing_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target) REFERENCES ${testSchema}.routing_nodes(id) ON DELETE CASCADE
      )
    `);
  });

  afterEach(async () => {
    // Clean up test schema
    await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
  });

  describe('Edge Generation Logic', () => {
    it('should NOT create edges between nodes that do not share trail connections', async () => {
      // Insert test trails that are completely separate (no shared connections)
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry, length_km
        ) VALUES 
        ('trail-1', 'Isolated Trail 1', 'test-region', 
         ST_GeomFromText('LINESTRING(-105.259216309 40.083118439, -105.259000000 40.083000000)', 4326), 1.0),
        ('trail-2', 'Isolated Trail 2', 'test-region', 
         ST_GeomFromText('LINESTRING(-105.244804382 40.080978394, -105.245000000 40.081000000)', 4326), 1.0)
      `);
      
      // Insert nodes that represent the endpoints of these isolated trails
      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_nodes (
          node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids
        ) VALUES 
        ('node-1', 40.083118439, -105.259216309, 1600, 'endpoint', 'Isolated Trail 1', ARRAY['trail-1']),
        ('node-2', 40.080978394, -105.244804382, 1600, 'endpoint', 'Isolated Trail 2', ARRAY['trail-2'])
      `);
      
      // Apply the new edge generation logic
      const edgesSql = `
        INSERT INTO ${testSchema}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
        WITH node_pairs AS (
          -- Find all pairs of nodes that share at least one trail connection
          SELECT DISTINCT
            n1.id as source_id,
            n2.id as target_id,
            n1.lat as source_lat,
            n1.lng as source_lng,
            n2.lat as target_lat,
            n2.lng as target_lng,
            -- Find shared trail IDs between the two nodes
            unnest(n1.trail_ids) as shared_trail_id
          FROM ${testSchema}.routing_nodes n1
          JOIN ${testSchema}.routing_nodes n2 ON 
            n1.id < n2.id  -- Avoid duplicate pairs (A->B and B->A)
            AND n1.trail_ids && n2.trail_ids  -- Check for array overlap (shared trails)
        ),
        trail_info AS (
          -- Get trail information for the shared trails
          SELECT 
            np.source_id,
            np.target_id,
            np.source_lat,
            np.source_lng,
            np.target_lat,
            np.target_lng,
            np.shared_trail_id,
            t.name as trail_name,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss
          FROM node_pairs np
          JOIN ${testSchema}.trails t ON t.app_uuid = np.shared_trail_id
          WHERE t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry) 
          AND t.length_km > 0
        ),
        unique_edges AS (
          -- Ensure we only create one edge per node pair, using the first shared trail
          SELECT DISTINCT ON (source_id, target_id)
            source_id,
            target_id,
            source_lat,
            source_lng,
            target_lat,
            target_lng,
            shared_trail_id as trail_id,
            trail_name,
            length_km,
            elevation_gain,
            elevation_loss
          FROM trail_info
          ORDER BY source_id, target_id, shared_trail_id
        )
        SELECT 
          source_id as source,
          target_id as target,
          trail_id,
          trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_MakeLine(
            ST_SetSRID(ST_MakePoint(source_lng, source_lat), 4326),
            ST_SetSRID(ST_MakePoint(target_lng, target_lat), 4326)
          ) as geometry,
          ST_AsGeoJSON(
            ST_MakeLine(
              ST_SetSRID(ST_MakePoint(source_lng, source_lat), 4326),
              ST_SetSRID(ST_MakePoint(target_lng, target_lat), 4326)
            ), 6, 0
          ) as geojson
        FROM unique_edges
        WHERE source_id IS NOT NULL 
        AND target_id IS NOT NULL
        AND source_id <> target_id
      `;
      
      await pgClient.query(edgesSql);
      
      // Check that NO edges were created (because nodes don't share trail connections)
      const edgeCountResult = await pgClient.query(`SELECT COUNT(*) FROM ${testSchema}.routing_edges`);
      const edgeCount = parseInt(edgeCountResult.rows[0].count);
      
      expect(edgeCount).toBe(0);
      
      // Verify the specific failure case coordinates are NOT present
      const failureCaseResult = await pgClient.query(`
        SELECT COUNT(*) FROM ${testSchema}.routing_edges 
        WHERE ST_Equals(
          geometry, 
          ST_GeomFromText('LINESTRING(-105.259216309 40.083118439, -105.244804382 40.080978394)', 4326)
        )
      `);
      const failureCaseCount = parseInt(failureCaseResult.rows[0].count);
      
      expect(failureCaseCount).toBe(0);
    });

    it('should create edges between nodes that DO share trail connections', async () => {
      // Insert test trails that share a connection point
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry, length_km
        ) VALUES 
        ('trail-1', 'Connected Trail 1', 'test-region', 
         ST_GeomFromText('LINESTRING(-105.259216309 40.083118439, -105.259000000 40.083000000)', 4326), 1.0),
        ('trail-2', 'Connected Trail 2', 'test-region', 
         ST_GeomFromText('LINESTRING(-105.259000000 40.083000000, -105.244804382 40.080978394)', 4326), 1.0)
      `);
      
      // Insert nodes where one node is shared between both trails
      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_nodes (
          node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids
        ) VALUES 
        ('node-1', 40.083118439, -105.259216309, 1600, 'endpoint', 'Connected Trail 1', ARRAY['trail-1']),
        ('node-2', 40.083000000, -105.259000000, 1600, 'intersection', 'Connected Trail 1, Connected Trail 2', ARRAY['trail-1', 'trail-2']),
        ('node-3', 40.080978394, -105.244804382, 1600, 'endpoint', 'Connected Trail 2', ARRAY['trail-2'])
      `);
      
      // Apply the new edge generation logic
      const edgesSql = `
        INSERT INTO ${testSchema}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
        WITH node_pairs AS (
          -- Find all pairs of nodes that share at least one trail connection
          SELECT DISTINCT
            n1.id as source_id,
            n2.id as target_id,
            n1.lat as source_lat,
            n1.lng as source_lng,
            n2.lat as target_lat,
            n2.lng as target_lng,
            -- Find shared trail IDs between the two nodes
            unnest(n1.trail_ids) as shared_trail_id
          FROM ${testSchema}.routing_nodes n1
          JOIN ${testSchema}.routing_nodes n2 ON 
            n1.id < n2.id  -- Avoid duplicate pairs (A->B and B->A)
            AND n1.trail_ids && n2.trail_ids  -- Check for array overlap (shared trails)
        ),
        trail_info AS (
          -- Get trail information for the shared trails
          SELECT 
            np.source_id,
            np.target_id,
            np.source_lat,
            np.source_lng,
            np.target_lat,
            np.target_lng,
            np.shared_trail_id,
            t.name as trail_name,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss
          FROM node_pairs np
          JOIN ${testSchema}.trails t ON t.app_uuid = np.shared_trail_id
          WHERE t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry) 
          AND t.length_km > 0
        ),
        unique_edges AS (
          -- Ensure we only create one edge per node pair, using the first shared trail
          SELECT DISTINCT ON (source_id, target_id)
            source_id,
            target_id,
            source_lat,
            source_lng,
            target_lat,
            target_lng,
            shared_trail_id as trail_id,
            trail_name,
            length_km,
            elevation_gain,
            elevation_loss
          FROM trail_info
          ORDER BY source_id, target_id, shared_trail_id
        )
        SELECT 
          source_id as source,
          target_id as target,
          trail_id,
          trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_MakeLine(
            ST_SetSRID(ST_MakePoint(source_lng, source_lat), 4326),
            ST_SetSRID(ST_MakePoint(target_lng, target_lat), 4326)
          ) as geometry,
          ST_AsGeoJSON(
            ST_MakeLine(
              ST_SetSRID(ST_MakePoint(source_lng, source_lat), 4326),
              ST_SetSRID(ST_MakePoint(target_lng, target_lat), 4326)
            ), 6, 0
          ) as geojson
        FROM unique_edges
        WHERE source_id IS NOT NULL 
        AND target_id IS NOT NULL
        AND source_id <> target_id
      `;
      
      await pgClient.query(edgesSql);
      
      // Check that edges WERE created (because nodes share trail connections)
      const edgeCountResult = await pgClient.query(`SELECT COUNT(*) FROM ${testSchema}.routing_edges`);
      const edgeCount = parseInt(edgeCountResult.rows[0].count);
      
      expect(edgeCount).toBeGreaterThan(0);
      
      // Verify that edges connect nodes that share trail connections
      const sharedConnectionEdges = await pgClient.query(`
        SELECT e.*, 
               n1.trail_ids as source_trail_ids,
               n2.trail_ids as target_trail_ids
        FROM ${testSchema}.routing_edges e
        JOIN ${testSchema}.routing_nodes n1 ON e.source = n1.id
        JOIN ${testSchema}.routing_nodes n2 ON e.target = n2.id
        WHERE n1.trail_ids && n2.trail_ids  -- Check for array overlap
      `);
      
      expect(sharedConnectionEdges.rows.length).toBe(edgeCount);
    });

    it('should verify the specific failure case coordinates are not generated', async () => {
      // This test specifically checks for the failure case mentioned by the user
      const failureCaseCoordinates = [
        [-105.259216309, 40.083118439],
        [-105.244804382, 40.080978394]
      ];
      
      // Create a scenario where these coordinates might be incorrectly connected
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry, length_km
        ) VALUES 
        ('trail-1', 'Trail with Failure Case Start', 'test-region', 
         ST_GeomFromText('LINESTRING(-105.259216309 40.083118439, -105.259000000 40.083000000)', 4326), 1.0),
        ('trail-2', 'Trail with Failure Case End', 'test-region', 
         ST_GeomFromText('LINESTRING(-105.245000000 40.081000000, -105.244804382 40.080978394)', 4326), 1.0)
      `);
      
      // Insert nodes at the failure case coordinates
      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_nodes (
          node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids
        ) VALUES 
        ('failure-node-1', 40.083118439, -105.259216309, 1600, 'endpoint', 'Trail with Failure Case Start', ARRAY['trail-1']),
        ('failure-node-2', 40.080978394, -105.244804382, 1600, 'endpoint', 'Trail with Failure Case End', ARRAY['trail-2'])
      `);
      
      // Apply the new edge generation logic
      const edgesSql = `
        INSERT INTO ${testSchema}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
        WITH node_pairs AS (
          -- Find all pairs of nodes that share at least one trail connection
          SELECT DISTINCT
            n1.id as source_id,
            n2.id as target_id,
            n1.lat as source_lat,
            n1.lng as source_lng,
            n2.lat as target_lat,
            n2.lng as target_lng,
            -- Find shared trail IDs between the two nodes
            unnest(n1.trail_ids) as shared_trail_id
          FROM ${testSchema}.routing_nodes n1
          JOIN ${testSchema}.routing_nodes n2 ON 
            n1.id < n2.id  -- Avoid duplicate pairs (A->B and B->A)
            AND n1.trail_ids && n2.trail_ids  -- Check for array overlap (shared trails)
        ),
        trail_info AS (
          -- Get trail information for the shared trails
          SELECT 
            np.source_id,
            np.target_id,
            np.source_lat,
            np.source_lng,
            np.target_lat,
            np.target_lng,
            np.shared_trail_id,
            t.name as trail_name,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss
          FROM node_pairs np
          JOIN ${testSchema}.trails t ON t.app_uuid = np.shared_trail_id
          WHERE t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry) 
          AND t.length_km > 0
        ),
        unique_edges AS (
          -- Ensure we only create one edge per node pair, using the first shared trail
          SELECT DISTINCT ON (source_id, target_id)
            source_id,
            target_id,
            source_lat,
            source_lng,
            target_lat,
            target_lng,
            shared_trail_id as trail_id,
            trail_name,
            length_km,
            elevation_gain,
            elevation_loss
          FROM trail_info
          ORDER BY source_id, target_id, shared_trail_id
        )
        SELECT 
          source_id as source,
          target_id as target,
          trail_id,
          trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_MakeLine(
            ST_SetSRID(ST_MakePoint(source_lng, source_lat), 4326),
            ST_SetSRID(ST_MakePoint(target_lng, target_lat), 4326)
          ) as geometry,
          ST_AsGeoJSON(
            ST_MakeLine(
              ST_SetSRID(ST_MakePoint(source_lng, source_lat), 4326),
              ST_SetSRID(ST_MakePoint(target_lng, target_lat), 4326)
            ), 6, 0
          ) as geojson
        FROM unique_edges
        WHERE source_id IS NOT NULL 
        AND target_id IS NOT NULL
        AND source_id <> target_id
      `;
      
      await pgClient.query(edgesSql);
      
      // Verify that the specific failure case edge is NOT created
      const failureCaseResult = await pgClient.query(`
        SELECT COUNT(*) FROM ${testSchema}.routing_edges 
        WHERE ST_Equals(
          geometry, 
          ST_GeomFromText('LINESTRING(-105.259216309 40.083118439, -105.244804382 40.080978394)', 4326)
        )
      `);
      const failureCaseCount = parseInt(failureCaseResult.rows[0].count);
      
      expect(failureCaseCount).toBe(0);
      
      // Also verify that no edges were created at all (since nodes don't share trails)
      const totalEdgeCount = await pgClient.query(`SELECT COUNT(*) FROM ${testSchema}.routing_edges`);
      expect(parseInt(totalEdgeCount.rows[0].count)).toBe(0);
    });
  });
}); 