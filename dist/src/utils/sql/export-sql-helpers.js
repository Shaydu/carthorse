"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportSqlHelpers = void 0;
const export_queries_1 = require("../../sql/queries/export-queries");
class ExportSqlHelpers {
    constructor(pgClient, stagingSchema) {
        this.pgClient = pgClient;
        this.stagingSchema = stagingSchema;
    }
    /**
     * Create export-ready tables in staging schema
     */
    async createExportTables() {
        console.log('Creating export-ready tables in staging schema...');
        try {
            // Create export-ready nodes table
            await this.pgClient.query(export_queries_1.ExportQueries.createExportReadyTables(this.stagingSchema));
            console.log('✅ Created export_nodes table');
            // Create export-ready trail vertices table
            await this.pgClient.query(export_queries_1.ExportQueries.createExportTrailVerticesTable(this.stagingSchema));
            console.log('✅ Created export_trail_vertices table');
            // Create export-ready edges table
            await this.pgClient.query(export_queries_1.ExportQueries.createExportEdgesTable(this.stagingSchema));
            console.log('✅ Created export_edges table');
            // Create export-ready routes table
            await this.pgClient.query(export_queries_1.ExportQueries.createExportRoutesTable(this.stagingSchema));
            console.log('✅ Created export_routes table');
        }
        catch (error) {
            console.log(`⚠️  Error creating export tables: ${error}`);
            throw error;
        }
    }
    /**
     * Export trail data for GeoJSON
     */
    async exportTrailsForGeoJSON() {
        const trailsResult = await this.pgClient.query(`
      SELECT 
        app_uuid,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        ST_AsGeoJSON(geometry, 6, 0) as geojson
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL
      ORDER BY name
    `);
        return trailsResult.rows;
    }
    /**
     * Export routing nodes for GeoJSON from export-ready table
     */
    async exportRoutingNodesForGeoJSON() {
        try {
            const nodesResult = await this.pgClient.query(export_queries_1.ExportQueries.getExportNodes(this.stagingSchema));
            // Convert string IDs to integers for nodes
            const convertedNodes = nodesResult.rows.map(row => ({
                ...row,
                id: parseInt(row.id),
                node_uuid: parseInt(row.id),
                degree: parseInt(row.degree)
            }));
            console.log(`[Export Debug] Converting ${nodesResult.rows.length} nodes, first node ID: ${nodesResult.rows[0]?.id} -> ${convertedNodes[0]?.id}`);
            return convertedNodes;
        }
        catch (error) {
            console.log(`⚠️  export_nodes table not found, skipping nodes export`);
            return [];
        }
    }
    /**
     * Export original trail vertices for GeoJSON from export-ready table
     */
    async exportTrailVerticesForGeoJSON() {
        try {
            const verticesResult = await this.pgClient.query(export_queries_1.ExportQueries.getExportTrailVertices(this.stagingSchema));
            return verticesResult.rows;
        }
        catch (error) {
            console.log(`⚠️  export_trail_vertices table not found, skipping trail vertices export`);
            return [];
        }
    }
    /**
     * Export routing edges for GeoJSON from export-ready table
     */
    async exportRoutingEdgesForGeoJSON() {
        try {
            const edgesResult = await this.pgClient.query(export_queries_1.ExportQueries.getExportEdges(this.stagingSchema));
            // Convert string IDs to integers for edges
            const convertedEdges = edgesResult.rows.map(row => ({
                ...row,
                id: parseInt(row.id),
                source: parseInt(row.source),
                target: parseInt(row.target),
                length_km: parseFloat(row.length_km),
                elevation_gain: parseFloat(row.elevation_gain),
                elevation_loss: parseFloat(row.elevation_loss)
            }));
            console.log(`[Export Debug] Converting ${edgesResult.rows.length} edges, first edge ID: ${edgesResult.rows[0]?.id} -> ${convertedEdges[0]?.id}`);
            return convertedEdges;
        }
        catch (error) {
            console.log(`⚠️  export_edges table not found, skipping edges export`);
            return [];
        }
    }
    /**
     * Export route recommendations for GeoJSON from export-ready table
     */
    async exportRouteRecommendationsForGeoJSON() {
        try {
            const routesResult = await this.pgClient.query(export_queries_1.ExportQueries.getExportRoutes(this.stagingSchema));
            return routesResult.rows;
        }
        catch (error) {
            console.log(`⚠️  export_routes table not found, skipping recommendations export`);
            return [];
        }
    }
    /**
     * Export all data for GeoJSON
     */
    async exportAllDataForGeoJSON() {
        const [trails, nodes, edges] = await Promise.all([
            this.exportTrailsForGeoJSON(),
            this.exportRoutingNodesForGeoJSON(),
            this.exportRoutingEdgesForGeoJSON()
        ]);
        return { trails, nodes, edges };
    }
    /**
     * Export trail segments only (for trails-only export)
     */
    async exportTrailSegmentsOnly() {
        const trailsResult = await this.pgClient.query(`
      SELECT 
        app_uuid,
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
        ST_AsGeoJSON(geometry) as geojson
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL
      ORDER BY name
    `);
        return trailsResult.rows;
    }
    /**
     * Export route recommendations for both GeoJSON and SQLite strategies
     */
    async exportRouteRecommendations() {
        // First check if there are any routes to export
        const countResult = await this.pgClient.query(`
      SELECT COUNT(*) as route_count 
      FROM ${this.stagingSchema}.route_recommendations 
      WHERE route_edges IS NOT NULL AND route_edges != 'null'
    `);
        const routeCount = parseInt(countResult.rows[0].route_count);
        if (routeCount === 0) {
            console.log('📊 No routes to export - returning empty array');
            return [];
        }
        const recommendationsResult = await this.pgClient.query(`
      SELECT 
        r.route_uuid,
        r.route_name,
        r.route_type,
        r.route_shape,
        r.input_length_km,
        r.input_elevation_gain,
        r.recommended_length_km,
        r.recommended_elevation_gain,
        r.route_path,
        r.route_edges,
        r.trail_count,
        r.route_score,
        r.similarity_score,
        r.region,
        r.created_at
      FROM ${this.stagingSchema}.route_recommendations r
      WHERE r.route_edges IS NOT NULL AND r.route_edges != 'null'
      ORDER BY r.route_score DESC
    `);
        return recommendationsResult.rows;
    }
}
exports.ExportSqlHelpers = ExportSqlHelpers;
//# sourceMappingURL=export-sql-helpers.js.map