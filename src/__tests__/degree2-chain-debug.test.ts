import { Pool } from 'pg';

describe('Degree-2 Chain Debug Tests', () => {
  let pgClient: Pool;

  beforeAll(async () => {
    pgClient = new Pool({
      host: 'localhost',
      port: 5432,
      database: 'trail_master_db',
      user: 'carthorse',
      password: 'carthorse'
    });
  });

  afterAll(async () => {
    await pgClient.end();
  });

  it('should debug the Marshall Valley Trail chain detection', async () => {
    const stagingSchema = 'carthorse_1754838138518';

    // Step 1: Check vertex degrees for the Marshall Valley Trail chain
    const vertexDegreesResult = await pgClient.query(`
      SELECT 
        v.id as vertex_id,
        COUNT(e.id) as degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      LEFT JOIN ${stagingSchema}.ways_noded e ON v.id = e.source OR v.id = e.target
      WHERE v.id IN (6, 8, 4)
      GROUP BY v.id
      ORDER BY v.id;
    `);

    console.log('Vertex degrees for Marshall Valley Trail chain:');
    console.log(vertexDegreesResult.rows);

    // Step 2: Check the actual edges
    const edgesResult = await pgClient.query(`
      SELECT id, source, target, name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE id IN (12, 13)
      ORDER BY id;
    `);

    console.log('Marshall Valley Trail edges:');
    console.log(edgesResult.rows);

    // Step 3: Test the recursive chain detection manually
    const chainResult = await pgClient.query(`
      WITH RECURSIVE 
      vertex_degrees AS (
        SELECT 
          v.id as vertex_id,
          COUNT(e.id) as degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${stagingSchema}.ways_noded e ON v.id = e.source OR v.id = e.target
        GROUP BY v.id
      ),
      degree2_chains AS (
        SELECT 
          e.id as edge_id,
          e.source as start_vertex,
          e.target as current_vertex,
          ARRAY[e.id]::bigint[] as chain_edges
        FROM ${stagingSchema}.ways_noded e
        JOIN vertex_degrees vd ON e.source = vd.vertex_id
        WHERE vd.degree = 1
        
        UNION ALL
        
        SELECT 
          next_e.id as edge_id,
          d2c.start_vertex,
          CASE 
            WHEN next_e.source = d2c.current_vertex THEN next_e.target
            ELSE next_e.source
          END as current_vertex,
          d2c.chain_edges || next_e.id as chain_edges
        FROM degree2_chains d2c
        JOIN ${stagingSchema}.ways_noded next_e ON 
          (next_e.source = d2c.current_vertex OR next_e.target = d2c.current_vertex)
        JOIN vertex_degrees vd ON 
          CASE 
            WHEN next_e.source = d2c.current_vertex THEN next_e.target
            ELSE next_e.source
          END = vd.vertex_id
        WHERE 
          next_e.id != ALL(d2c.chain_edges)
          AND vd.degree = 2
      )
      SELECT DISTINCT ON (start_vertex)
        start_vertex,
        current_vertex as end_vertex,
        chain_edges,
        array_length(chain_edges, 1) as chain_length
      FROM degree2_chains
      ORDER BY start_vertex, array_length(chain_edges, 1) DESC;
    `);

    console.log('Detected degree-2 chains:');
    console.log(chainResult.rows);

    // Step 4: Check if there are any chains starting from vertex 6
    const vertex6Chains = chainResult.rows.filter(row => row.start_vertex === 6);
    console.log('Chains starting from vertex 6:', vertex6Chains);

    // Assertions
    expect(vertexDegreesResult.rows).toHaveLength(3);
    expect(edgesResult.rows).toHaveLength(2);
    
    // The chain should be detected
    const marshallValleyChain = vertex6Chains.find(chain => chain.chain_length > 1);
    expect(marshallValleyChain).toBeDefined();
    expect(marshallValleyChain.chain_length).toBe(2);
  });

  it('should debug why the Community Ditch Trail chain is not detected', async () => {
    const stagingSchema = 'carthorse_1754838138518';

    // Check if the original Community Ditch Trail chain structure exists
    const communityDitchEdges = await pgClient.query(`
      SELECT id, source, target, name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE name = 'Community Ditch Trail'
      ORDER BY id;
    `);

    console.log('Community Ditch Trail edges in current database:');
    console.log(communityDitchEdges.rows);

    // Check vertex degrees for the original chain vertices
    const originalChainVertices = await pgClient.query(`
      SELECT 
        v.id as vertex_id,
        COUNT(e.id) as degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      LEFT JOIN ${stagingSchema}.ways_noded e ON v.id = e.source OR v.id = e.target
      WHERE v.id IN (13, 12, 11, 27)
      GROUP BY v.id
      ORDER BY v.id;
    `);

    console.log('Vertex degrees for original Community Ditch Trail chain:');
    console.log(originalChainVertices.rows);

    // The original chain should not exist in current database
    expect(communityDitchEdges.rows.length).toBeGreaterThan(0);
    console.log('Note: Original Community Ditch Trail chain structure has been transformed during network creation');
  });
});
