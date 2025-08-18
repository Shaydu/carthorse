# Enhanced Preference-Based Cost Routing

## Overview

The enhanced preference-based cost routing system redefines "cost" in the context of trail routing to represent **deviation from user preferences** rather than traditional routing costs like distance or time. This allows the system to find routes that best match user preferences for elevation gain rate, distance, and route shape.

## Key Concepts

### Cost as Deviation from Preferences

- **Lower cost = better match to user preferences**
- **Higher cost = worse match to user preferences**
- Routes are ordered by cost (ASC) - lowest cost routes are returned first

### Priority Weights

The system uses configurable priority weights to determine the importance of each preference:

```yaml
priorityWeights:
  elevation: 0.6    # 60% weight on elevation gain rate matching
  distance: 0.3     # 30% weight on distance matching  
  shape: 0.1        # 10% weight on route shape preference
```

### Cost Components

#### 1. Elevation Gain Rate Cost

Calculates how well a route's elevation gain rate matches the target:

```sql
-- Deviation cost (higher = worse match)
deviation_cost = POWER((|actual_gain_rate - target_gain_rate| / target_gain_rate) * deviation_weight, deviation_exponent)

-- Preference cost based on difficulty ranges
preference_cost = CASE
  WHEN gain_rate < 50 THEN 0.2   -- Easy terrain - low cost
  WHEN gain_rate < 100 THEN 0.0  -- Moderate terrain - lowest cost (most preferred)
  WHEN gain_rate < 150 THEN 0.1  -- Hard terrain - low cost
  WHEN gain_rate < 200 THEN 0.3  -- Expert terrain - higher cost
  ELSE 0.5                       -- Extreme terrain - highest cost
END

-- Combined cost
elevation_cost = (deviation_cost * 0.7) + (preference_cost * 0.3)
```

#### 2. Distance Cost

Calculates how well a route's distance matches the target:

```sql
-- Deviation cost (higher = worse match)
deviation_cost = POWER((|actual_distance - target_distance| / target_distance) * deviation_weight, deviation_exponent)

-- Preference cost based on distance ranges
preference_cost = CASE
  WHEN distance < 2 THEN 0.4    -- Very short routes - higher cost
  WHEN distance < 5 THEN 0.2    -- Short routes - moderate cost
  WHEN distance < 15 THEN 0.0   -- Medium routes - lowest cost (most preferred)
  WHEN distance < 25 THEN 0.1   -- Long routes - low cost
  ELSE 0.3                      -- Very long routes - higher cost
END

-- Combined cost
distance_cost = (deviation_cost * 0.7) + (preference_cost * 0.3)
```

#### 3. Route Shape Cost

Assigns costs based on shape preferences:

```sql
shape_cost = CASE route_shape
  WHEN 'loop' THEN 0.0           -- Most preferred (lowest cost)
  WHEN 'out-and-back' THEN 0.1   -- Highly preferred (low cost)
  WHEN 'point-to-point' THEN 0.3 -- Less preferred (higher cost)
  ELSE 0.5                       -- Default (highest cost)
END
```

### Overall Cost Calculation

```sql
overall_cost = (elevation_cost * elevation_weight) + 
               (distance_cost * distance_weight) + 
               (shape_cost * shape_weight)
```

## Usage Examples

### 1. Using SQL Functions Directly

```sql
-- Find routes with minimum preference cost
SELECT * FROM find_routes_with_minimum_preference_cost(
  'staging_boulder',  -- staging schema
  10.0,               -- target distance (km)
  500.0,              -- target elevation gain (m)
  20                  -- max routes to return
);
```

### 2. Using TypeScript Service

```typescript
import { EnhancedPreferenceCostService } from './src/utils/services/enhanced-preference-cost-service';

const costService = new EnhancedPreferenceCostService(pgClient);

// Calculate cost for a specific route
const costBreakdown = await costService.calculateRoutePreferenceCost(
  'staging_boulder',
  'route-uuid-123',
  10.0,  // target distance
  500.0  // target elevation
);

console.log('Total cost:', costBreakdown.totalCost);
console.log('Elevation cost:', costBreakdown.elevationCost);
console.log('Distance cost:', costBreakdown.distanceCost);
console.log('Shape cost:', costBreakdown.shapeCost);

// Find routes with minimum cost
const bestRoutes = await costService.findRoutesWithMinimumPreferenceCost(
  'staging_boulder',
  10.0,  // target distance
  500.0, // target elevation
  20     // max routes
);

// Sort existing routes by cost
const sortedRoutes = await costService.sortRoutesByPreferenceCost(
  'staging_boulder',
  ['route-1', 'route-2', 'route-3'],
  10.0,  // target distance
  500.0  // target elevation
);
```

### 3. Configuration

The system is configured in `configs/layer3-routing.config.yaml`:

```yaml
costWeighting:
  enhancedCostRouting:
    enabled: true
    priorityWeights:
      elevation: 0.6
      distance: 0.3
      shape: 0.1
    elevationCost:
      deviationWeight: 3.0
      deviationExponent: 1.5
    distanceCost:
      deviationWeight: 2.0
      deviationExponent: 1.2
```

## Integration with Route Generation

### 1. Modify KSP Route Generator

Update the route generation process to use preference-based cost:

```typescript
// In KspRouteGeneratorService
import { EnhancedPreferenceCostService } from './enhanced-preference-cost-service';

class KspRouteGeneratorService {
  private costService: EnhancedPreferenceCostService;

  constructor(pgClient: Pool, config: KspRouteGeneratorConfig) {
    this.costService = new EnhancedPreferenceCostService(pgClient);
  }

  async generateKspRoutes(): Promise<RouteRecommendation[]> {
    // ... existing route generation logic ...

    // Sort routes by preference cost instead of similarity score
    const sortedRoutes = await this.costService.sortRoutesByPreferenceCost(
      this.config.stagingSchema,
      routeIds,
      pattern.target_distance_km,
      pattern.target_elevation_gain
    );

    return sortedRoutes.map(route => route.routeId);
  }
}
```

### 2. Update Route Scoring

Replace the existing similarity score calculation with preference cost:

```typescript
// Instead of calculateRouteScore, use preference cost
const costBreakdown = await this.costService.calculateRoutePreferenceCost(
  stagingSchema,
  routeId,
  pattern.target_distance_km,
  pattern.target_elevation_gain
);

// Lower cost = higher quality route
const qualityScore = 100 - costBreakdown.totalCost;
```

## Benefits

1. **Preference-Driven**: Routes are selected based on how well they match user preferences
2. **Configurable**: Priority weights and cost calculations can be adjusted
3. **Comprehensive**: Considers elevation gain rate, distance, and route shape
4. **Scalable**: Can be easily extended to include additional preference factors
5. **Intuitive**: Lower cost means better match to preferences

## Future Enhancements

1. **Dynamic Weights**: Allow users to adjust priority weights based on personal preferences
2. **Seasonal Adjustments**: Modify cost calculations based on season or weather
3. **Trail Quality**: Include trail surface quality in cost calculations
4. **Scenic Value**: Add scenic rating to preference matching
5. **Crowding**: Consider trail popularity/crowding in cost calculations
