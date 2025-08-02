const fs = require('fs');

// Original trails GeoJSON (your provided data)
const originalTrails = {
  "type": "FeatureCollection",
  "features": [
    // ... your original trails data would go here
  ]
};

// Intersection points as magenta markers
const intersectionPoints = [
  {
    "type": "Feature",
    "geometry": {
      "type": "Point",
      "coordinates": [-105.2624954, 40.0797098, 1625.22253418]
    },
    "properties": {
      "node_type": "intersection",
      "connected_trails": ["Cobalt Trail", "Sage Trail"],
      "marker-color": "#FF00FF",
      "marker-size": "medium"
    }
  },
  {
    "type": "Feature", 
    "geometry": {
      "type": "Point",
      "coordinates": [-105.262738, 40.0801407, 1624.777832031]
    },
    "properties": {
      "node_type": "intersection",
      "connected_trails": ["Left Hand Trail", "Sage Trail"],
      "marker-color": "#FF00FF",
      "marker-size": "medium"
    }
  },
  {
    "type": "Feature",
    "geometry": {
      "type": "Point", 
      "coordinates": [-105.263484, 40.0744901, 1673.888427734]
    },
    "properties": {
      "node_type": "intersection",
      "connected_trails": ["Mesa Reservoir Trail", "Eagle Trail"],
      "marker-color": "#FF00FF",
      "marker-size": "medium"
    }
  },
  {
    "type": "Feature",
    "geometry": {
      "type": "Point",
      "coordinates": [-105.2584634, 40.0751855, 1626.103637695]
    },
    "properties": {
      "node_type": "intersection", 
      "connected_trails": ["Eagle Trail", "Sage Trail"],
      "marker-color": "#FF00FF",
      "marker-size": "medium"
    }
  },
  {
    "type": "Feature",
    "geometry": {
      "type": "Point",
      "coordinates": [-105.2746735, 40.0737409, 1681.403320312]
    },
    "properties": {
      "node_type": "intersection",
      "connected_trails": ["Hidden Valley Trail", "Degge Trail"], 
      "marker-color": "#FF00FF",
      "marker-size": "medium"
    }
  },
  {
    "type": "Feature",
    "geometry": {
      "type": "Point",
      "coordinates": [-105.2706831, 40.0746734, 1672.458862305]
    },
    "properties": {
      "node_type": "intersection",
      "connected_trails": ["Mesa Reservoir Trail", "Degge Trail"],
      "marker-color": "#FF00FF", 
      "marker-size": "medium"
    }
  },
  {
    "type": "Feature",
    "geometry": {
      "type": "Point",
      "coordinates": [-105.2667947, 40.076038, 1681.123291016]
    },
    "properties": {
      "node_type": "intersection",
      "connected_trails": ["Eagle Trail", "Degge Trail"],
      "marker-color": "#FF00FF",
      "marker-size": "medium"
    }
  },
  {
    "type": "Feature", 
    "geometry": {
      "type": "Point",
      "coordinates": [-105.2761835, 40.0767555, 1689.660766602]
    },
    "properties": {
      "node_type": "intersection",
      "connected_trails": ["Mesa Reservoir Trail", "Eagle Trail"],
      "marker-color": "#FF00FF",
      "marker-size": "medium"
    }
  },
  {
    "type": "Feature",
    "geometry": {
      "type": "Point", 
      "coordinates": [-105.27719, 40.0765988, 1691.97277832]
    },
    "properties": {
      "node_type": "intersection",
      "connected_trails": ["Cobalt Trail", "Eagle Trail"],
      "marker-color": "#FF00FF",
      "marker-size": "medium"
    }
  }
];

console.log('Intersection points found:');
intersectionPoints.forEach((point, index) => {
  console.log(`${index + 1}. ${point.properties.connected_trails.join(' ↔ ')} at [${point.geometry.coordinates[0].toFixed(6)}, ${point.geometry.coordinates[1].toFixed(6)}]`);
});

console.log('\nTo add these to your GeoJSON, add the intersection points to the features array of your original GeoJSON.');
console.log('Each intersection point has magenta color (#FF00FF) and medium size for visibility.'); 