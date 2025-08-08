# Visualization Analysis: Preventing Trails from Disappearing

## 🚨 **Problem Identified: Limited Visualization**

### **The Issue:**
Our current code has **two different filtering approaches**:

1. **Statistics Query:** Uses geometry intersection (96 trails)
2. **Visualization Query:** Uses geometry intersection but LIMIT 10 (only 10 trails)

This means we're **counting all 96 trails** but only **showing 10 trails** in the visualization.

## 📊 **Current Code Analysis:**

### **Statistics Query (Correct):**
```sql
-- Counts ALL 96 trails that intersect the bbox
SELECT COUNT(*) as total_edges
FROM staging_boulder_1754308823746.routing_edges e
WHERE ST_Intersects(e.geometry, ST_GeomFromText('POLYGON(...)', 4326))
```

### **Visualization Query (Limited):**
```sql
-- Only shows 10 sample trails (LIMIT 10)
SELECT e.id, e.trail_name, e.length_km, ...
FROM staging_boulder_1754308823746.routing_edges e
JOIN staging_boulder_1754308823746.routing_nodes n1 ON e.source = n1.id
JOIN staging_boulder_1754308823746.routing_nodes n2 ON e.target = n2.id
WHERE ST_Intersects(e.geometry, ST_GeomFromText('POLYGON(...)', 4326))
ORDER BY e.length_km DESC
LIMIT 10  -- ← This is the problem!
```

## 🔧 **Solutions to Prevent Trail Disappearance:**

### **Option 1: Show All Trails (Recommended)**
```javascript
// Remove LIMIT 10 to show all trails
const sampleEdgesResult = await pgClient.query(`
  SELECT 
    e.id, e.trail_id, e.trail_name, e.length_km, e.elevation_gain,
    n1.lat as source_lat, n1.lng as source_lng,
    n2.lat as target_lat, n2.lng as target_lng,
    ST_AsGeoJSON(e.geometry) as geometry
  FROM ${stagingSchema}.routing_edges e
  JOIN ${stagingSchema}.routing_nodes n1 ON e.source = n1.id
  JOIN ${stagingSchema}.routing_nodes n2 ON e.target = n2.id
  WHERE ST_Intersects(e.geometry, ST_GeomFromText('POLYGON((-105.32047300758535 39.97645469545003, -105.32047300758535 40.01589890417776, -105.26687332281577 40.01589890417776, -105.26687332281577 39.97645469545003, -105.32047300758535 39.97645469545003))', 4326))
  ORDER BY e.length_km DESC
  -- LIMIT 10  ← Remove this line
`);
```

### **Option 2: Show More Sample Trails**
```javascript
// Increase limit to show more trails
LIMIT 50  // Show 50 trails instead of 10
```

### **Option 3: Separate Queries for Stats vs Visualization**
```javascript
// Statistics query (all trails)
const statsResult = await pgClient.query(`
  SELECT COUNT(*) as total_edges, ...
  FROM ${stagingSchema}.routing_edges e
  WHERE ST_Intersects(e.geometry, ST_GeomFromText('POLYGON(...)', 4326))
`);

// Visualization query (all trails)
const vizResult = await pgClient.query(`
  SELECT e.id, e.trail_name, e.geometry, ...
  FROM ${stagingSchema}.routing_edges e
  WHERE ST_Intersects(e.geometry, ST_GeomFromText('POLYGON(...)', 4326))
  ORDER BY e.length_km DESC
`);
```

## 🎯 **Recommended Implementation:**

### **Update the Visualization Query:**
```javascript
// Get ALL edges for visualization (not just 10)
const allEdgesResult = await pgClient.query(`
  SELECT 
    e.id, e.trail_id, e.trail_name, e.length_km, e.elevation_gain,
    n1.lat as source_lat, n1.lng as source_lng,
    n2.lat as target_lat, n2.lng as target_lng,
    ST_AsGeoJSON(e.geometry) as geometry
  FROM ${stagingSchema}.routing_edges e
  JOIN ${stagingSchema}.routing_nodes n1 ON e.source = n1.id
  JOIN ${stagingSchema}.routing_nodes n2 ON e.target = n2.id
  WHERE ST_Intersects(e.geometry, ST_GeomFromText('POLYGON((-105.32047300758535 39.97645469545003, -105.32047300758535 40.01589890417776, -105.26687332281577 40.01589890417776, -105.26687332281577 39.97645469545003, -105.32047300758535 39.97645469545003))', 4326))
  ORDER BY e.length_km DESC
`);

// Show sample in console (first 10 for readability)
console.log(`\n🛤️ SAMPLE EDGES (showing first 10 of ${allEdgesResult.rows.length}):`);
allEdgesResult.rows.slice(0, 10).forEach((edge, i) => {
  console.log(`  ${i + 1}. ${edge.trail_name || edge.trail_id} (${edge.length_km.toFixed(2)}km, +${edge.elevation_gain}m)`);
});

// Add ALL edges to GeoJSON
allEdgesResult.rows.forEach(edge => {
  geojson.features.push({
    type: "Feature",
    properties: {
      type: "edge",
      id: edge.id,
      trail_name: edge.trail_name,
      length_km: edge.length_km,
      elevation_gain: edge.elevation_gain,
      color: "#0000ff",
      stroke: "#0000ff",
      "stroke-width": 2
    },
    geometry: JSON.parse(edge.geometry)
  });
});
```

## 📈 **Expected Results:**

### **Current (Limited):**
- **Statistics:** 96 trails counted
- **Visualization:** 10 trails shown
- **Missing:** 86 trails not visible

### **With Fix (Complete):**
- **Statistics:** 96 trails counted
- **Visualization:** 96 trails shown
- **Complete:** All trails visible

## 🚀 **Implementation Steps:**

1. **Remove LIMIT 10** from visualization query
2. **Show sample in console** (first 10 for readability)
3. **Add all trails to GeoJSON** for complete visualization
4. **Update file size warning** if needed for large datasets

This will ensure that **all 96 trails** are visible in the visualization, not just 10! 🎯 