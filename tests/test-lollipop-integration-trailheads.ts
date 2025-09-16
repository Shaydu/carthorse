import { Pool } from 'pg';
import { LollipopRouteGeneratorService } from '../src/services/layer3/LollipopRouteGeneratorService';
import { getDatabasePoolConfig } from '../src/utils/config-loader';

async function testTrailheadLollipopIntegration() {
  console.log('🏔️ Testing TRAILHEAD-ONLY LollipopRouteGeneratorService integration...');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-trailheads.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // First, let's check how many degree 1 nodes (trailheads) we have
    const trailheadCount = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${schema}.ways_noded_vertices_pgr
      WHERE (SELECT COUNT(*) FROM ${schema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) = 1
    `);

    console.log(`🏔️ Found ${trailheadCount.rows[0].count} trailhead nodes (degree 1) in schema ${schema}`);

    if (trailheadCount.rows[0].count === 0) {
      console.log('❌ No trailhead nodes found! Cannot generate trailhead routes.');
      return;
    }

    // Show some sample trailhead nodes
    const sampleTrailheads = await pgClient.query(`
      SELECT id, 
             ST_X(the_geom) as lng, 
             ST_Y(the_geom) as lat
      FROM ${schema}.ways_noded_vertices_pgr
      WHERE (SELECT COUNT(*) FROM ${schema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) = 1
      ORDER BY id
      LIMIT 10
    `);

    console.log('📍 Sample trailhead locations:');
    sampleTrailheads.rows.forEach((trailhead, index) => {
      console.log(`   ${index + 1}. Node ${trailhead.id}: (${trailhead.lng.toFixed(6)}, ${trailhead.lat.toFixed(6)})`);
    });

    // Test the standard lollipop service with trailhead-focused configuration
    const trailheadService = new LollipopRouteGeneratorService(pgClient, {
      stagingSchema: schema,
      region: 'boulder',
      targetDistance: 60, // Moderate target for trailhead routes
      maxAnchorNodes: 20, // Limit to reasonable number of trailheads
      maxReachableNodes: 20,
      maxDestinationExploration: 10,
      distanceRangeMin: 0.3, // Favor longer outbound legs
      distanceRangeMax: 0.8, // Allow reasonable return legs
      edgeOverlapThreshold: 30,
      kspPaths: 8,
      minOutboundDistance: 8, // Ensure substantial outbound distance
      outputPath: 'test-output'
    });

    console.log('🏔️ Generating lollipop routes (will include trailhead routes)...');
    const routes = await trailheadService.generateLollipopRoutes();
    
    console.log(`✅ Generated ${routes.length} total lollipop routes`);
    
    if (routes.length > 0) {
      // Filter for routes that start/end at degree 1 nodes (trailheads)
      const trailheadRoutes = [];
      
      for (const route of routes) {
        // Check if anchor node is degree 1
        const anchorDegree = await pgClient.query(`
          SELECT COUNT(*) as degree
          FROM ${schema}.ways_noded
          WHERE source = $1 OR target = $1
        `, [route.anchor_node]);
        
        // Check if destination node is degree 1
        const destDegree = await pgClient.query(`
          SELECT COUNT(*) as degree
          FROM ${schema}.ways_noded
          WHERE source = $1 OR target = $1
        `, [route.dest_node]);
        
        if (anchorDegree.rows[0].degree == 1 && destDegree.rows[0].degree == 1) {
          trailheadRoutes.push(route);
        }
      }

      console.log(`🏔️ Found ${trailheadRoutes.length} trailhead-to-trailhead routes`);
      
      if (trailheadRoutes.length > 0) {
        console.log('📊 Top 10 TRAILHEAD routes:');
        trailheadRoutes
          .sort((a, b) => b.total_distance - a.total_distance)
          .slice(0, 10)
          .forEach((route, index) => {
            console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (${route.edge_overlap_percentage.toFixed(1)}% overlap) - Trailhead ${route.anchor_node} → Trailhead ${route.dest_node}`);
          });

        // Show statistics for trailhead routes
        const longTrailheadRoutes = trailheadRoutes.filter(r => r.total_distance >= 40);
        const veryLongTrailheadRoutes = trailheadRoutes.filter(r => r.total_distance >= 60);
        
        console.log(`\n📈 Trailhead Route Statistics:`);
        console.log(`   • Total trailhead routes: ${trailheadRoutes.length}`);
        console.log(`   • Routes ≥40km: ${longTrailheadRoutes.length}`);
        console.log(`   • Routes ≥60km: ${veryLongTrailheadRoutes.length}`);
        console.log(`   • Average distance: ${(trailheadRoutes.reduce((sum, r) => sum + r.total_distance, 0) / trailheadRoutes.length).toFixed(2)}km`);
        console.log(`   • Max distance: ${Math.max(...trailheadRoutes.map(r => r.total_distance)).toFixed(2)}km`);

        // Show unique trailheads used
        const uniqueTrailheads = new Set([
          ...trailheadRoutes.map(r => r.anchor_node),
          ...trailheadRoutes.map(r => r.dest_node)
        ]);
        console.log(`   • Unique trailheads used: ${uniqueTrailheads.size}`);

        // Save to database
        await trailheadService.saveToDatabase(trailheadRoutes);
        
        // Export to GeoJSON
        const filepath = await trailheadService.exportToGeoJSON(trailheadRoutes);
        console.log(`📁 Exported trailhead routes to: ${filepath}`);
      } else {
        console.log('❌ No trailhead-to-trailhead routes found. This could mean:');
        console.log('   • Trailheads are too far apart for the target distance');
        console.log('   • Network connectivity issues between trailheads');
        console.log('   • Need to increase target distance or adjust parameters');
      }

      // Show overall route statistics for comparison
      console.log(`\n📊 Overall Route Statistics (all routes):`);
      console.log(`   • Total routes: ${routes.length}`);
      console.log(`   • Average distance: ${(routes.reduce((sum, r) => sum + r.total_distance, 0) / routes.length).toFixed(2)}km`);
      console.log(`   • Max distance: ${Math.max(...routes.map(r => r.total_distance)).toFixed(2)}km`);
    }

  } catch (error) {
    console.error('❌ Error testing trailhead lollipop integration:', error);
  } finally {
    await pgClient.end();
  }
}

testTrailheadLollipopIntegration().catch(console.error);