#!/usr/bin/env ts-node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const bbox_subdivision_1 = require("../utils/bbox-subdivision");
const geometry_preprocessing_1 = require("../utils/sql/geometry-preprocessing");
const pgrouting_helpers_1 = require("../utils/pgrouting-helpers");
const ksp_route_generator_1 = require("../utils/ksp-route-generator");
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: npx ts-node src/cli/process-staging-subdivisions.ts <sourceStagingSchema> <region> [maxTrailsPerChunk] [minChunkSize]');
        process.exit(1);
    }
    const sourceStagingSchema = args[0];
    const region = args[1];
    const maxTrailsPerChunk = args[2] ? parseInt(args[2]) : 300; // Smaller chunks for testing
    const minChunkSize = args[3] ? parseInt(args[3]) : 50;
    console.log(`🔧 Processing staging subdivisions for region: ${region}`);
    console.log(`📦 Source staging schema: ${sourceStagingSchema}`);
    console.log(`📊 Max trails per chunk: ${maxTrailsPerChunk}`);
    console.log(`📊 Min trails per chunk: ${minChunkSize}`);
    // Connect to database
    const pool = new pg_1.Pool({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        database: process.env.PGDATABASE || 'trail_master_db',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
    });
    try {
        const subdivider = (0, bbox_subdivision_1.createBboxSubdivider)(pool);
        const geometryPreprocessor = (0, geometry_preprocessing_1.createGeometryPreprocessor)(pool);
        // Step 1: Check if source staging schema exists and has data
        console.log('\n🔍 Step 1: Checking source staging data...');
        const stagingCheck = await pool.query(`
      SELECT COUNT(*) as count FROM ${sourceStagingSchema}.trails
    `);
        const trailCount = parseInt(stagingCheck.rows[0].count);
        if (trailCount === 0) {
            throw new Error(`No trails found in staging schema '${sourceStagingSchema}'`);
        }
        console.log(`✅ Found ${trailCount} trails in ${sourceStagingSchema}`);
        // Step 2: Subdivide the staging data
        console.log('\n🗺️ Step 2: Subdividing staging data...');
        const subdivisions = await subdivider.subdivideStagingData(sourceStagingSchema, maxTrailsPerChunk, minChunkSize);
        if (subdivisions.length === 0) {
            console.log('❌ No subdivisions created');
            return;
        }
        console.log(`\n✅ Created ${subdivisions.length} subdivisions`);
        // Step 3: Process each subdivision
        console.log('\n🔧 Step 3: Processing subdivisions...');
        const results = [];
        for (const subdivision of subdivisions) {
            const targetStagingSchema = `staging_${subdivision.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
            console.log(`\n📦 Processing subdivision: ${subdivision.name}`);
            // Process the subdivision
            const processResult = await subdivider.processStagingSubdivision(subdivision, sourceStagingSchema, targetStagingSchema);
            if (processResult.success && processResult.trailCount > 0) {
                console.log(`🔧 Running geometry preprocessing on ${processResult.trailCount} trails...`);
                try {
                    const preprocessResult = await geometryPreprocessor.preprocessTrailGeometries({
                        schemaName: targetStagingSchema,
                        tableName: 'trails',
                        region: subdivision.name,
                        maxPasses: 3, // Fewer passes for testing
                        tolerance: 0.00001
                    });
                    if (preprocessResult.success) {
                        console.log(`✅ Subdivision ${subdivision.name}: Preprocessing successful`);
                        console.log(`   - Initial: ${preprocessResult.initialCount} trails`);
                        console.log(`   - Final: ${preprocessResult.finalCount} trails`);
                        console.log(`   - Dropped: ${preprocessResult.droppedCount} trails`);
                        console.log(`   - Passes: ${preprocessResult.passes}`);
                        // Step 4: Generate routing network and KSP route recommendations
                        if (preprocessResult.finalCount > 0) {
                            console.log(`🔧 Generating routing network for ${preprocessResult.finalCount} trails...`);
                            try {
                                const pgRoutingHelpers = (0, pgrouting_helpers_1.createPgRoutingHelpers)(targetStagingSchema, pool);
                                await pgRoutingHelpers.createPgRoutingViews();
                                console.log(`✅ Subdivision ${subdivision.name}: Routing network created successfully`);
                                // Generate KSP route recommendations for this subdivision
                                console.log(`🔧 Generating KSP route recommendations for subdivision ${subdivision.name}...`);
                                const kspGenerator = new ksp_route_generator_1.KspRouteGenerator(pool, targetStagingSchema);
                                const routeRecommendations = await kspGenerator.generateRouteRecommendations();
                                console.log(`✅ Subdivision ${subdivision.name}: Generated ${routeRecommendations.length} route recommendations`);
                                // Store recommendations in the subdivision's staging schema
                                if (routeRecommendations.length > 0) {
                                    console.log(`💾 Storing ${routeRecommendations.length} route recommendations in ${targetStagingSchema}...`);
                                    // Create route_recommendations table in the subdivision schema
                                    await pool.query(`
                    CREATE TABLE IF NOT EXISTS ${targetStagingSchema}.route_recommendations (
                      route_uuid TEXT PRIMARY KEY,
                      route_name TEXT,
                      route_type TEXT,
                      route_shape TEXT,
                      input_length_km REAL,
                      input_elevation_gain REAL,
                      recommended_length_km REAL,
                      recommended_elevation_gain REAL,
                      route_path JSONB,
                      route_edges JSONB,
                      trail_count INTEGER,
                      route_score INTEGER,
                      similarity_score REAL,
                      region TEXT,
                      subdivision TEXT,
                      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                  `);
                                    // Insert recommendations
                                    for (const rec of routeRecommendations) {
                                        await pool.query(`
                      INSERT INTO ${targetStagingSchema}.route_recommendations (
                        route_uuid, route_name, route_type, route_shape,
                        input_length_km, input_elevation_gain,
                        recommended_length_km, recommended_elevation_gain,
                        route_path, route_edges, trail_count, route_score,
                        similarity_score, region, subdivision, created_at
                      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
                    `, [
                                            rec.route_uuid, rec.route_name, rec.route_type, rec.route_shape,
                                            rec.input_length_km, rec.input_elevation_gain,
                                            rec.recommended_length_km, rec.recommended_elevation_gain,
                                            JSON.stringify(rec.route_path), JSON.stringify(rec.route_edges),
                                            rec.trail_count, rec.route_score, rec.similarity_score, rec.region, subdivision.name
                                        ]);
                                    }
                                    console.log(`✅ Stored ${routeRecommendations.length} route recommendations in ${targetStagingSchema}.route_recommendations`);
                                    // Log summary of recommendations
                                    const routeSummary = routeRecommendations.reduce((acc, rec) => {
                                        const pattern = rec.route_name.split(' - ')[0];
                                        if (!acc[pattern])
                                            acc[pattern] = 0;
                                        acc[pattern]++;
                                        return acc;
                                    }, {});
                                    console.log(`📊 Route recommendations summary for ${subdivision.name}:`);
                                    Object.entries(routeSummary).forEach(([pattern, count]) => {
                                        console.log(`   - ${pattern}: ${count} routes`);
                                    });
                                }
                                results.push({
                                    subdivision: subdivision.name,
                                    success: true,
                                    initialCount: preprocessResult.initialCount,
                                    finalCount: preprocessResult.finalCount,
                                    droppedCount: preprocessResult.droppedCount,
                                    routingSuccess: true,
                                    routeRecommendationsCount: routeRecommendations.length,
                                    recommendations: {
                                        trail_count: preprocessResult.finalCount,
                                        route_recommendations: routeRecommendations.length,
                                        subdivision: subdivision.name
                                    }
                                });
                            }
                            catch (routingError) {
                                console.error(`❌ Error creating routing network or generating recommendations for subdivision ${subdivision.name}:`, routingError);
                                results.push({
                                    subdivision: subdivision.name,
                                    success: true,
                                    initialCount: preprocessResult.initialCount,
                                    finalCount: preprocessResult.finalCount,
                                    droppedCount: preprocessResult.droppedCount,
                                    routingSuccess: false,
                                    routingError: routingError instanceof Error ? routingError.message : String(routingError)
                                });
                            }
                        }
                        else {
                            console.log(`⚠️ Subdivision ${subdivision.name}: No trails remaining after preprocessing`);
                            results.push({
                                subdivision: subdivision.name,
                                success: true,
                                initialCount: preprocessResult.initialCount,
                                finalCount: 0,
                                droppedCount: preprocessResult.droppedCount,
                                routingSuccess: false,
                                routingError: 'No trails remaining after preprocessing'
                            });
                        }
                    }
                    else {
                        console.log(`❌ Subdivision ${subdivision.name}: Preprocessing failed`);
                        console.log(`   - Errors: ${preprocessResult.errors.join(', ')}`);
                        results.push({
                            subdivision: subdivision.name,
                            success: false,
                            initialCount: preprocessResult.initialCount,
                            finalCount: 0,
                            droppedCount: preprocessResult.droppedCount,
                            routingSuccess: false,
                            errors: preprocessResult.errors
                        });
                    }
                }
                catch (error) {
                    console.error(`❌ Error preprocessing subdivision ${subdivision.name}:`, error);
                    results.push({
                        subdivision: subdivision.name,
                        success: false,
                        initialCount: processResult.trailCount,
                        finalCount: 0,
                        droppedCount: processResult.trailCount,
                        routingSuccess: false,
                        errors: [error instanceof Error ? error.message : String(error)]
                    });
                }
            }
            else {
                console.log(`⚠️ Subdivision ${subdivision.name}: No trails or processing failed`);
                results.push({
                    subdivision: subdivision.name,
                    success: false,
                    initialCount: 0,
                    finalCount: 0,
                    droppedCount: 0,
                    routingSuccess: false,
                    errors: processResult.errors
                });
            }
        }
        // Step 5: Summary
        console.log('\n📊 Processing Summary:');
        console.log('=====================');
        const successfulSubdivisions = results.filter(r => r.success && r.routingSuccess);
        const failedSubdivisions = results.filter(r => !r.success || !r.routingSuccess);
        console.log(`✅ Successful subdivisions: ${successfulSubdivisions.length}/${results.length}`);
        console.log(`❌ Failed subdivisions: ${failedSubdivisions.length}/${results.length}`);
        if (successfulSubdivisions.length > 0) {
            const totalTrails = successfulSubdivisions.reduce((sum, r) => sum + r.finalCount, 0);
            const totalRoutes = successfulSubdivisions.reduce((sum, r) => sum + (r.routeRecommendationsCount || 0), 0);
            console.log(`📊 Total trails processed: ${totalTrails}`);
            console.log(`🛤️ Total route recommendations generated: ${totalRoutes}`);
            console.log('\n📋 Successful subdivisions:');
            successfulSubdivisions.forEach(r => {
                console.log(`  ✅ ${r.subdivision}: ${r.finalCount} trails, ${r.routeRecommendationsCount || 0} routes`);
            });
        }
        if (failedSubdivisions.length > 0) {
            console.log('\n❌ Failed subdivisions:');
            failedSubdivisions.forEach(r => {
                const errorMsg = r.errors ? r.errors.join(', ') : r.routingError || 'Unknown error';
                console.log(`  ❌ ${r.subdivision}: ${errorMsg}`);
            });
        }
    }
    catch (error) {
        console.error('❌ Processing failed:', error);
        throw error;
    }
    finally {
        await pool.end();
    }
}
// Run the processing
main().catch(console.error);
//# sourceMappingURL=process-staging-subdivisions.js.map