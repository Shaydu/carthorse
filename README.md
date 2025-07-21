<p align="center">
  <img src="https://raw.githubusercontent.com/carthorse/carthorse/main/logo.png" alt="Carthorse Logo" width="180"/>
</p>

# CARTHORSE

A comprehensive geospatial trail data processing pipeline for building 3D trail databases with elevation data from OpenStreetMap, GPX files, and elevation TIFFs.

## 🚀 Features

- **3D Trail Processing**: Convert 2D trail data to 3D with elevation information
- **Multi-Source Data**: Support for OpenStreetMap, GPX files, and elevation TIFFs
- **PostgreSQL/PostGIS Integration**: Robust database backend with spatial indexing
- **Region-Based Processing**: Process trails by geographic regions
- **Data Integrity Validation**: Comprehensive validation and quality checks
- **Export to SpatiaLite**: Generate optimized databases for deployment
- **CLI Tools**: Easy-to-use command-line interface

## 📦 Installation

```bash
npm install -g carthorse
```

### Prerequisites

- Node.js 18+
- PostgreSQL 12+ with PostGIS 3+
- GDAL/OGR for TIFF processing

## 🛠️ Quick Start

### 1. Configure Environment

Copy the example environment file and configure your settings:

```bash
cp env.example .env
# Edit .env with your database and data source paths
```

### 2. Check Region Readiness

```bash
# Check if a region is ready for export
carthorse-readiness check --region boulder

# List available regions
carthorse-readiness list
```

### 3. Process a Region

```bash
# Build master database and export region
carthorse --region boulder --out data/boulder.db --build-master

# Export existing region data
carthorse --region boulder --out data/boulder.db
```

## 📚 CLI Usage

### Main Export Command

```bash
carthorse --region <region> --out <output_path> [options]
```

#### Options

| Option                        | Description                                                      | Default                      |
|-------------------------------|------------------------------------------------------------------|------------------------------|
| `-r, --region <region>`       | Region to process (e.g., boulder, seattle)                       | (required)                   |
| `-o, --out <output_path>`     | Output database path                                             | `api-service/data/<region>.db`|
| `--simplify-tolerance <num>`  | Geometry simplification tolerance                                | `0.001`                      |
| `--intersection-tolerance <n>`| Intersection detection tolerance (meters)                        | `2`                          |
| `--target-size <size_mb>`     | Target database size in MB                                       |                              |
| `--max-spatialite-db-size <n>`| Maximum SpatiaLite database size in MB                           | `400`                        |
| `--replace`                   | Replace existing database                                        | `false`                      |
| `--validate`                  | Run validation after processing                                  | `false`                      |
| `--verbose`                   | Enable verbose logging                                           | `false`                      |
| `--skip-backup`               | Skip database backup                                             | `false`                      |
| `--build-master`              | Build master database from OSM data                              | `false`                      |
| `--deploy`                    | Build and deploy to Cloud Run after processing                   | `false`                      |
| `--skip-incomplete-trails`    | Skip trails missing elevation data or geometry                   | `false`                      |
| `-h, --help`                  | Show help                                                        |                              |
| `-V, --version`               | Show version                                                     |                              |

#### Examples

```bash
# Export Boulder region to a SpatiaLite DB
carthorse --region boulder --out data/boulder.db

# Build master DB and export, skipping incomplete trails
carthorse --region boulder --out data/boulder.db --build-master --skip-incomplete-trails

# Export with custom geometry simplification and target size
carthorse --region seattle --out data/seattle.db --simplify-tolerance 0.002 --target-size 100

# Export and run validation
carthorse --region boulder --out data/boulder.db --validate
```

### Region Readiness Command

```bash
carthorse-readiness check --region <region>
carthorse-readiness list
```

### Validation

- Use `--validate` with the main export command to run validation after export.
- See [docs/requirements/validation.md](docs/requirements/validation.md) for details.

## Environment Configuration

CARTHORSE looks for environment variables in the following files (in order of preference):

1. `.env` - Standard environment file
2. `env.local` - Local environment (common setup)
3. `api-service/.env.api.local` - API-specific environment
4. `.env.local` - Alternative local environment

### Required Environment Variables

```bash
# Database Configuration
PGUSER=your_username          # Database user (required)
PGHOST=localhost             # Database host (required)
PGDATABASE=your_database     # Database name (required)
PGPASSWORD=your_password     # Database password (optional)
PGPORT=5432                  # Database port (optional, default: 5432)

# Optional: Custom environment file
ENV_FILE=path/to/custom.env
```

### Example .env file

```bash
PGUSER=postgres
PGHOST=localhost
PGDATABASE=trail_master_db
PGPASSWORD=
PGPORT=5432
```

### Environment Variables

```bash
# Database Configuration
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_password
PGDATABASE=trail_master_db

# Data Source Paths
SOURCE_DATA_DIR=/path/to/source-data
ELEVATION_TIFF_DIR=/path/to/elevation-data
OSM_DATA_PATH=/path/to/osm/data
```

### Configuration Files

- `env.example`: Environment variables template
- `geo-bounds.json`: Region boundaries
- `api-regions.json`: API region definitions

## 🏗️ Architecture

```
CARTHORSE/
├── src/
│   ├── cli/                   # Command-line interfaces
│   ├── orchestrator/          # Main processing pipeline
│   ├── inserters/             # Database insertion utilities
│   ├── loaders/               # Data loading utilities
│   ├── processors/            # Data processing modules
│   ├── validation/            # Data integrity validation
│   ├── types/                 # TypeScript type definitions
│   └── constants.ts           # Shared constants
├── dist/                      # Compiled JavaScript
├── env.example               # Environment template
├── package.json              # NPM package configuration
└── README.md                 # This file
```

## 🧪 Testing

The project includes a comprehensive test suite that validates the entire pipeline:

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testNamePattern="boulder|seattle"

# Run with verbose output
npm test -- --verbose
```

### Test Coverage

- **Integration Tests**: Full pipeline validation for Boulder and Seattle regions
- **CLI Tests**: Command-line interface functionality
- **Data Validation**: Trail data integrity and schema validation
- **Export Validation**: SpatiaLite database generation and structure

### Test Stability

The test suite has been optimized for reliability:
- All tests complete without hanging
- Proper process cleanup and timeouts
- Consistent SpatiaLite database generation
- Validated routing nodes and edges export

## 🛠️ Helpful Utilities

The project includes several development utilities in the `scripts/dev-utils/` directory:

### Bandwidth Monitoring

Monitor your network usage during development sessions:

```bash
# Simple bandwidth tracker (safe monitoring only)
./scripts/dev-utils/simple_bandwidth_tracker.sh [limit_mb] [alert_percent]

# Examples:
./scripts/dev-utils/simple_bandwidth_tracker.sh 500 75  # 500MB limit, alert at 75%
./scripts/dev-utils/simple_bandwidth_tracker.sh 1000 80 # 1GB limit, alert at 80%

# Advanced bandwidth monitor (with shutdown capability)
./scripts/dev-utils/bandwidth_monitor.sh [limit_mb] [alert_percent] [shutdown_threshold]
```

**Features:**
- Real-time bandwidth usage tracking
- Visual progress bars and percentage display
- Audio alerts at configurable thresholds
- Session logging to `/tmp/bandwidth_session.log`
- Safe monitoring without network disruption

**Alert System:**
- **75% threshold**: Warning alert with audio notification
- **100% threshold**: Critical alert with audio notification
- **Log tracking**: All usage logged with timestamps

### Database Utilities

```bash
# Create trimmed test database from production
./scripts/dev-utils/create_test_database_advanced.sh [size] [target_db_name]

# Available sizes: tiny, small, medium, large
./scripts/dev-utils/create_test_database_advanced.sh small trail_master_db_test
```

**Note:** These utilities are excluded from version control via `.gitignore` as they are development tools, not part of the core application.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests (ensure they pass consistently)
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/your-org/carthorse/issues)
- **Documentation**: [Wiki](https://github.com/your-org/carthorse/wiki)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/carthorse/discussions)

## 🗺️ Supported Regions

- Boulder, CO
- Seattle, WA
- Denver, CO
- Portland, OR
- San Francisco, CA

## 🔧 Configuration

### Environment Variables

```bash
# Database
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_password
PGDATABASE=trail_master_db

# Data Sources
OSM_DATA_PATH=/path/to/osm/data
ELEVATION_DATA_PATH=/path/to/elevation/tiffs
```

### Configuration Files

- `geo-bounds.json`: Region boundaries
- `api-regions.json`: API region definitions
- `.env`: Environment variables

## 📊 Performance

- **Processing Speed**: ~1000 trails/minute
- **Memory Usage**: ~2GB for large regions
- **Database Size**: 50-500MB per region
- **Export Time**: 5-30 minutes per region

## 🔒 Security

- No sensitive data in logs
- Database connection encryption 

## 📈 Roadmap

- [ ] Support for additional data sources
- [ ] Real-time processing capabilities
- [ ] Cloud deployment options
- [ ] Advanced analytics features
- [ ] Mobile app integration 

## 🚦 Project Roadmap

- [ ] **Automated CLI/Integration Testing**
  - Add Jest-based tests that invoke the CLI (e.g., `npx carthorse ...`) and check for correct output, logs, and DB files.
  - Validate exported SQLite/SpatiaLite DB contents in tests.
- [ ] **Continuous Integration (CI/CD)**
  - Add a GitHub Actions workflow to run build and tests on every push/PR.
  - Ensure CLI works in a clean environment (e.g., `npx carthorse --version` and a sample export).
- [ ] **Release Automation**
  - Automate npm publishing after successful CI.
  - Add changelog and version bump automation.
- [ ] **Documentation Improvements**
  - Expand CLI usage examples and troubleshooting.
  - Add developer onboarding and contribution guidelines.

## ⚠️ Geometry Format Policy

**All geometry in Carthorse is stored and handled as binary (WKB) spatial objects in the database (PostGIS/SpatiaLite).**
- WKT (Well-Known Text) is only used for conversion at import/export boundaries or for debugging/validation.
- All API/database operations use the binary geometry type; use ST_AsText(geometry) or AsText(geometry) for WKT conversion if needed.

## Database Schema Differences: Postgres vs. SQLite/SpatiaLite

Carthorse supports both Postgres (with PostGIS) and SQLite/SpatiaLite as backing stores for trail and routing data. **There is a key schema difference regarding region support:**

- **Postgres (PostGIS):**
  - The `trails` table includes a `region` column. This allows a single database to store trails for multiple regions, and all queries/exports are filtered by region.
- **SQLite/SpatiaLite:**
  - The `trails` table does **not** include a `region` column. Each database file is single-region, and the region context is provided by the database itself (e.g., filename or the `regions` table, which typically has a single row).
  - All trails in a given SQLite/SpatiaLite DB are assumed to belong to the same region.

**Carthorse code and tests must account for this difference:**
- When working with Postgres, always filter and insert using the `region` column.
- When working with SQLite/SpatiaLite, do not expect or reference a `region` column in the `trails` table. Use the `regions` table or database context for region information.

> If you encounter errors or test failures related to a missing `region` column in SQLite/SpatiaLite, update your code/tests to match this schema distinction. 

## 📋 Development Status

See [TODO.md](TODO.md) for current development status, known issues, and next steps.

## Test Database Setup

To run the full end-to-end test suite, you must have a PostgreSQL test database accessible with your system username.

### Current Database Configuration

**Production Database:** `trail_master_db` (3,170+ trails)
**Test Database:** `trail_master_db_test` (75 sample trails)

### Setup Instructions

1. **Create a Postgres user with your system username** (if it does not already exist):
   ```sh
   createuser $USER --createdb --login
   # Optionally set a password:
   psql -c "ALTER USER $USER WITH PASSWORD 'yourpassword';"
   ```

2. **Create and populate the test database:**
   ```sh
   # Create test database
   createdb -O $USER trail_master_db_test
   
   # Copy sample data from production (50 Boulder + 25 Seattle trails)
   psql -h localhost -U $USER -d trail_master_db -c "COPY (SELECT * FROM trails WHERE region = 'boulder' LIMIT 50) TO STDOUT WITH CSV HEADER" > /tmp/boulder_sample.csv
   PGDATABASE=trail_master_db_test PGUSER=$USER psql -c "COPY trails FROM STDIN WITH CSV HEADER" < /tmp/boulder_sample.csv
   
   psql -h localhost -U $USER -d trail_master_db -c "COPY (SELECT * FROM trails WHERE region = 'seattle' LIMIT 25) TO STDOUT WITH CSV HEADER" > /tmp/seattle_sample.csv
   PGDATABASE=trail_master_db_test PGUSER=$USER psql -c "COPY trails FROM STDIN WITH CSV HEADER" < /tmp/seattle_sample.csv
   ```

3. **Set test environment variables:**
   ```sh
   export PGDATABASE=trail_master_db_test
   export PGUSER=$USER
   ```

4. **Run tests:**
   ```sh
   npm test
   ```

### Test Data Summary

- **Boulder Region:** 50 sample trails (bbox: -105.8 to -105.1, 39.7 to 40.7)
- **Seattle Region:** 25 sample trails (bbox: -122.19 to -121.78, 47.32 to 47.74)
- **Total Test Data:** 75 trails (vs 3,170+ in production)

### Why This Approach?

- **Safety:** Tests use isolated test database, never production
- **Speed:** Small dataset enables fast test execution
- **Reliability:** Consistent test data across environments
- **Portability:** No PII or personal credentials in codebase 

## Geometry Storage and API Expectations

- All geometry columns (e.g., trails.geometry) are stored as binary spatial objects (WKB) in the database (PostGIS/SpatiaLite).
- WKT (Well-Known Text) is only used for conversion at import/export boundaries or for debugging/validation.
- All API/database operations should use the binary geometry type; use ST_AsText(geometry) or AsText(geometry) for WKT conversion if needed.
- If you need to compare geometry as text in tests or debugging, use AsText(geometry) in your SQL queries. 

## Bundled SQL Files

All required SQL files (such as carthorse-postgis-intersection-functions.sql) are now bundled in the `sql/` directory of the npm package. These files are referenced internally by Carthorse, and you do not need to copy or inject them into your own project directories. After installing Carthorse, all required SQL files are available and used automatically. 

## Bundled SQL Functions

All required SQL files (such as carthorse-postgis-intersection-functions.sql) are now bundled in the `sql/` directory of the npm package. These files are referenced automatically by Carthorse, and you do not need to copy or inject them into your own project directories. After installing Carthorse, all required SQL files are available and used automatically. 