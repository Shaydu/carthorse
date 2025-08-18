import { Pool } from 'pg';

async function testBearPeakManualTrace() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Manual Bear Peak loop trace...');
    
    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'export_edges' 
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with export_edges found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Get the specific Bear Peak trails we know should connect
    console.log('\n🎯 Finding specific Bear Peak trails...');
    
    const bearPeakTrails = await pgClient.query(`
      SELECT id, source, target, trail_name, length_km, elevation_gain, elevation_loss
      FROM ${stagingSchema}.export_edges
      WHERE trail_name IN (
        'Bear Canyon Trail',
        'Bear Peak Trail', 
        'Bear Peak West Ridge Trail',
        'Fern Canyon Trail',
        'Mesa Trail',
        'NCAR - Bear Canyon Trail'
      )
      ORDER BY trail_name, id
    `);
    
    console.log(`Found ${bearPeakTrails.rows.length} specific Bear Peak trails:`);
    bearPeakTrails.rows.forEach(trail => {
      console.log(`  ${trail.id}: ${trail.trail_name} (${trail.source} → ${trail.target}, ${trail.length_km.toFixed(2)}km)`);
    });
    
    // Try to find a path from Bear Canyon Trail to Bear Peak Trail
    console.log('\n🔄 Finding path from Bear Canyon to Bear Peak...');
    
    // Start with Bear Canyon Trail (edge 373: 4007 → 4618)
    const bearCanyonEdge = bearPeakTrails.rows.find(t => t.trail_name === 'Bear Canyon Trail');
    if (bearCanyonEdge) {
      console.log(`Starting from Bear Canyon Trail: ${bearCanyonEdge.source} → ${bearCanyonEdge.target}`);
      
      // Try to find a path to Bear Peak Trail
      const bearPeakEdge = bearPeakTrails.rows.find(t => t.trail_name === 'Bear Peak Trail');
      if (bearPeakEdge) {
        console.log(`Looking for path to Bear Peak Trail: ${bearPeakEdge.source} → ${bearPeakEdge.target}`);
        
        // Use pgr_dijkstra to find shortest path
        try {
          const path = await pgClient.query(`
            SELECT * FROM pgr_dijkstra(
              'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded',
              $1, $2, true
            )
            ORDER BY seq
          `, [bearCanyonEdge.target, bearPeakEdge.source]);
          
          if (path.rows.length > 0) {
            console.log(`✅ Found path with ${path.rows.length} edges`);
            
            // Get details of each edge in the path
            const edgeIds = path.rows.map(row => row.edge).filter(id => id !== -1);
            const pathDetails = await pgClient.query(`
              SELECT id, source, target, trail_name, length_km
              FROM ${stagingSchema}.export_edges
              WHERE id = ANY($1)
              ORDER BY id
            `, [edgeIds]);
            
            console.log('Path details:');
            pathDetails.rows.forEach((edge, index) => {
              console.log(`  ${index + 1}. ${edge.trail_name || 'Unknown'} (${edge.source} → ${edge.target}, ${edge.length_km.toFixed(2)}km)`);
            });
            
            // Calculate total distance
            const totalDistance = pathDetails.rows.reduce((sum, edge) => sum + edge.length_km, 0);
            console.log(`Total path distance: ${totalDistance.toFixed(2)}km`);
            
          } else {
            console.log('❌ No path found between Bear Canyon and Bear Peak');
          }
        } catch (error) {
          console.log('❌ Error finding path:', error.message);
        }
      }
    }
    
    // Try to find a complete loop manually
    console.log('\n🔄 Attempting to find complete Bear Peak loop...');
    
    // Look for a path that starts and ends at the same node
    const startNode = 4007; // Bear Canyon Trail start
    const endNode = 4007;   // Should end back at Bear Canyon Trail start
    
    try {
      const loopPath = await pgClient.query(`
        WITH RECURSIVE path AS (
          SELECT 
            source, target, id, trail_name, length_km,
            ARRAY[source, target] as path_nodes,
            ARRAY[trail_name] as path_trails,
            length_km as total_distance,
            1 as depth
          FROM ${stagingSchema}.export_edges
          WHERE source = $1
          
          UNION ALL
          
          SELECT 
            e.source, e.target, e.id, e.trail_name, e.length_km,
            p.path_nodes || e.target,
            p.path_trails || e.trail_name,
            p.total_distance + e.length_km,
            p.depth + 1
          FROM ${stagingSchema}.export_edges e
          JOIN path p ON e.source = p.target
          WHERE p.depth < 15  -- Limit depth to avoid infinite loops
            AND e.target != ALL(p.path_nodes[1:array_length(p.path_nodes, 1)-1])  -- Avoid cycles except at end
        )
        SELECT * FROM path
        WHERE target = $2 AND depth > 1
        ORDER BY total_distance
        LIMIT 5
      `, [startNode, endNode]);
      
      console.log(`Found ${loopPath.rows.length} potential loops back to node ${startNode}`);
      
      loopPath.rows.forEach((path, index) => {
        console.log(`\nLoop ${index + 1}: ${path.total_distance.toFixed(2)}km (${path.depth} edges)`);
        console.log(`Trails: ${path.path_trails.join(' → ')}`);
        console.log(`Nodes: ${path.path_nodes.join(' → ')}`);
      });
      
    } catch (error) {
      console.log('❌ Error finding loop:', error.message);
    }
    
    // Check what connects to the Bear Peak Trail nodes
    console.log('\n🔗 Checking Bear Peak Trail connections...');
    
    const bearPeakConnections = await pgClient.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.export_edges
      WHERE source IN (4234, 4148, 4147, 4226)  -- Bear Peak Trail nodes
         OR target IN (4234, 4148, 4147, 4226)
      ORDER BY trail_name, id
    `);
    
    console.log(`Found ${bearPeakConnections.rows.length} connections to Bear Peak Trail nodes:`);
    bearPeakConnections.rows.forEach(edge => {
      console.log(`  ${edge.id}: ${edge.trail_name} (${edge.source} → ${edge.target}, ${edge.length_km.toFixed(2)}km)`);
    });
    
  } catch (error) {
    console.error('❌ Error during manual Bear Peak trace:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testBearPeakManualTrace().catch(console.error);
