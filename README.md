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
npm install carthorse
```

### Prerequisites

- Node.js 18+
- PostgreSQL 12+ with PostGIS 3+
- GDAL/OGR for TIFF processing

## 🛠️ Quick Start

### 1. Install CARTHORSE

```bash
npm install -g carthorse
```

### 2. Configure Environment

Copy the example environment file and configure your settings:

```bash
cp env.example .env
# Edit .env with your database and data source paths
```

### 3. Check Region Readiness

```bash
# Check if a region is ready for export
carthorse-readiness check --region boulder

# List available regions
carthorse-readiness list
```

### 4. Process a Region

```bash
# Build master database and export region
carthorse --region boulder --out data/boulder.db --build-master

# Export existing region data
carthorse --region boulder --out data/boulder.db
```

## 📚 Usage

### CLI Commands

#### Region Readiness Check

```bash
# Basic validation
carthorse-readiness check --region boulder

# Custom database connection
carthorse-readiness check \
  --region seattle \
  --host localhost \
  --port 5432 \
  --user postgres \
  --database trail_master_db
```

#### Orchestrator

```bash
# Build master database from OSM data
carthorse --region boulder --build-master

# Export region to SpatiaLite
carthorse --region boulder --out data/boulder.db

# Export with custom settings
carthorse --region boulder \
  --out data/boulder.db \
  --simplify-tolerance 0.001 \
  --target-size 100 \
  --validate
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

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
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
- Input validation and sanitization
- Secure file handling

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

## Test Database Setup

To run the full end-to-end test suite, you must have a PostgreSQL test database accessible with the username `tester`.

- Create a Postgres user named `tester` (if it does not already exist):
  ```sh
  createuser tester --createdb --login
  # Optionally set a password:
  psql -c "ALTER USER tester WITH PASSWORD 'yourpassword';"
  ```
- Grant the `tester` user access to your test database (e.g., `trail_master_db_test`):
  ```sh
  createdb -O tester trail_master_db_test
  # Or, if the DB already exists:
  psql -c "GRANT ALL PRIVILEGES ON DATABASE trail_master_db_test TO tester;"
  ```
- Ensure your test environment uses this user for all test DB operations.
- Never commit your personal or system username to the codebase or scripts.

**Why?**
- This avoids PII in open source code.
- It ensures tests are portable and safe for CI/CD environments. 

## Geometry Storage and API Expectations

- All geometry columns (e.g., trails.geometry) are stored as binary spatial objects (WKB) in the database (PostGIS/SpatiaLite).
- WKT (Well-Known Text) is only used for conversion at import/export boundaries or for debugging/validation.
- All API/database operations should use the binary geometry type; use ST_AsText(geometry) or AsText(geometry) for WKT conversion if needed.
- If you need to compare geometry as text in tests or debugging, use AsText(geometry) in your SQL queries. 