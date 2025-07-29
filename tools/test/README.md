# Trail Splitting Test Suite

This directory contains comprehensive tests for the trail splitting algorithm, specifically testing Y, T, X, and Double T intersection types using realistic trail data.

## 📁 Files

### Test Data Creation
- **`create_realistic_test_intersections.sql`** - SQL script to create realistic test trails with Y, T, X, and Double T intersections using actual trail names

### Test Execution
- **`test_intersection_validation.js`** - Comprehensive validation suite for intersection testing
- **`test_trail_splitting_visualization.js`** - Generates interactive map visualization of test results

### Visualization Output
- **`test-splitting-visualization/`** - Directory containing generated visualization files
  - `index.html` - Interactive map dashboard
  - `pre-split-trails.geojson` - Original test trails
  - `pre-split-intersections.geojson` - Intersection points
  - `post-split-trails.geojson` - Split trail segments
  - `post-split-nodes.geojson` - Routing nodes
  - `post-split-edges.geojson` - Routing edges
  - `test-summary.json` - Test results summary

## 🧪 Test Cases

### 1. T Intersection: Fern Canyon and Nebel Horn
- **Fern Canyon Trail**: Horizontal trail that gets bisected
- **Nebel Horn Trail**: Vertical trail that creates T intersection
- **Expected**: Fern Canyon splits into 2 segments, Nebel Horn remains intact
- **Color**: Blue (#007bff)

### 2. Y Intersection: Shadow Canyon Trails
- **Shadow Canyon Main Trail**: Central trail
- **Shadow Canyon South Trail**: South branch
- **Shadow Canyon North Trail**: North branch
- **Expected**: All three trails meet at one point, creating Y intersection
- **Color**: Green (#28a745)

### 3. X Intersection: Shanahan Mesa Trail crosses Mesa Trail
- **Mesa Trail**: East-west trail
- **Shanahan Mesa Trail**: North-south trail that crosses Mesa Trail
- **Expected**: Both trails split at intersection point
- **Color**: Red (#dc3545)

### 4. Double T: Amphitheater Express Trail - Amphitheater Trail
- **Amphitheater Express Trail**: Trail that forms two T intersections
- **Amphitheater Trail**: Main trail that gets intersected twice
- **Expected**: Amphitheater Trail splits into 3 segments, Amphitheater Express splits into 3 segments
- **Color**: Purple (#6f42c1)

## 🚀 Usage

### 1. Create Test Data
```bash
# Create realistic test trails in the database
PGDATABASE=trail_master_db_test psql -f tools/test/create_realistic_test_intersections.sql
```

### 2. Run Intersection Detection
```bash
# Detect intersections using PostGIS functions
PGDATABASE=trail_master_db_test psql -c "SELECT detect_trail_intersections('public', 'trails', 1.0);"

# Create staging schema and copy test data
PGDATABASE=trail_master_db_test psql -c "CREATE SCHEMA IF NOT EXISTS test_staging;"
PGDATABASE=trail_master_db_test psql -c "CREATE TABLE test_staging.trails AS SELECT * FROM trails WHERE name LIKE 'TEST_%';"

# Run trail splitting using pgRouting
PGDATABASE=trail_master_db_test psql -c "SELECT pgr_nodeNetwork('test_staging.trails', 0.0001, 'id', 'geometry');"
```

### 3. Generate Visualization
```bash
# Generate interactive map visualization
node tools/test/test_trail_splitting_visualization.js
```

### 4. Run Validation Tests
```bash
# Run comprehensive validation suite
node tools/test/test_intersection_validation.js
```

### 5. View Results
```bash
# Start visualization server
cd tools/test/test-splitting-visualization && python3 -m http.server 8082

# Open in browser: http://localhost:8082
```

## 📊 Expected Results

### Test Summary
- **Original Test Trails**: 8 (4 intersection scenarios)
- **Intersection Points**: Variable based on tolerance
- **Split Trail Segments**: Variable based on intersections
- **Routing Nodes**: Created at intersection points
- **Routing Edges**: Created between nodes

### Validation Results
- **T Intersection (Fern Canyon/Nebel Horn)**: ✅ PASS
- **Y Intersection (Shadow Canyon Trails)**: ✅ PASS  
- **X Intersection (Shanahan/Mesa)**: ✅ PASS
- **Double T (Amphitheater Express/Amphitheater)**: ✅ PASS

## 🗺️ Visualization Features

### Pre-Split View
- **Original Trails**: Blue lines showing test trails before splitting
- **Intersection Points**: Red circles at trail intersection points
- **Color Coding**: Different colors for each intersection type

### Post-Split View
- **Split Trail Segments**: Green lines showing trail segments after splitting
- **Routing Nodes**: Orange circles at intersection points
- **Routing Edges**: Purple lines connecting nodes

### Interactive Controls
- **View Toggle**: Switch between pre-split and post-split views
- **Layer Controls**: Show/hide trails, nodes, and edges
- **Popups**: Click on elements for detailed information

## 🔍 Test Validation

The validation suite checks:

1. **Intersection Detection**: Verifies T, Y, X, and Double T intersections are correctly identified
2. **Trail Splitting**: Confirms trails are processed into segments using pgRouting
3. **Routing Graph**: Validates nodes and edges are generated
4. **Data Integrity**: Ensures all test data is properly processed
5. **Visualization**: Confirms map data is correctly generated

## 📈 Test Results

### T Intersection (Fern Canyon/Nebel Horn)
- ✅ Intersection point detected at crossing
- ✅ Fern Canyon splits into 2 segments
- ✅ Nebel Horn remains as single segment
- ✅ Routing nodes created at intersection

### Y Intersection (Shadow Canyon Trails)
- ✅ Three trails meet at single point
- ✅ All trails split into segments
- ✅ Routing nodes created at intersection point
- ✅ Proper Y topology maintained

### X Intersection (Shanahan/Mesa)
- ✅ Two trails cross at intersection point
- ✅ Both trails split into segments
- ✅ Routing nodes created at intersection
- ✅ Proper X topology maintained

### Double T (Amphitheater Express/Amphitheater)
- ✅ Two T intersections detected
- ✅ Amphitheater Trail splits into 3 segments
- ✅ Amphitheater Express Trail splits into 3 segments
- ✅ Routing nodes created at both intersections

## 🛠️ Troubleshooting

### No Data in Visualization
1. Check that test data was created: `SELECT COUNT(*) FROM trails WHERE name LIKE 'TEST_%';`
2. Verify intersection detection: `SELECT COUNT(*) FROM intersection_points WHERE EXISTS (SELECT 1 FROM unnest(connected_trail_names) AS trail_name WHERE trail_name LIKE 'TEST_%');`
3. Ensure visualization files were generated in `test-splitting-visualization/`

### Server Issues
1. Check if port 8082 is available
2. Verify you're running the server from the correct directory: `cd tools/test/test-splitting-visualization`
3. Try a different port: `python3 -m http.server 8083`

### Database Issues
1. Ensure you're using the test database: `PGDATABASE=trail_master_db_test`
2. Check that PostGIS and pgRouting functions are available
3. Verify staging schema exists: `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'test_staging';`

### pgRouting Issues
1. Verify pgRouting extension is installed: `SELECT * FROM pg_extension WHERE extname = 'pgrouting';`
2. Check pgr_nodeNetwork function exists: `SELECT proname FROM pg_proc WHERE proname = 'pgr_nodenetwork';`
3. Ensure geometry column is 2D for pgRouting operations

## 🔧 pgRouting Integration

This test suite now uses pgRouting's `pgr_nodeNetwork()` function for trail splitting:

### Key Features
- **Automatic Intersection Detection**: pgRouting detects all intersection points
- **Precise Splitting**: Splits trails exactly at intersection points
- **Topology Creation**: Creates source/target columns for routing
- **Performance Optimized**: Uses spatial indexes for fast processing

### Usage in Tests
```sql
-- Split trails at intersections
SELECT pgr_nodeNetwork('test_staging.trails', 0.0001, 'id', 'geometry');

-- Create routing topology
SELECT pgr_createTopology('test_staging.trails_noded', 0.0001, 'geometry', 'id');
``` 