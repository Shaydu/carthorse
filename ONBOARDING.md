# CARTHORSE Onboarding Guide

Welcome to the CARTHORSE pipeline and toolset! This directory contains all the core scripts, documentation, and utilities for building, validating, and exporting high-quality trail and elevation data for the Trail Map project.

---

## 🚦 **Start Here: Essential Docs**

- **[DATA_SOURCES.md](./DATA_SOURCES.md)**
  - _Comprehensive overview of all data sources, directory structure, PostgreSQL schema organization, and the rationale for the hybrid OSM+Postgres approach._

- **[README.md](./README.md)**
  - _Pipeline architecture, data flow diagrams, script usage, and step-by-step explanations of each stage in the orchestrator._

---

## 🧭 **What is CARTHORSE?**

CARTHORSE is the end-to-end data pipeline for transforming raw OSM and elevation data into application-ready trail databases. It is designed for reproducibility, modularity, and robust geospatial analysis.

- **Purpose:**
  - Build and maintain a master trail database from OSM and elevation sources
  - Support reproducible, region-specific, and scalable data processing
  - Enable both automated and manual validation of trail data

- **Key Features:**
  - Local, versioned OSM extracts (no live Overpass dependency)
  - Region-specific schemas for modularity and reproducibility
  - Idempotent upsert logic (safe to re-run scripts)
  - Fast, local SQL queries and spatial indexing
  - Easy to add new regions or data sources

---

## 🛠️ **Directory Structure**

- `README.md` — Pipeline architecture, flow, and script usage
- `DATA_SOURCES.md` — Data source details, directory layout, and schema design
- `carthorse-osm-postgres-loader.ts` — Loads OSM extracts into Postgres schemas
- `carthorse-enhanced-postgres-orchestrator.ts` — Main orchestrator logic
- `test-osm-postgres-loader.ts` — Example/test for OSM data loading
- `migrations/` — SQL migrations for schema setup
- `logs/` — Pipeline and validation logs
- `backups/` — Database backups
- `tools/` — One-off and utility scripts

---

## 🚀 **Getting Started**

1. **Read [DATA_SOURCES.md](./DATA_SOURCES.md) for the big picture.**
2. **See [README.md](./README.md) for pipeline details and script usage.**
3. **Check the scripts directory for entry points and examples.**
4. **Set up your environment:**
   - Install required tools (`osm2pgsql`, `osmium-tool`) via Homebrew
   - Set `SOURCE_DATA_DIR` to your local data directory

---

## 🤖 **For AI Models**
- **Start with `DATA_SOURCES.md` for context.**
- **Use `README.md` for pipeline logic and script entry points.**
- **All code and data flow is documented and discoverable from these two files.**

---

## 👩‍💻 **For Human Developers**
- **Follow the same steps as above.**
- **All scripts are documented and have clear entry points.**
- **If in doubt, start with this ONBOARDING.md and branch out.**

---

**This file is the canonical entrypoint for the CARTHORSE toolset. Point any new developer or AI session here to get up to speed quickly!** 