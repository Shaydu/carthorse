import { Command } from 'commander';
import * as fs from 'fs';
import { Pool } from 'pg';

interface GeoJSONFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: number[] | number[][];
  };
  properties: {
    id: string;
    node_uuid: string;
    lat: number;
    lng: number;
    elevation: number;
    node_type: string;
    degree: string;
    type: string;
    color: string;
    stroke: string;
    strokeWidth: number;
    fillOpacity: number;
    radius: number;
  };
}

interface GeoJSONCollection {
  type: string;
  features: GeoJSONFeature[];
}

interface TrailSegment {
  id: string;
  app_uuid: string;
  name: string;
  geometry: any;
  length_km: number;
  source_node: string;
  target_node: string;
}

interface IntersectionPoint {
  lng: number;
  lat: number;
  elevation: number;
  node_uuid: string;
  connected_trails: string[];
  intersection_type: 'Y' | 'T' | 'X';
}

class TrailSplitter {
  private pgClient: Pool;
  private stagingSchema: string;
  private tolerance: number;

  constructor(pgClient: Pool, stagingSchema: string, tolerance: number = 0.000045) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
    this.tolerance = tolerance;
  }

  /**
   * Find all intersection points between trails
   */
  async findIntersectionPoints(): Promise<IntersectionPoint[]> {
    console.log('🔍 Finding intersection points between trails...');

    const intersectionQuery = `
      WITH trail_intersections AS (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t2.app_uuid as trail2_uuid,
          ST_Intersection(t1.geometry, t2.geometry) as intersection_geom
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > 10
          AND ST_Length(t2.geometry::geography) > 10
      ),
      dumped_intersections AS (
        SELECT 
          trail1_uuid,
          trail2_uuid,
          (ST_Dump(intersection_geom)).geom as point_geom
        FROM trail_intersections
      ),
      unique_points AS (
        SELECT 
          ST_SnapToGrid(point_geom, $1) as snapped_point,
          ARRAY_AGG(DISTINCT trail1_uuid) || ARRAY_AGG(DISTINCT trail2_uuid) as connected_trails
        FROM dumped_intersections
        GROUP BY ST_SnapToGrid(point_geom, $1)
      )
      SELECT 
        ST_X(snapped_point) as lng,
        ST_Y(snapped_point) as lat,
        ST_Z(snapped_point) as elevation,
        'intersection-' || gen_random_uuid()::text as node_uuid,
        connected_trails,
        CASE 
          WHEN array_length(connected_trails, 1) = 2 THEN 'T'
          WHEN array_length(connected_trails, 1) = 3 THEN 'Y'
          ELSE 'X'
        END as intersection_type
      FROM unique_points
      ORDER BY lng, lat
    `;

    const result = await this.pgClient.query(intersectionQuery, [this.tolerance]);
    
    console.log(`📍 Found ${result.rows.length} intersection points`);
    return result.rows.map(row => ({
      lng: row.lng,
      lat: row.lat,
      elevation: row.elevation || 0,
      node_uuid: row.node_uuid,
      connected_trails: row.connected_trails,
      intersection_type: row.intersection_type
    }));
  }

  /**
   * Split trails at intersection points
   */
  async splitTrailsAtIntersections(intersections: IntersectionPoint[]): Promise<{ segmentsCreated: number; nodesCreated: number }> {
    console.log('✂️ Splitting trails at intersection points...');

    let segmentsCreated = 0;
    let nodesCreated = 0;

    for (const intersection of intersections) {
      console.log(`   📍 Processing ${intersection.intersection_type} intersection at (${intersection.lng.toFixed(6)}, ${intersection.lat.toFixed(6)})`);

      // Find trails that pass through this intersection
      const trailsQuery = `
        WITH intersection_point AS (
          SELECT ST_SetSRID(ST_MakePoint($1, $2, $3), 4326) as point_geom
        )
        SELECT 
          t.id,
          t.app_uuid,
          t.name,
          t.geometry,
          t.length_km,
          ST_Distance(t.geometry::geography, ip.point_geom::geography) as distance_to_intersection
        FROM ${this.stagingSchema}.trails t, intersection_point ip
        WHERE ST_DWithin(t.geometry::geography, ip.point_geom::geography, $4)
          AND t.app_uuid = ANY($5)
        ORDER BY distance_to_intersection
      `;

      const trailsResult = await this.pgClient.query(trailsQuery, [
        intersection.lng,
        intersection.lat,
        intersection.elevation,
        this.tolerance * 111000, // Convert degrees to meters
        intersection.connected_trails
      ]);

      for (const trail of trailsResult.rows) {
        const splitResult = await this.splitTrailAtPoint(trail, intersection);
        if (splitResult.success) {
          segmentsCreated += splitResult.segmentsCreated;
        }
      }

      nodesCreated++;
    }

    return { segmentsCreated, nodesCreated };
  }

  /**
   * Split a single trail at an intersection point
   */
  async splitTrailAtPoint(trail: any, intersection: IntersectionPoint): Promise<{ success: boolean; segmentsCreated: number }> {
    try {
      // Find the exact point on the trail closest to the intersection
      const splitQuery = `
        WITH trail_geom AS (
          SELECT $1::geometry as geom
        ),
        intersection_point AS (
          SELECT ST_SetSRID(ST_MakePoint($2, $3, $4), 4326) as point_geom
        ),
        closest_analysis AS (
          SELECT 
            tg.geom as trail_geom,
            ip.point_geom as intersection_point,
            ST_ClosestPoint(tg.geom, ip.point_geom) as closest_point,
            ST_LineLocatePoint(tg.geom, ip.point_geom) as split_ratio,
            ST_Distance(tg.geom::geography, ip.point_geom::geography) as distance_meters
          FROM trail_geom tg, intersection_point ip
        ),
        valid_split AS (
          SELECT 
            trail_geom,
            closest_point,
            split_ratio,
            distance_meters
          FROM closest_analysis
          WHERE distance_meters <= 50  -- Increased from 10 to 50 meters
            AND split_ratio > 0.01     -- Don't split too close to start
            AND split_ratio < 0.99     -- Don't split too close to end
        ),
        split_segments AS (
          SELECT 
            trail_geom,
            closest_point,
            split_ratio,
            -- Split at the ratio using ST_LineInterpolatePoint
            ST_LineSubstring(trail_geom, 0, split_ratio) as segment1,
            ST_LineSubstring(trail_geom, split_ratio, 1) as segment2
          FROM valid_split
        ),
        all_segments AS (
          SELECT segment1 as segment_geom FROM split_segments
          WHERE ST_Length(segment1::geography) > 5
          UNION ALL
          SELECT segment2 as segment_geom FROM split_segments
          WHERE ST_Length(segment2::geography) > 5
        )
        SELECT 
          ST_AsText(segment_geom) as geometry_wkt,
          ST_Length(segment_geom::geography) / 1000.0 as length_km
        FROM all_segments
        WHERE ST_GeometryType(segment_geom) = 'ST_LineString'
        ORDER BY length_km DESC
      `;

      const splitResult = await this.pgClient.query(splitQuery, [
        trail.geometry,
        intersection.lng,
        intersection.lat,
        intersection.elevation
      ]);

      if (splitResult.rows.length < 2) {
        console.log(`     ⚠️ Trail "${trail.name}" split produced only ${splitResult.rows.length} segments (distance: ${splitResult.rows.length > 0 ? 'within range' : 'too far'})`);
        return { success: false, segmentsCreated: 0 };
      }

      // Delete the original trail
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [trail.app_uuid]);

      // Insert the split segments with proper node connections
      for (let i = 0; i < splitResult.rows.length; i++) {
        const segment = splitResult.rows[i];
        const segmentUuid = `segment-${trail.app_uuid}-${i}`;
        
        // Determine source and target nodes
        const sourceNode = i === 0 ? `node-${trail.app_uuid}-start` : intersection.node_uuid;
        const targetNode = i === splitResult.rows.length - 1 ? `node-${trail.app_uuid}-end` : intersection.node_uuid;

        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
            trail_type, surface, difficulty, source, source_node, target_node
          )
          VALUES (
            $1,
            $2,
            ST_GeomFromText($3, 4326),
            $4,
            0,
            0,
            'trail',
            'unknown',
            'unknown',
            'split',
            $5,
            $6
          )
        `, [
          segmentUuid,
          `${trail.name} Segment ${i + 1}`,
          segment.geometry_wkt,
          segment.length_km,
          sourceNode,
          targetNode
        ]);
      }

      console.log(`     ✅ Split trail "${trail.name}" into ${splitResult.rows.length} segments`);
      return { success: true, segmentsCreated: splitResult.rows.length };

    } catch (error) {
      console.error(`     ❌ Error splitting trail "${trail.name}":`, error);
      return { success: false, segmentsCreated: 0 };
    }
  }

  /**
   * Create nodes table for routing
   */
  async createNodesTable(intersections: IntersectionPoint[]): Promise<void> {
    console.log('📋 Creating nodes table for routing...');

    // Drop existing routing tables to avoid foreign key conflicts
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.stagingSchema}.routing_edges CASCADE;
      DROP TABLE IF EXISTS ${this.stagingSchema}.routing_nodes CASCADE;
    `);

    // Add missing columns to trails table if they don't exist
    try {
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.trails 
        ADD COLUMN IF NOT EXISTS source_node TEXT,
        ADD COLUMN IF NOT EXISTS target_node TEXT
      `);
    } catch (error) {
      console.log('     ℹ️ Columns may already exist');
    }

    // Create nodes table
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_uuid TEXT UNIQUE NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        elevation REAL DEFAULT 0,
        node_type TEXT DEFAULT 'intersection',
        connected_trails INTEGER DEFAULT 0,
        geom GEOMETRY(POINTZ, 4326)
      )
    `);

    // Insert intersection nodes
    for (const intersection of intersections) {
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.routing_nodes (
          node_uuid, lat, lng, elevation, node_type, connected_trails, geom
        )
        VALUES (
          $1, $2, $3, $4::real, $5, $6, ST_SetSRID(ST_MakePoint($3, $2, $4::real), 4326)
        )
        ON CONFLICT (node_uuid) DO NOTHING
      `, [
        intersection.node_uuid,
        intersection.lat,
        intersection.lng,
        intersection.elevation,
        intersection.intersection_type,
        intersection.connected_trails.length
      ]);
    }

    // Insert endpoint nodes from trail start/end points
    const endpointQuery = `
      WITH trail_endpoints AS (
        SELECT 
          'node-' || app_uuid || '-start' as node_uuid,
          ST_X(ST_StartPoint(geometry)) as lng,
          ST_Y(ST_StartPoint(geometry)) as lat,
          ST_Z(ST_StartPoint(geometry)) as elevation,
          'endpoint' as node_type
        FROM ${this.stagingSchema}.trails
        WHERE source_node IS NULL OR source_node = 'node-' || app_uuid || '-start'
        
        UNION ALL
        
        SELECT 
          'node-' || app_uuid || '-end' as node_uuid,
          ST_X(ST_EndPoint(geometry)) as lng,
          ST_Y(ST_EndPoint(geometry)) as lat,
          ST_Z(ST_EndPoint(geometry)) as elevation,
          'endpoint' as node_type
        FROM ${this.stagingSchema}.trails
        WHERE target_node IS NULL OR target_node = 'node-' || app_uuid || '-end'
      )
      INSERT INTO ${this.stagingSchema}.routing_nodes (
        node_uuid, lat, lng, elevation, node_type, connected_trails, geom
      )
      SELECT 
        node_uuid, lat, lng, COALESCE(elevation, 0.0), node_type, 1, 
        ST_SetSRID(ST_MakePoint(lng, lat, COALESCE(elevation, 0.0)), 4326)
      FROM trail_endpoints
      ON CONFLICT (node_uuid) DO NOTHING
    `;

    await this.pgClient.query(endpointQuery);

    const nodeCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes
    `);
    console.log(`     ✅ Created ${nodeCount.rows[0].count} routing nodes`);
  }

  /**
   * Create edges table for routing
   */
  async createEdgesTable(): Promise<void> {
    console.log('🔗 Creating edges table for routing...');

    // Create edges table
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.stagingSchema}.routing_edges (
        id SERIAL PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        trail_id TEXT,
        trail_name TEXT,
        distance_km DOUBLE PRECISION NOT NULL,
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        geometry GEOMETRY(LINESTRING, 4326),
        FOREIGN KEY (from_node_id) REFERENCES ${this.stagingSchema}.routing_nodes(id),
        FOREIGN KEY (to_node_id) REFERENCES ${this.stagingSchema}.routing_nodes(id)
      )
    `);

    // Clear existing edges
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_edges`);

    // Insert edges from trail segments
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.routing_edges (
        from_node_id, to_node_id, trail_id, trail_name, distance_km, 
        elevation_gain, elevation_loss, geometry
      )
      SELECT 
        n1.id as from_node_id,
        n2.id as to_node_id,
        t.app_uuid as trail_id,
        t.name as trail_name,
        t.length_km as distance_km,
        COALESCE(t.elevation_gain, 0) as elevation_gain,
        COALESCE(t.elevation_loss, 0) as elevation_loss,
        t.geometry
      FROM ${this.stagingSchema}.trails t
      JOIN ${this.stagingSchema}.routing_nodes n1 ON n1.node_uuid = t.source_node
      JOIN ${this.stagingSchema}.routing_nodes n2 ON n2.node_uuid = t.target_node
      WHERE t.source_node IS NOT NULL AND t.target_node IS NOT NULL
    `);

    const edgeCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_edges`);
    console.log(`✅ Created ${edgeCount.rows[0].count} edges`);
  }
}

const program = new Command();

program
  .name('split-trails-at-intersections')
  .description('Split trails at intersection points and create proper nodes/edges for routing')
  .option('-s, --staging-schema <schema>', 'Staging schema to use', 'carthorse_1755862988734')
  .option('-t, --tolerance <degrees>', 'Tolerance for intersection detection in degrees', '0.000045')
  .option('--dry-run', 'Show what would be done without making changes')
  .parse();

async function splitTrailsAtIntersections() {
  const options = program.opts();
  
  console.log('🔧 Splitting trails at intersections for routing...');
  console.log(`   Staging Schema: ${options.stagingSchema}`);
  console.log(`   Tolerance: ${options.tolerance} degrees`);
  console.log(`   Dry Run: ${options.dryRun ? 'Yes' : 'No'}`);

  // Database connection
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'trail_master_db',
    user: process.env.DB_USER || 'carthorse',
    password: process.env.DB_PASSWORD || ''
  });

  try {
    const splitter = new TrailSplitter(pool, options.stagingSchema, parseFloat(options.tolerance));

    if (options.dryRun) {
      const intersections = await splitter.findIntersectionPoints();
      console.log('🔍 DRY RUN: Would process intersections');
      console.log(`   Found ${intersections.length} intersection points to process`);
      return;
    }

    // Step 1: Find intersection points
    const intersections = await splitter.findIntersectionPoints();

    if (intersections.length === 0) {
      console.log('✅ No intersections found - no splitting needed');
      return;
    }

    // Step 2: Split trails at intersections
    const { segmentsCreated, nodesCreated } = await splitter.splitTrailsAtIntersections(intersections);

    // Step 3: Create nodes table
    await splitter.createNodesTable(intersections);

    // Step 4: Create edges table
    await splitter.createEdgesTable();

    console.log(`✅ Trail splitting completed successfully!`);
    console.log(`📊 Results:`);
    console.log(`   📍 Intersection points: ${intersections.length}`);
    console.log(`   ✂️ Trail segments created: ${segmentsCreated}`);
    console.log(`   🔗 Nodes created: ${nodesCreated}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the split
splitTrailsAtIntersections();
