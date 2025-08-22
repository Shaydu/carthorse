import { Command } from 'commander';
import * as fs from 'fs';
import { Pool } from 'pg';

interface GeoJSONFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: number[] | number[][]; // Allow both Point and LineString coordinates
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
  midpoint: { lng: number; lat: number; elevation: number };
  distance: number;
}

class EndpointSnapper {
  private pgClient: Pool;
  private stagingSchema: string;

  constructor(pgClient: Pool, stagingSchema: string) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
  }

  /**
   * Find the nearest trail to a given endpoint and snap the endpoint to its closest point
   */
  async snapEndpointToNearestTrail(
    endpointLng: number, 
    endpointLat: number, 
    endpointElevation: number,
    toleranceMeters: number = 50
  ): Promise<{ success: boolean; snappedTrail?: TrailSegment; error?: string }> {
    try {
      console.log(`🔍 Finding nearest trail to endpoint at (${endpointLng}, ${endpointLat})...`);

      // Find the nearest trail within tolerance
      const nearestTrailQuery = `
        WITH endpoint_point AS (
          SELECT ST_SetSRID(ST_MakePoint($1, $2, $3), 4326) as endpoint_geom
        ),
        nearby_trails AS (
          SELECT 
            t.id,
            t.app_uuid,
            t.name,
            t.geometry,
            t.length_km,
            ST_Distance(t.geometry::geography, ep.endpoint_geom::geography) as distance_meters,
            ST_ClosestPoint(t.geometry, ep.endpoint_geom) as closest_point,
            ST_LineLocatePoint(t.geometry, ST_ClosestPoint(t.geometry, ep.endpoint_geom)) as split_ratio
          FROM ${this.stagingSchema}.trails t, endpoint_point ep
          WHERE ST_DWithin(t.geometry::geography, ep.endpoint_geom::geography, $4)
            AND ST_Length(t.geometry::geography) > 10  -- Minimum 10m trail
          ORDER BY ST_Distance(t.geometry::geography, ep.endpoint_geom::geography)
          LIMIT 1
        )
        SELECT 
          id,
          app_uuid,
          name,
          ST_AsText(geometry) as geometry_wkt,
          length_km,
          distance_meters,
          ST_AsText(closest_point) as closest_point_wkt,
          ST_X(closest_point) as closest_lng,
          ST_Y(closest_point) as closest_lat,
          ST_Z(closest_point) as closest_elevation,
          split_ratio
        FROM nearby_trails
      `;

      const result = await this.pgClient.query(nearestTrailQuery, [
        endpointLng, 
        endpointLat, 
        endpointElevation, 
        toleranceMeters
      ]);

      if (result.rows.length === 0) {
        return { 
          success: false, 
          error: `No trails found within ${toleranceMeters}m of endpoint` 
        };
      }

      const trail = result.rows[0];
      console.log(`📍 Found nearest trail: "${trail.name}" (${trail.distance_meters.toFixed(1)}m away)`);
      console.log(`   Split ratio: ${(trail.split_ratio * 100).toFixed(1)}% along trail`);

      // Check if endpoint is close enough to warrant splitting
      const proximityThreshold = 10; // Only split if endpoint is within 10m of trail
      if (trail.distance_meters > proximityThreshold) {
        console.log(`⚠️ Endpoint too far from trail (${trail.distance_meters.toFixed(1)}m), using closest point without splitting`);
        return {
          success: true,
          snappedTrail: {
            id: trail.id,
            app_uuid: trail.app_uuid,
            name: trail.name,
            geometry: trail.geometry_wkt,
            length_km: trail.length_km,
            midpoint: {
              lng: trail.closest_lng,
              lat: trail.closest_lat,
              elevation: trail.closest_elevation || endpointElevation
            },
            distance: trail.distance_meters
          }
        };
      }

      // Always attempt to split the trail at the closest point
      console.log(`✂️ Will split trail at ${(trail.split_ratio * 100).toFixed(1)}% along trail`)

      // Split the trail at the closest point
      const splitResult = await this.splitTrailAtClosestPoint(trail);
      
      if (!splitResult.success) {
        console.log(`⚠️ Failed to split trail, using closest point without splitting: ${splitResult.error}`);
        return {
          success: true,
          snappedTrail: {
            id: trail.id,
            app_uuid: trail.app_uuid,
            name: trail.name,
            geometry: trail.geometry_wkt,
            length_km: trail.length_km,
            midpoint: {
              lng: trail.closest_lng,
              lat: trail.closest_lat,
              elevation: trail.closest_elevation || endpointElevation
            },
            distance: trail.distance_meters
          }
        };
      }

      return {
        success: true,
        snappedTrail: {
          id: trail.id,
          app_uuid: trail.app_uuid,
          name: trail.name,
          geometry: trail.geometry_wkt,
          length_km: trail.length_km,
          midpoint: {
            lng: trail.closest_lng,
            lat: trail.closest_lat,
            elevation: trail.closest_elevation || endpointElevation
          },
          distance: trail.distance_meters
        }
      };

    } catch (error) {
      console.error('❌ Error snapping endpoint:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Split a trail at its closest point to the endpoint
   */
  private async splitTrailAtClosestPoint(trail: any): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`✂️ Splitting trail "${trail.name}" at closest point...`);

      const splitQuery = `
        WITH trail_geometry AS (
          SELECT ST_GeomFromText($1, 4326) as geom
        ),
        split_result AS (
          SELECT (ST_Dump(ST_Split(geom, ST_GeomFromText($2, 4326)))).geom as split_geom
          FROM trail_geometry
        ),
        valid_segments AS (
          SELECT 
            split_geom,
            ST_Length(split_geom::geography) / 1000.0 as length_km
          FROM split_result
          WHERE ST_GeometryType(split_geom) = 'ST_LineString'
            AND ST_Length(split_geom::geography) > 5  -- Minimum 5m segments
        )
        SELECT 
          ST_AsText(split_geom) as geometry_wkt,
          length_km
        FROM valid_segments
        ORDER BY length_km DESC
      `;

      const splitResult = await this.pgClient.query(splitQuery, [trail.geometry_wkt, trail.closest_point_wkt]);

      if (splitResult.rows.length < 2) {
        return { 
          success: false, 
          error: 'Trail split did not produce 2 valid segments' 
        };
      }

      // Delete the original trail
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [trail.app_uuid]);

      // Insert the split segments
      for (let i = 0; i < splitResult.rows.length; i++) {
        const segment = splitResult.rows[i];
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
            trail_type, surface, difficulty, source
          )
          VALUES (
            gen_random_uuid(),
            $1,
            ST_GeomFromText($2, 4326),
            $3,
            0,
            0,
            'trail',
            'unknown',
            'unknown',
            'split'
          )
        `, [
          `${trail.name} Segment ${i + 1}`,
          segment.geometry_wkt,
          segment.length_km
        ]);
      }

      console.log(`✅ Successfully split trail into ${splitResult.rows.length} segments`);
      return { success: true };

    } catch (error) {
      console.error('❌ Error splitting trail:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Update the endpoint coordinates in the GeoJSON file
   */
  async updateEndpointInGeoJSON(
    inputFile: string, 
    outputFile: string, 
    nodeUuid: string, 
    newLng: number, 
    newLat: number, 
    newElevation: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`📝 Updating endpoint ${nodeUuid} in GeoJSON...`);

      // Read input file
      const inputData = fs.readFileSync(inputFile, 'utf8');
      const geojson: GeoJSONCollection = JSON.parse(inputData);

      // Find and update the endpoint
      let endpointFound = false;
      geojson.features = geojson.features.map(feature => {
        if (feature.properties.node_uuid === nodeUuid) {
          endpointFound = true;
          return {
            ...feature,
            geometry: {
              ...feature.geometry,
              coordinates: [newLng, newLat, newElevation] as number[]
            },
            properties: {
              ...feature.properties,
              lng: newLng,
              lat: newLat,
              elevation: newElevation,
              node_type: 'intersection',
              color: '#FF6B35',
              stroke: '#FF6B35',
              strokeWidth: 4,
              radius: 6
            }
          };
        }
        return feature;
      });

      if (!endpointFound) {
        return { 
          success: false, 
          error: `Endpoint with UUID ${nodeUuid} not found in GeoJSON` 
        };
      }

      // Write output file
      fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
      
      console.log(`✅ Updated endpoint ${nodeUuid} to (${newLng}, ${newLat}, ${newElevation})`);
      return { success: true };

    } catch (error) {
      console.error('❌ Error updating GeoJSON:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }
}

const program = new Command();

program
  .name('snap-endpoint-to-trail')
  .description('Snap a specific endpoint to the midpoint of the nearest trail')
  .argument('<input-file>', 'Input GeoJSON file path')
  .argument('<output-file>', 'Output GeoJSON file path')
  .argument('<node-uuid>', 'UUID of the endpoint to snap')
  .option('-t, --tolerance <meters>', 'Tolerance for finding nearby trails in meters', '50')
  .option('-s, --staging-schema <schema>', 'Staging schema to use', 'carthorse_1755862988734')
  .option('--dry-run', 'Show what would be done without making changes')
  .parse();

async function snapEndpointToTrail() {
  const options = program.opts();
  const [inputFile, outputFile, nodeUuid] = program.args;
  
  console.log('🔧 Snapping endpoint to nearest trail...');
  console.log(`   Input: ${inputFile}`);
  console.log(`   Output: ${outputFile}`);
  console.log(`   Node UUID: ${nodeUuid}`);
  console.log(`   Tolerance: ${options.tolerance}m`);
  console.log(`   Staging Schema: ${options.stagingSchema}`);
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
    // Read the input GeoJSON to find the endpoint coordinates
    const inputData = fs.readFileSync(inputFile, 'utf8');
    const geojson: GeoJSONCollection = JSON.parse(inputData);

    // Find the endpoint
    const endpoint = geojson.features.find(f => 
      f.properties.node_uuid === nodeUuid && f.geometry.type === 'Point'
    );

    if (!endpoint) {
      console.error(`❌ Endpoint with UUID ${nodeUuid} not found in GeoJSON`);
      process.exit(1);
    }

    const [lng, lat, elevation] = endpoint.geometry.coordinates as number[];
    console.log(`📍 Found endpoint at (${lng}, ${lat}, ${elevation})`);

    if (options.dryRun) {
      console.log('🔍 DRY RUN: Would snap endpoint to nearest trail');
      console.log(`   Current position: (${lng}, ${lat}, ${elevation})`);
      return;
    }

    // Create snapper and find nearest trail
    const snapper = new EndpointSnapper(pool, options.stagingSchema);
    const snapResult = await snapper.snapEndpointToNearestTrail(
      lng, lat, elevation, parseFloat(options.tolerance)
    );

    if (!snapResult.success) {
      console.error(`❌ Failed to snap endpoint: ${snapResult.error}`);
      process.exit(1);
    }

    const { snappedTrail } = snapResult;
    console.log(`✅ Successfully snapped endpoint to trail "${snappedTrail!.name}"`);
    console.log(`   New position: (${snappedTrail!.midpoint.lng}, ${snappedTrail!.midpoint.lat}, ${snappedTrail!.midpoint.elevation})`);

    // Update the GeoJSON file
    const updateResult = await snapper.updateEndpointInGeoJSON(
      inputFile,
      outputFile,
      nodeUuid,
      snappedTrail!.midpoint.lng,
      snappedTrail!.midpoint.lat,
      snappedTrail!.midpoint.elevation
    );

    if (!updateResult.success) {
      console.error(`❌ Failed to update GeoJSON: ${updateResult.error}`);
      process.exit(1);
    }

    console.log(`✅ Endpoint snapping completed successfully!`);
    console.log(`📊 Output file: ${outputFile}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the snap
snapEndpointToTrail();
