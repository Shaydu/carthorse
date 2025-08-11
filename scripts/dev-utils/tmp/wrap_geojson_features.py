import sys
import json

if len(sys.argv) != 3:
    print("Usage: python3 wrap_geojson_features.py input.geojson output.geojson")
    sys.exit(1)

input_file = sys.argv[1]
output_file = sys.argv[2]

features = []
with open(input_file, 'r') as f:
    for line in f:
        line = line.strip()
        if line:
            try:
                features.append(json.loads(line))
            except Exception as e:
                print(f"Skipping invalid line: {e}")

fc = {"type": "FeatureCollection", "features": features}

with open(output_file, 'w') as f:
    json.dump(fc, f, indent=2)

print(f"Wrote {len(features)} features to {output_file}") 