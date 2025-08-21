import { PoolClient } from 'pg';

export interface NetworkConnectionResult {
  connectionsCreated: number;
  componentsBefore: number;
  componentsAfter: number;
  connectivityImproved: boolean;
  details: {
    suggestedConnections: Array<{
      seq: number;
      start_vid: number;
      end_vid: number;
      distance?: number;
    }>;
    implementedConnections: Array<{
      source: number;
      target: number;
      distance: number;
      geometry: string;
    }>;
  };
}

export class NetworkConnectionService {
  constructor(
    private stagingSchema: string,
    private pgClient: PoolClient
  ) {}

  /**
   * Connect fragmented network components using pgr_makeConnected suggestions
   */
  async connectFragmentedNetwork(): Promise<NetworkConnectionResult> {
    console.log('🔗 Connecting fragmented network components...');

    // Step 1: Get current component count
    const componentsBefore = await this.getComponentCount();
    console.log(`📊 Current network has ${componentsBefore} disconnected components`);

    if (componentsBefore <= 1) {
      console.log('✅ Network is already fully connected');
      return {
        connectionsCreated: 0,
        componentsBefore,
        componentsAfter: componentsBefore,
        connectivityImproved: false,
        details: {
          suggestedConnections: [],
          implementedConnections: []
        }
      };
    }

    // Step 2: Get suggested connections from pgr_makeConnected
    const suggestedConnections = await this.getSuggestedConnections();
    console.log(`🔗 pgr_makeConnected suggests ${suggestedConnections.length} connections`);

    if (suggestedConnections.length === 0) {
      console.log('⚠️ No connections suggested by pgr_makeConnected');
      return {
        connectionsCreated: 0,
        componentsBefore,
        componentsAfter: componentsBefore,
        connectivityImproved: false,
        details: {
          suggestedConnections: [],
          implementedConnections: []
        }
      };
    }

    // Step 3: Implement the suggested connections
    const implementedConnections = await this.implementConnections(suggestedConnections);
    console.log(`✅ Implemented ${implementedConnections.length} connections`);

    // Step 4: Verify connectivity improvement
    const componentsAfter = await this.getComponentCount();
    console.log(`📊 Network now has ${componentsAfter} components (was ${componentsBefore})`);

    return {
      connectionsCreated: implementedConnections.length,
      componentsBefore,
      componentsAfter,
      connectivityImproved: componentsAfter < componentsBefore,
      details: {
        suggestedConnections,
        implementedConnections
      }
    };
  }

  /**
   * Get the number of disconnected components in the network
   */
  private async getComponentCount(): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT COUNT(DISTINCT component) as component_count
      FROM pgr_strongcomponents('
        SELECT id, source, target, length_km as cost 
        FROM ${this.stagingSchema}.ways_noded
      ')
    `);
    return parseInt(result.rows[0]?.component_count) || 0;
  }

  /**
   * Get suggested connections from pgr_makeConnected
   */
  private async getSuggestedConnections(): Promise<Array<{seq: number, start_vid: number, end_vid: number}>> {
    try {
      const result = await this.pgClient.query(`
        SELECT seq, start_vid, end_vid
        FROM pgr_makeconnected('
          SELECT id, source, target, length_km as cost 
          FROM ${this.stagingSchema}.ways_noded
        ')
        ORDER BY seq
      `);
      return result.rows;
    } catch (error) {
      console.warn('⚠️ pgr_makeconnected failed:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * Implement the suggested connections by creating virtual edges
   */
  private async implementConnections(suggestedConnections: Array<{seq: number, start_vid: number, end_vid: number}>): Promise<Array<{source: number, target: number, distance: number, geometry: string}>> {
    const implementedConnections: Array<{source: number, target: number, distance: number, geometry: string}> = [];

    for (const connection of suggestedConnections) {
      try {
        // Get the coordinates of the two nodes
        const nodeCoords = await this.pgClient.query(`
          SELECT 
            v1.id as node1_id, v1.x as x1, v1.y as y1,
            v2.id as node2_id, v2.x as x2, v2.y as y2
          FROM ${this.stagingSchema}.ways_noded_vertices_pgr v1
          JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v2 ON v2.id = $2
          WHERE v1.id = $1
        `, [connection.start_vid, connection.end_vid]);

        if (nodeCoords.rows.length === 0) {
          console.warn(`⚠️ Could not find coordinates for nodes ${connection.start_vid} and ${connection.end_vid}`);
          continue;
        }

        const coords = nodeCoords.rows[0];
        
        // Create a straight line geometry between the nodes
        const geometry = `LINESTRING(${coords.x1} ${coords.y1}, ${coords.x2} ${coords.y2})`;
        
        // Calculate distance in meters
        const distance = Math.sqrt(
          Math.pow((coords.x2 - coords.x1) * 111320 * Math.cos((coords.y1 + coords.y2) / 2 * Math.PI / 180), 2) +
          Math.pow((coords.y2 - coords.y1) * 111320, 2)
        );

        // Insert the connection as a virtual edge
        const insertResult = await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.ways_noded (
            source, target, length_km, the_geom, 
            original_trail_id, app_uuid, name, trail_type, surface, difficulty,
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
          ) VALUES (
            $1, $2, $3, ST_GeomFromText($4, 4326),
            NULL, gen_random_uuid(), $5, 'virtual_connection', 'virtual', 'easy',
            0, 0, 0, 0, 0
          )
          RETURNING id
        `, [
          connection.start_vid,
          connection.end_vid,
          distance / 1000.0, // Convert to km
          geometry,
          `Virtual Connection ${connection.seq}`
        ]);

        if (insertResult.rows.length > 0) {
          implementedConnections.push({
            source: connection.start_vid,
            target: connection.end_vid,
            distance: distance,
            geometry: geometry
          });
          console.log(`✅ Created virtual connection ${connection.seq}: ${connection.start_vid} → ${connection.end_vid} (${distance.toFixed(1)}m)`);
        }

      } catch (error) {
        console.warn(`⚠️ Failed to implement connection ${connection.seq}:`, error instanceof Error ? error.message : String(error));
      }
    }

    return implementedConnections;
  }

  /**
   * Update vertex degrees after adding connections
   */
  async updateVertexDegrees(): Promise<void> {
    console.log('🔄 Updating vertex degrees after network connections...');
    
    try {
      // Update the cnt column in vertices table
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*)
          FROM ${this.stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
      `);
      
      console.log('✅ Vertex degrees updated successfully');
    } catch (error) {
      console.warn('⚠️ Failed to update vertex degrees:', error instanceof Error ? error.message : String(error));
    }
  }
}
