import { Client } from 'pg';
import { TEST_CONFIG } from '../config/test-config';

describe.skip('Routing Graph Quality Validation (Moved to staging-integration.test.ts)', () => {
  let pgClient: Client;
  let stagingSchema: string;

  beforeAll(async () => {
    pgClient = new Client(TEST_CONFIG.database);
    await pgClient.connect();
    
    // Create a test staging schema
    stagingSchema = `staging_test_routing_quality_${Date.now()}`;
    console.log(`🏗️  Creating test staging schema: ${stagingSchema}`);
    
    // Create the staging schema
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Create trails table in staging schema
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        trail_type TEXT,
        surface TEXT,
        length_km REAL CHECK(length_km > 0),
        elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
        geometry GEOMETRY(LINESTRING, 4326)
      )
    `);
    
    // Create routing_nodes table in staging schema
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_uuid TEXT UNIQUE,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
        connected_trails TEXT,
        geo2 GEOMETRY(POINT, 4326)
      )
    `);
    
    // Create routing_edges table in staging schema
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.routing_edges (
        id SERIAL PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        trail_id TEXT NOT NULL,
        trail_name TEXT NOT NULL,
        distance_km REAL NOT NULL CHECK(distance_km > 0),
        elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
        is_bidirectional BOOLEAN DEFAULT TRUE,
        geo2 GEOMETRY(LINESTRING, 4326),
        FOREIGN KEY (from_node_id) REFERENCES ${stagingSchema}.routing_nodes(id),
        FOREIGN KEY (to_node_id) REFERENCES ${stagingSchema}.routing_nodes(id)
      )
    `);
    
    // Insert test trail data
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.trails (app_uuid, name, region, trail_type, surface, length_km, elevation_gain, elevation_loss, geometry) VALUES
      ('test-trail-1', 'Test Trail 1', 'test', 'path', 'dirt', 2.5, 100, 50, ST_GeomFromText('LINESTRING(-105.5 40.0, -105.4 40.1, -105.3 40.2)')),
      ('test-trail-2', 'Test Trail 2', 'test', 'path', 'dirt', 1.8, 75, 25, ST_GeomFromText('LINESTRING(-105.4 40.1, -105.3 40.2, -105.2 40.3)')),
      ('test-trail-3', 'Test Trail 3', 'test', 'path', 'dirt', 3.2, 150, 100, ST_GeomFromText('LINESTRING(-105.3 40.2, -105.2 40.3, -105.1 40.4)'))
    `);
    
    // Insert test routing nodes
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails, geo2) VALUES
      ('node-1', 40.0, -105.5, 2000, 'endpoint', 'test-trail-1', ST_GeomFromText('POINT(-105.5 40.0)')),
      ('node-2', 40.1, -105.4, 2100, 'intersection', 'test-trail-1,test-trail-2', ST_GeomFromText('POINT(-105.4 40.1)')),
      ('node-3', 40.2, -105.3, 2200, 'intersection', 'test-trail-1,test-trail-2,test-trail-3', ST_GeomFromText('POINT(-105.3 40.2)')),
      ('node-4', 40.3, -105.2, 2300, 'intersection', 'test-trail-2,test-trail-3', ST_GeomFromText('POINT(-105.2 40.3)')),
      ('node-5', 40.4, -105.1, 2400, 'endpoint', 'test-trail-3', ST_GeomFromText('POINT(-105.1 40.4)'))
    `);
    
    // Insert test routing edges
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geo2) VALUES
      (1, 2, 'test-trail-1', 'Test Trail 1', 1.2, 50, 0, ST_GeomFromText('LINESTRING(-105.5 40.0, -105.4 40.1)')),
      (2, 3, 'test-trail-1', 'Test Trail 1', 1.3, 50, 0, ST_GeomFromText('LINESTRING(-105.4 40.1, -105.3 40.2)')),
      (2, 3, 'test-trail-2', 'Test Trail 2', 1.1, 25, 0, ST_GeomFromText('LINESTRING(-105.4 40.1, -105.3 40.2)')),
      (3, 4, 'test-trail-2', 'Test Trail 2', 0.7, 25, 0, ST_GeomFromText('LINESTRING(-105.3 40.2, -105.2 40.3)')),
      (3, 4, 'test-trail-3', 'Test Trail 3', 1.0, 50, 25, ST_GeomFromText('LINESTRING(-105.3 40.2, -105.2 40.3)')),
      (4, 5, 'test-trail-3', 'Test Trail 3', 2.2, 100, 75, ST_GeomFromText('LINESTRING(-105.2 40.3, -105.1 40.4)'))
    `);
    
    console.log(`✅ Test staging schema created with sample data`);
  });

  afterAll(async () => {
    // Clean up the test staging schema
    if (stagingSchema) {
      console.log(`🧹 Cleaning up test staging schema: ${stagingSchema}`);
      await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    }
    await pgClient.end();
  });

  describe('Routing Graph Quality Metrics', () => {
    it('should have reasonable node-to-trail ratio', async () => {
      const result = await pgClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM ${stagingSchema}.routing_nodes) as node_count,
          (SELECT COUNT(*) FROM ${stagingSchema}.trails) as trail_count
      `);
      
      const nodeCount = parseInt(result.rows[0].node_count);
      const trailCount = parseInt(result.rows[0].trail_count);
      const ratio = nodeCount / trailCount;
      
      console.log(`📊 Node-to-trail ratio: ${ratio.toFixed(2)} (${nodeCount} nodes / ${trailCount} trails)`);
      
      // Node-to-trail ratio should be reasonable (not too high, not too low)
      expect(ratio).toBeGreaterThan(1.0); // Should have more nodes than trails
      expect(ratio).toBeLessThan(10.0); // Shouldn't have excessive nodes
    });

    it('should have no orphaned nodes', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as orphaned_count
        FROM ${stagingSchema}.routing_nodes n
        WHERE NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.routing_edges e 
          WHERE e.from_node_id = n.id OR e.to_node_id = n.id
        )
      `);
      
      const orphanedCount = parseInt(result.rows[0].orphaned_count);
      console.log(`🔗 Orphaned nodes: ${orphanedCount}`);
      
      expect(orphanedCount).toBe(0);
    });

    it('should have minimal self-loops', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as self_loop_count
        FROM ${stagingSchema}.routing_edges 
        WHERE from_node_id = to_node_id
      `);
      
      const selfLoopCount = parseInt(result.rows[0].self_loop_count);
      const totalEdges = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
      const totalEdgeCount = parseInt(totalEdges.rows[0].count);
      const selfLoopPercentage = (selfLoopCount / totalEdgeCount) * 100;
      
      console.log(`🔄 Self-loops: ${selfLoopCount}/${totalEdgeCount} (${selfLoopPercentage.toFixed(1)}%)`);
      
      // Self-loops should be minimal (less than 10% of edges)
      expect(selfLoopPercentage).toBeLessThan(10.0);
    });

    it('should have valid edge connections', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as invalid_edges
        FROM ${stagingSchema}.routing_edges e
        LEFT JOIN ${stagingSchema}.routing_nodes n1 ON e.from_node_id = n1.id
        LEFT JOIN ${stagingSchema}.routing_nodes n2 ON e.to_node_id = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
      `);
      
      const invalidEdgeCount = parseInt(result.rows[0].invalid_edges);
      const totalEdges = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
      const totalEdgeCount = parseInt(totalEdges.rows[0].count);
      
      console.log(`🔗 Invalid edge connections: ${invalidEdgeCount}/${totalEdgeCount} edges`);
      
      expect(invalidEdgeCount).toBe(0);
    });

    it('should have reasonable edge distances', async () => {
      const result = await pgClient.query(`
        SELECT 
          COUNT(*) as total_edges,
          COUNT(CASE WHEN distance_km > 0 AND distance_km < 100 THEN 1 END) as valid_length_edges,
          AVG(distance_km) as avg_length,
          MIN(distance_km) as min_length,
          MAX(distance_km) as max_length
        FROM ${stagingSchema}.routing_edges
        WHERE distance_km IS NOT NULL
      `);
      
      const row = result.rows[0];
      const totalEdges = parseInt(row.total_edges);
      const validLengthEdges = parseInt(row.valid_length_edges);
      const avgLength = parseFloat(row.avg_length);
      const minLength = parseFloat(row.min_length);
      const maxLength = parseFloat(row.max_length);
      
      console.log(`📏 Edge distances: avg=${avgLength.toFixed(2)}km, min=${minLength.toFixed(2)}km, max=${maxLength.toFixed(2)}km`);
      console.log(`📏 Valid length edges: ${validLengthEdges}/${totalEdges}`);
      
      // All edges should have reasonable lengths
      expect(validLengthEdges).toBe(totalEdges);
      expect(avgLength).toBeGreaterThan(0);
      expect(maxLength).toBeLessThan(100); // No extremely long edges
    });

    it('should have proper spatial distribution', async () => {
      const result = await pgClient.query(`
        SELECT 
          COUNT(*) as total_nodes,
          COUNT(DISTINCT lat) as unique_latitudes,
          COUNT(DISTINCT lng) as unique_longitudes,
          AVG(lat) as avg_lat,
          AVG(lng) as avg_lng
        FROM ${stagingSchema}.routing_nodes
      `);
      
      const row = result.rows[0];
      const totalNodes = parseInt(row.total_nodes);
      const uniqueLatitudes = parseInt(row.unique_latitudes);
      const uniqueLongitudes = parseInt(row.unique_longitudes);
      const avgLat = parseFloat(row.avg_lat);
      const avgLng = parseFloat(row.avg_lng);
      
      console.log(`🗺️ Spatial distribution: ${uniqueLatitudes} unique lat, ${uniqueLongitudes} unique lng`);
      console.log(`🗺️ Average position: (${avgLat.toFixed(4)}, ${avgLng.toFixed(4)})`);
      
      // Should have reasonable spatial distribution
      expect(uniqueLatitudes).toBeGreaterThan(1);
      expect(uniqueLongitudes).toBeGreaterThan(1);
      expect(avgLat).toBeGreaterThan(30); // Should be in reasonable latitude range
      expect(avgLat).toBeLessThan(50);
      expect(avgLng).toBeGreaterThan(-111); // Should be in reasonable longitude range
      expect(avgLng).toBeLessThan(-100);
    });
  });

  describe('Routing Graph Performance Metrics', () => {
    it('should have reasonable table sizes', async () => {
      const result = await pgClient.query(`
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_tables 
        WHERE tablename IN ('routing_nodes', 'routing_edges', 'trails')
        AND schemaname = $1
      `, [stagingSchema]);
      
      console.log(`💾 Table sizes:`);
      for (const row of result.rows) {
        console.log(`  - ${row.tablename}: ${row.size}`);
      }
      
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Routing Graph Data Integrity', () => {
    it('should have consistent data types', async () => {
      const result = await pgClient.query(`
        SELECT 
          table_name,
          column_name,
          data_type,
          is_nullable
        FROM information_schema.columns 
        WHERE table_name IN ('routing_nodes', 'routing_edges')
        AND table_schema = $1
        ORDER BY table_name, column_name
      `, [stagingSchema]);
      
      console.log(`📋 Column data types:`);
      for (const row of result.rows) {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      }
      
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have no duplicate nodes at same location', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as duplicate_count
        FROM (
          SELECT lat, lng, COUNT(*) as cnt
          FROM ${stagingSchema}.routing_nodes
          GROUP BY lat, lng
          HAVING COUNT(*) > 1
        ) duplicates
      `);
      
      const duplicateCount = parseInt(result.rows[0].duplicate_count);
      console.log(`🔄 Duplicate nodes at same location: ${duplicateCount}`);
      
      expect(duplicateCount).toBe(0);
    });

    it('should have no duplicate edges', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as duplicate_count
        FROM (
          SELECT from_node_id, to_node_id, trail_id, COUNT(*) as cnt
          FROM ${stagingSchema}.routing_edges
          GROUP BY from_node_id, to_node_id, trail_id
          HAVING COUNT(*) > 1
        ) duplicates
      `);
      
      const duplicateCount = parseInt(result.rows[0].duplicate_count);
      console.log(`🔄 Duplicate edges: ${duplicateCount}`);
      
      expect(duplicateCount).toBe(0);
    });
  });

  describe('Comprehensive Quality Report', () => {
    it('should generate comprehensive quality report', async () => {
      const report = await pgClient.query(`
        SELECT 
          'Total Nodes' as metric, COUNT(*)::text as value FROM ${stagingSchema}.routing_nodes
        UNION ALL
        SELECT 
          'Total Edges' as metric, COUNT(*)::text as value FROM ${stagingSchema}.routing_edges
        UNION ALL
        SELECT 
          'Total Trails' as metric, COUNT(*)::text as value FROM ${stagingSchema}.trails
        UNION ALL
        SELECT 
          'Intersection Nodes' as metric, COUNT(*)::text as value FROM ${stagingSchema}.routing_nodes WHERE node_type = 'intersection'
        UNION ALL
        SELECT 
          'Endpoint Nodes' as metric, COUNT(*)::text as value FROM ${stagingSchema}.routing_nodes WHERE node_type = 'endpoint'
        UNION ALL
        SELECT 
          'Average Edge Length' as metric, AVG(distance_km)::text as value FROM ${stagingSchema}.routing_edges
        UNION ALL
        SELECT 
          'Total Distance' as metric, SUM(distance_km)::text as value FROM ${stagingSchema}.routing_edges
      `);
      
      console.log(`📊 Quality Report:`);
      for (const row of report.rows) {
        console.log(`  - ${row.metric}: ${row.value}`);
      }
      
      expect(report.rows.length).toBeGreaterThan(0);
      
      // Validate we have reasonable data
      const totalNodes = parseInt(report.rows.find(r => r.metric === 'Total Nodes')?.value || '0');
      const totalEdges = parseInt(report.rows.find(r => r.metric === 'Total Edges')?.value || '0');
      const totalTrails = parseInt(report.rows.find(r => r.metric === 'Total Trails')?.value || '0');
      
      expect(totalNodes).toBeGreaterThan(0);
      expect(totalEdges).toBeGreaterThan(0);
      expect(totalTrails).toBeGreaterThan(0);
    });
  });
}); 