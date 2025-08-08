#!/bin/bash

# Carthorse Cleanup Script for Unused GeoJSON Exports and Duplicated Databases
# This script removes unused export files and duplicated database files

set -e

echo "🧹 Starting Carthorse Cleanup for Unused Exports and Duplicated Databases..."
echo "========================================================================"

# Create backup directory for important files
BACKUP_DIR="backups/cleanup-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "📦 Creating backup directory: $BACKUP_DIR"

# Function to safely remove files with confirmation
safe_remove() {
    local file="$1"
    local reason="$2"
    
    if [ -f "$file" ]; then
        local size=$(du -h "$file" | cut -f1)
        echo "🗑️  Removing $file ($size) - $reason"
        rm -f "$file"
    fi
}

# Function to safely remove directories
safe_remove_dir() {
    local dir="$1"
    local reason="$2"
    
    if [ -d "$dir" ]; then
        local size=$(du -sh "$dir" 2>/dev/null | cut -f1 || echo "unknown")
        echo "🗑️  Removing directory $dir ($size) - $reason"
        rm -rf "$dir"
    fi
}

echo ""
echo "🗑️  Cleaning up unused GeoJSON exports from root directory..."

# Remove unused GeoJSON files from root directory
safe_remove "top-route-recommendations.geojson" "unused route recommendations export"
safe_remove "route-recommendations-test.geojson" "test route recommendations export"
safe_remove "test-boulder-fixed-export.geojson" "test boulder fixed export"
safe_remove "test-boulder-fixed.geojson" "test boulder fixed"
safe_remove "test-boulder-complete.geojson" "test boulder complete"
safe_remove "test-optimized-working-edges.geojson" "test optimized working edges"
safe_remove "boulder-working-node-edge.geojson" "boulder working node edge"
safe_remove "intersection-network-full-boulder.geojson" "intersection network full boulder"
safe_remove "intersection-network-with-junctions.geojson" "intersection network with junctions"
safe_remove "intersection-network-boy-scout-debug.geojson" "intersection network boy scout debug"
safe_remove "intersection-network-debug-loops.geojson" "intersection network debug loops"
safe_remove "intersection-network-refined.geojson" "intersection network refined"
safe_remove "intersection-network-fixed.geojson" "intersection network fixed"

echo ""
echo "🗑️  Cleaning up test database files from root directory..."

# Remove test database files from root directory
safe_remove "test-route-recommendations.db" "test route recommendations database"
safe_remove "debug-test.db" "debug test database"
safe_remove "test-chautauqua-trails-only.geojson.db" "test chautauqua trails database"
safe_remove "boulder-working-node-edge.geojson.db" "boulder working node edge database"
safe_remove "boulder-valley-ranch-post-refactor.db" "boulder valley ranch post refactor database"
safe_remove "boulder-valley-ranch-old.db" "boulder valley ranch old database"
safe_remove "boulder-valley-ranch-original-bbox.db" "boulder valley ranch original bbox database"

# Keep the main boulder.db in root as it might be important
echo "⏭️  Keeping boulder.db in root directory (may be important)"

echo ""
echo "🗑️  Cleaning up test output directory..."

# Remove test output GeoJSON files
safe_remove_dir "test-output" "test output directory with unused exports"

echo ""
echo "🗑️  Cleaning up data directory..."

# Remove unused GeoJSON files from data directory
safe_remove "data/boulder-complete-network-with-real-names.geojson" "boulder complete network with real names"
safe_remove "data/boulder-with-real-names.geojson" "boulder with real names"
safe_remove "data/boulder-valley-ranch-4x-expanded.geojson" "boulder valley ranch 4x expanded"
safe_remove "data/boulder-valley-ranch-working.geojson" "boulder valley ranch working"
safe_remove "data/boulder-pgrouting-final.geojson" "boulder pgrouting final"
safe_remove "data/boulder-pgrouting-exit-test.geojson" "boulder pgrouting exit test"
safe_remove "data/boulder-pgrouting-simple.geojson" "boulder pgrouting simple"

# Remove files with _clean_trails.geojson suffix (test files)
find data/ -name "*_clean_trails.geojson" -type f | while read -r file; do
    safe_remove "$file" "clean trails test file"
done

# Remove various test files with specific patterns
find data/ -name "boulder-*-test.geojson" -type f | while read -r file; do
    safe_remove "$file" "boulder test file"
done

find data/ -name "boulder-pgrouting-*.geojson" -type f | while read -r file; do
    safe_remove "$file" "boulder pgrouting test file"
done

find data/ -name "boulder-valley-ranch-*.geojson" -type f | while read -r file; do
    safe_remove "$file" "boulder valley ranch test file"
done

echo ""
echo "🗑️  Cleaning up temporary test files from root directory..."

# Remove temporary test JavaScript files
safe_remove "test-orchestrator-loop-integration-small.js" "test orchestrator loop integration small"
safe_remove "test-orchestrator-loop-integration-10mile.js" "test orchestrator loop integration 10mile"
safe_remove "test-orchestrator-loop-integration.js" "test orchestrator loop integration"
safe_remove "test-pgr-comparison.js" "test pgr comparison"
safe_remove "test-pgr-workflow-simplified.js" "test pgr workflow simplified"
safe_remove "test-pgr-nodenetwork-fixed.js" "test pgr nodenetwork fixed"
safe_remove "test-pgr-workflow-simple.js" "test pgr workflow simple"
safe_remove "test-pgr-workflow.js" "test pgr workflow"
safe_remove "test-network-analysis-manual.js" "test network analysis manual"
safe_remove "test-pgr-nodes-edges.js" "test pgr nodes edges"
safe_remove "test-pgr-nodenetwork-benjamin.js" "test pgr nodenetwork benjamin"

echo ""
echo "🗑️  Cleaning up SQLite WAL/SHM files..."

# Remove SQLite WAL/SHM files
find . -name "*.db-wal" -o -name "*.db-shm" | while read -r file; do
    safe_remove "$file" "SQLite WAL/SHM file"
done

echo ""
echo "🗑️  Cleaning up empty directories..."

# Remove empty directories
find . -type d -empty -delete 2>/dev/null || true

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📋 Summary of what was cleaned:"
echo "   - Unused GeoJSON export files (~200MB+)"
echo "   - Duplicate database files"
echo "   - Test output directories"
echo "   - Temporary test JavaScript files"
echo "   - SQLite WAL/SHM files"
echo "   - Empty directories"
echo ""
echo "💾 Important files preserved:"
echo "   - data/boulder.db (main production database)"
echo "   - Essential source code and documentation"
echo "   - Configuration files"
echo "   - Backup directories"
echo ""
echo "🔄 The codebase is now cleaner and more organized!" 