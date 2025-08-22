#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as yargs from 'yargs';

interface TrailEndpoint {
  trail_id: number;
  trail_uuid: string;
  trail_name: string;
  endpoint: string; // 'start' or 'end'
  endpoint_geom: any;
  trail_geom: any;
}

interface Intersection {
  visitor_trail_id: number;
  visitor_trail_uuid: string;
  visitor_trail_name: string;
  visitor_endpoint: string;
  visited_trail_id: number;
  visited_trail_uuid: string;
  visited_trail_name: string;
  intersection_point: any;
  distance_meters: number;
  intersection_type: 'T' | 'Y';
}

class TrailGapBridge {
  private pgClient: Pool;
  private stagingSchema: string;
  private tolerance: number;

  constructor(pgClient: Pool, stagingSchema: string, tolerance: number = 0.000045) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
    this.tolerance = tolerance;
  }

  /**
   * Find T and Y intersections where trail endpoints meet other trails
   */
  async findIntersections(): Promise<Intersection[]> {
    console.log('🔍 Finding T/Y intersections where trail endpoints meet other trails...');

    const intersectionQuery = `
      WITH trail_endpoints AS (
        -- Get all trail start and end points
        SELECT 
          id as trail_id,
          app_uuid as trail_uuid,
          name as trail_name,
          ST_StartPoint(geometry) as endpoint_geom,
          'start' as endpoint_type,
          geometry as trail_geom
        FROM ${this.stagingSchema}.trails
        UNION ALL
        SELECT 
          id as trail_id,
          app_uuid as trail_uuid,
          name as trail_name,
          ST_EndPoint(geometry) as endpoint_geom,
          'end' as endpoint_type,
          geometry as trail_geom
        FROM ${this.stagingSchema}.trails
      ),
      endpoint_trail_intersections AS (
        -- Find where trail endpoints are close to other trails (but not their own trail)
        SELECT 
          ep.trail_id as visitor_trail_id,
          ep.trail_uuid as visitor_trail_uuid,
          ep.trail_name as visitor_trail_name,
          ep.endpoint_type as visitor_endpoint,
          t.id as visited_trail_id,
          t.app_uuid as visited_trail_uuid,
          t.name as visited_trail_name,
          ep.endpoint_geom as visitor_endpoint_geom,
          t.geometry as visited_trail_geom,
          ST_Distance(ep.endpoint_geom::geography, t.geometry::geography) as distance_meters,
          ST_ClosestPoint(t.geometry, ep.endpoint_geom) as intersection_point
        FROM trail_endpoints ep
        JOIN ${this.stagingSchema}.trails t ON ep.trail_id != t.id
        WHERE ST_DWithin(ep.endpoint_geom::geography, t.geometry::geography, 8) -- Within 8m
          AND ST_Distance(ep.endpoint_geom::geography, t.geometry::geography) > 0.5 -- But not too close
      ),
      valid_intersections AS (
        -- Filter to valid T/Y intersections
        SELECT 
          visitor_trail_id,
          visitor_trail_uuid,
          visitor_trail_name,
          visitor_endpoint,
          visited_trail_id,
          visited_trail_uuid,
          visited_trail_name,
          intersection_point,
          distance_meters,
          -- Determine if this creates a T or Y intersection
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM trail_endpoints ep2 
              WHERE ep2.trail_id = visited_trail_id 
                AND ST_DWithin(ep2.endpoint_geom::geography, intersection_point::geography, 5)
            ) THEN 'Y'
            ELSE 'T'
          END as intersection_type
        FROM endpoint_trail_intersections
        WHERE distance_meters <= 8 -- Only process gaps up to 8m
      ),
      clustered_intersections AS (
        -- Group nearby intersections to avoid duplicates
        SELECT 
          visitor_trail_id,
          visitor_trail_uuid,
          visitor_trail_name,
          visitor_endpoint,
          visited_trail_id,
          visited_trail_uuid,
          visited_trail_name,
          ST_Centroid(ST_Collect(intersection_point)) as intersection_point,
          AVG(distance_meters) as distance_meters,
          intersection_type
        FROM valid_intersections
        GROUP BY 
          visitor_trail_id, visitor_trail_uuid, visitor_trail_name, visitor_endpoint,
          visited_trail_id, visited_trail_uuid, visited_trail_name, intersection_type
      )
      SELECT 
        visitor_trail_id,
        visitor_trail_uuid,
        visitor_trail_name,
        visitor_endpoint,
        visited_trail_id,
        visited_trail_uuid,
        visited_trail_name,
        ST_AsText(intersection_point) as intersection_point_wkt,
        ROUND(distance_meters::numeric, 2) as distance_meters,
        intersection_type
      FROM clustered_intersections
      ORDER BY distance_meters ASC
    `;

    const result = await this.pgClient.query(intersectionQuery);
    
    const intersections: Intersection[] = result.rows.map(row => ({
      visitor_trail_id: row.visitor_trail_id,
      visitor_trail_uuid: row.visitor_trail_uuid,
      visitor_trail_name: row.visitor_trail_name,
      visitor_endpoint: row.visitor_endpoint,
      visited_trail_id: row.visited_trail_id,
      visited_trail_uuid: row.visited_trail_uuid,
      visited_trail_name: row.visited_trail_name,
      intersection_point: row.intersection_point_wkt,
      distance_meters: row.distance_meters,
      intersection_type: row.intersection_type
    }));

    console.log(`📍 Found ${intersections.length} T/Y intersections to process`);
    
    // Log some examples
    intersections.slice(0, 5).forEach(intersection => {
      console.log(`   ${intersection.intersection_type}: ${intersection.visitor_trail_name} (${intersection.visitor_endpoint}) → ${intersection.visited_trail_name} (${intersection.distance_meters}m gap)`);
    });

    return intersections;
  }

  /**
   * Split visited trails at intersection points
   */
  async splitVisitedTrails(intersections: Intersection[]): Promise<{ splitsPerformed: number }> {
    console.log('✂️ Splitting visited trails at intersection points...');

    let splitsPerformed = 0;

    for (const intersection of intersections) {
      console.log(`   📍 Processing ${intersection.intersection_type} intersection:`);
      console.log(`      ${intersection.visitor_trail_name} (${intersection.visitor_endpoint}) → ${intersection.visited_trail_name} (${intersection.distance_meters}m gap)`);

      try {
        // Split the visited trail at the intersection point
        const splitQuery = `
          WITH visited_trail AS (
            SELECT geometry, app_uuid, name, length_km
            FROM ${this.stagingSchema}.trails
            WHERE id = $1
          ),
          intersection_point AS (
            SELECT ST_GeomFromText($2, 4326) as point_geom
          ),
          split_analysis AS (
            SELECT 
              vt.geometry as trail_geom,
              vt.app_uuid,
              vt.name,
              vt.length_km,
              ip.point_geom,
              ST_LineLocatePoint(vt.geometry, ip.point_geom) as split_ratio,
              ST_Distance(vt.geometry::geography, ip.point_geom::geography) as distance_meters
            FROM visited_trail vt, intersection_point ip
          ),
          split_segments AS (
            SELECT 
              trail_geom,
              app_uuid,
              name,
              length_km,
              point_geom,
              split_ratio,
              -- Split at the ratio
              ST_LineSubstring(trail_geom, 0, split_ratio) as segment1,
              ST_LineSubstring(trail_geom, split_ratio, 1) as segment2
            FROM split_analysis
            WHERE split_ratio > 0.01 AND split_ratio < 0.99 -- Don't split too close to endpoints
          ),
          valid_segments AS (
            SELECT 
              app_uuid,
              name,
              length_km,
              point_geom,
              segment1,
              segment2,
              ST_Length(segment1::geography) / 1000.0 as length1_km,
              ST_Length(segment2::geography) / 1000.0 as length2_km
            FROM split_segments
            WHERE ST_Length(segment1::geography) > 5 AND ST_Length(segment2::geography) > 5
          )
          SELECT 
            app_uuid,
            name,
            point_geom,
            segment1,
            segment2,
            length1_km,
            length2_km
          FROM valid_segments
        `;

        const splitResult = await this.pgClient.query(splitQuery, [
          intersection.visited_trail_id,
          intersection.intersection_point
        ]);

        if (splitResult.rows.length > 0) {
          const split = splitResult.rows[0];
          
          // Delete the original trail
          await this.pgClient.query(`
            DELETE FROM ${this.stagingSchema}.trails 
            WHERE id = $1
          `, [intersection.visited_trail_id]);

          // Insert the two new segments
          await this.pgClient.query(`
            INSERT INTO ${this.stagingSchema}.trails (
              app_uuid, name, geometry, length_km, source, source_node, target_node
            )
            VALUES 
              ($1, $2, ST_GeomFromText($3, 4326), $4, 'split', 'intersection-start', 'intersection-mid'),
              ($1, $5, ST_GeomFromText($6, 4326), $7, 'split', 'intersection-mid', 'intersection-end')
          `, [
            split.app_uuid,
            `${split.name} Segment 1`,
            split.segment1,
            split.length1_km,
            `${split.name} Segment 2`,
            split.segment2,
            split.length2_km
          ]);

          console.log(`     ✅ Split ${intersection.visited_trail_name} into 2 segments`);
          splitsPerformed++;
        } else {
          console.log(`     ⚠️ Could not split ${intersection.visited_trail_name} (split ratio out of range)`);
        }

      } catch (error) {
        console.error(`     ❌ Error splitting ${intersection.visited_trail_name}:`, error);
      }
    }

    console.log(`✅ Completed ${splitsPerformed} trail splits`);
    return { splitsPerformed };
  }
}

async function main() {
  const argv = await yargs
    .option('staging-schema', {
      type: 'string',
      required: true,
      description: 'Staging schema name'
    })
    .option('tolerance', {
      type: 'number',
      default: 0.000045,
      description: 'Spatial tolerance in degrees'
    })
    .option('dry-run', {
      type: 'boolean',
      default: false,
      description: 'Only detect intersections, don\'t split trails'
    })
    .help()
    .argv;

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'trail_master_db',
    user: process.env.DB_USER || 'carthorse',
    password: process.env.DB_PASSWORD || 'carthorse'
  });

  try {
    const bridge = new TrailGapBridge(pool, argv.stagingSchema, argv.tolerance);
    
    console.log('🌉 Bridging trail gaps...');
    console.log(`   Staging Schema: ${argv.stagingSchema}`);
    console.log(`   Tolerance: ${argv.tolerance} degrees`);
    console.log(`   Dry Run: ${argv.dryRun ? 'Yes' : 'No'}`);

    // Find intersections
    const intersections = await bridge.findIntersections();
    
    if (intersections.length === 0) {
      console.log('❌ No intersections found to process');
      return;
    }

    if (argv.dryRun) {
      console.log('🔍 DRY RUN: Would process intersections');
      console.log(`   Found ${intersections.length} intersections to process`);
      return;
    }

    // Split visited trails
    const result = await bridge.splitVisitedTrails(intersections);
    
    console.log('✅ Trail gap bridging completed!');
    console.log(`📊 Results:`);
    console.log(`   📍 Intersections found: ${intersections.length}`);
    console.log(`   ✂️ Trails split: ${result.splitsPerformed}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}
