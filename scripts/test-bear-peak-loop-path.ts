import { Pool } from 'pg';

async function testBearPeakLoopPath() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🧪 Testing Bear Peak loop path...');
    
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
    
    // Test the complete Bear Peak loop path
    console.log('\n🔄 Testing complete Bear Peak loop path...');
    
    const loopPath = [
      { from: 50, to: 4, trail: 'Bear Canyon Trail' },
      { from: 4, to: 13, trail: 'Mesa Trail' },
      { from: 13, to: 10, trail: 'Mesa Trail' },
      { from: 10, to: 48, trail: 'NCAR Trail' },
      { from: 48, to: 18, trail: 'NCAR Trail (Split 1)' },
      { from: 18, to: 16, trail: 'NCAR Water Tank Road' },
      { from: 16, to: 17, trail: 'Fern Canyon Trail' },
      { from: 17, to: 24, trail: 'Bear Peak Trail' },
      { from: 24, to: 50, trail: 'Bear Peak West Ridge Trail' }
    ];
    
    let totalDistance = 0;
    let totalElevationGain = 0;
    let totalElevationLoss = 0;
    let pathTrails: string[] = [];
    
    console.log('\n📍 Loop path verification:');
    
    for (let i = 0; i < loopPath.length; i++) {
      const segment = loopPath[i];
      const nextSegment = loopPath[(i + 1) % loopPath.length];
      
      // Check if this edge exists
      const edgeResult = await pgClient.query(`
        SELECT id, source, target, length_km, elevation_gain, elevation_loss, trail_name
        FROM ${stagingSchema}.export_edges
        WHERE source = $1 AND target = $2
      `, [segment.from, segment.to]);
      
      if (edgeResult.rows.length > 0) {
        const edge = edgeResult.rows[0];
        totalDistance += edge.length_km;
        totalElevationGain += edge.elevation_gain;
        totalElevationLoss += edge.elevation_loss;
        pathTrails.push(edge.trail_name);
        
        console.log(`  ✅ ${i + 1}. ${edge.trail_name}: ${segment.from} → ${segment.to} (${edge.length_km.toFixed(2)}km, +${edge.elevation_gain.toFixed(0)}m/-${edge.elevation_loss.toFixed(0)}m)`);
        
        // Check if this connects to the next segment
        if (i < loopPath.length - 1) {
          const nextEdgeResult = await pgClient.query(`
            SELECT COUNT(*) as count
            FROM ${stagingSchema}.export_edges
            WHERE source = $1 AND target = $2
          `, [segment.to, nextSegment.from]);
          
          if (nextEdgeResult.rows[0].count === 0) {
            console.log(`  ❌ Gap detected: No edge from ${segment.to} to ${nextSegment.from}`);
          }
        }
      } else {
        console.log(`  ❌ Missing edge: ${segment.from} → ${segment.to} (${segment.trail})`);
      }
    }
    
    console.log('\n📊 Loop Summary:');
    console.log(`  Total Distance: ${totalDistance.toFixed(2)} km`);
    console.log(`  Total Elevation Gain: ${totalElevationGain.toFixed(0)} m`);
    console.log(`  Total Elevation Loss: ${totalElevationLoss.toFixed(0)} m`);
    console.log(`  Number of Trail Segments: ${pathTrails.length}`);
    console.log(`  Unique Trails: ${[...new Set(pathTrails)].length}`);
    
    // Test if this is a valid loop (starts and ends at same node)
    if (loopPath[0].from === loopPath[loopPath.length - 1].to) {
      console.log('  ✅ Valid loop: Starts and ends at same node');
    } else {
      console.log('  ❌ Invalid loop: Does not start and end at same node');
    }
    
    // Test with pgRouting to see if it can find this path
    console.log('\n🔄 Testing with pgRouting path finding...');
    
    // Create a simple path query to test the connection
    const pathResult = await pgClient.query(`
      WITH RECURSIVE path AS (
        SELECT 
          source, target, id, trail_name, length_km,
          ARRAY[source, target] as path_nodes,
          ARRAY[trail_name] as path_trails,
          length_km as total_distance,
          1 as depth
        FROM ${stagingSchema}.export_edges
        WHERE source = 50
        
        UNION ALL
        
        SELECT 
          e.source, e.target, e.id, e.trail_name, e.length_km,
          p.path_nodes || e.target,
          p.path_trails || e.trail_name,
          p.total_distance + e.length_km,
          p.depth + 1
        FROM ${stagingSchema}.export_edges e
        JOIN path p ON e.source = p.target
        WHERE p.depth < 10  -- Limit depth to avoid infinite loops
          AND e.target != ALL(p.path_nodes[1:array_length(p.path_nodes, 1)-1])  -- Avoid cycles except at end
      )
      SELECT * FROM path
      WHERE target = 50 AND depth > 1
      ORDER BY total_distance
      LIMIT 5
    `);
    
    console.log(`Found ${pathResult.rows.length} potential loops back to node 50`);
    pathResult.rows.forEach((path, index) => {
      console.log(`  ${index + 1}. Distance: ${path.total_distance.toFixed(2)}km, Depth: ${path.depth}, Trails: ${path.path_trails.join(' → ')}`);
    });
    
  } catch (error) {
    console.error('❌ Error during Bear Peak loop path test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testBearPeakLoopPath().catch(console.error);
