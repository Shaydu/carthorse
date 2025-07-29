<div align="left">
  <img src="../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# PostgreSQL Status Scripting

This directory contains PostgreSQL versions of the legacy SQLite/SpatiaLite status and monitoring scripts. These scripts provide comprehensive database validation, statistics, and analysis for the PostGIS master database.

## Scripts Overview

### 1. Database Validation
**File**: `carthorse-postgres-validate-database.ts`

**Purpose**: Comprehensive validation of PostGIS trail database after build completion.

**Features**:
- Data completeness analysis
- Quality metrics assessment
- Routing network validation
- Surface and trail type distribution
- Issue identification and recommendations

**Usage**:
```bash
npx ts-node carthorse-postgres-validate-database.ts --db trail_master_db
```

**Output**: Detailed validation report with:
- Summary statistics (total, complete, incomplete trails)
- Trail data quality metrics
- Routing network statistics
- Surface and trail type distributions
- Quality issues and recommendations

### 2. Database Statistics
**File**: `carthorse-postgres-stats.ts`

**Purpose**: Comprehensive statistics about the PostGIS master database.

**Features**:
- Trail statistics (counts, averages, ranges)
- Elevation coverage analysis
- Performance impact assessment
- Surface and trail type distributions
- Routing network connectivity

**Usage**:
```bash
npx ts-node carthorse-postgres-stats.ts --db trail_master_db
```

**Output**: Statistics report with:
- Trail counts and averages
- Elevation coverage percentages
- Quality metrics
- Performance analysis
- Recommendations for improvement

### 3. Elevation Analysis
**File**: `carthorse-postgres-analyze-elevation.ts`

**Purpose**: Detailed analysis of trails missing elevation data.

**Features**:
- Elevation coverage assessment
- Sample trail analysis
- Coordinate dimension statistics
- Geometry type analysis
- Quality issue identification

**Usage**:
```bash
npx ts-node carthorse-postgres-analyze-elevation.ts --db trail_master_db
```

**Output**: Elevation analysis report with:
- Coverage statistics
- Sample trails missing elevation
- Coordinate dimension breakdown
- Geometry type distribution
- Quality issues and recommendations

## Migration from Legacy Scripts

### Legacy Scripts Ported
1. **`carthorse-validate-database.ts`** → **`carthorse-postgres-validate-database.ts`**
   - SQLite/SpatiaLite → PostgreSQL/PostGIS
   - `better-sqlite3` → `pg` (node-postgres)
   - SpatiaLite functions → PostGIS functions

2. **`analyze_missing_elevation.js`** → **`carthorse-postgres-analyze-elevation.ts`**
   - JavaScript → TypeScript
   - SQLite → PostgreSQL
   - Enhanced analysis capabilities

3. **`verify_elevation_coverage.js`** → Integrated into **`carthorse-postgres-stats.ts`**
   - Coverage analysis now part of comprehensive statistics
   - Enhanced performance analysis

### Key Changes in Migration

#### Database Connection
```typescript
// Legacy (SQLite)
const db = new Database(dbPath);
db.loadExtension(SPATIALITE_PATH);

// New (PostgreSQL)
const client = new Client({
  host: 'localhost',
  port: 5432,
  database: dbName,
  user: 'postgres',
  password: 'postgres'
});
await client.connect();
```

#### Spatial Functions
```sql
-- Legacy (SpatiaLite)
CoordDimension(geometry) as dimensions
GeometryType(geometry) as geom_type
NumPoints(geometry) as point_count
AsText(geometry) as coords_sample

-- New (PostGIS)
ST_NDims(geometry) as dimensions
ST_GeometryType(geometry) as geometry_type
ST_NPoints(geometry) as point_count
ST_AsText(ST_Transform(geometry, 4326)) as coordinates_sample
```

#### Query Structure
```sql
-- Legacy (SQLite)
SELECT COUNT(*) as count FROM trails WHERE geometry IS NOT NULL

-- New (PostgreSQL)
SELECT COUNT(*) as count FROM trails WHERE geometry IS NOT NULL
-- (Similar structure, but with PostgreSQL-specific functions)
```

## Configuration

### Database Connection
All scripts use the same PostgreSQL connection configuration:
- **Host**: localhost
- **Port**: 5432
- **User**: postgres
- **Password**: postgres
- **Database**: Specified via `--db` parameter

### Environment Variables
Consider using environment variables for production:
```bash
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=postgres
```

## Usage Examples

### Validate Database After Build
```bash
# After running carthorse-postgres-master-db-builder
npx ts-node carthorse-postgres-validate-database.ts --db trail_master_db
```

### Check Database Statistics
```bash
# Get comprehensive statistics
npx ts-node carthorse-postgres-stats.ts --db trail_master_db
```

### Analyze Elevation Coverage
```bash
# Check elevation data quality
npx ts-node carthorse-postgres-analyze-elevation.ts --db trail_master_db
```

### Integration with Orchestrator
These scripts can be integrated into the main orchestrator:
```typescript
// In carthorse-postgres-orchestrator.ts
import { validateDatabase } from './carthorse-postgres-validate-database';
import { getDatabaseStats } from './carthorse-postgres-stats';
import { analyzeElevationData } from './carthorse-postgres-analyze-elevation';

// After database build
const validation = await validateDatabase(dbName);
const stats = await getDatabaseStats(dbName);
const elevationAnalysis = await analyzeElevationData(dbName);
```

## Output Formats

### Validation Report
```
📊 PostgreSQL Database Validation Report
========================================

🎯 Summary:
   Total Trails: 1,234
   Complete Trails: 1,100
   Incomplete Trails: 134
   Completion Rate: 89.1%

🗺️ Trail Data Quality:
   With Geometry: 1,200 (97.3%)
   With Length: 1,180 (95.6%)
   With Elevation Gain: 1,150 (93.2%)
   ...
```

### Statistics Report
```
📊 PostgreSQL Database Statistics Report
=========================================

🎯 Trail Statistics:
   Total Trails: 1,234
   Trails with Geometry: 1,200
   Trails with Elevation Gain: 1,150
   Average Elevation Gain: 245m
   Average Length: 3.2km
   ...

🏔️ Elevation Coverage:
   Coverage Percentage: 95.8%
   Pre-calculated: 1,150 trails
   Would need UI calculation: 50 trails
```

### Elevation Analysis Report
```
🏔️ PostgreSQL Elevation Analysis Report
========================================

📊 Summary:
   Total Trails: 1,234
   Trails with Geometry: 1,200
   Trails with Elevation Gain: 1,150
   Trails Missing Elevation Gain: 50
   Elevation Coverage: 95.8%

🔍 Sample Trails Missing Elevation Gain:
1. Trail Name (ID: abc123)
   - Points: 45, Type: ST_LineString, Dimensions: 2D
   - Coordinates sample: LINESTRING(-105.2705 40.0150, -105.2706 40.0151)...
```

## Error Handling

All scripts include comprehensive error handling:
- Database connection failures
- PostGIS function errors
- Query execution errors
- Graceful degradation for missing tables

## Performance Considerations

### Query Optimization
- Use appropriate indexes on geometry columns
- Limit sample queries to reasonable sizes
- Use spatial indexes for geometry operations

### Memory Usage
- Process large datasets in batches
- Close database connections properly
- Use streaming for large result sets

## Future Enhancements

### Planned Features
1. **Export Capabilities**: JSON/CSV export of analysis results
2. **Comparative Analysis**: Compare databases across regions
3. **Trend Analysis**: Track database quality over time
4. **Automated Reporting**: Generate reports for CI/CD pipelines
5. **Web Interface**: Web-based dashboard for database monitoring

### Integration Opportunities
1. **CI/CD Pipeline**: Automated validation in build process
2. **Monitoring Dashboard**: Real-time database health monitoring
3. **Alert System**: Notifications for quality issues
4. **Data Quality Scoring**: Automated quality assessment

## Dependencies

### Required Packages
```json
{
  "pg": "^8.11.0",
  "@types/pg": "^8.10.0"
}
```

### PostgreSQL Extensions
- **PostGIS**: Required for spatial operations
- **PostgreSQL**: 14+ recommended

## Troubleshooting

### Common Issues

1. **Connection Errors**
   ```bash
   # Check PostgreSQL is running
   sudo systemctl status postgresql
   
   # Check connection parameters
   psql -h localhost -p 5432 -U postgres -d trail_master_db
   ```

2. **PostGIS Function Errors**
   ```sql
   -- Check PostGIS is installed
   SELECT PostGIS_Version();
   
   -- Check spatial functions
   SELECT ST_GeometryType(ST_GeomFromText('POINT(0 0)'));
   ```

3. **Permission Issues**
   ```sql
   -- Grant necessary permissions
   GRANT ALL PRIVILEGES ON DATABASE trail_master_db TO postgres;
   GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
   ```

### Debug Mode
Add debug logging to scripts:
```typescript
const DEBUG = process.env.DEBUG === 'true';
if (DEBUG) {
  console.log('Executing query:', query);
  console.log('Parameters:', params);
}
```

## Contributing

When adding new status scripts:
1. Follow the existing naming convention: `carthorse-postgres-*.ts`
2. Include comprehensive TypeScript interfaces
3. Add proper error handling
4. Include usage examples in this README
5. Update the integration examples above 