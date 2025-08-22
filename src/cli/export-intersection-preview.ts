#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as yargs from 'yargs';
import * as fs from 'fs';

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
  snapped_point?: any; // The actual point on the visited trail where we'll split
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString' | 'Point';
    coordinates: number[][] | number[];
  };
  properties: {
    id: string;
    name: string;
    type: 'trail' | 'intersection' | 'snapped_point' | 'split_segment' | 'existing_node';
    intersection_type?: 'T' | 'Y';
    distance_meters?: number;
    visitor_trail?: string;
    visited_trail?: string;
    node_type?: string;
    connected_trails?: string;
    color?: string;
    stroke?: string;
    strokeWidth?: number;
    fillOpacity?: number;
    radius?: number;
    segment_index?: number; // Added for split segments
  };
}

class IntersectionPreviewExporter {
  private pgClient: Pool;
  private stagingSchema: string;
  private tolerance: number;

  constructor(pgClient: Pool, stagingSchema: string, tolerance: number = 8) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
    this.tolerance = tolerance;
  }

  async findIntersections(): Promise<Intersection[]> {
    console.log('🔍 Finding T/Y intersections...');
    
    const query = `
      WITH trail_endpoints AS (
        SELECT 
          id as trail_id,
          app_uuid as trail_uuid,
          name as trail_name,
          'start' as endpoint,
          ST_AsText(ST_StartPoint(geometry)) as endpoint_geom,
          geometry as trail_geom
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL
        UNION ALL
        SELECT 
          id as trail_id,
          app_uuid as trail_uuid,
          name as trail_name,
          'end' as endpoint,
          ST_AsText(ST_EndPoint(geometry)) as endpoint_geom,
          geometry as trail_geom
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL
      ),
      intersections AS (
        SELECT 
          te1.trail_id as visitor_trail_id,
          te1.trail_uuid as visitor_trail_uuid,
          te1.trail_name as visitor_trail_name,
          te1.endpoint as visitor_endpoint,
          te2.id as visited_trail_id,
          te2.app_uuid as visited_trail_uuid,
          te2.name as visited_trail_name,
          te1.endpoint_geom as intersection_point,
          ST_Distance(ST_GeomFromText(te1.endpoint_geom, 4326)::geography, te2.geometry::geography) as distance_meters,
          CASE 
            WHEN te1.trail_id = te2.id THEN 'Y'  -- Same trail, different endpoints
            ELSE 'T'  -- Different trails
          END as intersection_type
        FROM trail_endpoints te1
        JOIN ${this.stagingSchema}.trails te2 ON te1.trail_id != te2.id
        WHERE ST_DWithin(ST_GeomFromText(te1.endpoint_geom, 4326)::geography, te2.geometry::geography, $1)
          AND NOT ST_Touches(ST_GeomFromText(te1.endpoint_geom, 4326), te2.geometry)
          AND ST_Distance(ST_GeomFromText(te1.endpoint_geom, 4326)::geography, te2.geometry::geography) <= $1
      )
      SELECT * FROM intersections
      ORDER BY distance_meters ASC;
    `;

    const result = await this.pgClient.query(query, [this.tolerance]);
    return result.rows;
  }

  async snapEndpointsToTrails(intersections: Intersection[]): Promise<Intersection[]> {
    console.log('🎯 Snapping endpoints to trails...');
    
    const snappedIntersections: Intersection[] = [];
    
    for (const intersection of intersections) {
      try {
        // Find the closest point on the visited trail to the visitor's endpoint
        const snapQuery = `
          SELECT 
            ST_AsText(ST_ClosestPoint(t.geometry, ST_GeomFromText($1, 4326))) as snapped_point,
            ST_LineLocatePoint(t.geometry, ST_GeomFromText($1, 4326)) as split_ratio,
            ST_Distance(t.geometry::geography, ST_GeomFromText($1, 4326)::geography) as distance_meters
          FROM ${this.stagingSchema}.trails t
          WHERE t.id = $2
        `;
        
        const snapResult = await this.pgClient.query(snapQuery, [
          intersection.intersection_point,
          intersection.visited_trail_id
        ]);
        
        if (snapResult.rows.length > 0) {
          const snapped = {
            ...intersection,
            snapped_point: snapResult.rows[0].snapped_point,
            distance_meters: snapResult.rows[0].distance_meters
          };
          snappedIntersections.push(snapped);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to snap intersection for ${intersection.visitor_trail_name} -> ${intersection.visited_trail_name}: ${(error as Error).message}`);
      }
    }
    
    return snappedIntersections;
  }

  async exportGeoJSON(intersections: Intersection[], outputPath: string): Promise<void> {
    console.log('📤 Exporting GeoJSON preview...');
    
    const features: GeoJSONFeature[] = [];
    
    // Add all trail geometries
    const trailsQuery = `
      SELECT id, app_uuid, name, ST_AsText(geometry) as geometry_wkt
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL
    `;
    
    const trailsResult = await this.pgClient.query(trailsQuery);
    
    for (const trail of trailsResult.rows) {
      try {
        const coordinates = this.parseWKT(trail.geometry_wkt);
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coordinates
          },
          properties: {
            id: trail.app_uuid,
            name: trail.name,
            type: 'trail',
            color: '#0000FF',
            stroke: '#0000FF',
            strokeWidth: 2
          }
        });
      } catch (error) {
        console.warn(`⚠️ Skipping trail ${trail.name}: ${(error as Error).message}`);
      }
    }
    
    // Add existing routing nodes (existing detected nodes)
    const nodesQuery = `
      SELECT id, node_uuid, lat, lng, node_type, connected_trails
      FROM ${this.stagingSchema}.routing_nodes
      WHERE lat IS NOT NULL AND lng IS NOT NULL
    `;
    
    const nodesResult = await this.pgClient.query(nodesQuery);
    
    for (const node of nodesResult.rows) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [node.lng, node.lat]
        },
        properties: {
          id: `existing-node-${node.id}`,
          name: `Existing Node ${node.id} (${node.node_type})`,
          type: 'existing_node',
          node_type: node.node_type,
          connected_trails: node.connected_trails,
          color: '#0066CC', // Darker blue for existing nodes
          stroke: '#0066CC',
          strokeWidth: 2,
          fillOpacity: 0.9,
          radius: 5
        }
      });
    }
    
    // Add intersection points (original endpoints)
    for (const intersection of intersections) {
      try {
        const coordinates = this.parseWKT(intersection.intersection_point);
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: coordinates
          },
          properties: {
            id: `intersection-${intersection.visitor_trail_id}-${intersection.visited_trail_id}`,
            name: `${intersection.visitor_trail_name} -> ${intersection.visited_trail_name}`,
            type: 'intersection',
            intersection_type: intersection.intersection_type,
            distance_meters: intersection.distance_meters,
            visitor_trail: intersection.visitor_trail_name,
            visited_trail: intersection.visited_trail_name,
            color: '#800080', // Purple
            stroke: '#800080',
            strokeWidth: 2,
            fillOpacity: 0.8,
            radius: 4
          }
        });
      } catch (error) {
        console.warn(`⚠️ Skipping intersection ${intersection.visitor_trail_name}: ${(error as Error).message}`);
      }
    }
    
    // Add snapped points (where trails would actually be split)
    for (const intersection of intersections) {
      if (intersection.snapped_point) {
        try {
          const coordinates = this.parseWKT(intersection.snapped_point);
          features.push({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: coordinates
            },
            properties: {
              id: `snapped-${intersection.visitor_trail_id}-${intersection.visited_trail_id}`,
              name: `Split point: ${intersection.visited_trail_name}`,
              type: 'snapped_point',
              intersection_type: intersection.intersection_type,
              distance_meters: intersection.distance_meters,
              visitor_trail: intersection.visitor_trail_name,
              visited_trail: intersection.visited_trail_name,
              color: '#FF0000', // Red
              stroke: '#FF0000',
              strokeWidth: 2,
              fillOpacity: 0.8,
              radius: 6
            }
          });
        } catch (error) {
          console.warn(`⚠️ Skipping snapped point for ${intersection.visitor_trail_name}: ${(error as Error).message}`);
        }
      }
    }
    
    // Add snapped trail segments (what the trails would look like after splitting)
    for (const intersection of intersections) {
      if (intersection.snapped_point) {
        try {
          const splitSegments = await this.getSplitSegments(intersection);
          
          for (let i = 0; i < splitSegments.length; i++) {
            const segment = splitSegments[i];
            const coordinates = this.parseWKT(segment.geometry_wkt);
            features.push({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: coordinates
              },
              properties: {
                id: `split-segment-${intersection.visited_trail_id}-${i}`,
                name: `Split segment ${i + 1}: ${intersection.visited_trail_name}`,
                type: 'split_segment',
                intersection_type: intersection.intersection_type,
                distance_meters: intersection.distance_meters,
                visitor_trail: intersection.visitor_trail_name,
                visited_trail: intersection.visited_trail_name,
                segment_index: i + 1,
                color: '#00FF00', // Green
                stroke: '#00FF00',
                strokeWidth: 3
              }
            });
          }
        } catch (error) {
          console.warn(`⚠️ Failed to get split segments for ${intersection.visited_trail_name}: ${(error as Error).message}`);
        }
      }
    }
    
    const geojson = {
      type: 'FeatureCollection',
      features: features
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(`✅ Exported ${features.length} features to ${outputPath}`);
    console.log(`   - ${trailsResult.rows.length} trails (blue)`);
    console.log(`   - ${nodesResult.rows.length} existing nodes (darker blue)`);
    console.log(`   - ${intersections.length} intersection points (purple)`);
    console.log(`   - ${intersections.filter(i => i.snapped_point).length} snapped points (red)`);
    console.log(`   - ${features.filter(f => f.properties.type === 'split_segment').length} split segments (green)`);
  }

  private async getSplitSegments(intersection: Intersection): Promise<any[]> {
    const splitQuery = `
      WITH trail_geom AS (
        SELECT geometry as geom FROM ${this.stagingSchema}.trails WHERE id = $1
      ),
      intersection_point AS (
        SELECT ST_GeomFromText($2, 4326) as point_geom
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
        WHERE distance_meters <= $3
          AND split_ratio > 0.01
          AND split_ratio < 0.99
      ),
      split_segments AS (
        SELECT
          trail_geom,
          closest_point,
          split_ratio,
          ST_LineSubstring(trail_geom, 0, split_ratio) as segment1,
          ST_LineSubstring(trail_geom, split_ratio, 1) as segment2
        FROM valid_split
      ),
      all_segments AS (
        SELECT 
          ST_AsText(segment1) as geometry_wkt,
          ST_Length(segment1::geography) / 1000.0 as length_km,
          1 as segment_index
        FROM split_segments
        WHERE ST_GeometryType(segment1) = 'ST_LineString'
          AND ST_Length(segment1::geography) > 5
        UNION ALL
        SELECT 
          ST_AsText(segment2) as geometry_wkt,
          ST_Length(segment2::geography) / 1000.0 as length_km,
          2 as segment_index
        FROM split_segments
        WHERE ST_GeometryType(segment2) = 'ST_LineString'
          AND ST_Length(segment2::geography) > 5
      )
      SELECT geometry_wkt, length_km, segment_index
      FROM all_segments
      ORDER BY segment_index, length_km DESC;
    `;
    
    const result = await this.pgClient.query(splitQuery, [
      intersection.visited_trail_id,
      intersection.snapped_point,
      this.tolerance
    ]);
    
    return result.rows;
  }

  private parseWKT(wkt: string): number[] | number[][] {
    try {
      // Enhanced WKT parser for POINT, LINESTRING, and their 3D variants
      // Handle both text WKT and binary WKT (hex-encoded)
      
      // If it's binary WKT (starts with hex), we need to convert it to text first
      if (wkt.startsWith('0101')) {
        // This is binary WKT - we need to use PostGIS to convert it
        throw new Error('Binary WKT detected - need to use ST_AsText() in SQL');
      }
      
      if (wkt.startsWith('POINT')) {
        const coords = wkt.match(/\(([^)]+)\)/)?.[1];
        if (!coords) throw new Error('Invalid POINT WKT');
        const numbers = coords.split(' ').map(Number);
        // Return lng, lat for GeoJSON (drop Z coordinate)
        return [numbers[0], numbers[1]]; // lng, lat order for GeoJSON
      } else if (wkt.startsWith('LINESTRING')) {
        const coords = wkt.match(/\(([^)]+)\)/)?.[1];
        if (!coords) throw new Error('Invalid LINESTRING WKT');
        return coords.split(',').map(pair => {
          const numbers = pair.trim().split(' ').map(Number);
          // Return lng, lat for GeoJSON (drop Z coordinate)
          return [numbers[0], numbers[1]]; // lng, lat order for GeoJSON
        });
      }
      throw new Error(`Unsupported WKT type: ${wkt}`);
    } catch (error) {
      console.error(`Failed to parse WKT: ${wkt.substring(0, 100)}...`);
      throw error;
    }
  }
}

async function findLatestStagingSchema(pgClient: Pool): Promise<string> {
  const result = await pgClient.query(`
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name LIKE 'carthorse_%' 
    ORDER BY schema_name DESC 
    LIMIT 1
  `);
  
  if (result.rows.length === 0) {
    throw new Error('No staging schema found! Please run the orchestrator first to create a staging environment.');
  }
  
  return result.rows[0].schema_name;
}

async function main() {
  const argv = await yargs
    .option('staging-schema', {
      type: 'string',
      description: 'Staging schema name (auto-detected if not provided)',
      demandOption: false
    })
    .option('output', {
      type: 'string',
      description: 'Output GeoJSON file path',
      demandOption: true
    })
    .option('tolerance', {
      type: 'number',
      description: 'Distance tolerance in meters for detecting intersections',
      default: 8
    })
    .help()
    .argv;

  const pgClient = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'trail_master_db',
    user: process.env.DB_USER || 'carthorse',
    password: process.env.DB_PASSWORD
  });

  try {
    // Auto-detect staging schema if not provided
    let stagingSchema = argv.stagingSchema;
    if (!stagingSchema) {
      console.log('🔍 Auto-detecting latest staging schema...');
      stagingSchema = await findLatestStagingSchema(pgClient);
      console.log(`✅ Using staging schema: ${stagingSchema}`);
    }
    
    const exporter = new IntersectionPreviewExporter(pgClient, stagingSchema, argv.tolerance);
    
    // Find intersections
    const intersections = await exporter.findIntersections();
    console.log(`Found ${intersections.length} T/Y intersections`);
    
    // Snap endpoints to trails
    const snappedIntersections = await exporter.snapEndpointsToTrails(intersections);
    console.log(`Successfully snapped ${snappedIntersections.length} endpoints to trails`);
    
    // Export preview
    await exporter.exportGeoJSON(snappedIntersections, argv.output);
    
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
