#!/usr/bin/env node

const { Client } = require('pg');

// Database configuration for trail_master_db
const config = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || '',
  database: 'trail_master_db',
};

async function deleteTestTrail() {
  const client = new Client(config);
  
  try {
    await client.connect();
    console.log('🔍 Connected to trail_master_db');
    
    // First, let's verify the trail exists and get its details
    console.log('\n📋 Checking for "Test Elevation Trail Split"...');
    const checkResult = await client.query(`
      SELECT 
        id, 
        app_uuid, 
        name, 
        region,
        bbox_min_lng, 
        bbox_max_lng, 
        bbox_min_lat, 
        bbox_max_lat,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        length_km,
        ST_Length(geometry::geography) as length_meters,
        ST_NPoints(geometry) as point_count
      FROM trails 
      WHERE name = 'Test Elevation Trail Split'
    `);
    
    if (checkResult.rows.length === 0) {
      console.log('❌ Trail "Test Elevation Trail Split" not found in database');
      return;
    }
    
    const trail = checkResult.rows[0];
    console.log(`\n📋 Found trail to delete:`);
    console.log(`   ID: ${trail.id}`);
    console.log(`   UUID: ${trail.app_uuid}`);
    console.log(`   Name: ${trail.name}`);
    console.log(`   Region: ${trail.region}`);
    console.log(`   Length: ${trail.length_km?.toFixed(3)} km (${trail.length_meters?.toFixed(1)} m)`);
    console.log(`   Points: ${trail.point_count}`);
    console.log(`   BBox: [${trail.bbox_min_lng}, ${trail.bbox_min_lat}] to [${trail.bbox_max_lng}, ${trail.bbox_max_lat}]`);
    console.log(`   Elevation: ${trail.min_elevation?.toFixed(1)}m - ${trail.max_elevation?.toFixed(1)}m (avg: ${trail.avg_elevation?.toFixed(1)}m)`);
    console.log(`   Gain/Loss: +${trail.elevation_gain?.toFixed(1)}m / -${trail.elevation_loss?.toFixed(1)}m`);
    
    // Check if there are any related records in other tables
    console.log('\n🔍 Checking for related records...');
    
    // Check routing_edges table
    const edgesResult = await client.query(`
      SELECT COUNT(*) as count FROM routing_edges 
      WHERE trail_id = $1
    `, [trail.id]);
    console.log(`   Related routing edges: ${edgesResult.rows[0].count}`);
    
    // Check routing_nodes table (if any nodes are specific to this trail)
    const nodesResult = await client.query(`
      SELECT COUNT(*) as count FROM routing_nodes 
      WHERE trail_id = $1
    `, [trail.id]);
    console.log(`   Related routing nodes: ${nodesResult.rows[0].count}`);
    
    // Check route_recommendations table
    const recommendationsResult = await client.query(`
      SELECT COUNT(*) as count FROM route_recommendations 
      WHERE trail_composition::text LIKE '%${trail.app_uuid}%'
    `);
    console.log(`   Related route recommendations: ${recommendationsResult.rows[0].count}`);
    
    // Confirm deletion
    console.log('\n⚠️  WARNING: This will permanently delete the trail and all related data!');
    console.log('   Are you sure you want to proceed? (y/N)');
    
    // For safety, we'll require explicit confirmation
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('Confirm deletion (y/N): ', async (answer) => {
      rl.close();
      
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log('❌ Deletion cancelled');
        return;
      }
      
      try {
        console.log('\n🗑️  Deleting trail...');
        
        // Start a transaction
        await client.query('BEGIN');
        
        // Delete related routing edges first
        const deleteEdgesResult = await client.query(`
          DELETE FROM routing_edges WHERE trail_id = $1
        `, [trail.id]);
        console.log(`   Deleted ${deleteEdgesResult.rowCount} routing edges`);
        
        // Delete related routing nodes
        const deleteNodesResult = await client.query(`
          DELETE FROM routing_nodes WHERE trail_id = $1
        `, [trail.id]);
        console.log(`   Deleted ${deleteNodesResult.rowCount} routing nodes`);
        
        // Delete route recommendations that contain this trail
        const deleteRecommendationsResult = await client.query(`
          DELETE FROM route_recommendations 
          WHERE trail_composition::text LIKE '%${trail.app_uuid}%'
        `);
        console.log(`   Deleted ${deleteRecommendationsResult.rowCount} route recommendations`);
        
        // Finally, delete the trail itself
        const deleteTrailResult = await client.query(`
          DELETE FROM trails WHERE id = $1
        `, [trail.id]);
        console.log(`   Deleted ${deleteTrailResult.rowCount} trail record`);
        
        // Commit the transaction
        await client.query('COMMIT');
        
        console.log('\n✅ Successfully deleted "Test Elevation Trail Split" and all related data');
        
        // Verify deletion
        const verifyResult = await client.query(`
          SELECT COUNT(*) as count FROM trails WHERE name = 'Test Elevation Trail Split'
        `);
        console.log(`   Verification: ${verifyResult.rows[0].count} trails with this name remain`);
        
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error during deletion:', error.message);
        throw error;
      }
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

deleteTestTrail().catch(console.error); 