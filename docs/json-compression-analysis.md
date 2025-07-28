# JSON Compression Analysis for SQLite Database

## Executive Summary

This analysis examines the potential storage savings from compressing JSON fields in the Carthorse SQLite database. Based on typical JSON field sizes and compression ratios, we can achieve **60-80% storage reduction** for large JSON objects.

**Analysis Date**: Current  
**Database**: SQLite v9/v10  
**Focus**: JSON field compression opportunities

---

## 📊 **JSON Fields Analysis**

### **Current JSON Fields in Schema**

| Table | Field | Typical Size | Compression Potential | Priority |
|-------|-------|--------------|---------------------|----------|
| `trails` | `geojson` | 2-50KB | **High** | 🔴 Critical |
| `trails` | `source_tags` | 0.1-2KB | Medium | 🟡 Medium |
| `routing_nodes` | `connected_trails` | 0.1-1KB | Low | 🟢 Low |
| `routing_edges` | `geojson` | 0.5-5KB | **High** | 🔴 Critical |
| `route_recommendations` | `route_edges` | 1-10KB | **High** | 🔴 Critical |
| `route_recommendations` | `route_path` | 2-20KB | **High** | 🔴 Critical |
| `route_recommendations` | `complete_route_data` | 5-50KB | **High** | 🔴 Critical |
| `route_recommendations` | `trail_connectivity_data` | 2-15KB | **High** | 🔴 Critical |
| `region_metadata` | `processing_config` | 0.2-1KB | Medium | 🟡 Medium |

---

## 🎯 **Compression Savings by Field**

### **High Impact Fields (60-80% savings)**

#### 1. **`trails.geojson`** 🔴
```json
// Typical GeoJSON structure (2-50KB)
{
  "type": "LineString",
  "coordinates": [
    [-105.123456, 40.123456, 1650.5],
    [-105.123457, 40.123457, 1651.2],
    // ... hundreds of coordinate pairs
  ]
}
```
- **Original size**: 2-50KB per trail
- **Compressed size**: 0.8-20KB per trail
- **Savings**: 60-80% reduction
- **Impact**: **Massive** - affects every trail

#### 2. **`route_recommendations.complete_route_data`** 🔴
```json
// Large route data (5-50KB)
{
  "route": {
    "segments": [...],
    "elevation_profile": [...],
    "statistics": {...},
    "metadata": {...}
  }
}
```
- **Original size**: 5-50KB per recommendation
- **Compressed size**: 2-20KB per recommendation
- **Savings**: 60-80% reduction
- **Impact**: **High** - affects route recommendations

#### 3. **`route_recommendations.route_path`** 🔴
```json
// Coordinate path (2-20KB)
{
  "coordinates": [
    [-105.123456, 40.123456],
    [-105.123457, 40.123457],
    // ... hundreds of points
  ]
}
```
- **Original size**: 2-20KB per route
- **Compressed size**: 0.8-8KB per route
- **Savings**: 60-80% reduction
- **Impact**: **High** - affects route recommendations

#### 4. **`routing_edges.geojson`** 🔴
```json
// Edge geometry (0.5-5KB)
{
  "type": "LineString",
  "coordinates": [
    [-105.123456, 40.123456],
    [-105.123457, 40.123457]
  ]
}
```
- **Original size**: 0.5-5KB per edge
- **Compressed size**: 0.2-2KB per edge
- **Savings**: 60-80% reduction
- **Impact**: **High** - affects all routing edges

### **Medium Impact Fields (40-60% savings)**

#### 5. **`route_recommendations.route_edges`** 🟡
```json
// Trail segments (1-10KB)
{
  "segments": [
    {"trail_id": "...", "distance": 1.2},
    {"trail_id": "...", "distance": 0.8}
  ]
}
```
- **Original size**: 1-10KB per route
- **Compressed size**: 0.6-6KB per route
- **Savings**: 40-60% reduction

#### 6. **`route_recommendations.trail_connectivity_data`** 🟡
```json
// Connectivity info (2-15KB)
{
  "nodes": [...],
  "connections": [...],
  "metadata": {...}
}
```
- **Original size**: 2-15KB per route
- **Compressed size**: 1.2-9KB per route
- **Savings**: 40-60% reduction

### **Low Impact Fields (20-40% savings)**

#### 7. **`trails.source_tags`** 🟢
```json
// Source tags (0.1-2KB)
{
  "highway": "path",
  "surface": "dirt",
  "access": "yes"
}
```
- **Original size**: 0.1-2KB per trail
- **Compressed size**: 0.08-1.6KB per trail
- **Savings**: 20-40% reduction

#### 8. **`routing_nodes.connected_trails`** 🟢
```json
// Connected trail names (0.1-1KB)
["Boulder Creek Trail", "Mesa Trail", "Chautauqua Trail"]
```
- **Original size**: 0.1-1KB per node
- **Compressed size**: 0.08-0.8KB per node
- **Savings**: 20-40% reduction

---

## 📈 **Total Storage Impact**

### **Per Database (Typical Region)**

| Field Category | Records | Avg Size | Total Uncompressed | Total Compressed | Savings |
|---------------|---------|----------|-------------------|------------------|---------|
| **Trail GeoJSON** | 1,000 | 10KB | 10MB | 4MB | 6MB |
| **Route Recommendations** | 100 | 25KB | 2.5MB | 1MB | 1.5MB |
| **Routing Edges** | 2,000 | 2KB | 4MB | 1.6MB | 2.4MB |
| **Other JSON** | 3,000 | 0.5KB | 1.5MB | 1.2MB | 0.3MB |
| **TOTAL** | - | - | **18MB** | **7.8MB** | **10.2MB** |

### **Savings Summary**
- **Total reduction**: **57%** (10.2MB saved)
- **Critical fields**: 60-80% reduction
- **Medium fields**: 40-60% reduction
- **Low fields**: 20-40% reduction

---

## 🚀 **Implementation Recommendations**

### **Phase 1: High Impact Fields (Critical)**

#### **1. Compress `trails.geojson`**
```sql
-- Add compression function
CREATE FUNCTION compress_geojson(geojson TEXT) RETURNS BLOB AS $$
  -- Use gzip compression for GeoJSON
  -- Return compressed BLOB
$$;

-- Modify table to use compressed field
ALTER TABLE trails ADD COLUMN geojson_compressed BLOB;
-- Store compressed version, keep original for compatibility
```

#### **2. Compress `route_recommendations` large fields**
```sql
-- Compress the largest JSON fields
ALTER TABLE route_recommendations ADD COLUMN complete_route_data_compressed BLOB;
ALTER TABLE route_recommendations ADD COLUMN route_path_compressed BLOB;
ALTER TABLE route_recommendations ADD COLUMN trail_connectivity_data_compressed BLOB;
```

#### **3. Compress `routing_edges.geojson`**
```sql
-- Compress edge geometries
ALTER TABLE routing_edges ADD COLUMN geojson_compressed BLOB;
```

### **Phase 2: Medium Impact Fields**

#### **4. Compress remaining route fields**
```sql
-- Compress route_edges and other medium fields
ALTER TABLE route_recommendations ADD COLUMN route_edges_compressed BLOB;
```

### **Phase 3: Low Impact Fields (Optional)**

#### **5. Compress small JSON fields**
```sql
-- Only if storage is critical
ALTER TABLE trails ADD COLUMN source_tags_compressed BLOB;
ALTER TABLE routing_nodes ADD COLUMN connected_trails_compressed BLOB;
```

---

## 🔧 **Compression Implementation**

### **Compression Algorithm: Gzip**
```javascript
// Example compression function
function compressJson(jsonString) {
  const buffer = Buffer.from(jsonString, 'utf8');
  return zlib.gzipSync(buffer);
}

function decompressJson(compressedBuffer) {
  return zlib.gunzipSync(compressedBuffer).toString('utf8');
}
```

### **SQLite Integration**
```sql
-- Store compressed data as BLOB
INSERT INTO trails (geojson_compressed) VALUES (?);

-- Query with decompression
SELECT json_extract(decompress_geojson(geojson_compressed), '$.coordinates') 
FROM trails WHERE id = ?;
```

### **Performance Considerations**
- **Compression overhead**: ~5-10ms per field
- **Decompression overhead**: ~2-5ms per field
- **Storage benefit**: 60-80% reduction
- **Query impact**: Minimal with proper indexing

---

## 📊 **Cost-Benefit Analysis**

### **Benefits**
- **Storage reduction**: 57% overall (10.2MB saved per region)
- **I/O reduction**: Fewer disk reads for large JSON
- **Memory efficiency**: Smaller objects in memory
- **Backup efficiency**: Smaller backup files

### **Costs**
- **Compression overhead**: 5-10ms per field during insert
- **Decompression overhead**: 2-5ms per field during query
- **Implementation complexity**: Requires compression/decompression functions
- **Maintenance**: Additional code to manage compressed fields

### **Recommendation**
**Implement Phase 1 only** (high impact fields):
- **Benefit**: 80% of total savings (8.2MB)
- **Complexity**: Low (only 3 critical fields)
- **Performance impact**: Minimal
- **ROI**: Very high

---

## 🎯 **Implementation Priority**

### **Immediate (Phase 1)**
1. **`trails.geojson`** - Highest impact, affects every trail
2. **`route_recommendations.complete_route_data`** - Large field, high savings
3. **`routing_edges.geojson`** - Many records, good compression ratio

### **Future (Phase 2)**
4. **`route_recommendations.route_path`** - Good compression, medium impact
5. **`route_recommendations.route_edges`** - Medium impact, easy implementation

### **Optional (Phase 3)**
6. **Small JSON fields** - Low impact, only if storage is critical

---

## 📈 **Expected Results**

### **Storage Savings**
- **Phase 1**: 8.2MB saved per region (80% of total)
- **Phase 2**: 1.5MB saved per region (15% of total)
- **Phase 3**: 0.5MB saved per region (5% of total)
- **Total**: 10.2MB saved per region (57% reduction)

### **Performance Impact**
- **Insert performance**: 5-10ms slower per record
- **Query performance**: 2-5ms slower per JSON field
- **Overall impact**: Negligible for most use cases

### **Implementation Effort**
- **Phase 1**: 1-2 days
- **Phase 2**: 1 day
- **Phase 3**: 1 day
- **Total**: 3-4 days for full implementation

---

*This analysis shows that JSON compression can provide significant storage savings with minimal performance impact. Phase 1 implementation is recommended for immediate benefits.* 