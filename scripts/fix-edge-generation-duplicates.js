const { Client } = require('pg');
const fs = require('fs');

async function analyzeEdgeDuplicates() {
    console.log('🔍 Analyzing edge generation duplicates...');
    
    // Connect to database
    const client = new Client({
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE || 'trail_master_db',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres'
    });
    
    try {
        await client.connect();
        console.log('✅ Connected to database');
        
        // Find the staging schema
        const schemaResult = await client.query(`
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE 'staging_%' 
            ORDER BY schema_name DESC 
            LIMIT 1
        `);
        
        if (schemaResult.rows.length === 0) {
            throw new Error('No staging schema found');
        }
        
        const stagingSchema = schemaResult.rows[0].schema_name;
        console.log(`📋 Using staging schema: ${stagingSchema}`);
        
        // Analyze routing edges for duplicates
        const duplicateAnalysis = await client.query(`
            WITH edge_signatures AS (
                SELECT 
                    trail_id,
                    trail_name,
                    source,
                    target,
                    COUNT(*) as duplicate_count,
                    array_agg(id) as edge_ids
                FROM ${stagingSchema}.routing_edges
                GROUP BY trail_id, trail_name, source, target
                HAVING COUNT(*) > 1
            )
            SELECT 
                trail_id,
                trail_name,
                source,
                target,
                duplicate_count,
                edge_ids
            FROM edge_signatures
            ORDER BY duplicate_count DESC, trail_name
            LIMIT 20
        `);
        
        console.log('\n=== DUPLICATE EDGE ANALYSIS ===');
        console.log(`Found ${duplicateAnalysis.rows.length} groups of duplicate edges`);
        
        if (duplicateAnalysis.rows.length > 0) {
            console.log('\nTop duplicate groups:');
            duplicateAnalysis.rows.forEach((row, index) => {
                console.log(`\n${index + 1}. ${row.trail_name} (${row.trail_id})`);
                console.log(`   Source: ${row.source}, Target: ${row.target}`);
                console.log(`   Duplicates: ${row.duplicate_count} edges`);
                console.log(`   Edge IDs: ${row.edge_ids.join(', ')}`);
            });
        }
        
        // Analyze the root cause - check for multiple nodes near trail endpoints
        const rootCauseAnalysis = await client.query(`
            WITH trail_endpoints AS (
                SELECT 
                    app_uuid as trail_id,
                    name as trail_name,
                    ST_StartPoint(geometry) as start_point,
                    ST_EndPoint(geometry) as end_point
                FROM ${stagingSchema}.trails
                WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
            ),
            start_node_counts AS (
                SELECT 
                    te.trail_id,
                    te.trail_name,
                    COUNT(n.id) as start_nodes_count
                FROM trail_endpoints te
                JOIN ${stagingSchema}.routing_nodes n ON 
                    ST_DWithin(
                        ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
                        te.start_point,
                        0.0001  -- ~11 meters tolerance
                    )
                GROUP BY te.trail_id, te.trail_name
            ),
            end_node_counts AS (
                SELECT 
                    te.trail_id,
                    te.trail_name,
                    COUNT(n.id) as end_nodes_count
                FROM trail_endpoints te
                JOIN ${stagingSchema}.routing_nodes n ON 
                    ST_DWithin(
                        ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
                        te.end_point,
                        0.0001  -- ~11 meters tolerance
                    )
                GROUP BY te.trail_id, te.trail_name
            )
            SELECT 
                snc.trail_id,
                snc.trail_name,
                snc.start_nodes_count,
                enc.end_nodes_count,
                (snc.start_nodes_count * enc.end_nodes_count) as potential_edge_combinations
            FROM start_node_counts snc
            JOIN end_node_counts enc ON snc.trail_id = enc.trail_id
            WHERE (snc.start_nodes_count * enc.end_nodes_count) > 1
            ORDER BY potential_edge_combinations DESC
            LIMIT 10
        `);
        
        console.log('\n=== ROOT CAUSE ANALYSIS ===');
        console.log('Trails with multiple nodes near endpoints:');
        rootCauseAnalysis.rows.forEach((row, index) => {
            console.log(`\n${index + 1}. ${row.trail_name}`);
            console.log(`   Start nodes: ${row.start_nodes_count}`);
            console.log(`   End nodes: ${row.end_nodes_count}`);
            console.log(`   Potential combinations: ${row.potential_edge_combinations}`);
        });
        
        // Get total statistics
        const stats = await client.query(`
            SELECT 
                COUNT(*) as total_edges,
                COUNT(DISTINCT (trail_id, source, target)) as unique_connections,
                COUNT(*) - COUNT(DISTINCT (trail_id, source, target)) as duplicate_edges
            FROM ${stagingSchema}.routing_edges
        `);
        
        const stat = stats.rows[0];
        console.log('\n=== SUMMARY ===');
        console.log(`Total edges: ${stat.total_edges}`);
        console.log(`Unique connections: ${stat.unique_connections}`);
        console.log(`Duplicate edges: ${stat.duplicate_edges}`);
        console.log(`Duplication rate: ${((stat.duplicate_edges / stat.total_edges) * 100).toFixed(1)}%`);
        
        return {
            totalEdges: stat.total_edges,
            uniqueConnections: stat.unique_connections,
            duplicateEdges: stat.duplicate_edges,
            duplicateGroups: duplicateAnalysis.rows.length
        };
        
    } catch (error) {
        console.error('❌ Error analyzing edge duplicates:', error);
        throw error;
    } finally {
        await client.end();
    }
}

// Run the analysis
analyzeEdgeDuplicates()
    .then(results => {
        console.log('\n=== RECOMMENDATION ===');
        console.log('The issue is that multiple routing nodes are being created near the same trail endpoints.');
        console.log('This causes the edge generation to create multiple edges for the same trail segment.');
        console.log('\nTo fix this, we need to:');
        console.log('1. Improve node generation to avoid creating multiple nodes near the same point');
        console.log('2. Add deduplication in the edge generation SQL');
        console.log('3. Use a more sophisticated node selection strategy');
    })
    .catch(error => {
        console.error('Error:', error);
    }); 