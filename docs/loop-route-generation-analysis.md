# Loop Route Generation Analysis

## **Overview**

This document analyzes how to reliably generate loop routes using pgRouting's route discovery functions for multi-trail routes based on elevation and length parameters.

## **Current State Analysis**

### **✅ What We Have:**
1. **Loop patterns exist** in `public.route_patterns` (5 patterns: Micro, Short, Medium, Long loops)
2. **pgRouting functions available** for loop discovery
3. **Current orchestrator** generates out-and-back routes only
4. **Staging schema** with proper UUID mapping for trail metadata

### **❌ What's Missing:**
1. **Loop route generation** in the current orchestrator
2. **Integration of pgRouting loop discovery functions**
3. **Loop-specific route processing logic**

## **pgRouting Functions for Loop Route Discovery**

### **1. `pgr_hawickcircuits` - Primary Method** 🎯
```sql
SELECT cycle_id, edge_id, cost, agg_cost, path_seq
FROM pgr_hawickcircuits(
  'SELECT id, source, target, length_km as cost FROM staging.ways_noded'
)
ORDER BY cycle_id, path_seq;
```

**Advantages:**
- Finds ALL cycles in the graph
- Guaranteed to find loops
- Efficient algorithm
- Returns complete cycle information

**Implementation:**
- Group edges by `cycle_id`
- Calculate total distance/elevation for each cycle
- Filter by target criteria
- Process into route recommendations

### **2. Alternative Method: KSP + Return Paths**
```sql
-- Find outbound path
SELECT * FROM pgr_ksp(source, intermediate_node, 3, false);

-- Find return path  
SELECT * FROM pgr_ksp(intermediate_node, source, 3, false);

-- Combine into loop
```

**Advantages:**
- More control over loop characteristics
- Can target specific distance ranges
- Better for large networks

## **Implementation Strategy**

### **Phase 1: Core Loop Generation** ✅
1. **Add loop pattern loading** to `RoutePatternSqlHelpers`
2. **Implement `generateLoopRoutes()`** using `pgr_hawickcircuits`
3. **Create `LoopRouteGeneratorService`** for modular processing
4. **Create `RouteGenerationOrchestratorService`** to coordinate all route generation
5. **Keep orchestrator lean** - just call the service

### **Phase 2: Advanced Loop Features**
1. **Loop quality scoring** (elevation variation, trail diversity)
2. **Loop shape optimization** (avoid backtracking, maximize coverage)
3. **Multi-loop combinations** (figure-8, lollipop routes)
4. **Loop validation** (minimum trail count, maximum overlap)

### **Phase 3: Performance Optimization**
1. **Parallel loop discovery** for large networks
2. **Loop caching** to avoid recalculation
3. **Incremental loop updates** when network changes

## **Technical Implementation**

### **Loop Route Generation Process:**

```typescript
// 1. Load loop patterns
const patterns = await sqlHelpers.loadLoopPatterns();

// 2. For each pattern, generate loops
for (const pattern of patterns) {
  // 3. Use pgr_hawickcircuits to find cycles
  const cycles = await sqlHelpers.generateLoopRoutes(
    stagingSchema,
    pattern.target_distance_km,
    pattern.target_elevation_gain,
    pattern.tolerance_percent
  );
  
  // 4. Filter and process loops
  const validLoops = await filterCyclesByCriteria(cycles, pattern);
  
  // 5. Convert to route recommendations
  const recommendations = await processLoopsToRecommendations(validLoops);
}
```

### **Loop Quality Metrics:**

1. **Distance Accuracy:** How close to target distance
2. **Elevation Accuracy:** How close to target elevation gain
3. **Trail Diversity:** Number of unique trails used
4. **Loop Shape:** Avoidance of backtracking
5. **Elevation Distribution:** Even vs. concentrated elevation gain

### **Loop Validation Criteria:**

```typescript
const validateLoop = (loop, pattern) => {
  const distanceOk = loop.total_distance >= minDistance && 
                    loop.total_distance <= maxDistance;
  const elevationOk = loop.total_elevation_gain >= minElevation && 
                      loop.total_elevation_gain <= maxElevation;
  const trailCountOk = loop.trail_count >= 2; // At least 2 trails
  const noBacktracking = !hasBacktracking(loop.edges);
  
  return distanceOk && elevationOk && trailCountOk && noBacktracking;
};
```

## **Configuration Options**

### **Loop Generation Settings:**
```yaml
loop_generation:
  use_hawick_circuits: true
  target_routes_per_pattern: 3
  min_distance_between_routes: 2.0
  max_loop_overlap_percent: 30
  min_trail_count: 2
  max_backtracking_percent: 10
```

### **Loop Pattern Examples:**
```sql
-- Micro Loop: 0.5km, 50m elevation
INSERT INTO route_patterns VALUES (10, 'Micro Loop', 0.5, 50, 'loop', 30);

-- Short Loop: 1km, 75m elevation  
INSERT INTO route_patterns VALUES (13, 'Short Loop', 1.0, 75, 'loop', 25);

-- Medium Loop: 5km, 200m elevation
INSERT INTO route_patterns VALUES (1, 'Short Loop', 5.0, 200, 'loop', 20);

-- Long Loop: 10km, 400m elevation
INSERT INTO route_patterns VALUES (2, 'Medium Loop', 10.0, 400, 'loop', 20);
```

## **Expected Results**

### **Loop Route Characteristics:**
- **Route Shape:** `'loop'` (vs. `'out-and-back'`)
- **Route Type:** `'similar_distance'` or `'similar_elevation'`
- **Trail Count:** 2-10 unique trails per loop
- **Distance Range:** 0.5km - 15km (based on patterns)
- **Elevation Range:** 50m - 600m (based on patterns)

### **Sample Loop Route:**
```json
{
  "route_uuid": "loop-1234567890-abc123",
  "route_name": "Medium Moderate Loop - 5.2km, 180m gain",
  "route_type": "similar_distance",
  "route_shape": "loop",
  "recommended_distance_km": 5.2,
  "recommended_elevation_gain": 180,
  "trail_count": 4,
  "constituent_trails": [
    {
      "app_uuid": "trail-123",
      "name": "Boulder Creek Trail",
      "length_km": 2.1,
      "elevation_gain": 85
    },
    {
      "app_uuid": "trail-456", 
      "name": "Mesa Trail",
      "length_km": 1.8,
      "elevation_gain": 45
    }
  ]
}
```

## **Testing Strategy**

### **Unit Tests:**
1. **Loop pattern loading** - Verify correct patterns loaded
2. **Cycle discovery** - Test `pgr_hawickcircuits` integration
3. **Loop filtering** - Test distance/elevation criteria
4. **Loop validation** - Test quality metrics

### **Integration Tests:**
1. **Full loop generation** - End-to-end workflow
2. **Loop export** - Verify SQLite/GeoJSON export
3. **Loop visualization** - Test GeoJSON output

### **Performance Tests:**
1. **Large network loops** - Test with 1000+ trails
2. **Loop generation time** - Target <30 seconds
3. **Memory usage** - Monitor during loop discovery

## **Next Steps**

### **Immediate (Phase 1):**
1. ✅ **Implement loop pattern loading**
2. ✅ **Add `generateLoopRoutes()` method**
3. ✅ **Create `LoopRouteGeneratorService`**
4. ✅ **Create `RouteGenerationOrchestratorService`**
5. ✅ **Keep orchestrator lean**
6. **Test with Boulder region**

### **Short-term (Phase 2):**
1. **Add loop quality scoring**
2. **Implement loop shape optimization**
3. **Add loop validation rules**
4. **Test with multiple regions**

### **Long-term (Phase 3):**
1. **Performance optimization**
2. **Advanced loop types** (figure-8, lollipop)
3. **Loop caching system**
4. **Real-time loop updates**

## **Conclusion**

The implementation provides a robust foundation for generating loop routes using pgRouting's `pgr_hawickcircuits` function. This approach:

- **Reliably finds loops** in any connected trail network
- **Respects distance/elevation parameters** with tolerance ranges
- **Integrates seamlessly** with existing orchestrator workflow
- **Provides detailed metadata** for route reporting
- **Scales efficiently** for large trail networks

The modular service architecture allows for easy testing, maintenance, and future enhancements while maintaining consistency with the existing KSP route generation system. The orchestrator remains lean and focused on coordination rather than implementation details. 