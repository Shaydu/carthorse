import { Pool } from 'pg';
import { loadConfig } from './src/config/carthorse.global.config';
import { PgRoutingSplittingService } from './src/services/layer1/PgRoutingSplittingService';

async function testTIntersectionSplitting() {
  const config = loadConfig();
  const pool = new Pool(config.database);
  
  try {
    console.log('🔍 Testing T-intersection splitting...');
    
    // Check initial state
    const initialResult = await pool.query(`
      SELECT app_uuid, name, ST_NumPoints(geometry) as num_points 
      FROM carthorse_1755227694173.trails 
      WHERE name = 'Enchanted Mesa Trail'
    `);
    
    console.log('Initial Enchanted Mesa Trail:', initialResult.rows[0]);
    
    // Check T-intersection detection
    const tIntersectionResult = await pool.query(`
      SELECT connected_trail_names, distance_meters, ST_AsText(intersection_point_3d) as location 
      FROM carthorse_1755227694173.intersection_points 
      WHERE node_type = 't_intersection' 
      AND ('Enchanted Mesa Trail' = ANY(connected_trail_names) OR 'Enchanted-Kohler Spur Trail' = ANY(connected_trail_names))
      ORDER BY distance_meters
    `);
    
    console.log('T-intersections found:', tIntersectionResult.rows);
    
    // Test the splitting logic directly
    const splittingService = new PgRoutingSplittingService(pool, 'carthorse_1755227694173');
    
    await splittingService.splitTrailsAtTIntersections();
    
    // Check final state
    const finalResult = await pool.query(`
      SELECT app_uuid, name, ST_NumPoints(geometry) as num_points 
      FROM carthorse_1755227694173.trails 
      WHERE name = 'Enchanted Mesa Trail'
    `);
    
    console.log('Final Enchanted Mesa Trail segments:', finalResult.rows);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

testTIntersectionSplitting();


