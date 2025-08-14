"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresRoutingService = void 0;
const queries_1 = require("../sql/queries");
const queries_2 = require("../sql/queries");
class PostgresRoutingService {
    constructor(client, databaseService) {
        this.client = client;
        this.databaseService = databaseService;
    }
    async detectIntersections(schemaName, tolerance) {
        console.log(`🔍 Detecting trail intersections with tolerance: ${tolerance}m`);
        const result = await this.databaseService.executeQuery(queries_1.RoutingQueries.detectIntersections(schemaName, tolerance), [schemaName, tolerance]);
        const intersectionCount = result.rows.length;
        console.log(`✅ Detected ${intersectionCount} trail intersections`);
        return {
            intersectionCount,
            intersections: result.rows
        };
    }
    async generateRoutingNodes(schemaName, tolerance) {
        console.log(`📍 Generating routing nodes with tolerance: ${tolerance}m`);
        // Clear existing routing nodes
        await this.databaseService.executeQuery(queries_1.RoutingQueries.cleanupOrphanedNodes(schemaName));
        // Debug: Check how many trails we're starting with for node generation
        const trailCountResult = await this.databaseService.executeQuery(`SELECT COUNT(*) as count FROM ${schemaName}.trails WHERE geometry IS NOT NULL AND ST_IsValid(geometry)`);
        const trailCount = parseInt(trailCountResult.rows[0].count);
        console.log(`🔍 DEBUG: Node generation starting with ${trailCount} valid trails`);
        // Debug: Check our specific trail for node generation
        const missingTrailCheck = await this.databaseService.executeQuery(`SELECT id, app_uuid, name, ST_AsText(ST_StartPoint(geometry)) as start_point, ST_AsText(ST_EndPoint(geometry)) as end_point
       FROM ${schemaName}.trails 
       WHERE app_uuid = 'c9baec8c-2700-440a-8517-8fda53c2fbf8' OR (name = 'Mesa Trail' AND length_km > 0.5 AND length_km < 0.6)`);
        if (missingTrailCheck.rowCount > 0) {
            console.log(`🔍 DEBUG: Our target trail for node generation:`, missingTrailCheck.rows[0]);
        }
        else {
            console.log(`🔍 DEBUG: Our target trail NOT found for node generation`);
        }
        // Generate routing nodes
        const result = await this.databaseService.executeQuery(queries_1.RoutingQueries.generateNodes(schemaName, tolerance), [schemaName, tolerance]);
        const nodeCount = result.rowCount;
        console.log(`✅ Generated ${nodeCount} routing nodes`);
        // Get node type breakdown
        const nodeTypesResult = await this.databaseService.executeQuery(queries_1.RoutingQueries.getNodeTypeBreakdown(schemaName));
        const nodeTypes = {
            endpoint: 0,
            intersection: 0
        };
        nodeTypesResult.rows.forEach((row) => {
            if (row.node_type === 'endpoint') {
                nodeTypes.endpoint = parseInt(row.count);
            }
            else if (row.node_type === 'intersection') {
                nodeTypes.intersection = parseInt(row.count);
            }
        });
        console.log('📍 Node type breakdown:');
        console.log(`  - endpoint: ${nodeTypes.endpoint} nodes`);
        console.log(`  - intersection: ${nodeTypes.intersection} nodes`);
        return {
            nodeCount,
            nodeTypes
        };
    }
    async generateRoutingEdges(schemaName, tolerance) {
        console.log(`🛤️ Generating routing edges with tolerance: ${tolerance}m`);
        // Clear existing routing edges
        await this.databaseService.executeQuery(queries_1.RoutingQueries.cleanupOrphanedEdges(schemaName));
        // Get node count for validation
        const nodeCountResult = await this.databaseService.executeQuery(queries_1.StagingQueries.getNodeCount(schemaName));
        const nodeCount = parseInt(nodeCountResult.rows[0].count);
        console.log(`📍 Found ${nodeCount} nodes to connect`);
        // Debug: Check how many trails we're starting with
        const trailCountResult = await this.databaseService.executeQuery(`SELECT COUNT(*) as count FROM ${schemaName}.trails WHERE geometry IS NOT NULL AND ST_IsValid(geometry)`);
        const trailCount = parseInt(trailCountResult.rows[0].count);
        console.log(`🔍 DEBUG: Starting with ${trailCount} valid trails`);
        // Debug: Check our specific missing trail
        const missingTrailCheck = await this.databaseService.executeQuery(`SELECT id, app_uuid, name, length_km, ST_IsValid(geometry) as is_valid, ST_Length(geometry::geography) as geom_length
       FROM ${schemaName}.trails 
       WHERE app_uuid = 'c9baec8c-2700-440a-8517-8fda53c2fbf8' OR (name = 'Mesa Trail' AND length_km > 0.5 AND length_km < 0.6)`);
        if (missingTrailCheck.rowCount > 0) {
            console.log(`🔍 DEBUG: Our target trail is in trails table:`, missingTrailCheck.rows[0]);
        }
        else {
            console.log(`🔍 DEBUG: Our target trail is NOT in trails table`);
        }
        // Generate routing edges
        const result = await this.databaseService.executeQuery(queries_1.RoutingQueries.generateEdges(schemaName, tolerance), [schemaName, tolerance]);
        const edgeCount = result.rowCount;
        console.log(`✅ Generated ${edgeCount} routing edges`);
        // Debug: Check if our trail became an edge
        const edgeCheck = await this.databaseService.executeQuery(`SELECT source, target, trail_id, trail_name, length_km 
       FROM ${schemaName}.routing_edges 
       WHERE trail_id = 'c9baec8c-2700-440a-8517-8fda53c2fbf8' OR (trail_name = 'Mesa Trail' AND length_km > 0.5 AND length_km < 0.6)`);
        if (edgeCheck.rowCount > 0) {
            console.log(`🔍 DEBUG: Our target trail became an edge:`, edgeCheck.rows[0]);
        }
        else {
            console.log(`🔍 DEBUG: Our target trail did NOT become an edge`);
        }
        // Clean up orphaned nodes
        const orphanedNodesResult = await this.databaseService.executeQuery(queries_1.RoutingQueries.cleanupOrphanedNodes(schemaName));
        const orphanedNodesCount = orphanedNodesResult.rowCount;
        console.log(`🧹 Cleaned up ${orphanedNodesCount} orphaned nodes`);
        // Clean up orphaned edges
        const orphanedEdgesResult = await this.databaseService.executeQuery(queries_1.RoutingQueries.cleanupOrphanedEdges(schemaName));
        const orphanedEdgesCount = orphanedEdgesResult.rowCount;
        console.log(`🧹 Cleaned up ${orphanedEdgesCount} orphaned edges`);
        // Clean up bridge connector artifacts that create isolated degree-1 nodes
        const bridgeConnectorCleanupResult = await this.databaseService.executeQuery(queries_2.CleanupQueries.cleanupBridgeConnectorArtifacts(schemaName));
        const bridgeConnectorCleanupCount = bridgeConnectorCleanupResult.rowCount;
        if (bridgeConnectorCleanupCount > 0) {
            console.log(`🔧 Cleaned up ${bridgeConnectorCleanupCount} bridge connector artifacts`);
        }
        return {
            edgeCount,
            orphanedNodesRemoved: orphanedNodesCount,
            orphanedEdgesRemoved: orphanedEdgesCount,
            bridgeConnectorCleanupCount
        };
    }
    async validateRoutingNetwork(schemaName) {
        console.log('🔍 Validating routing network connectivity...');
        // Check for isolated nodes
        const isolatedNodesResult = await this.databaseService.executeQuery(queries_1.RoutingQueries.checkIsolatedNodes(schemaName));
        const isolatedNodesCount = parseInt(isolatedNodesResult.rows[0].count);
        // Check for orphaned edges
        const orphanedEdgesResult = await this.databaseService.executeQuery(queries_1.RoutingQueries.checkOrphanedEdges(schemaName));
        const orphanedEdgesCount = parseInt(orphanedEdgesResult.rows[0].count);
        // Check connectivity statistics
        const connectivityResult = await this.databaseService.executeQuery(queries_1.RoutingQueries.validateNetwork(schemaName));
        const connectivityStats = {
            totalNodes: 0,
            connectedNodes: 0,
            leafNodes: 0,
            avgDegree: 0
        };
        connectivityResult.rows.forEach((row) => {
            connectivityStats.totalNodes += parseInt(row.total_nodes);
            connectivityStats.connectedNodes += parseInt(row.connected_nodes);
            connectivityStats.leafNodes += parseInt(row.leaf_nodes);
            connectivityStats.avgDegree = parseFloat(row.avg_degree);
        });
        console.log('🔍 Routing network validation results:');
        console.log(`  - Isolated nodes: ${isolatedNodesCount}`);
        console.log(`  - Orphaned edges: ${orphanedEdgesCount}`);
        console.log(`  - Total nodes: ${connectivityStats.totalNodes}`);
        console.log(`  - Connected nodes: ${connectivityStats.connectedNodes}`);
        console.log(`  - Leaf nodes: ${connectivityStats.leafNodes}`);
        console.log(`  - Average degree: ${connectivityStats.avgDegree.toFixed(1)}`);
        const isConnected = isolatedNodesCount === 0 && orphanedEdgesCount === 0;
        if (isolatedNodesCount > 0 || orphanedEdgesCount > 0) {
            console.log(`⚠️ Warning: Found ${isolatedNodesCount} isolated nodes and ${orphanedEdgesCount} orphaned edges`);
        }
        else {
            console.log('✅ Routing network is fully connected!');
        }
        return {
            isConnected,
            isolatedNodes: isolatedNodesCount,
            orphanedEdges: orphanedEdgesCount,
            connectivityStats
        };
    }
    async cleanupOrphanedNodes(schemaName) {
        const result = await this.databaseService.executeQuery(queries_1.RoutingQueries.cleanupOrphanedNodes(schemaName));
        return result.rowCount;
    }
}
exports.PostgresRoutingService = PostgresRoutingService;
//# sourceMappingURL=RoutingService.js.map