import { Pool } from 'pg';

async function testBearPeakLoopDetails() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Testing Bear Peak loop details...');
    
    // Get the most recent staging schema with unified network
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
    
    // Find the specific Bear Peak loops using pgr_hawickCircuits
    console.log('\n🔄 Finding Bear Peak loops with pgr_hawickCircuits...');
    
    const loops = await pgClient.query(`
      SELECT * FROM pgr_hawickCircuits(
        'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded'
      )
      WHERE cost BETWEEN 5 AND 15
      ORDER BY path_id, path_seq
      LIMIT 100
    `);
    
    console.log(`Found ${loops.rows.length} path segments`);
    
    // Group by path_id to reconstruct complete loops
    const loopGroups = new Map();
    loops.rows.forEach(segment => {
      if (!loopGroups.has(segment.path_id)) {
        loopGroups.set(segment.path_id, []);
      }
      loopGroups.get(segment.path_id).push(segment);
    });
    
    console.log(`Reconstructed ${loopGroups.size} complete loops`);
    
    // Analyze each complete loop
    for (const [pathId, segments] of loopGroups) {
      const totalCost = segments.reduce((sum: number, seg: any) => sum + seg.cost, 0);
      console.log(`\n📍 Analyzing Loop ${pathId}: ${totalCost.toFixed(2)}km (${segments.length} segments)`);
      
      // Extract edge IDs from all segments
      const edgeIds = segments.map((seg: any) => seg.edge);
      
      // Get detailed information about each edge in the loop
      const edgeDetails = await pgClient.query(`
        SELECT 
          wn.id,
          wn.source,
          wn.target,
          wn.cost as length_km,
          ee.trail_name,
          ee.trail_id
        FROM ${stagingSchema}.ways_noded wn
        LEFT JOIN ${stagingSchema}.export_edges ee ON wn.id = ee.id
        WHERE wn.id = ANY($1)
        ORDER BY wn.id
      `, [edgeIds]);
      
      // Check if this loop contains Bear Peak related trails
      const bearPeakTrails = edgeDetails.rows.filter(edge => 
        edge.trail_name && (
          edge.trail_name.toLowerCase().includes('bear peak') ||
          edge.trail_name.toLowerCase().includes('fern canyon') ||
          edge.trail_name.toLowerCase().includes('mesa trail') ||
          edge.trail_name.toLowerCase().includes('bear canyon')
        )
      );
      
      if (bearPeakTrails.length > 0) {
        console.log(`  🎯 BEAR PEAK LOOP FOUND! Contains ${bearPeakTrails.length} Bear Peak related trails`);
        
        // Calculate total distance and elevation
        let totalDistance = 0;
        let totalElevationGain = 0;
        let totalElevationLoss = 0;
        
        console.log(`  📍 Loop path (${edgeDetails.rows.length} edges):`);
        
        for (let j = 0; j < edgeDetails.rows.length; j++) {
          const edge = edgeDetails.rows[j];
          totalDistance += edge.length_km;
          
          // Get elevation data
          const elevationData = await pgClient.query(`
            SELECT elevation_gain, elevation_loss
            FROM ${stagingSchema}.export_edges
            WHERE id = $1
          `, [edge.id]);
          
          if (elevationData.rows.length > 0) {
            totalElevationGain += elevationData.rows[0].elevation_gain || 0;
            totalElevationLoss += elevationData.rows[0].elevation_loss || 0;
          }
          
          const isBearPeak = bearPeakTrails.some(bp => bp.id === edge.id);
          const marker = isBearPeak ? '🎯' : '  ';
          
          console.log(`    ${marker} ${j + 1}. ${edge.trail_name || 'Unknown Trail'} (${edge.source} → ${edge.target}, ${edge.length_km.toFixed(2)}km)`);
        }
        
        console.log(`  📊 Loop Summary:`);
        console.log(`    Total Distance: ${totalDistance.toFixed(2)}km`);
        console.log(`    Total Elevation Gain: ${totalElevationGain.toFixed(0)}m`);
        console.log(`    Total Elevation Loss: ${totalElevationLoss.toFixed(0)}m`);
        console.log(`    Bear Peak Trails: ${bearPeakTrails.map(t => t.trail_name).join(', ')}`);
        
        // Show the complete route sequence
        console.log(`  🛤️ Complete Route Sequence:`);
        const routeSequence = edgeDetails.rows.map((edge, index) => {
          const isBearPeak = bearPeakTrails.some(bp => bp.id === edge.id);
          const marker = isBearPeak ? '🎯' : '  ';
          return `${marker} ${edge.trail_name || 'Unknown Trail'}`;
        });
        
        console.log(`    ${routeSequence.join(' → ')}`);
        
        // Check if this is a valid loop (starts and ends at same node)
        const firstEdge = edgeDetails.rows[0];
        const lastEdge = edgeDetails.rows[edgeDetails.rows.length - 1];
        
        if (firstEdge && lastEdge) {
          const isLoop = firstEdge.source === lastEdge.target;
          console.log(`  ✅ Valid Loop: ${isLoop ? 'Yes' : 'No'} (${firstEdge.source} → ... → ${lastEdge.target})`);
        }
        
        break; // Found the Bear Peak loop, no need to check others
      } else {
        console.log(`  ⏭️ Not a Bear Peak loop (contains ${edgeDetails.rows.length} other trails)`);
      }
    }
    
    // Also check what Bear Peak trails are available in the network
    console.log('\n📋 Available Bear Peak related trails in network:');
    const bearPeakEdges = await pgClient.query(`
      SELECT id, source, target, trail_name, length_km, elevation_gain, elevation_loss
      FROM ${stagingSchema}.export_edges
      WHERE trail_name ILIKE '%bear peak%' 
         OR trail_name ILIKE '%fern canyon%' 
         OR trail_name ILIKE '%mesa trail%'
         OR trail_name ILIKE '%bear canyon%'
      ORDER BY trail_name, id
    `);
    
    console.log(`Found ${bearPeakEdges.rows.length} Bear Peak related edges:`);
    bearPeakEdges.rows.forEach(edge => {
      console.log(`  ${edge.id}: ${edge.trail_name} (${edge.source} → ${edge.target}, ${edge.length_km.toFixed(2)}km, +${edge.elevation_gain?.toFixed(0) || 0}m/-${edge.elevation_loss?.toFixed(0) || 0}m)`);
    });
    
  } catch (error) {
    console.error('❌ Error during Bear Peak loop details test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testBearPeakLoopDetails().catch(console.error);
