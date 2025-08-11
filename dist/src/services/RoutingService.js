"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresRoutingService = void 0;
const queries_1 = require("../sql/queries");
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
        // Generate routing edges
        const result = await this.databaseService.executeQuery(queries_1.RoutingQueries.generateEdges(schemaName, tolerance), [schemaName, tolerance]);
        const edgeCount = result.rowCount;
        console.log(`✅ Generated ${edgeCount} routing edges`);
        // Clean up orphaned nodes
        const orphanedNodesResult = await this.databaseService.executeQuery(queries_1.RoutingQueries.cleanupOrphanedNodes(schemaName));
        const orphanedNodesCount = orphanedNodesResult.rowCount;
        console.log(`🧹 Cleaned up ${orphanedNodesCount} orphaned nodes`);
        // Clean up orphaned edges
        const orphanedEdgesResult = await this.databaseService.executeQuery(queries_1.RoutingQueries.cleanupOrphanedEdges(schemaName));
        const orphanedEdgesCount = orphanedEdgesResult.rowCount;
        console.log(`🧹 Cleaned up ${orphanedEdgesCount} orphaned edges`);
        // Final counts
        const finalNodeCountResult = await this.databaseService.executeQuery(`SELECT COUNT(*) FROM ${schemaName}.routing_nodes`);
        const finalEdgeCountResult = await this.databaseService.executeQuery(`SELECT COUNT(*) FROM ${schemaName}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL`);
        const finalNodeCount = parseInt(finalNodeCountResult.rows[0].count);
        const finalEdgeCount = parseInt(finalEdgeCountResult.rows[0].count);
        console.log(`✅ Final routing network: ${finalNodeCount} nodes, ${finalEdgeCount} edges`);
        return {
            edgeCount,
            orphanedNodesRemoved: orphanedNodesCount,
            orphanedEdgesRemoved: orphanedEdgesCount
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