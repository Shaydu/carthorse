import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';
import { runConnectorEdgeSpanning } from '../connector-edge-spanning';
import { runConnectorEdgeCollapse } from '../connector-edge-collapse';
import { runConnectorEndpointWeld } from '../connector-endpoint-weld';

export class EndpointSnapAndSplitStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const { stagingSchema, tolerances } = config;
    
    try {
      console.log('🔄 Using endpoint-snap-and-split strategy for trail network creation...');

      // Check if input data exists
      const inputCheck = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.trails WHERE geometry IS NOT NULL
      `);
      console.log(`📊 Input trails table contains ${inputCheck.rows[0].count} rows with geometry`);
      
      if (inputCheck.rows[0].count === 0) {
        throw new Error('No input data found in trails table');
      }

      // Step 1: Create initial network using PostGIS node strategy
      console.log('📍 Step 1: Creating initial network with vertex snapping...');
      await this.createInitialNetwork(pgClient, stagingSchema, tolerances);

      // Step 2: Identify degree 1 endpoints that need connection
      console.log('🔍 Step 2: Identifying degree 1 endpoints...');
      const degree1Endpoints = await this.identifyDegree1Endpoints(pgClient, stagingSchema);
      console.log(`📍 Found ${degree1Endpoints.length} degree 1 endpoints`);

      // Step 3: Find nearby trail paths for each degree 1 endpoint
      console.log('🔗 Step 3: Finding nearby trail paths for endpoints...');
      const endpointConnections = await this.findEndpointConnections(pgClient, stagingSchema, degree1Endpoints, tolerances);
      console.log(`🔗 Found ${endpointConnections.length} potential endpoint connections`);

      // Step 4: Split trails at connection points and create new edges
      console.log('✂️ Step 4: Splitting trails at connection points...');
      const connectionSplitResult = await this.splitTrailsAtConnections(pgClient, stagingSchema, endpointConnections);
      console.log(`✂️ Split ${connectionSplitResult.trailsSplit} trails at connection points`);

      // Step 5: Create final routing network
      console.log('🛤️ Step 5: Creating final routing network...');
      const finalResult = await this.createFinalRoutingNetwork(pgClient, stagingSchema);

      // Step 6: Fix gaps in edge network
      console.log('🔧 Step 6: Fixing gaps in edge network...');
      // TODO: Fix gap fixing - routing_nodes table doesn't exist yet
      // const gapFixResult = await this.fixGapsInEdgeNetwork(pgClient, stagingSchema, tolerances);
      // console.log(`🔧 Fixed ${gapFixResult.gapsFixed} gaps in edge network`);
      console.log(`🔧 Skipping gap fixing (routing_nodes table not created yet)`);

      // Step 7: Create connector edges to ensure network connectivity
      console.log('🔗 Step 7: Creating connector edges for network connectivity...');
      const connectorResult = await runConnectorEdgeSpanning(pgClient, stagingSchema, tolerances.edgeToVertexTolerance);
      console.log(`🔗 Created ${connectorResult.inserted} connector edges`);

      // Step 8: Optimize connector edges (collapse and weld)
      console.log('🔧 Step 8: Optimizing connector edges...');
      const collapseResult = await runConnectorEdgeCollapse(pgClient, stagingSchema);
      console.log(`🔧 Collapsed ${collapseResult.collapsed} connector edges`);
      
      const weldResult = await runConnectorEndpointWeld(pgClient, stagingSchema, tolerances.edgeToVertexTolerance);
      console.log(`🔧 Welded ${weldResult.weldedPairs} endpoint pairs`);

      console.log(`✅ Endpoint-snap-and-split network creation completed successfully!`);
      console.log(`📊 Final network: ${finalResult.nodesCreated} nodes, ${finalResult.edgesCreated} edges`);
      console.log(`🔗 Degree 1 endpoints processed: ${degree1Endpoints.length}`);
      console.log(`✂️ Trails split at connections: ${connectionSplitResult.trailsSplit}`);
      console.log(`🔧 Gaps fixed in edge network: 0 (routing_nodes table not created yet)`);
      
      return {
        success: true,
        stats: {
          nodesCreated: finalResult.nodesCreated,
          edgesCreated: finalResult.edgesCreated,
          isolatedNodes: finalResult.isolatedNodes,
          orphanedEdges: finalResult.orphanedEdges
        }
      };

    } catch (error) {
      console.error('❌ Endpoint-snap-and-split network creation failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error), 
        stats: { nodesCreated: 0, edgesCreated: 0, isolatedNodes: 0, orphanedEdges: 0 } 
      };
    }
  }

  private async createInitialNetwork(pgClient: Pool, stagingSchema: string, tolerances: any): Promise<void> {
    // Use consistent tolerance that matches the grid snap used in trail processing
    const gridSnapTolerance = 0.000045; // 5m grid snap (same as used in trail processing)
    const edgeToVertexTolerance = tolerances.edgeToVertexTolerance || gridSnapTolerance;
    
    await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.all_vertices`);
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.all_vertices AS
      WITH       existing_intersections AS (
        -- Use intersection points created by Layer 1
        SELECT 
          ROW_NUMBER() OVER (ORDER BY point) as vertex_id,
          point as the_geom,
          ST_X(point) as x,
          ST_Y(point) as y,
          node_type,
          ARRAY_LENGTH(connected_trail_ids, 1) as usage_count
        FROM ${stagingSchema}.intersection_points
        WHERE point IS NOT NULL AND ST_IsValid(point)
      ),
      trail_endpoints AS (
        -- Use split points from Layer 1 (where trails were actually split)
        SELECT 
          t.id as trail_id,
          t.app_uuid as trail_uuid,
          t.name as trail_name,
          ST_StartPoint(t.geometry) as start_point,
          ST_EndPoint(t.geometry) as end_point
        FROM ${stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
      ),
      endpoint_points AS (
        SELECT start_point as point FROM trail_endpoints
        UNION ALL
        SELECT end_point as point FROM trail_endpoints
      ),
      unique_endpoints AS (
        SELECT 
          ST_SnapToGrid(point, $1 * 0.1) as the_geom,
          COUNT(*) as usage_count
        FROM endpoint_points
        GROUP BY ST_SnapToGrid(point, $1 * 0.1)
      ),
             endpoint_vertices AS (
         SELECT 
           ROW_NUMBER() OVER (ORDER BY the_geom) + (SELECT COALESCE(MAX(id), 0) FROM ${stagingSchema}.intersection_points) as id,
           the_geom,
           ST_X(the_geom) as x,
           ST_Y(the_geom) as y,
           CASE 
             WHEN usage_count >= 3 THEN 'intersection'
             WHEN usage_count = 2 THEN 'connector'
             ELSE 'endpoint'
           END as node_type,
           usage_count
         FROM unique_endpoints
         WHERE NOT EXISTS (
           SELECT 1 FROM existing_intersections ei 
           WHERE ST_DWithin(ei.the_geom::geometry, unique_endpoints.the_geom::geometry, $1 * 2) -- Use 2x tolerance for better snapping
         )
       ),
      all_vertices_combined AS (
        SELECT * FROM existing_intersections
        UNION ALL
        SELECT * FROM endpoint_vertices
      ),
      snapped_vertices AS (
        -- Snap endpoint vertices to nearby intersection points to ensure alignment
        SELECT 
          av.vertex_id as id,
          CASE 
            WHEN av.node_type = 'intersection' THEN av.the_geom
            ELSE COALESCE(
              (SELECT ei.the_geom 
               FROM existing_intersections ei 
               WHERE ST_DWithin(av.the_geom::geometry, ei.the_geom::geometry, $1)
               ORDER BY ST_Distance(av.the_geom::geometry, ei.the_geom::geometry)
               LIMIT 1),
              av.the_geom
            )
          END as the_geom,
          ST_X(CASE 
            WHEN av.node_type = 'intersection' THEN av.the_geom
            ELSE COALESCE(
              (SELECT ei.the_geom 
               FROM existing_intersections ei 
               WHERE ST_DWithin(av.the_geom::geometry, ei.the_geom::geometry, $1)
               ORDER BY ST_Distance(av.the_geom::geometry, ei.the_geom::geometry)
               LIMIT 1),
              av.the_geom
            )
          END) as x,
          ST_Y(CASE 
            WHEN av.node_type = 'intersection' THEN av.the_geom
            ELSE COALESCE(
              (SELECT ei.the_geom 
               FROM existing_intersections ei 
               WHERE ST_DWithin(av.the_geom::geometry, ei.the_geom::geometry, $1)
               ORDER BY ST_Distance(av.the_geom::geometry, ei.the_geom::geometry)
               LIMIT 1),
              av.the_geom
            )
          END) as y,
          av.node_type,
          av.usage_count
        FROM all_vertices_combined av
      )
      SELECT * FROM snapped_vertices
      ORDER BY id
    `, [edgeToVertexTolerance]);

    // Create initial edges
    await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded`);
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.ways_noded AS
      WITH trail_edges AS (
        SELECT 
          t.id,
          t.app_uuid,
          t.name,
          t.app_uuid as original_trail_uuid,
          t.name as original_trail_name,
          COALESCE(t.length_km, ST_Length(t.geometry::geography)/1000.0) as length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.source as trail_source,
          (SELECT v.id FROM ${stagingSchema}.all_vertices v 
           WHERE ST_DWithin(ST_StartPoint(t.geometry)::geometry, v.the_geom::geometry, $1)
           ORDER BY ST_Distance(ST_StartPoint(t.geometry)::geometry, v.the_geom::geometry) 
           LIMIT 1) as source,
          (SELECT v.id FROM ${stagingSchema}.all_vertices v 
           WHERE ST_DWithin(ST_EndPoint(t.geometry)::geometry, v.the_geom::geometry, $1)
           ORDER BY ST_Distance(ST_EndPoint(t.geometry)::geometry, v.the_geom::geometry) 
           LIMIT 1) as target,
          t.geometry as the_geom
        FROM ${stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
      )
      SELECT 
          id, app_uuid, name, original_trail_uuid, original_trail_name,
          ST_Length(the_geom::geography)/1000.0 as length_km,  -- Recalculate based on snapped geometry
          elevation_gain, elevation_loss, trail_type, surface, difficulty, trail_source,
          source, target, the_geom
      FROM trail_edges
      WHERE source IS NOT NULL AND target IS NOT NULL AND source != target
    `, [edgeToVertexTolerance]);

    // Create vertices table
    await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
      SELECT 
        id,
        the_geom,
        x,
        y,
        0 as cnt,
        0 as chk,
        0 as ein,
        0 as eout
      FROM ${stagingSchema}.all_vertices
      ORDER BY id
    `);

    // Calculate vertex degrees
    await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*)
        FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
  }

  private async identifyDegree1Endpoints(pgClient: Pool, stagingSchema: string): Promise<any[]> {
    const result = await pgClient.query(`
      SELECT 
        v.id as vertex_id,
        v.the_geom as vertex_geom,
        v.x as lng,
        v.y as lat,
        v.cnt as degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE v.cnt = 1
      ORDER BY v.id
    `);
    
    return result.rows;
  }

  private async findEndpointConnections(pgClient: Pool, stagingSchema: string, degree1Endpoints: any[], tolerances: any): Promise<any[]> {
    const connections: any[] = [];
    const connectionTolerance = tolerances.intersectionDetectionTolerance || 0.0001; // ~10 meters

    for (const endpoint of degree1Endpoints) {
      // Find nearby trail paths that this endpoint should connect to
      const nearbyTrails = await pgClient.query(`
        WITH endpoint_buffer AS (
          SELECT ST_Buffer($1::geometry, $2) as buffer_geom
        ),
        nearby_trails AS (
          SELECT 
            t.id as trail_id,
            t.app_uuid as trail_uuid,
            t.name as trail_name,
            t.geometry as trail_geom,
            ST_Distance($1::geometry, t.geometry) as distance,
            ST_ClosestPoint(t.geometry, $1::geometry) as closest_point
          FROM ${stagingSchema}.trails t, endpoint_buffer
          WHERE ST_Intersects(t.geometry, buffer_geom)
            AND ST_Distance($1::geometry, t.geometry) > 0
            AND ST_Distance($1::geometry, t.geometry) <= $2
          ORDER BY ST_Distance($1::geometry, t.geometry)
          LIMIT 3
        )
        SELECT * FROM nearby_trails
      `, [endpoint.vertex_geom, connectionTolerance]);

      for (const trail of nearbyTrails.rows) {
        connections.push({
          endpointId: endpoint.vertex_id,
          endpointGeom: endpoint.vertex_geom,
          trailId: trail.trail_id,
          trailUuid: trail.trail_uuid,
          trailName: trail.trail_name,
          trailGeom: trail.trail_geom,
          distance: trail.distance,
          connectionPoint: trail.closest_point
        });
      }
    }

    return connections;
  }

  private async splitTrailsAtConnections(pgClient: Pool, stagingSchema: string, connections: any[]): Promise<{ trailsSplit: number }> {
    let trailsSplit = 0;
    const processedTrails = new Set();

    for (const connection of connections) {
      if (processedTrails.has(connection.trailId)) {
        continue; // Skip if we've already processed this trail
      }

      try {
        // Split the trail at the connection point
        const splitResult = await pgClient.query(`
          WITH trail_split AS (
            SELECT 
              (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom as split_geom,
              (ST_Dump(ST_Split($1::geometry, $2::geometry))).path[1] as segment_order
            FROM ${stagingSchema}.trails t
            WHERE t.id = $3
          )
          SELECT 
            split_geom,
            segment_order,
            ST_Length(split_geom::geography) / 1000.0 as length_km
          FROM trail_split
          WHERE ST_GeometryType(split_geom) = 'ST_LineString'
            AND ST_Length(split_geom::geography) > 5
          ORDER BY segment_order
        `, [connection.trailGeom, connection.connectionPoint, connection.trailId]);

        if (splitResult.rows.length > 1) {
          // Trail was successfully split - replace original with split segments
          await pgClient.query(`
            DELETE FROM ${stagingSchema}.trails WHERE id = $1
          `, [connection.trailId]);

          for (const segment of splitResult.rows) {
            await pgClient.query(`
              INSERT INTO ${stagingSchema}.trails (
                app_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
                trail_type, surface, difficulty, source
              )
              SELECT 
                gen_random_uuid()::text,
                $1 || ' (segment ' || $2 || ')',
                $3::geometry,
                $4,
                elevation_gain, elevation_loss,
                trail_type, surface, difficulty, source
              FROM ${stagingSchema}.trails
              WHERE id = (SELECT MAX(id) FROM ${stagingSchema}.trails)
            `, [connection.trailName, segment.segment_order, segment.split_geom, segment.length_km]);
          }

          trailsSplit++;
          processedTrails.add(connection.trailId);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to split trail ${connection.trailId}: ${error}`);
      }
    }

    return { trailsSplit };
  }

  private async createFinalRoutingNetwork(pgClient: Pool, stagingSchema: string): Promise<any> {
    // Recreate vertices and edges with the updated trail data
    await this.createInitialNetwork(pgClient, stagingSchema, { intersectionDetectionTolerance: 0.0001 });

    // Create routing_nodes table
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${stagingSchema}.routing_nodes (
        id INTEGER PRIMARY KEY,
        node_uuid TEXT UNIQUE NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        elevation REAL DEFAULT 0,
        node_type TEXT DEFAULT 'intersection',
        connected_trails INTEGER DEFAULT 0
      )
    `);
    
    await pgClient.query(`DELETE FROM ${stagingSchema}.routing_nodes`);
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_nodes (
        id, node_uuid, lat, lng, elevation, node_type, connected_trails
      )
      SELECT 
        v.id,
        'node-' || v.id as node_uuid,
        v.y as lat,
        v.x as lng,
        COALESCE(ST_Z(v.the_geom), 0) as elevation,
        CASE 
          WHEN v.cnt >= 3 THEN 'intersection'
          WHEN v.cnt = 2 THEN 'connector'
          ELSE 'endpoint'
        END as node_type,
        v.cnt as connected_trails
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      ORDER BY v.id
    `);

    // Create routing_edges table
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${stagingSchema}.routing_edges (
        id INTEGER PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        trail_id TEXT,
        trail_name TEXT,
        distance_km DOUBLE PRECISION NOT NULL,
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        geometry GEOMETRY(LINESTRING, 4326),
        FOREIGN KEY (from_node_id) REFERENCES ${stagingSchema}.routing_nodes(id),
        FOREIGN KEY (to_node_id) REFERENCES ${stagingSchema}.routing_nodes(id)
      )
    `);
    
    await pgClient.query(`DELETE FROM ${stagingSchema}.routing_edges`);
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_edges (
        id, from_node_id, to_node_id, trail_id, trail_name, distance_km, 
        elevation_gain, elevation_loss, geometry
      )
      SELECT 
        id,
        source as from_node_id,
        target as to_node_id,
        original_trail_uuid as trail_id,
        original_trail_name as trail_name,
        length_km as distance_km,
        COALESCE(elevation_gain, 0) as elevation_gain,
        COALESCE(elevation_loss, 0) as elevation_loss,
        ST_Force2D(the_geom) as geometry
      FROM ${stagingSchema}.ways_noded
      ORDER BY id
    `);

    // Step 7: Create edge_trail_composition table for export compatibility
    console.log('📋 Step 7: Creating edge_trail_composition table...');
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${stagingSchema}.edge_trail_composition AS
      SELECT 
        e.id as edge_id,
        e.trail_id as trail_uuid,
        t.name as trail_name,
        e.trail_name as edge_trail_name,
        e.distance_km as edge_distance_km,
        e.elevation_gain as edge_elevation_gain,
        e.elevation_loss as edge_elevation_loss,
        e.from_node_id,
        e.to_node_id,
        t.length_km as original_trail_length_km,
        t.elevation_gain as original_trail_elevation_gain,
        t.elevation_loss as original_trail_elevation_loss,
        t.source as original_trail_source,
        1 as segment_sequence,
        100.0 as segment_percentage,
        'original' as composition_type
      FROM ${stagingSchema}.routing_edges e
      LEFT JOIN ${stagingSchema}.trails t ON e.trail_id::text = t.app_uuid::text
      ORDER BY e.id
    `);
    
    const compositionCount = await pgClient.query(`SELECT COUNT(*) as c FROM ${stagingSchema}.edge_trail_composition`);
    console.log(`📋 Created edge_trail_composition table with ${compositionCount.rows[0].c} rows`);

    // Calculate final statistics
    const nodesCreated = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
    const edgesCreated = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
    const isolatedNodes = await pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${stagingSchema}.routing_nodes 
      WHERE connected_trails = 0
    `);
    const orphanedEdges = await pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${stagingSchema}.routing_edges e
      LEFT JOIN ${stagingSchema}.routing_nodes n1 ON e.from_node_id = n1.id
      LEFT JOIN ${stagingSchema}.routing_nodes n2 ON e.to_node_id = n2.id
      WHERE n1.id IS NULL OR n2.id IS NULL
    `);

    return {
      nodesCreated: nodesCreated.rows[0].count,
      edgesCreated: edgesCreated.rows[0].count,
      isolatedNodes: isolatedNodes.rows[0].count,
      orphanedEdges: orphanedEdges.rows[0].count
    };
  }

  private async fixGapsInEdgeNetwork(pgClient: Pool, stagingSchema: string, tolerances: any): Promise<{ gapsFixed: number }> {
    let gapsFixed = 0;
    
    try {
      // Find degree 1 endpoints in the routing network
      const degree1Endpoints = await pgClient.query(`
        SELECT 
          n.id as node_id,
          n.node_uuid,
          n.lat,
          n.lng,
          n.elevation,
          n.geometry
        FROM ${stagingSchema}.routing_nodes n
        WHERE n.connected_trails = 1
      `);

      console.log(`🔍 Found ${degree1Endpoints.rows.length} degree 1 endpoints in routing network`);

      for (const endpoint of degree1Endpoints.rows) {
        // Find nearby edges that this endpoint should connect to
        const nearbyEdges = await pgClient.query(`
          WITH endpoint_point AS (
            SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) as endpoint_geom
          ),
          nearby_edges AS (
            SELECT 
              e.id as edge_id,
              e.from_node_id,
              e.to_node_id,
              e.geometry as edge_geom,
              ST_Distance(e.geometry, ep.endpoint_geom) as distance,
              ST_ClosestPoint(e.geometry, ep.endpoint_geom) as closest_point
            FROM ${stagingSchema}.routing_edges e, endpoint_point ep
            WHERE ST_DWithin(e.geometry, ep.endpoint_geom, $3)
              AND ST_Distance(e.geometry, ep.endpoint_geom) > 0
              AND ST_Distance(e.geometry, ep.endpoint_geom) <= $4
              AND e.from_node_id != $5 AND e.to_node_id != $5
            ORDER BY ST_Distance(e.geometry, ep.endpoint_geom)
            LIMIT 1
          )
          SELECT * FROM nearby_edges
        `, [endpoint.lng, endpoint.lat, tolerances.edgeTolerance * 2, tolerances.edgeTolerance, endpoint.node_id]);

        if (nearbyEdges.rows.length > 0) {
          const edge = nearbyEdges.rows[0];
          console.log(`🔗 Connecting endpoint ${endpoint.node_uuid} to edge ${edge.edge_id} at distance ${edge.distance.toFixed(2)}m`);

          // Split the edge at the closest point
          const splitResult = await pgClient.query(`
            WITH edge_split AS (
              SELECT 
                ST_Split(edge_geom, ST_Buffer(closest_point, 0.0001)) as split_geoms
              FROM (SELECT $1::geometry as edge_geom, $2::geometry as closest_point) as data
            ),
            split_geoms AS (
              SELECT (ST_Dump(split_geoms)).geom as geom
              FROM edge_split
              WHERE ST_GeometryType((ST_Dump(split_geoms)).geom) = 'ST_LineString'
            ),
            split_parts AS (
              SELECT 
                ROW_NUMBER() OVER (ORDER BY ST_Length(geom::geography)) as part_num,
                geom,
                ST_Length(geom::geography) / 1000.0 as distance_km
              FROM split_geoms
            )
            SELECT 
              part_num,
              ST_AsText(geom) as geom_wkt,
              distance_km
            FROM split_parts
            ORDER BY part_num
          `, [edge.edge_geom, edge.closest_point]);

          if (splitResult.rows.length >= 2) {
            // Create new edges from the split
            const [edge1, edge2] = splitResult.rows;
            
            // Insert the split edges
            await pgClient.query(`
              INSERT INTO ${stagingSchema}.routing_edges (
                from_node_id, to_node_id, trail_id, trail_name, distance_km, 
                elevation_gain, elevation_loss, geometry
              )
              VALUES 
                ($1, $2, $3, $4, $5, $6, $7, ST_GeomFromText($8)),
                ($2, $9, $3, $4, $10, $6, $7, ST_GeomFromText($11))
            `, [
              edge.from_node_id,
              endpoint.node_id,
              `split-${edge.edge_id}-1`,
              `Split Trail ${edge.edge_id} (part 1)`,
              edge1.distance_km,
              0, 0,
              edge1.geom_wkt,
              edge.to_node_id,
              edge2.distance_km,
              edge2.geom_wkt
            ]);

            // Remove the original edge
            await pgClient.query(`
              DELETE FROM ${stagingSchema}.routing_edges WHERE id = $1
            `, [edge.edge_id]);

            // Update node degrees
            await pgClient.query(`
              UPDATE ${stagingSchema}.routing_nodes 
              SET connected_trails = (
                SELECT COUNT(*) 
                FROM ${stagingSchema}.routing_edges 
                WHERE from_node_id = ${stagingSchema}.routing_nodes.id OR to_node_id = ${stagingSchema}.routing_nodes.id
              )
              WHERE id IN ($1, $2, $3)
            `, [edge.from_node_id, endpoint.node_id, edge.to_node_id]);

            gapsFixed++;
            console.log(`✅ Fixed gap: connected endpoint ${endpoint.node_uuid} to edge ${edge.edge_id}`);
          }
        }
      }

      console.log(`🔧 Gap fixing completed: ${gapsFixed} gaps fixed`);
    } catch (error) {
      console.error('❌ Error during gap fixing:', error);
    }

    return { gapsFixed };
  }
}
