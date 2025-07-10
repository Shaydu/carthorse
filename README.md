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