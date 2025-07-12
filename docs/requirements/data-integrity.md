# Data Integrity Guarantees for SpatiaLite Export

## 🛡️ **Complete Data Integrity Protection**

The enhanced `carthorse-optimized-spatialite-export.ts` script provides **guaranteed data integrity** for all successful exports. **Every exported database will have complete, valid data or the export will fail with detailed error logging.**

## 🔍 **Validation Layers**

### **1. Per-Trail Validation (Pre-Export)**
Before any trail is inserted into the SpatiaLite database, it undergoes comprehensive validation:

#### **Required Fields**
- ✅ `app_uuid` - Must be present and non-empty
- ✅ `name` - Must be present and non-empty  
- ✅ `trail_type` - Must be present and non-empty
- ✅ `geometry_text` - Must be present and non-empty

#### **Geometry Validation**
- ✅ Must be LINESTRING type
- ✅ Must contain Z coordinates (3D geometry required)
- ✅ Must have minimum 2 coordinate pairs (6 values: lng, lat, elevation)
- ✅ Must be valid WKT format

#### **Elevation Data Validation**
- ✅ `elevation_gain` ≥ 0
- ✅ `elevation_loss` ≥ 0
- ✅ `max_elevation` > 0
- ✅ `min_elevation` > 0
- ✅ `avg_elevation` > 0
- ✅ `max_elevation` ≥ `min_elevation`
- ✅ `avg_elevation` between `min_elevation` and `max_elevation`

#### **Length & Bbox Validation**
- ✅ `length_km` > 0
- ✅ `bbox_min_lng` < `bbox_max_lng`
- ✅ `bbox_min_lat` < `bbox_max_lat`

### **2. Simplification Validation (During Export)**
If geometry simplification is enabled:

- ✅ Simplified geometry must retain Z coordinates
- ✅ Simplified geometry must remain valid LINESTRING
- ✅ **FATAL ERROR** if simplification removes 3D coordinates

### **3. Post-Export Validation (Final Check)**
After all trails are exported, comprehensive database validation:

#### **Record Count Validation**
- ✅ Expected count matches actual count
- ✅ No missing or extra records

#### **Data Completeness Validation**
- ✅ Zero trails with missing/zero elevation data
- ✅ Zero trails with missing/invalid geometry
- ✅ Zero trails missing Z coordinates
- ✅ Zero trails with invalid bounding boxes
- ✅ Zero trails with invalid length (≤ 0)

#### **Data Consistency Validation**
- ✅ Zero duplicate OSM IDs
- ✅ Sample validation of first 5 records
- ✅ All required fields present and valid

## 🚨 **Failure Handling**

### **Atomic Export Guarantee**
- **Single validation failure = Complete export failure**
- **Incomplete database is automatically deleted**
- **Detailed error logs written to `logs/` directory**
- **Process exits with code 1**

### **Error Logging**
All failures are logged with:
- Timestamp
- Trail name and OSM ID
- Specific validation errors
- Full context (geometry, elevation data, etc.)
- Stack traces for exceptions

### **Cleanup on Failure**
- Incomplete database file is removed
- Error log is written with session ID
- Console output shows fatal error details

## 📊 **What the API Needs (Guaranteed)**

### **Complete Trail Records**
Every trail in the exported database will have:

```sql
-- Required for API functionality
app_uuid          -- Unique identifier
osm_id            -- OpenStreetMap ID
name              -- Trail name
trail_type        -- Type classification
surface           -- Surface type
difficulty        -- Difficulty rating
geometry          -- 3D LINESTRING (lng, lat, elevation)
length_km         -- Trail length in kilometers
elevation_gain    -- Total elevation gain (meters)
elevation_loss    -- Total elevation loss (meters)
max_elevation     -- Highest point (meters)
min_elevation     -- Lowest point (meters)
avg_elevation     -- Average elevation (meters)
bbox_*            -- Bounding box coordinates
```

### **3D Geometry Requirements**
- All trails have Z coordinates (elevation)
- Valid LINESTRING format
- Sufficient coordinate density for smooth rendering
- Proper spatial indexing for fast queries

### **Elevation Data Requirements**
- Complete elevation profile data
- Valid gain/loss calculations
- Consistent min/max/avg values
- No zero or negative values

## 🔧 **Usage Examples**

### **Basic Export with Full Validation**
```bash
npx ts-node carthorse-optimized-spatialite-export.ts \
  --region seattle \
  --out seattle.db \
  --validate \
  --verbose
```

### **Export with Size Optimization**
```bash
npx ts-node carthorse-optimized-spatialite-export.ts \
  --region seattle \
  --out seattle.db \
  --target-size 25 \
  --validate
```

### **Programmatic Usage**
```typescript
import { exportSpatiaLiteDb } from './carthorse-optimized-spatialite-export';

const config = {
  region: 'seattle',
  outputPath: 'seattle.db',
  targetSizeMB: 50,
  enableSimplification: true,
  replace: false,
  validate: true,
  verbose: true
};

try {
  await exportSpatiaLiteDb(config);
  console.log('✅ Export successful - data integrity guaranteed');
} catch (error) {
  console.error('❌ Export failed - incomplete database removed');
  // Check logs/ directory for detailed error information
}
```

## 📋 **Validation Checklist**

Before deployment, every exported database is verified to have:

- [ ] Complete elevation data (gain, loss, min, max, avg)
- [ ] Valid 3D geometry with Z coordinates
- [ ] Proper bounding box calculations
- [ ] Accurate trail lengths
- [ ] No duplicate records
- [ ] All required metadata fields
- [ ] Valid spatial data for API queries

## 🎯 **Guarantees Summary**

1. **Complete Data**: Every trail has all required fields
2. **Valid Geometry**: All trails have 3D LINESTRING geometry
3. **Elevation Data**: Complete elevation profile for every trail
4. **No Duplicates**: Unique OSM IDs across all records
5. **Spatial Integrity**: Valid bounding boxes and coordinates
6. **API Ready**: All data required for API functionality
7. **Atomic Export**: All-or-nothing export with cleanup on failure
8. **Detailed Logging**: Comprehensive error reporting for debugging

**Result**: Every successful export produces a database that will work perfectly with the API service, with zero data integrity issues. 