# Route Deduplication Feature

## Overview

The route deduplication feature automatically removes shorter routes when they meet a configurable threshold of edge overlap with longer routes of the same route shape. This prevents route redundancy and ensures users get the most comprehensive route options.

## Problem Statement

During route generation, the system may create multiple routes that share significant overlap:

- A short 5km out-and-back route that is completely contained within a longer 15km out-and-back route
- A 3km loop route that is entirely within a 8km loop route
- Multiple lollipop routes that share the same base trail but have different stick lengths

This creates redundancy in the route recommendations and clutters the user experience.

## Solution

### Route Shape-Specific Deduplication

Routes are only deduplicated within the same route shape type:

- **Out-and-back routes** are only compared against other out-and-back routes
- **Loop routes** are only compared against other loop routes  
- **Lollipop routes** are only compared against other lollipop routes

This preserves the different characteristics and use cases of each route shape.

### Deduplication Logic

1. **Group routes by shape** - Routes are grouped into out-and-back, loop, and lollipop categories
2. **Sort by length** - Within each shape group, routes are sorted by recommended length (longest first)
3. **Compare edge sets** - For each route, check if the percentage of its edges that match a longer route meets the deduplication threshold
4. **Remove duplicates** - If a shorter route meets the threshold when compared to a longer route, remove the shorter one
5. **Keep unique routes** - Routes that don't meet the threshold with any longer route are preserved

### Implementation Details

#### Edge-Based Comparison with Threshold

The deduplication uses edge-based comparison with a configurable threshold percentage:

```typescript
private isRouteContained(routeA: RouteRecommendation, routeB: RouteRecommendation, threshold: number): boolean {
  // If route A is longer than route B, it can't be contained
  if ((routeA.recommended_length_km || 0) > (routeB.recommended_length_km || 0)) {
    return false;
  }
  
  // Convert route edges to sets for comparison
  const edgesA = new Set(this.normalizeRouteEdges(routeA.route_edges));
  const edgesB = new Set(this.normalizeRouteEdges(routeB.route_edges));
  
  // Count how many edges in route A are also in route B
  let matchingEdges = 0;
  for (const edge of edgesA) {
    if (edgesB.has(edge)) {
      matchingEdges++;
    }
  }
  
  // Calculate the percentage of edges that match
  const matchPercentage = edgesA.size > 0 ? (matchingEdges / edgesA.size) * 100 : 0;
  
  // Return true if the match percentage meets or exceeds the threshold
  return matchPercentage >= threshold;
}
```

#### Processing Order

Routes are processed in descending order of length to prioritize keeping longer routes:

1. Sort routes by `recommended_length_km` (longest first)
2. For each route, check if it's contained within any previously processed route
3. If contained, mark for removal
4. If not contained, keep the route

## Benefits

### User Experience
- **Reduced clutter** - Users see fewer redundant route options
- **Better recommendations** - Longer, more comprehensive routes are prioritized
- **Clearer choices** - Each remaining route offers distinct value

### System Performance
- **Smaller datasets** - Fewer routes to process and store
- **Faster queries** - Reduced database size and query complexity
- **Lower storage costs** - Less redundant data to maintain

### Route Quality
- **Comprehensive coverage** - Longer routes typically offer better trail experiences
- **Reduced fragmentation** - Prevents splitting of good routes into smaller segments
- **Better variety** - Ensures route diversity rather than route redundancy

## Configuration

The deduplication feature is configurable for each route shape with a threshold percentage:

```yaml
routeGeneration:
  ksp:
    dedupeThreshold: 50  # Remove shorter routes if 50%+ of their edges match a longer route
  loops:
    dedupeThreshold: 50  # Remove shorter routes if 50%+ of their edges match a longer route
  lollipops:
    dedupeThreshold: 50  # Remove shorter routes if 50%+ of their edges match a longer route
```

**Threshold Values:**
- `0`: No deduplication (keep all routes)
- `50`: Remove shorter routes if 50% or more of their edges match a longer route
- `100`: Only remove routes that are 100% contained within longer routes (strictest)

### Logging

The system provides detailed logging during deduplication:

```
🔧 [SIMPLIFIED-ORCHESTRATOR] Starting route deduplication by shape...
🔧 [SIMPLIFIED-ORCHESTRATOR] Deduplicating 15 out-and-back routes...
🔧 [SIMPLIFIED-ORCHESTRATOR] Route "Short Trail Out-and-Back" (5.20km) meets 50% threshold with "Long Trail Out-and-Back" (15.80km) - removing shorter route
🔧 [SIMPLIFIED-ORCHESTRATOR] out-and-back: Kept 8 routes, removed 7 duplicate routes
🔧 [SIMPLIFIED-ORCHESTRATOR] Deduplication complete: 25 → 18 routes
```

## Examples

### Example 1: Out-and-Back Routes

**Before deduplication:**
- "Mesa Trail Out-and-Back" - 3.2km (edges: [101, 102, 103])
- "Mesa Trail Extended Out-and-Back" - 8.1km (edges: [101, 102, 103, 104, 105, 106, 107, 108])

**After deduplication:**
- "Mesa Trail Extended Out-and-Back" - 8.1km (edges: [101, 102, 103, 104, 105, 106, 107, 108])
- *Short route removed because all its edges are contained in the longer route*

### Example 2: Loop Routes

**Before deduplication:**
- "Chautauqua Loop" - 2.8km (edges: [201, 202, 203, 204])
- "Chautauqua Extended Loop" - 6.5km (edges: [201, 202, 203, 204, 205, 206, 207, 208])

**After deduplication:**
- "Chautauqua Extended Loop" - 6.5km (edges: [201, 202, 203, 204, 205, 206, 207, 208])
- *Short loop removed because all its edges are contained in the longer loop*

### Example 3: Mixed Route Shapes

**Before deduplication:**
- "Bear Peak Out-and-Back" - 4.2km (edges: [301, 302, 303])
- "Bear Peak Loop" - 4.2km (edges: [301, 302, 303, 304])
- "Bear Peak Extended Out-and-Back" - 7.8km (edges: [301, 302, 303, 305, 306])

**After deduplication:**
- "Bear Peak Loop" - 4.2km (edges: [301, 302, 303, 304]) *[kept - different shape]*
- "Bear Peak Extended Out-and-Back" - 7.8km (edges: [301, 302, 303, 305, 306]) *[kept - longer out-and-back]*
- *Short out-and-back removed because contained in longer out-and-back*

## Edge Cases and Considerations

### Partial Overlaps
Routes with partial overlaps are deduplicated based on the configured threshold. Routes that meet the threshold percentage of edge overlap with longer routes are removed.

### Route Shape Preservation
Routes of different shapes are never deduplicated against each other, even if they share edges. This preserves the distinct characteristics of each route type.

### Edge Order Independence
The deduplication logic is independent of edge order within routes. It only checks for the presence of edges, not their sequence.

### Performance Considerations
- Time complexity: O(n²) where n is the number of routes per shape
- Space complexity: O(n) for storing edge sets
- Typically processes hundreds of routes in milliseconds

## Future Enhancements

### Potential Improvements
1. **Geometric overlap detection** - Use spatial analysis for more precise containment detection
2. **User preference weighting** - Consider user preferences when choosing which routes to keep
3. **Configurable thresholds** - Allow users to set minimum overlap percentages for deduplication
4. **Route quality scoring** - Use route quality metrics in addition to length for prioritization

### Monitoring and Analytics
- Track deduplication statistics over time
- Monitor impact on user route selection patterns
- Analyze route diversity and coverage metrics
