# Database Validation System

This directory contains comprehensive validation tools for trail databases built by the orchestrator pipeline.

> **Tip:** You can run validation automatically as part of the export process using the CLI:
>
> ```bash
> carthorse --region <region> --out <output_path> --validate
> ```
>
> See the [README CLI Usage section](../../README.md#cli-usage) for more details.

## 📁 Files

- **`validate-database.ts`** - Main validation script with comprehensive checks
- **`post-run-validation.sh`** - Shell script wrapper for easy execution
- **`README-validation.md`** - This documentation

## 🚀 Quick Start

### Validate a Database
```bash
# Using the TypeScript script directly
npx ts-node scripts/db/build/validate-database.ts --db /path/to/database.db

# Using the shell script wrapper
./scripts/db/build/post-run-validation.sh /path/to/database.db
```

### Examples
```bash
# Validate Boulder database
./scripts/db/build/post-run-validation.sh /path/to/data/boulder-complete.db

# Validate Seattle database
./scripts/db/build/post-run-validation.sh /path/to/data/seattle-complete.db
```

## 📊 What Gets Validated

### 🎯 Summary Statistics
- **Total trails** in the database
- **Complete trails** (all required fields present)
- **Completion rate** percentage
- **Incomplete trails** count

### 🗺️ Trail Data Quality
- **Geometry** - 3D trail coordinates
- **Length** - Trail distance in kilometers
- **Elevation data** - Gain, loss, min, max, average
- **Names** - Trail names
- **Surface types** - Dirt, gravel, etc.
- **Trail types** - Path, track, footway, etc.
- **Bounding boxes** - Geographic extents

### 📈 Quality Metrics
- **Average trail length** and elevation gain/loss
- **Trails with zero elevation** (potential issues)
- **Trails with zero length** (invalid data)
- **Trails with invalid geometry** (spatial issues)

### 🔗 Routing Network
- **Routing nodes** count
- **Routing edges** count
- **Connected nodes** (network connectivity)
- **Isolated nodes** (disconnected trails)

### 🛤️ Data Distribution
- **Surface type distribution** - What types of trails
- **Trail type distribution** - Path vs track vs footway
- **Geographic coverage** - Where trails are located

## ⚠️ Issues Detected

The validation script identifies several types of issues:

### ❌ Critical Errors
- **Missing trails table** - Database structure problems
- **No trails found** - Empty database
- **No geometry data** - Spatial data missing
- **No elevation data** - Elevation processing failed

### ⚠️ Warnings
- **High number of zero elevation trails** - TIFF coverage issues
- **Trails with zero length** - Invalid trail data
- **Invalid geometry** - Spatial data problems
- **Sparse routing network** - Trail splitting issues
- **Isolated routing nodes** - Connectivity problems

### 💡 Recommendations
- **Data completeness** - How to improve missing data
- **Quality improvements** - Filtering and processing suggestions
- **Surface type filtering** - Recommendations for trail types
- **Network connectivity** - Routing network improvements

## 🔧 Integration with Orchestrator

The orchestrator pipeline automatically runs validation after completion:

```typescript
// In orchestrator-build.ts
async function main() {
  // ... build process ...
  
  // Validate the database
  validateDatabase();
  
  console.log('🎉 Database build completed successfully!');
}
```

## 📋 Validation Report Example

```
📊 Database Validation Report
============================

🎯 Summary:
   Total Trails: 1162
   Complete Trails: 1162
   Incomplete Trails: 0
   Completion Rate: 100.0%

🗺️ Trail Data Quality:
   With Geometry: 1162 (100.0%)
   With Length: 1162 (100.0%)
   With Elevation Gain: 1162 (100.0%)
   With Elevation Loss: 1162 (100.0%)
   With Names: 1162 (100.0%)
   With Surface: 1162 (100.0%)
   With Trail Type: 1162 (100.0%)
   With BBox: 1162 (100.0%)

📈 Quality Metrics:
   Average Length: 0.89 km
   Average Elevation Gain: 46.3 m
   Average Elevation Loss: 38.7 m
   Trails with Zero Elevation: 195
   Trails with Zero Length: 0
   Trails with Invalid Geometry: 0

🔗 Routing Network:
   Routing Nodes: 49143
   Routing Edges: 58838
   Connected Nodes: 97048
   Isolated Nodes: 619

🛤️ Surface Distribution:
   dirt: 700 (60.2%)
   ground: 337 (29.0%)
   unpaved: 93 (8.0%)
   gravel: 23 (2.0%)
   fine_gravel: 4 (0.3%)
   sand: 2 (0.2%)
   compacted: 2 (0.2%)
   grass: 1 (0.1%)

🏃 Trail Type Distribution:
   path: 650 (55.9%)
   track: 441 (38.0%)
   cycleway: 49 (4.2%)
   footway: 15 (1.3%)
   bridleway: 7 (0.6%)

✅ Database validation passed successfully!
```

## 🎯 Success Criteria

A database is considered **successfully validated** when:

- ✅ **No critical errors** are found
- ✅ **Completion rate** is >90%
- ✅ **All required tables** exist
- ✅ **Routing network** is properly connected
- ✅ **Elevation data** is present for most trails
- ✅ **Geometry data** is valid

## 🔍 Troubleshooting

### Common Issues

**"No TIFF coverage"**
- Add elevation TIFF files to the elevation-data directory
- Ensure TIFF files cover the region bbox

**"High number of zero elevation trails"**
- Check TIFF file quality and coverage
- Verify elevation data processing pipeline

**"Sparse routing network"**
- Check trail splitting logic
- Verify intersection detection

**"Invalid geometry"**
- Check SpatiaLite installation
- Verify coordinate system consistency

### Exit Codes
- **0** - Validation passed successfully
- **1** - Critical errors found or validation failed

## 🛠️ Customization

The validation script can be customized by modifying:

- **Threshold values** for warnings and errors
- **Additional checks** for specific requirements
- **Report format** and output style
- **Integration** with CI/CD pipelines

## 📚 Related Documentation

- [Orchestrator Pipeline](../README.md)
- [Database Schema](../schema/README.md)
- [Elevation Processing](../elevation/README.md)
- [API Service](../../README.md) 