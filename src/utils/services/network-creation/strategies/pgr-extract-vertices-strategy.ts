import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';

export class PgrExtractVerticesStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const { stagingSchema } = config;
    console.log('🔧 [PGR-EXTRACT-VERTICES] Creating network with pgr_extractVertices...');

    try {
      // Step 1: Create a clean edges table with unique IDs
      console.log('📋 Creating edges table with unique IDs...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.edges CASCADE`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.edges AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY t.id) as id,
          t.geometry as geom,
          t.length_km,
          t.app_uuid,
          t.name,
          t.elevation_gain,
          t.elevation_loss,
          t.osm_id,
          t.id as original_id
        FROM ${stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry)
          AND ST_NumPoints(t.geometry) > 1
      `);

      // Add primary key
      await pgClient.query(`
        ALTER TABLE ${stagingSchema}.edges 
        ADD PRIMARY KEY (id)
      `);

      // Add spatial index
      await pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_edges_geom 
        ON ${stagingSchema}.edges USING GIST(geom)
      `);

      const edgeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.edges`);
      console.log(`✅ Created ${edgeCount.rows[0].count} edges with unique IDs`);

      // Step 2: Extract vertices using pgr_extractVertices
      console.log('🔧 Extracting vertices with pgr_extractVertices...');
      const vertexResult = await pgClient.query(`
        SELECT * FROM pgr_extractVertices(
          'SELECT id, geom FROM ${stagingSchema}.edges'
        )
      `);

      console.log(`✅ Extracted ${vertexResult.rows.length} vertices`);

      // Create vertices table
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.vertices CASCADE`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.vertices AS
        SELECT * FROM pgr_extractVertices(
          'SELECT id, geom FROM ${stagingSchema}.edges'
        )
      `);

      // Add spatial index to vertices  
      await pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_vertices_geom 
        ON ${stagingSchema}.vertices USING GIST(geom)
      `);

      // Step 3: Assign source and target to edges based on extracted vertices
      console.log('🔗 Assigning source and target to edges...');
      
      // Add source and target columns to edges table
      await pgClient.query(`
        ALTER TABLE ${stagingSchema}.edges 
        ADD COLUMN IF NOT EXISTS source BIGINT,
        ADD COLUMN IF NOT EXISTS target BIGINT
      `);
      
      // Assign source and target based on closest vertices to edge endpoints
      await pgClient.query(`
        UPDATE ${stagingSchema}.edges 
        SET source = (
          SELECT v.id FROM ${stagingSchema}.vertices v 
          ORDER BY ST_Distance(ST_StartPoint(edges.geom), v.geom) 
          LIMIT 1
        ),
        target = (
          SELECT v.id FROM ${stagingSchema}.vertices v 
          ORDER BY ST_Distance(ST_EndPoint(edges.geom), v.geom) 
          LIMIT 1
        )
      `);

      console.log(`✅ Source and target assignment complete`);

      // Step 4: Create ways_noded from the analyzed edges
      console.log('🛤️ Creating ways_noded from analyzed edges...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded CASCADE`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        SELECT 
          e.id,
          e.geom as the_geom,
          e.length_km,
          e.app_uuid,
          e.name,
          e.elevation_gain,
          e.elevation_loss,
          e.osm_id,
          e.original_id,
          e.source,
          e.target,
          -- Add cost and reverse_cost for bidirectional routing
          COALESCE(e.length_km, 0.1) as cost,
          COALESCE(e.length_km, 0.1) as reverse_cost
        FROM ${stagingSchema}.edges e
        WHERE e.source IS NOT NULL 
          AND e.target IS NOT NULL 
          AND e.source != e.target
      `);

      // Add indexes
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom)`);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_source ON ${stagingSchema}.ways_noded(source)`);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_target ON ${stagingSchema}.ways_noded(target)`);

      // Step 5: Create ways_noded_vertices_pgr from extracted vertices
      console.log('📍 Creating ways_noded_vertices_pgr...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr CASCADE`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT 
          id,
          geom as the_geom,
          x,
          y,
          0 as z,
          1 as cnt
        FROM ${stagingSchema}.vertices
      `);

      // Add spatial index to vertices
      await pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_ways_noded_vertices_pgr_geom 
        ON ${stagingSchema}.ways_noded_vertices_pgr USING GIST(the_geom)
      `);

      // Step 6: Get final network statistics
      const finalEdges = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded`);
      const finalVertices = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded_vertices_pgr`);

      console.log(`📊 Network created successfully:`);
      console.log(`   Edges: ${finalEdges.rows[0].count}`);
      console.log(`   Vertices: ${finalVertices.rows[0].count}`);

      // Step 7: Test loop detection with pgr_ksp
      console.log('🔄 Testing loop detection with pgr_ksp...');
      const testLoops = await pgClient.query(`
        SELECT 
          path_id,
          path_seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_ksp(
          'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded',
          1, -- start node
          10, -- end node (pick a reasonable target)
          3, -- k = 3 shortest paths
          directed := false
        )
        ORDER BY path_id, path_seq
        LIMIT 50
      `);

      console.log(`✅ Found ${testLoops.rows.length} path segments in test loop detection`);

      // Step 8: Test Hawick Circuits for loop detection
      console.log('🔄 Testing Hawick Circuits for loop detection...');
      const hawickLoops = await pgClient.query(`
        SELECT 
          path_id,
          path_seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded'
        )
        ORDER BY path_id, path_seq
        LIMIT 100
      `);

      console.log(`✅ Found ${hawickLoops.rows.length} path segments with Hawick Circuits`);

      // Group loops by path_id
      const loopGroups = new Map<number, any[]>();
      hawickLoops.rows.forEach(row => {
        if (!loopGroups.has(row.path_id)) {
          loopGroups.set(row.path_id, []);
        }
        loopGroups.get(row.path_id)!.push(row);
      });

      console.log(`🔍 Found ${loopGroups.size} unique cycles`);

      // Look for Bear Canyon related loops
      console.log('🔍 Looking for Bear Canyon related loops...');
      for (const [pathId, cycleEdges] of loopGroups) {
        const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
        
        // Check if this cycle contains Bear Canyon related trails
        const edgeIds = cycleEdges.map(edge => edge.edge).filter(id => id !== -1);
        const bearCanyonTrails = await pgClient.query(`
          SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded 
          WHERE id = ANY($1::integer[]) 
          AND (name ILIKE '%bear%' OR name ILIKE '%fern%' OR name ILIKE '%mesa%')
        `, [edgeIds]);
        
        if (bearCanyonTrails.rows[0].count > 0) {
          console.log(`🎯 Found Bear Canyon loop (path_id: ${pathId}): ${totalDistance.toFixed(2)}km with ${bearCanyonTrails.rows[0].count} Bear Canyon trails`);
          
          // Get the trail names in this loop
          const trailNames = await pgClient.query(`
            SELECT DISTINCT name FROM ${stagingSchema}.ways_noded 
            WHERE id = ANY($1::integer[])
            ORDER BY name
          `, [edgeIds]);
          
          console.log(`  Trails: ${trailNames.rows.map((r: any) => r.name).join(', ')}`);
        }
      }

      console.log('✅ [PGR-EXTRACT-VERTICES] Network creation complete!');

      // Return success result
      return {
        success: true,
        stats: {
          nodesCreated: finalVertices.rows[0].count,
          edgesCreated: finalEdges.rows[0].count,
          isolatedNodes: 0, // TODO: calculate this
          orphanedEdges: 0  // TODO: calculate this
        }
      };

    } catch (error) {
      console.error('❌ [PGR-EXTRACT-VERTICES] Error creating network:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stats: {
          nodesCreated: 0,
          edgesCreated: 0,
          isolatedNodes: 0,
          orphanedEdges: 0
        }
      };
    }
  }
}
