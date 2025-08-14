import { Pool, PoolClient } from 'pg';
import { EdgeCompositionTracking } from './edge-composition-tracking';

export interface MergeDegree2ChainsResult {
  chainsMerged: number;
  edgesRemoved: number;
  finalEdges: number;
}

export interface Degree2AnalysisResult {
  chainsFound: number;
  edgesThatWouldBeRemoved: number[];
  chainsThatWouldBeCreated: Array<{
    startVertex: number;
    endVertex: number;
    edgeIds: number[];
    totalLength: number;
    name: string;
  }>;
}

/**
 * Analyze what degree-2 chains would be merged without actually merging them.
 * This is useful for debugging and understanding what the merge process would do.
 * 
 * @param pgClient - PostgreSQL client (Pool or PoolClient)
 * @param stagingSchema - Staging schema name
 */
export async function analyzeDegree2Chains(
  pgClient: Pool | PoolClient,
  stagingSchema: string
): Promise<Degree2AnalysisResult> {
  console.log('🔍 Analyzing degree-2 chains (dry run)...');
  
  try {
    // Step 1: Recompute vertex degrees BEFORE analysis (bidirectional)
    console.log('🔄 Recomputing vertex degrees before analysis...');
    await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    // Log vertex degree distribution for debugging
    const degreeStats = await pgClient.query(`
      SELECT cnt as degree, COUNT(*) as vertex_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    console.log('📊 Vertex degrees:', degreeStats.rows.map(r => `degree-${r.degree}: ${r.vertex_count} vertices`).join(', '));
    
    // Step 2: Find all mergeable chains (bidirectional approach)
    const analysisResult = await pgClient.query(`
      WITH RECURSIVE 
      vertex_degrees AS (
        SELECT 
          id as vertex_id,
          cnt as degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      
      -- Start chains from degree-1 or degree-3+ vertices (endpoints/intersections)
      trail_chains AS (
        -- Base case: start with ALL edges and find degree-2 chains
        SELECT 
          e.id as edge_id,
          e.source as start_vertex,
          e.target as end_vertex,
          ARRAY[e.id]::bigint[] as chain_edges,
          ARRAY[e.source, e.target]::int[] as chain_vertices,
          e.the_geom::geometry as chain_geom,
          e.length_km as total_length,
          e.elevation_gain as total_elevation_gain,
          e.elevation_loss as total_elevation_loss,
          e.name
        FROM ${stagingSchema}.ways_noded e
        
        UNION ALL
        
        -- Extend chains through degree-2 vertices to reach endpoints
        SELECT 
          next_e.id as edge_id,
          tc.start_vertex,
          CASE 
            WHEN next_e.source = tc.end_vertex THEN next_e.target
            ELSE next_e.source
          END as end_vertex,
          tc.chain_edges || next_e.id as chain_edges,
          tc.chain_vertices || CASE 
            WHEN next_e.source = tc.end_vertex THEN next_e.target
            ELSE next_e.source
          END as chain_vertices,
          (
            WITH merged AS (
              SELECT ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom)) as geom
            ),
            simplified AS (
              SELECT 
                CASE 
                  WHEN ST_GeometryType(geom) = 'ST_LineString' THEN geom
                  WHEN ST_GeometryType(geom) = 'ST_MultiLineString' THEN 
                    CASE 
                      WHEN ST_NumGeometries(geom) = 1 THEN ST_GeometryN(geom, 1)
                      WHEN ST_NumGeometries(geom) > 1 THEN 
                        -- Simplify and try to merge multiple geometries
                        ST_LineMerge(ST_Simplify(geom, 0.000001))
                      ELSE geom
                    END
                  ELSE ST_GeometryN(geom, 1)
                END as geom
              FROM merged
            )
            SELECT 
              CASE 
                WHEN ST_GeometryType(geom) = 'ST_LineString' THEN geom
                WHEN ST_GeometryType(geom) = 'ST_MultiLineString' THEN ST_GeometryN(geom, 1)
                ELSE geom
              END
            FROM simplified
          )::geometry as chain_geom,
          tc.total_length + next_e.length_km as total_length,
          tc.total_elevation_gain + next_e.elevation_gain as total_elevation_gain,
          tc.total_elevation_loss + next_e.elevation_loss as total_elevation_loss,
          tc.name
        FROM trail_chains tc
        JOIN ${stagingSchema}.ways_noded next_e ON 
          (next_e.source = tc.end_vertex OR next_e.target = tc.end_vertex)
        JOIN vertex_degrees vd ON 
          CASE 
            WHEN next_e.source = tc.end_vertex THEN next_e.target
            ELSE next_e.source
          END = vd.vertex_id
        WHERE 
          next_e.id != ALL(tc.chain_edges)  -- Don't revisit edges
          AND vd.degree = 2  -- Only continue through degree-2 vertices
      ),
      
      -- Get complete chains that end at degree-1 or degree-3+ vertices
      complete_chains AS (
        SELECT 
          start_vertex,
          end_vertex,
          chain_edges,
          chain_vertices,
          chain_geom,
          total_length,
          total_elevation_gain,
          total_elevation_loss,
          name,
          array_length(chain_edges, 1) as chain_length
        FROM trail_chains tc
        JOIN vertex_degrees vd_start ON tc.start_vertex = vd_start.vertex_id
        JOIN vertex_degrees vd_end ON tc.end_vertex = vd_end.vertex_id
        WHERE array_length(chain_edges, 1) > 1  -- Must have at least 2 edges
          AND (
            -- Chain must start OR end at degree-1 or degree-3+ vertices
            (vd_start.degree = 1 OR vd_start.degree >= 3) OR 
            (vd_end.degree = 1 OR vd_end.degree >= 3)
          )
      ),
      
      -- Select longest chains ensuring no edge appears in multiple chains
      mergeable_chains AS (
        WITH ranked_chains AS (
          SELECT 
            start_vertex,
            end_vertex,
            chain_edges,
            chain_vertices,
            chain_geom,
            total_length,
            total_elevation_gain,
            total_elevation_loss,
            name,
            chain_length,
            ROW_NUMBER() OVER (ORDER BY chain_length DESC, total_length DESC) as priority
          FROM complete_chains
        )
        SELECT 
          start_vertex, end_vertex, chain_edges, chain_vertices, chain_geom,
          total_length, total_elevation_gain, total_elevation_loss,
          name, chain_length
        FROM ranked_chains r1
        WHERE NOT EXISTS (
          SELECT 1 FROM ranked_chains r2
          WHERE r2.priority < r1.priority
            AND r2.chain_edges && r1.chain_edges
        )
      )
      SELECT 
        start_vertex,
        end_vertex,
        chain_edges,
        total_length,
        name,
        chain_length
      FROM mergeable_chains
      ORDER BY chain_length DESC, total_length DESC
    `);
    
    // Extract the results
    const chainsThatWouldBeCreated = analysisResult.rows.map(row => ({
      startVertex: row.start_vertex,
      endVertex: row.end_vertex,
      edgeIds: row.chain_edges,
      totalLength: row.total_length,
      name: row.name
    }));
    
    // Get all edges that would be removed
    const edgesThatWouldBeRemoved = new Set<number>();
    chainsThatWouldBeCreated.forEach(chain => {
      chain.edgeIds.forEach((edgeId: number) => edgesThatWouldBeRemoved.add(edgeId));
    });
    
    console.log(`🔍 Analysis complete:`);
    console.log(`   📊 Found ${chainsThatWouldBeCreated.length} mergeable chains`);
    console.log(`   🗑️ Would remove ${edgesThatWouldBeRemoved.size} edges`);
    
    // Log details of each chain that would be created
    chainsThatWouldBeCreated.forEach((chain, index) => {
      console.log(`   📋 Chain ${index + 1}: ${chain.startVertex} → ${chain.endVertex} (${chain.edgeIds.length} edges, ${chain.totalLength.toFixed(2)}km)`);
    });
    
    return {
      chainsFound: chainsThatWouldBeCreated.length,
      edgesThatWouldBeRemoved: Array.from(edgesThatWouldBeRemoved),
      chainsThatWouldBeCreated
    };
    
  } catch (error) {
    console.error('❌ Error analyzing degree-2 chains:', error);
    throw error;
  }
}

/**
 * Merge degree-2 chain edges into single edges.
 * This creates continuous edges from dead ends to intersections by merging
 * chains where internal vertices have degree 2.
 * 
 * @param pgClient - PostgreSQL client (Pool or PoolClient)
 * @param stagingSchema - Staging schema name
 * @param toleranceMeters - Tolerance in meters for geometric operations (default: 5.0)
 */
export async function mergeDegree2Chains(
  pgClient: Pool | PoolClient,
  stagingSchema: string,
  toleranceMeters: number = 5.0
): Promise<MergeDegree2ChainsResult> {
  console.log(`🔗 Merging degree-2 chains (tolerance: ${toleranceMeters}m)...`);
  
  try {
    // Get the next available ID (assumes we're already in a transaction)
    const maxIdResult = await pgClient.query(`
      SELECT COALESCE(MAX(id), 0) as max_id FROM ${stagingSchema}.ways_noded
    `);
    const nextId = parseInt(maxIdResult.rows[0].max_id) + 1;
  
    // Step 1: Recompute vertex degrees BEFORE merge (defensive against upstream inconsistencies)
    console.log('🔄 Recomputing vertex degrees before merge...');
    await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    // Log vertex degree distribution before merge for debugging
    const degreeStatsBefore = await pgClient.query(`
      SELECT cnt as degree, COUNT(*) as vertex_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    console.log('📊 Vertex degrees BEFORE merge:', degreeStatsBefore.rows.map(r => `degree-${r.degree}: ${r.vertex_count} vertices`).join(', '));
    
    // Step 2: PHASE 1 - MERGE EDGES INTO LONGER CHAINS
    console.log('🔄 Phase 1: Merging edges into longer chains...');
    
    // Add logging to identify problematic geometries before merging
    console.log('🔍 Checking for potential MultiLineString issues...');
    const problematicEdges = await pgClient.query(`
      SELECT id, source, target, name, 
             ST_GeometryType(the_geom) as geom_type,
             ST_NumGeometries(the_geom) as num_geometries
      FROM ${stagingSchema}.ways_noded 
      WHERE ST_GeometryType(the_geom) = 'ST_MultiLineString' 
         OR ST_NumGeometries(the_geom) > 1
      LIMIT 10
    `);
    
    if (problematicEdges.rows.length > 0) {
      console.log('⚠️ Found edges with potential geometry issues:');
      problematicEdges.rows.forEach(edge => {
        console.log(`   Edge ID ${edge.id}: ${edge.source}→${edge.target}, "${edge.name}", type: ${edge.geom_type}, geometries: ${edge.num_geometries}`);
      });
    } else {
      console.log('✅ No obvious geometry issues found in individual edges');
    }
    // Convert tolerance to degrees for PostGIS operations
    const toleranceDegrees = toleranceMeters / 111000.0;
    
    const mergeResult = await pgClient.query(`
      WITH RECURSIVE 
      -- Use the freshly updated vertex degrees from cnt column
      vertex_degrees AS (
        SELECT 
          id as vertex_id,
          cnt as degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      
      -- Start chains from degree-1 or degree-3+ vertices (endpoints/intersections)
      trail_chains AS (
        -- Base case: start with ALL edges and find degree-2 chains
        SELECT 
          e.id as edge_id,
          e.source as start_vertex,
          e.target as end_vertex,
          ARRAY[e.id]::bigint[] as chain_edges,
          ARRAY[e.source, e.target]::int[] as chain_vertices,
          e.the_geom::geometry as chain_geom,
          e.length_km as total_length,
          e.elevation_gain as total_elevation_gain,
          e.elevation_loss as total_elevation_loss,
          e.name
        FROM ${stagingSchema}.ways_noded e
        
        UNION ALL
        
        -- Extend chains through degree-2 vertices to reach endpoints
        SELECT 
          next_e.id as edge_id,
          tc.start_vertex,
          CASE 
            WHEN next_e.source = tc.end_vertex THEN next_e.target
            ELSE next_e.source
          END as end_vertex,
          tc.chain_edges || next_e.id as chain_edges,
          tc.chain_vertices || CASE 
            WHEN next_e.source = tc.end_vertex THEN next_e.target
            ELSE next_e.source
          END as chain_vertices,
          (
            WITH merged AS (
              SELECT ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom)) as geom
            ),
            simplified AS (
              SELECT 
                CASE 
                  WHEN ST_GeometryType(geom) = 'ST_LineString' THEN geom
                  WHEN ST_GeometryType(geom) = 'ST_MultiLineString' THEN 
                    CASE 
                      WHEN ST_NumGeometries(geom) = 1 THEN ST_GeometryN(geom, 1)
                      WHEN ST_NumGeometries(geom) > 1 THEN 
                        -- For multiple geometries, try to merge them, otherwise take the longest one
                        COALESCE(
                          ST_LineMerge(geom),
                          (SELECT ST_GeometryN(geom, 1) FROM (SELECT geom) as g)
                        )
                      ELSE geom
                    END
                  ELSE ST_GeometryN(geom, 1)
                END as geom
              FROM merged
            )
            SELECT 
              CASE 
                WHEN ST_GeometryType(geom) = 'ST_LineString' THEN geom
                WHEN ST_GeometryType(geom) = 'ST_MultiLineString' THEN ST_GeometryN(geom, 1)
                ELSE geom
              END
            FROM simplified
          ) as chain_geom,
          tc.total_length + next_e.length_km as total_length,
          tc.total_elevation_gain + next_e.elevation_gain as total_elevation_gain,
          tc.total_elevation_loss + next_e.elevation_loss as total_elevation_loss,
          tc.name
        FROM trail_chains tc
        JOIN ${stagingSchema}.ways_noded next_e ON 
          (next_e.source = tc.end_vertex OR next_e.target = tc.end_vertex)
        JOIN vertex_degrees vd ON 
          CASE 
            WHEN next_e.source = tc.end_vertex THEN next_e.target
            ELSE next_e.source
          END = vd.vertex_id
        WHERE 
          next_e.id != ALL(tc.chain_edges)  -- Don't revisit edges
          AND vd.degree = 2  -- Only continue through degree-2 vertices
      ),
      
      -- Get complete chains that end at degree-1 or degree-3+ vertices
      complete_chains AS (
        SELECT 
          start_vertex,
          end_vertex,
          chain_edges,
          chain_vertices,
          chain_geom,
          total_length,
          total_elevation_gain,
          total_elevation_loss,
          name,
          array_length(chain_edges, 1) as chain_length
        FROM trail_chains tc
        JOIN vertex_degrees vd_start ON tc.start_vertex = vd_start.vertex_id
        JOIN vertex_degrees vd_end ON tc.end_vertex = vd_end.vertex_id
        WHERE array_length(chain_edges, 1) > 1  -- Must have at least 2 edges
          AND (
            -- Chain must start OR end at degree-1 or degree-3+ vertices
            (vd_start.degree = 1 OR vd_start.degree >= 3) OR 
            (vd_end.degree = 1 OR vd_end.degree >= 3)
          )
      ),
      
      -- Select longest chains ensuring no edge appears in multiple chains
      mergeable_chains AS (
        WITH ranked_chains AS (
          SELECT 
            start_vertex,
            end_vertex,
            chain_edges,
            chain_vertices,
            chain_geom,
            total_length,
            total_elevation_gain,
            total_elevation_loss,
            name,
            chain_length,
            ROW_NUMBER() OVER (ORDER BY chain_length DESC, total_length DESC) as priority
          FROM complete_chains
        )
        SELECT 
          start_vertex, end_vertex, chain_edges, chain_vertices, chain_geom,
          total_length, total_elevation_gain, total_elevation_loss,
          name, chain_length
        FROM ranked_chains r1
        WHERE NOT EXISTS (
          SELECT 1 FROM ranked_chains r2
          WHERE r2.priority < r1.priority
            AND r2.chain_edges && r1.chain_edges
        )
      ),
      
      -- Pre-cleanup: Remove existing merged chains that would conflict with new chains we're about to create
      cleaned_existing_chains AS (
        DELETE FROM ${stagingSchema}.ways_noded
        WHERE app_uuid LIKE 'merged-degree2-chain-%'
          AND EXISTS (
            SELECT 1 FROM mergeable_chains mc
            WHERE mc.chain_edges && (
              string_to_array(
                CASE 
                  WHEN app_uuid LIKE '%edges-%' THEN split_part(app_uuid, 'edges-', 2)
                  ELSE ''
                END,
                ','
              )::bigint[]
            )
          )
        RETURNING id, app_uuid
      ),
      
      -- Insert merged edges and delete constituent edges in one operation
      inserted_edges AS (
        INSERT INTO ${stagingSchema}.ways_noded (
          id, source, target, the_geom, length_km, elevation_gain, elevation_loss,
          app_uuid, name, old_id
        )
        SELECT 
          ${nextId} + row_number() OVER () - 1 as id,
          start_vertex as source,
          end_vertex as target,
          chain_geom as the_geom,
          total_length as length_km,
          total_elevation_gain as elevation_gain,
          total_elevation_loss as elevation_loss,
          'merged-degree2-chain-' || start_vertex || '-' || end_vertex || '-' || array_length(chain_edges, 1) || 'edges' as app_uuid,
          name,
          NULL::bigint as old_id
        FROM mergeable_chains
        RETURNING id
      ),
      
      -- Delete constituent edges using the chain_edges from mergeable_chains
      deleted_edges AS (
        DELETE FROM ${stagingSchema}.ways_noded 
        WHERE id IN (
          SELECT unnest(mc.chain_edges) 
          FROM mergeable_chains mc
        )
        RETURNING id
      ),
      
      -- Remove orphaned vertices (degree-0 vertices) in the same transaction
      orphaned_vertices AS (
        DELETE FROM ${stagingSchema}.ways_noded_vertices_pgr v
        WHERE NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
        RETURNING id
      )
      
      -- Return counts for auditing
      SELECT 
        (SELECT COUNT(*) FROM inserted_edges) AS chains_merged,
        (SELECT COUNT(*) FROM deleted_edges) AS edges_removed,
        (SELECT COUNT(*) FROM orphaned_vertices) AS orphaned_vertices_removed,
        (SELECT COUNT(*) FROM cleaned_existing_chains) AS existing_chains_cleaned;
    `);

    const chainsMerged = Number(mergeResult.rows[0]?.chains_merged || 0);
    const edgesRemoved = Number(mergeResult.rows[0]?.edges_removed || 0);
    const orphanedVerticesRemoved = Number(mergeResult.rows[0]?.orphaned_vertices_removed || 0);
    const existingChainsCleanedCount = Number(mergeResult.rows[0]?.existing_chains_cleaned || 0);

    if (existingChainsCleanedCount > 0) {
      console.log(`🧹 Pre-cleaned ${existingChainsCleanedCount} existing merged chains that conflicted with new chains`);
    }
    
    if (orphanedVerticesRemoved > 0) {
      console.log(`🧹 Cleaned up ${orphanedVerticesRemoved} orphaned vertices (handled in same transaction)`);
    }

    // Debug: Show what chains were created
    if (chainsMerged > 0) {
      console.log(`🔍 Created ${chainsMerged} merged chains. Checking details...`);
      const chainDetails = await pgClient.query(`
        SELECT id, source, target, app_uuid, name 
        FROM ${stagingSchema}.ways_noded 
        WHERE app_uuid LIKE 'merged-degree2-chain-%' 
        ORDER BY id DESC 
        LIMIT ${chainsMerged}
      `);
      
      chainDetails.rows.forEach((chain, index) => {
        console.log(`   Chain ${index + 1}: ID ${chain.id}, ${chain.source}→${chain.target}, "${chain.name}", ${chain.app_uuid}`);
      });
    }

    // Step 3: PHASE 2 - DELETION IS NOW HANDLED IN THE SAME TRANSACTION
    if (edgesRemoved > 0) {
      console.log(`🗑️  Deleted ${edgesRemoved} constituent edges (handled in same transaction)`);
    }

    // Step 4: Update composition tracking for merged edges
    if (chainsMerged > 0) {
      console.log('📋 Updating composition tracking for merged edges...');
      const compositionTracking = new EdgeCompositionTracking(stagingSchema, pgClient);
      
      // Get the newly created merged edges and their constituent edges
      const mergedEdges = await pgClient.query(`
        SELECT id, app_uuid
        FROM ${stagingSchema}.ways_noded 
        WHERE app_uuid LIKE 'merged-degree2-chain-%' 
        ORDER BY id DESC 
        LIMIT ${chainsMerged}
      `);

      for (const mergedEdge of mergedEdges.rows) {
        // Extract edge IDs from the app_uuid (format: 'merged-degree2-chain-{s}-{t}-{count}edges')
        const edgeCountMatch = mergedEdge.app_uuid.match(/merged-degree2-chain-\d+-\d+-(\d+)edges/);
        if (edgeCountMatch) {
          const edgeCount = parseInt(edgeCountMatch[1]);
          
          // Get the constituent edges that were merged (we need to reconstruct this from the mergeable_chains)
          const constituentEdges = await pgClient.query(`
            SELECT unnest(chain_edges) as edge_id
            FROM (
              SELECT chain_edges
              FROM (
                WITH RECURSIVE 
                vertex_degrees AS (
                  SELECT id as vertex_id, cnt as degree
                  FROM ${stagingSchema}.ways_noded_vertices_pgr
                ),
                trail_chains AS (
                  SELECT 
                    e.id as edge_id,
                    e.source as start_vertex,
                    e.target as current_vertex,
                    ARRAY[e.id]::bigint[] as chain_edges,
                    ARRAY[e.source, e.target]::int[] as chain_vertices,
                    e.the_geom::geometry as chain_geom,
                    e.length_km as total_length,
                    e.elevation_gain as total_elevation_gain,
                    e.elevation_loss as total_elevation_loss,
                    e.name
                  FROM ${stagingSchema}.ways_noded e
                  JOIN vertex_degrees vd_source ON e.source = vd_source.vertex_id
                  JOIN vertex_degrees vd_target ON e.target = vd_target.vertex_id
                  WHERE (vd_source.degree = 1 OR vd_source.degree >= 3 OR vd_target.degree = 1 OR vd_target.degree >= 3)
                  
                  UNION ALL
                  
                  SELECT 
                    next_e.id as edge_id,
                    tc.start_vertex,
                    CASE 
                      WHEN next_e.source = tc.current_vertex THEN next_e.target
                      ELSE next_e.source
                    END as current_vertex,
                    tc.chain_edges || next_e.id as chain_edges,
                    tc.chain_vertices || CASE 
                      WHEN next_e.source = tc.current_vertex THEN next_e.target
                      ELSE next_e.source
                    END as chain_vertices,
                    CASE 
                      WHEN ST_GeometryType(ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom))) = 'ST_LineString' 
                      THEN ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom))
                      ELSE ST_GeometryN(ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom)), 1)
                    END as chain_geom,
                    tc.total_length + next_e.length_km as total_length,
                    tc.total_elevation_gain + next_e.elevation_gain as total_elevation_gain,
                    tc.total_elevation_loss + next_e.elevation_loss as total_elevation_loss,
                    tc.name
                  FROM trail_chains tc
                  JOIN ${stagingSchema}.ways_noded next_e ON (
                    (next_e.source = tc.current_vertex OR next_e.target = tc.current_vertex)
                    AND next_e.id != ALL(tc.chain_edges)
                  )
                  JOIN vertex_degrees vd_next ON (
                    CASE 
                      WHEN next_e.source = tc.current_vertex THEN next_e.target
                      ELSE next_e.source
                    END = vd_next.vertex_id
                  )
                  WHERE vd_next.degree = 2
                )
                SELECT DISTINCT chain_edges
                FROM trail_chains
                WHERE array_length(chain_edges, 1) = ${edgeCount}
              ) as chains
            ) as chain_data
            LIMIT 1
          `);

          if (constituentEdges.rows.length > 0) {
            const sourceEdgeIds = constituentEdges.rows.map(row => row.edge_id);
            await compositionTracking.updateCompositionForMergedEdge(mergedEdge.id, sourceEdgeIds, 'merged');
          }
        }
      }
      
      console.log(`✅ Updated composition tracking for ${mergedEdges.rows.length} merged edges`);
    }

    // Step 3: PHASE 3 - RECOMPUTE VERTEX DEGREES AFTER EDGE DELETION
    console.log('🔄 Phase 3: Recomputing vertex degrees after edge deletion...');
    await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    // Log vertex degree distribution after merge for debugging
    const degreeStatsAfter = await pgClient.query(`
      SELECT cnt as degree, COUNT(*) as vertex_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    console.log('📊 Vertex degrees AFTER merge:', degreeStatsAfter.rows.map(r => `degree-${r.degree}: ${r.vertex_count} vertices`).join(', '));

    // Step 4: PHASE 4 - REMOVE ORPHANED VERTICES (only after all merges and deletions are complete)
    console.log('🔄 Phase 4: Removing orphaned vertices...');
    const orphanedResult = await pgClient.query(`
      DELETE FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
      RETURNING id
    `);
    
    const orphanedCount = orphanedResult.rowCount || 0;
    if (orphanedCount > 0) {
      console.log(`🧹 Cleaned up ${orphanedCount} orphaned vertices after all merges completed`);
    }

    // Step 6: Get final counts
    const finalCountResult = await pgClient.query(`
      SELECT COUNT(*) as final_edges FROM ${stagingSchema}.ways_noded;
    `);

    const finalEdges = Number(finalCountResult.rows[0]?.final_edges || 0);

    console.log(`🔗 Degree-2 chain merge: chainsMerged=${chainsMerged}, edgesRemoved=${edgesRemoved}, existingChainsCleanedCount=${existingChainsCleanedCount}, finalEdges=${finalEdges}`);

    // Debug: Check for duplicate IDs after merge
    const duplicateCheck = await pgClient.query(`
      SELECT id, COUNT(*) as count
      FROM ${stagingSchema}.ways_noded
      GROUP BY id
      HAVING COUNT(*) > 1
    `);
    
    if (duplicateCheck.rows.length > 0) {
      console.warn(`⚠️ Found ${duplicateCheck.rows.length} duplicate edge IDs after merge:`, duplicateCheck.rows.map(r => `ID ${r.id} (${r.count} copies)`).join(', '));
    }

    return {
      chainsMerged,
      edgesRemoved,
      finalEdges
    };

  } catch (error) {
    console.error('❌ Error merging degree-2 chains:', error);
    throw error;
  }
}
