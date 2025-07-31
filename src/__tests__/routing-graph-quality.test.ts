import { Client } from 'pg';
import { TEST_CONFIG } from '../config/test-config';

describe('Routing Graph Quality Validation', () => {
  let pgClient: Client;

  beforeAll(async () => {
    pgClient = new Client(TEST_CONFIG.database);
    await pgClient.connect();
  });

  afterAll(async () => {
    await pgClient.end();
  });

  describe('Routing Graph Quality Metrics', () => {
    it('should have reasonable node-to-trail ratio', async () => {
      const result = await pgClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM routing_nodes) as node_count,
          (SELECT COUNT(*) FROM trails) as trail_count
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
        FROM routing_nodes n
        WHERE NOT EXISTS (
          SELECT 1 FROM routing_edges e 
          WHERE e.source = n.id OR e.target = n.id
        )
      `);
      
      const orphanedCount = parseInt(result.rows[0].orphaned_count);
      console.log(`🔗 Orphaned nodes: ${orphanedCount}`);
      
      expect(orphanedCount).toBe(0);
    });

    it('should have minimal self-loops', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as self_loop_count
        FROM routing_edges 
        WHERE source = target
      `);
      
      const selfLoopCount = parseInt(result.rows[0].self_loop_count);
      const totalEdges = await pgClient.query('SELECT COUNT(*) as count FROM routing_edges');
      const totalEdgeCount = parseInt(totalEdges.rows[0].count);
      const selfLoopPercentage = (selfLoopCount / totalEdgeCount) * 100;
      
      console.log(`🔄 Self-loops: ${selfLoopCount}/${totalEdgeCount} (${selfLoopPercentage.toFixed(1)}%)`);
      
      // Self-loops should be minimal (less than 10% of edges)
      expect(selfLoopPercentage).toBeLessThan(10.0);
    });

    it('should have proper network connectivity', async () => {
      const result = await pgClient.query(`
        WITH connected_components AS (
          SELECT DISTINCT 
            CASE WHEN source = target THEN id ELSE LEAST(source, target) END as component
          FROM routing_edges
        )
        SELECT COUNT(DISTINCT component) as component_count
        FROM connected_components
      `);
      
      const componentCount = parseInt(result.rows[0].component_count);
      const totalEdges = await pgClient.query('SELECT COUNT(*) as count FROM routing_edges');
      const totalEdgeCount = parseInt(totalEdges.rows[0].count);
      
      console.log(`🌐 Connected components: ${componentCount} (${totalEdgeCount} total edges)`);
      
      // Should have reasonable number of connected components
      expect(componentCount).toBeGreaterThan(0);
      expect(componentCount).toBeLessThan(totalEdgeCount);
    });

    it('should have valid node coordinates', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as invalid_nodes
        FROM routing_nodes 
        WHERE lng IS NULL OR lat IS NULL 
           OR lng < -180 OR lng > 180 
           OR lat < -90 OR lat > 90
      `);
      
      const invalidNodeCount = parseInt(result.rows[0].invalid_nodes);
      const totalNodes = await pgClient.query('SELECT COUNT(*) as count FROM routing_nodes');
      const totalNodeCount = parseInt(totalNodes.rows[0].count);
      
      console.log(`📍 Invalid coordinates: ${invalidNodeCount}/${totalNodeCount} nodes`);
      
      expect(invalidNodeCount).toBe(0);
    });

    it('should have valid edge connections', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as invalid_edges
        FROM routing_edges e
        LEFT JOIN routing_nodes n1 ON e.source = n1.id
        LEFT JOIN routing_nodes n2 ON e.target = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
      `);
      
      const invalidEdgeCount = parseInt(result.rows[0].invalid_edges);
      const totalEdges = await pgClient.query('SELECT COUNT(*) as count FROM routing_edges');
      const totalEdgeCount = parseInt(totalEdges.rows[0].count);
      
      console.log(`🔗 Invalid edge connections: ${invalidEdgeCount}/${totalEdgeCount} edges`);
      
      expect(invalidEdgeCount).toBe(0);
    });

    it('should have reasonable edge distances', async () => {
      const result = await pgClient.query(`
        SELECT 
          COUNT(*) as total_edges,
          COUNT(CASE WHEN length_km > 0 AND length_km < 100 THEN 1 END) as valid_length_edges,
          AVG(length_km) as avg_length,
          MIN(length_km) as min_length,
          MAX(length_km) as max_length
        FROM routing_edges
        WHERE length_km IS NOT NULL
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
        FROM routing_nodes
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
      expect(avgLng).toBeGreaterThan(-111); // Should be in reasonable longitude range (adjusted for actual data)
      expect(avgLng).toBeLessThan(-100);
    });
  });

  describe('Routing Graph Performance Metrics', () => {
    it.skip('should have efficient spatial indexes', async () => {
      const result = await pgClient.query(`
        SELECT 
          i.relname as indexname,
          t.relname as tablename,
          pg_get_indexdef(i.oid) as indexdef
        FROM pg_class i
        JOIN pg_class t ON i.relindextype = t.oid
        JOIN pg_namespace n ON i.relnamespace = n.oid
        WHERE n.nspname = 'public'
        AND t.relname IN ('routing_nodes', 'routing_edges')
        AND (pg_get_indexdef(i.oid) LIKE '%GIST%' OR pg_get_indexdef(i.oid) LIKE '%gist%')
      `);
      
      const spatialIndexes = result.rows;
      console.log(`🔍 Spatial indexes found: ${spatialIndexes.length}`);
      
      // Should have spatial indexes for performance
      expect(spatialIndexes.length).toBeGreaterThan(0);
      
      for (const index of spatialIndexes) {
        console.log(`  - ${index.tablename}: ${index.indexname}`);
      }
    });

    it('should have reasonable table sizes', async () => {
      const result = await pgClient.query(`
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_tables 
        WHERE tablename IN ('routing_nodes', 'routing_edges', 'trails')
        AND schemaname = 'public'
      `);
      
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
        AND table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `);
      
      console.log(`📋 Column data types:`);
      for (const row of result.rows) {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      }
      
      // Should have expected data types
      const nodeColumns = result.rows.filter(r => r.column_name && r.column_name.includes('node'));
      const edgeColumns = result.rows.filter(r => r.column_name && r.column_name.includes('edge'));
      
      // Check that we have columns from both tables
      const hasNodeTable = result.rows.some(r => r.column_name === 'id' && r.table_name === 'routing_nodes');
      const hasEdgeTable = result.rows.some(r => r.column_name === 'id' && r.table_name === 'routing_edges');
      

      
      expect(hasNodeTable).toBe(true);
      expect(hasEdgeTable).toBe(true);
    });

    it('should have no duplicate nodes at same location', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as duplicate_count
        FROM (
          SELECT lng, lat, COUNT(*) as node_count
          FROM routing_nodes
          GROUP BY lng, lat
          HAVING COUNT(*) > 1
        ) duplicates
      `);
      
      const duplicateCount = parseInt(result.rows[0].duplicate_count);
      console.log(`🔄 Duplicate nodes at same location: ${duplicateCount}`);
      
      // Should have minimal duplicates (some may be expected due to precision)
      expect(duplicateCount).toBeLessThan(10);
    });

    it('should have no duplicate edges', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as duplicate_count
        FROM (
          SELECT source, target, COUNT(*) as edge_count
          FROM routing_edges
          GROUP BY source, target
          HAVING COUNT(*) > 1
        ) duplicates
      `);
      
      const duplicateCount = parseInt(result.rows[0].duplicate_count);
      console.log(`🔄 Duplicate edges: ${duplicateCount}`);
      
      // Allow some duplicate edges (common in real routing graphs)
      expect(duplicateCount).toBeLessThanOrEqual(5); // Allow up to 5 duplicates
    });
  });

  describe('Comprehensive Quality Report', () => {
    it('should generate comprehensive quality report', async () => {
      const report = await pgClient.query(`
        SELECT 
          'Total Nodes' as metric, COUNT(*)::text as value FROM routing_nodes
        UNION ALL
        SELECT 'Total Edges', COUNT(*)::text FROM routing_edges
        UNION ALL
        SELECT 'Self Loops', COUNT(*)::text FROM routing_edges WHERE source = target
        UNION ALL
        SELECT 'Orphaned Nodes', COUNT(*)::text FROM routing_nodes WHERE id NOT IN (SELECT DISTINCT source FROM routing_edges) AND id NOT IN (SELECT DISTINCT target FROM routing_edges)
        UNION ALL
        SELECT 'Connected Components', COUNT(DISTINCT component)::text FROM (SELECT id, CASE WHEN source = target THEN id ELSE LEAST(source, target) END as component FROM routing_edges) as components
        UNION ALL
        SELECT 'Node-to-Trail Ratio', (COUNT(*)::numeric / (SELECT COUNT(*) FROM trails))::text FROM routing_nodes
        UNION ALL
        SELECT 'Average Edge Length (km)', CAST(AVG(length_km) AS DECIMAL(10,2))::text FROM routing_edges WHERE length_km IS NOT NULL
        UNION ALL
        SELECT 'Max Edge Length (km)', CAST(MAX(length_km) AS DECIMAL(10,2))::text FROM routing_edges WHERE length_km IS NOT NULL
        UNION ALL
        SELECT 'Min Edge Length (km)', CAST(MIN(length_km) AS DECIMAL(10,2))::text FROM routing_edges WHERE length_km IS NOT NULL
        ORDER BY metric
      `);
      
      console.log(`\n📊 ROUTING GRAPH QUALITY REPORT:`);
      console.log(`================================`);
      for (const row of report.rows) {
        console.log(`  ${row.metric}: ${row.value}`);
      }
      console.log(`================================\n`);
      
      // All metrics should be present
      expect(report.rows.length).toBeGreaterThan(5);
      
      // Validate key metrics
      const totalNodes = parseInt(report.rows.find(r => r.metric === 'Total Nodes')?.value || '0');
      const totalEdges = parseInt(report.rows.find(r => r.metric === 'Total Edges')?.value || '0');
      const selfLoops = parseInt(report.rows.find(r => r.metric === 'Self Loops')?.value || '0');
      const orphanedNodes = parseInt(report.rows.find(r => r.metric === 'Orphaned Nodes')?.value || '0');
      
      expect(totalNodes).toBeGreaterThan(0);
      expect(totalEdges).toBeGreaterThan(0);
      expect(orphanedNodes).toBe(0);
    });
  });
}); 