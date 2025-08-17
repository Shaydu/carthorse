# Configurable Cost Routing for Elevation-Targeted Routes

## Overview

This document outlines various approaches for implementing configurable cost routing to find routes with specific elevation gain targets. The current system uses a similarity scoring approach that balances distance and elevation, but we need more targeted options for applications that prioritize elevation gain.

## Current System Analysis

### Current Similarity Scoring Formula

```sql
-- Distance score (0-1, where 1 is perfect match)
distance_score := GREATEST(0, 1 - ABS(actual_distance - target_distance) / target_distance);

-- Elevation score (0-1, where 1 is perfect match)  
elevation_score := GREATEST(0, 1 - ABS(actual_elevation - target_elevation) / target_elevation);

-- Final weighted score
final_score := (distance_weight * distance_score) + (elevation_weight * elevation_score);
```

### Current Configuration

```yaml
# Current weights in layer3-routing.config.yaml
scoring:
  distance_weight: 0.5
  elevation_weight: 0.3
  quality_weight: 0.3
```

**Problem:** The current system balances distance and elevation equally, making it difficult to find routes that prioritize elevation gain.

## Proposed Solutions

### Option 1: Adjust Similarity Score Weights

**Approach:** Modify the existing similarity scoring system to prioritize elevation over distance.

**Pros:**
- Simple implementation
- Uses existing infrastructure
- Minimal code changes required

**Cons:**
- Still balances distance vs elevation
- May not provide enough elevation focus

**Implementation:**
```yaml
# For elevation-focused routes:
scoring:
  distance_weight: 0.2    # Reduced from 0.5
  elevation_weight: 0.8   # Increased from 0.3
  quality_weight: 0.0     # Disabled for elevation focus
```

**Use Case:** When you want to prioritize elevation but still consider distance as a secondary factor.

---

### Option 2: Elevation-First Filtering

**Approach:** Filter routes by elevation range first, then score by distance within that range.

**Pros:**
- Guarantees elevation targets are met first
- Clear separation of concerns
- Predictable results

**Cons:**
- May reduce route variety
- Could eliminate good routes that are slightly outside elevation range

**Implementation:**
```sql
-- Stage 1: Filter by elevation range (±20% tolerance)
WHERE actual_elevation_gain BETWEEN 
    target_elevation_gain * 0.8 AND 
    target_elevation_gain * 1.2

-- Stage 2: Score remaining routes by distance match
ORDER BY distance_score DESC, elevation_score DESC
```

**Configuration:**
```yaml
elevationFirstFiltering:
  enabled: true
  elevationTolerance: 20%    # ±20% tolerance
  distanceWeight: 1.0        # Full weight on distance after elevation filter
```

**Use Case:** When elevation is the primary requirement and you want to ensure all returned routes meet elevation criteria.

---

### Option 3: Elevation Gain Rate Targeting

**Approach:** Focus on elevation gain rate (steepness) instead of total elevation gain.

**Pros:**
- Focuses on steepness, which may be more important than total elevation
- Better for finding challenging routes
- More nuanced approach

**Cons:**
- May ignore total elevation targets
- Could return very short, steep routes

**Implementation:**
```sql
-- Calculate elevation gain rate
elevation_gain_rate := actual_elevation_gain / actual_distance_km;

-- Score based on how close to target gain rate
gain_rate_score := GREATEST(0, 1 - ABS(actual_gain_rate - target_gain_rate) / target_gain_rate);

-- Combine with distance score
final_score := (gain_rate_weight * gain_rate_score) + (distance_weight * distance_score);
```

**Configuration:**
```yaml
elevationGainRateTargeting:
  enabled: true
  gain_rate_weight: 0.7
  distance_weight: 0.3
  min_distance_km: 2.0      # Minimum route length
  max_distance_km: 20.0     # Maximum route length
```

**Use Case:** When you want to find routes with specific steepness characteristics rather than total elevation gain.

---

### Option 4: Multi-Stage Filtering

**Approach:** Use multiple filtering stages with configurable tolerances.

**Pros:**
- More precise control over results
- Better quality routes
- Flexible configuration

**Cons:**
- More complex implementation
- Multiple configuration parameters

**Implementation:**
```sql
-- Stage 1: Filter by elevation range (±20%)
WHERE actual_elevation_gain BETWEEN target_elevation_gain * 0.8 AND target_elevation_gain * 1.2

-- Stage 2: Filter by distance range (±30%)
AND actual_distance_km BETWEEN target_distance_km * 0.7 AND target_distance_km * 1.3

-- Stage 3: Score remaining routes by precision
ORDER BY (elevation_precision * elevation_weight) + (distance_precision * distance_weight) DESC
```

**Configuration:**
```yaml
multiStageFiltering:
  enabled: true
  stages:
    elevation:
      tolerance: 20%
      weight: 0.6
    distance:
      tolerance: 30%
      weight: 0.4
  precisionScoring:
    elevation_weight: 0.7
    distance_weight: 0.3
```

**Use Case:** When you need precise control over both elevation and distance with configurable tolerances.

---

### Option 5: Elevation Bins with Distance Optimization

**Approach:** Group routes into elevation bins, then optimize for distance within each bin.

**Pros:**
- Groups similar elevation routes
- Provides variety within elevation ranges
- Optimizes distance within each group

**Cons:**
- More complex implementation
- Requires bin configuration

**Implementation:**
```sql
-- Create elevation bins
CASE 
  WHEN actual_elevation_gain < 200 THEN 'low'
  WHEN actual_elevation_gain < 500 THEN 'medium'
  WHEN actual_elevation_gain < 1000 THEN 'high'
  ELSE 'extreme'
END as elevation_bin

-- Within each bin, optimize for distance match
ORDER BY elevation_bin, distance_score DESC
```

**Configuration:**
```yaml
elevationBins:
  enabled: true
  bins:
    low: [0, 200]      # 0-200m elevation gain
    medium: [200, 500] # 200-500m elevation gain
    high: [500, 1000]  # 500-1000m elevation gain
    extreme: [1000, 9999] # 1000m+ elevation gain
  distanceOptimization:
    enabled: true
    weight: 1.0
  maxRoutesPerBin: 3
```

**Use Case:** When you want to provide users with route options across different elevation ranges while optimizing distance within each range.

---

### Option 6: Configurable Tolerance Levels

**Approach:** Allow users to choose tolerance levels that control precision vs variety trade-off.

**Pros:**
- User can control precision vs variety
- Flexible for different use cases
- Clear configuration options

**Cons:**
- More configuration complexity
- Requires UI/UX for tolerance selection

**Implementation:**
```yaml
toleranceLevels:
  strict:
    elevationTolerance: 10%    # ±10% elevation
    distanceTolerance: 15%     # ±15% distance
    description: "High precision, low variety"
  moderate:
    elevationTolerance: 25%    # ±25% elevation  
    distanceTolerance: 30%     # ±30% distance
    description: "Balanced precision and variety"
  flexible:
    elevationTolerance: 50%    # ±50% elevation
    distanceTolerance: 60%     # ±60% distance
    description: "Low precision, high variety"
```

**Use Case:** When you want to give users control over how strict the matching should be.

---

## Implementation Recommendations

### Phase 1: Quick Wins (Options 1 & 2)
1. **Implement Option 1** - Adjust similarity score weights for elevation focus
2. **Implement Option 2** - Add elevation-first filtering as an alternative mode

### Phase 2: Advanced Features (Options 3 & 4)
3. **Implement Option 3** - Elevation gain rate targeting for steepness focus
4. **Implement Option 4** - Multi-stage filtering for precise control

### Phase 3: User Experience (Options 5 & 6)
5. **Implement Option 5** - Elevation bins for route variety
6. **Implement Option 6** - Configurable tolerance levels

## Configuration Schema

```yaml
# Proposed configuration structure
elevationTargeting:
  # Primary targeting mode
  mode: "elevationFirst"  # Options: similarity, elevationFirst, gainRate, multiStage, bins, tolerance
  
  # Similarity scoring weights (Option 1)
  similarityWeights:
    distance_weight: 0.2
    elevation_weight: 0.8
    quality_weight: 0.0
  
  # Elevation-first filtering (Option 2)
  elevationFirst:
    enabled: true
    elevationTolerance: 20%
    distanceWeight: 1.0
  
  # Elevation gain rate targeting (Option 3)
  gainRateTargeting:
    enabled: false
    gain_rate_weight: 0.7
    distance_weight: 0.3
    min_distance_km: 2.0
    max_distance_km: 20.0
  
  # Multi-stage filtering (Option 4)
  multiStage:
    enabled: false
    stages:
      elevation:
        tolerance: 20%
        weight: 0.6
      distance:
        tolerance: 30%
        weight: 0.4
  
  # Elevation bins (Option 5)
  elevationBins:
    enabled: false
    bins:
      low: [0, 200]
      medium: [200, 500]
      high: [500, 1000]
      extreme: [1000, 9999]
    maxRoutesPerBin: 3
  
  # Tolerance levels (Option 6)
  toleranceLevels:
    strict:
      elevationTolerance: 10%
      distanceTolerance: 15%
    moderate:
      elevationTolerance: 25%
      distanceTolerance: 30%
    flexible:
      elevationTolerance: 50%
      distanceTolerance: 60%
```

## Questions for Consideration

1. **What's more important: hitting the exact elevation target, or having route variety?**
   - If exact elevation: Use Option 2 or 4
   - If variety: Use Option 1 or 6

2. **Do you want to prioritize elevation gain rate (steepness) or total elevation gain?**
   - Elevation gain rate: Use Option 3
   - Total elevation: Use current approach with adjusted weights

3. **How much flexibility do you want in distance vs elevation?**
   - Strict elevation, flexible distance: Option 2
   - Balanced: Option 1 with adjusted weights
   - User-configurable: Option 6

4. **Do you want to return multiple route options or just the best match?**
   - Multiple options: Use Option 5 (bins)
   - Best match: Use Option 4 (multi-stage filtering)

5. **What's the primary use case for your app?**
   - Training for specific elevation targets: Option 2 or 4
   - Finding challenging routes: Option 3
   - Route discovery and variety: Option 5 or 6

## Next Steps

1. **Choose primary approach** based on your app's specific needs
2. **Implement Phase 1** options for quick wins
3. **Test with real data** to validate approach
4. **Iterate and refine** based on user feedback
5. **Add advanced features** in subsequent phases

This document provides a comprehensive framework for implementing configurable cost routing that prioritizes elevation gain while maintaining flexibility for different use cases.
