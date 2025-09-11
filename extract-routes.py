#!/usr/bin/env python3
"""
Simple script to extract routes from Carthorse SQLite database to GeoJSON
"""

import sqlite3
import json
import sys
import os

def extract_routes(db_path, output_path):
    """Extract routes from SQLite database to GeoJSON"""
    
    if not os.path.exists(db_path):
        print(f"❌ Database file not found: {db_path}")
        return False
    
    # Connect to database
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get all routes
    cursor.execute('''
        SELECT 
            route_uuid, route_name, route_path, route_score, route_shape, 
            recommended_length_km, recommended_elevation_gain, trail_count,
            created_at
        FROM route_recommendations 
        ORDER BY route_score DESC
    ''')
    
    routes = cursor.fetchall()
    print(f"📍 Found {len(routes)} routes")
    
    # Create GeoJSON structure
    geojson = {
        "type": "FeatureCollection",
        "features": []
    }
    
    for route in routes:
        (route_uuid, route_name, route_path, route_score, route_shape, 
         length_km, elevation_gain, trail_count, created_at) = route
        
        if not route_path:
            print(f"⚠️  Skipping route {route_name} - no route path")
            continue
            
        try:
            # Parse the route path (should be MultiLineString GeoJSON)
            route_geometry = json.loads(route_path)
            
            # Create feature
            feature = {
                "type": "Feature",
                "properties": {
                    "id": route_uuid,
                    "route_uuid": route_uuid,
                    "route_name": route_name,
                    "route_score": route_score,
                    "route_shape": route_shape,
                    "recommended_length_km": length_km,
                    "recommended_elevation_gain": elevation_gain,
                    "trail_count": trail_count,
                    "created_at": created_at,
                    "layer": "routes"
                },
                "geometry": route_geometry
            }
            
            geojson["features"].append(feature)
            
        except json.JSONDecodeError as e:
            print(f"⚠️  Skipping route {route_name} - invalid JSON: {e}")
            continue
    
    conn.close()
    
    # Write GeoJSON file
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    
    with open(output_path, 'w') as f:
        json.dump(geojson, f, indent=2)
    
    print(f"✅ Export completed successfully!")
    print(f"📁 Output: {output_path}")
    print(f"📊 Exported: {len(geojson['features'])} routes")
    
    # Get file size
    file_size = os.path.getsize(output_path)
    print(f"📏 File size: {file_size / 1024:.0f} KB")
    
    return True

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 extract-routes.py <database_path> <output_geojson_path>")
        sys.exit(1)
    
    db_path = sys.argv[1]
    output_path = sys.argv[2]
    
    success = extract_routes(db_path, output_path)
    sys.exit(0 if success else 1)
