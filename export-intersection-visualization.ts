#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';
import * as fs from 'fs';

interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'LineString' | 'Polygon';
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, any>;
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function exportIntersectionVisualization() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node export-intersection-visualization.ts <schema>');
    process.exit(1);
  }

  console.log(`🗺️ Exporting intersection visualization for schema: ${schema}`);

  // Connect to database
  const dbConfig = getDatabasePoolConfig();
  const pool = new Pool(dbConfig);

  try {
    console.log('✅ Connected to database');

    const features: GeoJSONFeature[] = [];

    // 1. Export all trails (including split segments)
    console.log('🏔️ Exporting trails...');
    const trailsQuery = `
      SELECT 
        app_uuid,
        original_trail_uuid,
        name,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        ST_AsGeoJSON(geometry, 6, 0) as geojson,
        CASE 
          WHEN original_trail_uuid IS NOT NULL THEN 'split_segment'
          ELSE 'original_trail'
        END as trail_status
      FROM ${schema}.trails
      WHERE geometry IS NOT NULL
      ORDER BY name, original_trail_uuid, length_km DESC
    `;

    const trailsResult = await pool.query(trailsQuery);
    console.log(`   Found ${trailsResult.rows.length} trails`);

    for (const trail of trailsResult.rows) {
      const geometry = JSON.parse(trail.geojson);
      
      // Color coding for visualization
      let color = '#228B22'; // Default green
      let strokeWidth = 2;
      
      if (trail.trail_status === 'split_segment') {
        if (trail.name?.toLowerCase().includes('flatiron')) {
          color = '#FF4500'; // Orange for Flatiron split segments
          strokeWidth = 3;
        } else {
          color = '#4169E1'; // Blue for other split segments
          strokeWidth = 2;
        }
      } else if (trail.name?.toLowerCase().includes('saddle rock')) {
        color = '#FFD700'; // Gold for Saddle Rock Trail
        strokeWidth = 3;
      } else if (trail.name?.toLowerCase().includes('flatiron')) {
        color = '#FF6347'; // Tomato for original Flatiron
        strokeWidth = 2;
      }

      const feature: GeoJSONFeature = {
        type: 'Feature',
        geometry: geometry,
        properties: {
          id: trail.app_uuid,
          name: trail.name,
          trail_type: trail.trail_type,
          surface: trail.surface,
          difficulty: trail.difficulty,
          length_km: trail.length_km,
          elevation_gain: trail.elevation_gain,
          elevation_loss: trail.elevation_loss,
          max_elevation: trail.max_elevation,
          min_elevation: trail.min_elevation,
          avg_elevation: trail.avg_elevation,
          trail_status: trail.trail_status,
          original_trail_uuid: trail.original_trail_uuid,
          // Styling properties for visualization
          stroke: color,
          strokeWidth: strokeWidth,
          strokeOpacity: 0.8,
          fill: color,
          fillOpacity: 0.6
        }
      };

      features.push(feature);
    }

    // 2. Export intersection points
    console.log('📍 Exporting intersection points...');
    const intersectionQuery = `
      SELECT 
        id,
        ST_AsText(intersection_point) as point_text,
        ST_AsGeoJSON(intersection_point, 6, 0) as geojson,
        connected_trail_ids,
        connected_trail_names,
        node_type,
        distance_meters
      FROM ${schema}.intersection_points
      WHERE intersection_point IS NOT NULL
    `;

    const intersectionResult = await pool.query(intersectionQuery);
    console.log(`   Found ${intersectionResult.rows.length} intersection points`);

    for (const intersection of intersectionResult.rows) {
      const geometry = JSON.parse(intersection.geojson);
      
      const feature: GeoJSONFeature = {
        type: 'Feature',
        geometry: geometry,
        properties: {
          id: intersection.id,
          node_type: intersection.node_type,
          connected_trail_ids: intersection.connected_trail_ids,
          connected_trail_names: intersection.connected_trail_names,
          distance_meters: intersection.distance_meters,
          // Styling properties
          markerColor: '#FF0000',
          markerSize: 'medium',
          markerSymbol: 'circle'
        }
      };

      features.push(feature);
    }

    // 3. Export routing nodes (if they exist)
    console.log('🔗 Exporting routing nodes...');
    const routingNodesQuery = `
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        elevation,
        node_type,
        connected_trails,
        ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326), 6, 0) as geojson
      FROM ${schema}.routing_nodes
      WHERE lat IS NOT NULL AND lng IS NOT NULL
    `;

    const routingNodesResult = await pool.query(routingNodesQuery);
    console.log(`   Found ${routingNodesResult.rows.length} routing nodes`);

    for (const node of routingNodesResult.rows) {
      const geometry = JSON.parse(node.geojson);
      
      // Color coding for node types
      let color = '#000000';
      let size = 'small';
      
      if (node.node_type === 'degree3_intersection') {
        color = '#FF0000';
        size = 'large';
      } else if (node.node_type === 'intersection') {
        color = '#FFA500';
        size = 'medium';
      }

      const feature: GeoJSONFeature = {
        type: 'Feature',
        geometry: geometry,
        properties: {
          id: node.id,
          node_uuid: node.node_uuid,
          node_type: node.node_type,
          connected_trails: node.connected_trails,
          elevation: node.elevation,
          // Styling properties
          markerColor: color,
          markerSize: size,
          markerSymbol: 'circle'
        }
      };

      features.push(feature);
    }

    // 4. Export the specific Y-intersection point we processed
    console.log('🎯 Exporting processed Y-intersection point...');
    const yIntersectionFeature: GeoJSONFeature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [-105.29508127646427, 39.98999302987391, 2176.841796875]
      },
      properties: {
        id: 'y_intersection_processed',
        name: 'Processed Y-Intersection',
        description: 'New Saddle Rock Trail start point snapped to 1st/2nd Flatiron',
        distance_from_original: 0.095,
        line_location_percent: 2.7,
        // Styling properties
        markerColor: '#00FF00',
        markerSize: 'large',
        markerSymbol: 'star'
      }
    };

    features.push(yIntersectionFeature);

    // 5. Export the original Y-intersection point (before snapping)
    console.log('📍 Exporting original Y-intersection point...');
    const originalYIntersectionFeature: GeoJSONFeature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [-105.295095, 39.990015, 2176.841796875]
      },
      properties: {
        id: 'y_intersection_original',
        name: 'Original Y-Intersection Point',
        description: 'Original Y-intersection point before snapping',
        // Styling properties
        markerColor: '#FFFF00',
        markerSize: 'medium',
        markerSymbol: 'triangle'
      }
    };

    features.push(originalYIntersectionFeature);

    // Create the GeoJSON collection
    const geojson: GeoJSONCollection = {
      type: 'FeatureCollection',
      features: features
    };

    // Write to file
    const outputFile = `test-output/intersection-visualization-${schema}-${new Date().toISOString().replace(/[:.]/g, '-')}.geojson`;
    fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));

    console.log('\n✅ Export complete!');
    console.log(`📄 Output file: ${outputFile}`);
    console.log(`📊 Total features: ${features.length}`);
    
    // Show feature breakdown
    const trailFeatures = features.filter(f => f.geometry.type === 'LineString');
    const pointFeatures = features.filter(f => f.geometry.type === 'Point');
    const splitSegments = features.filter(f => f.properties.trail_status === 'split_segment');
    const flatironSegments = features.filter(f => f.properties.name?.toLowerCase().includes('flatiron') && f.properties.trail_status === 'split_segment');
    
    console.log(`🏔️ Trails: ${trailFeatures.length}`);
    console.log(`📍 Points: ${pointFeatures.length}`);
    console.log(`✂️ Split segments: ${splitSegments.length}`);
    console.log(`🏔️ Flatiron split segments: ${flatironSegments.length}`);

    // Show the specific segments we created
    console.log('\n🔍 Flatiron split segments:');
    flatironSegments.forEach((segment, index) => {
      console.log(`   ${index + 1}. ${segment.properties.name} (${segment.properties.length_km.toFixed(3)}km) - ${segment.properties.id}`);
    });

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
}

exportIntersectionVisualization().catch(console.error);
