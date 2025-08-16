#!/usr/bin/env python3
import json
import sys
from geojson import FeatureCollection, Feature
from geojson.validation import is_valid

def validate_geojson(file_path):
    print(f"Validating GeoJSON file: {file_path}")
    
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ Error reading file: {e}")
        return False
    
    print(f"✅ File loaded successfully")
    print(f"📊 File size: {len(json.dumps(data))} characters")
    print(f"📊 Feature count: {len(data['features'])}")
    
    # Use geojson library to validate
    try:
        feature_collection = FeatureCollection(data['features'])
        if is_valid(feature_collection):
            print("✅ GeoJSON is valid according to geojson library")
        else:
            print("❌ GeoJSON is invalid according to geojson library")
            return False
    except Exception as e:
        print(f"❌ Error validating with geojson library: {e}")
        return False
    
    # Additional checks for rendering issues
    issues = []
    feature_types = {}
    geometry_types = {}
    
    for i, feature in enumerate(data['features']):
        # Count feature types
        feature_type = feature['properties'].get('type', 'unknown')
        feature_types[feature_type] = feature_types.get(feature_type, 0) + 1
        
        # Count geometry types
        geom_type = feature['geometry'].get('type')
        geometry_types[geom_type] = geometry_types.get(geom_type, 0) + 1
        
        # Check for potential rendering issues
        geom = feature['geometry']
        coords = geom.get('coordinates', [])
        
        if geom_type == 'LineString':
            if len(coords) < 2:
                issues.append(f"Feature {i}: LineString with < 2 points")
            # Check for very short lines that might not render
            if len(coords) == 2:
                p1, p2 = coords[0], coords[1]
                if len(p1) >= 2 and len(p2) >= 2:
                    import math
                    dist = math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)
                    if dist < 0.0001:  # Very small distance
                        issues.append(f"Feature {i}: Very short LineString ({dist:.6f} degrees)")
        
        elif geom_type == 'Point':
            if len(coords) not in [2, 3]:
                issues.append(f"Feature {i}: Point with {len(coords)} coordinates")
    
    print(f"\n📊 Feature type distribution:")
    for ftype, count in feature_types.items():
        print(f"   {ftype}: {count}")
    
    print(f"\n📊 Geometry type distribution:")
    for gtype, count in geometry_types.items():
        print(f"   {gtype}: {count}")
    
    print(f"\n🔍 Rendering compatibility check:")
    if issues:
        print(f"⚠️  Found {len(issues)} potential rendering issues:")
        for issue in issues[:10]:  # Show first 10 issues
            print(f"   - {issue}")
        if len(issues) > 10:
            print(f"   ... and {len(issues) - 10} more issues")
    else:
        print("✅ No obvious rendering issues found")
    
    return True

if __name__ == "__main__":
    file_path = "/Users/shaydu/dev/carthorse/test-output/boulder-layered-no-bbox.geojson"
    success = validate_geojson(file_path)
    sys.exit(0 if success else 1)
