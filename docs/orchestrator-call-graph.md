omplete Function Audit for SQLite Export
1. Core PostgreSQL Functions Called by Orchestrator
Data Copy and Processing Functions:
copy_trails_to_staging_v1() - Copy trails to staging (decomposed from v16)
Copies region data from master database to staging schema
Handles bbox filtering and trail limits
Returns: original_count, copied_count, success, message

split_trails_in_staging_v1() - Split trails at intersections (decomposed from v16)
Splits trails at intersection points using PostGIS ST_Split
Detects and creates intersection points
Returns: original_count, split_count, intersection_count, success, message
Intersection Detection Functions:
detect_trail_intersections(staging_schema, 'trails', tolerance_meters)
Detects trail intersection points using PostGIS
Populates intersection_points table in staging schema
Uses ST_Intersection with 3D geometry support
Routing Graph Generation Functions:
generate_routing_nodes_native_v2_with_trail_ids(staging_schema, node_tolerance)
Creates routing nodes at trail endpoints and intersections
Includes trail_ids array for connectivity tracking
Returns: node_count, success, message
generate_routing_edges_native_v2(staging_schema, edge_tolerance)
Creates routing edges between nodes
Handles bidirectional trail connections
Returns: edge_count, success, message
Cleanup Functions:
cleanup_orphaned_nodes(staging_schema)
Removes orphaned nodes that have no connected edges
Returns: success, message, cleaned_nodes
Route Recommendation Functions (Optional):
generate_route_recommendations(staging_schema)
Generates route recommendations using recursive route finding
Populates route_recommendations table
Returns: number of routes generated
2. SQLite Export Helper Functions
Table Creation Functions:
createSqliteTables(db, dbPath) - Creates v14 schema tables:
trails table with bbox columns and elevation constraints
routing_nodes table with node_type and connected_trails
routing_edges table with elevation fields
route_recommendations table with classification fields
route_trails junction table
region_metadata table
schema_version table
Data Insertion Functions:
insertTrails(db, trails, dbPath) - Inserts trail data with validation
insertRoutingNodes(db, nodes, dbPath) - Inserts routing nodes
insertRoutingEdges(db, edges, dbPath) - Inserts routing edges
insertRouteRecommendations(db, recommendations) - Inserts route recommendations
insertRegionMetadata(db, metadata, dbPath) - Inserts region metadata
insertSchemaVersion(db, version, description, dbPath) - Inserts schema version
Utility Functions:
buildRegionMeta(trails, regionName, bbox) - Builds region metadata object
getSchemaVersionFromDatabase(db) - Gets schema version from SQLite
hasColumn(db, tableName, columnName) - Checks if table has column
3. Orchestrator Internal Functions
Validation Functions:
checkRequiredSqlFunctions() - Verifies all required PostgreSQL functions exist
validateTrailsForRouting() - Validates trails before routing graph generation
validateExport() - Comprehensive validation of exported SQLite database
Environment Setup Functions:
createStagingEnvironment() - Creates staging schema and tables
copyRegionDataToStaging() - Copies data using native PostgreSQL functions
Service Functions:
ElevationService - Handles elevation data processing
ValidationService - Handles data validation
CleanupService - Handles cleanup operations
4. Configuration and Utility Functions
Configuration Functions:
getTolerances() - Gets tolerance values from YAML configuration
getCurrentSqliteSchemaVersion() - Gets current SQLite schema version
getTestDbConfig() - Gets test database configuration
Hook Functions:
OrchestratorHooks.executeHooks() - Executes pre/post processing hooks
Various validation hooks for trail data, bbox data, geometry data
5. External Validation Functions
Database Validation:
carthorse-validate-database.ts - Comprehensive SQLite database validation
DataIntegrityValidator.validateRegion() - Region data integrity validation
6. File System Functions
SQLite Database Operations:
Database (better-sqlite3) - SQLite database operations
fs.unlinkSync() - File deletion for clean exports
fs.mkdirSync() - Directory creation
fs.writeFileSync() - File writing
7. Schema Version Management
Version Functions:
Schema version checking and validation
Version-specific table creation
Backward compatibility handling
Function Call Flow During Export:
Setup Phase:
checkRequiredSqlFunctions() - Verify all functions exist
createStagingEnvironment() - Create staging schema
Data Processing Phase:
copy_trails_to_staging_v1() - Copy trails to staging
split_trails_in_staging_v1() - Split trails at intersections
detect_trail_intersections() - Detect intersections
generate_routing_nodes_native_v2_with_trail_ids() - Generate nodes
generate_routing_edges_native_v2() - Generate edges
generate_route_recommendations() - Generate routes (optional)
Export Phase:
createSqliteTables() - Create SQLite tables
insertTrails() - Insert trail data
insertRoutingNodes() - Insert node data
insertRoutingEdges() - Insert edge data
insertRouteRecommendations() - Insert route data
insertRegionMetadata() - Insert metadata
insertSchemaVersion() - Insert version info
Validation Phase:
validateExport() - Comprehensive validation
External validation tool execution
This audit shows that the orchestrator uses a comprehensive set of PostgreSQL functions for data processing and SQLite functions for export, with extensive validation and error handling throughout the process.