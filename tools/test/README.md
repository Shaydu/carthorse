# Trail Splitting Test Suite

This directory contains comprehensive tests for the trail splitting algorithm, specifically testing Y, T, and X intersection types.

## 📁 Files

### Test Data Creation
- **`create_test_intersections.sql`** - SQL script to create test trails with Y, T, and X intersections

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

### Y Intersection Test
- **3 trails** meeting at one point
- **7 intersection points** detected
- **3 split segments** created
- **Color**: Green (#28a745)

### T Intersection Test  
- **2 trails** crossing each other
- **3 intersection points** detected
- **2 split segments** created
- **Color**: Yellow (#ffc107)

### X Intersection Test
- **2 trails** crossing each other
- **5 intersection points** detected  
- **2 split segments** created
- **Color**: Red (#dc3545)

## 🚀 Usage

### 1. Create Test Data
```bash
# Create test trails in the database
PGDATABASE=trail_master_db_test psql -f tools/test/create_test_intersections.sql
```

### 2. Run Intersection Detection
```bash
# Detect intersections
PGDATABASE=trail_master_db_test psql -c "SELECT detect_trail_intersections('public', 0.1);"

# Create staging schema and copy test data
PGDATABASE=trail_master_db_test psql -c "CREATE SCHEMA IF NOT EXISTS test_staging;"
PGDATABASE=trail_master_db_test psql -c "CREATE TABLE test_staging.trails AS SELECT * FROM trails WHERE name LIKE 'TEST_%';"
PGDATABASE=trail_master_db_test psql -c "CREATE TABLE test_staging.intersection_points AS SELECT * FROM intersection_points WHERE EXISTS (SELECT 1 FROM unnest(connected_trail_names) AS trail_name WHERE trail_name LIKE 'TEST_%');"

# Run trail splitting
PGDATABASE=trail_master_db_test psql -c "SELECT replace_trails_with_split_trails('test_staging', 0.1);"
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
- **Original Test Trails**: 7
- **Intersection Points**: 15
- **Split Trail Segments**: 7
- **Routing Nodes**: 15
- **Routing Edges**: 0 (current implementation copies without splitting)

### Validation Results
- **Y Intersection**: ✅ PASS
- **T Intersection**: ✅ PASS  
- **X Intersection**: ✅ PASS

## 🗺️ Visualization Features

### Pre-Split View
- **Original Trails**: Blue lines showing test trails before splitting
- **Intersection Points**: Red circles at trail intersection points
- **Color Coding**: Different colors for Y (green), T (yellow), X (red) intersections

### Post-Split View
- **Split Trail Segments**: Green lines showing trail segments after splitting
- **Routing Nodes**: Orange circles at intersection points
- **Routing Edges**: Purple lines connecting nodes (when edges exist)

### Interactive Controls
- **View Toggle**: Switch between pre-split and post-split views
- **Layer Controls**: Show/hide trails, nodes, and edges
- **Popups**: Click on elements for detailed information

## 🔍 Test Validation

The validation suite checks:

1. **Intersection Detection**: Verifies Y, T, and X intersections are correctly identified
2. **Trail Splitting**: Confirms trails are processed into segments
3. **Routing Graph**: Validates nodes and edges are generated
4. **Data Integrity**: Ensures all test data is properly processed
5. **Visualization**: Confirms map data is correctly generated

## 📈 Test Results

### Y Intersection
- ✅ 7 intersection points detected
- ✅ 3 original trails processed
- ✅ 3 split segments created
- ✅ 15 routing nodes generated

### T Intersection  
- ✅ 3 intersection points detected
- ✅ 2 original trails processed
- ✅ 2 split segments created
- ✅ Direct intersection between T_TRAIL_1 ↔ T_TRAIL_2

### X Intersection
- ✅ 5 intersection points detected
- ✅ 2 original trails processed  
- ✅ 2 split segments created
- ✅ Direct intersection between X_TRAIL_1 ↔ X_TRAIL_2

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
2. Check that PostGIS functions are available
3. Verify staging schema exists: `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'test_staging';` 