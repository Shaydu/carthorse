#!/bin/bash

# Cleanup script for old SQLite test databases
# This removes old test database files that may have outdated schemas

echo "🧹 Cleaning up old SQLite test databases..."

# Find and remove test database files
find . -name "*.db" -type f | while read -r file; do
    # Skip production databases
    if [[ "$file" == *"boulder-export"* ]] || [[ "$file" == *"seattle-export"* ]]; then
        echo "⏭️  Skipping production database: $file"
        continue
    fi
    
    # Check if it's a test database
    if [[ "$file" == *"test"* ]] || [[ "$file" == *"tmp"* ]] || [[ "$file" == *"temp"* ]]; then
        echo "🗑️  Removing test database: $file"
        rm -f "$file"
    fi
done

# Remove test output directories
echo "🗑️  Cleaning test output directories..."
rm -rf src/data/test-sqlite-migration/
rm -rf src/data/test-sqlite-helpers/
rm -rf logs/
rm -rf tmp/

# Remove any SQLite WAL/SHM files
find . -name "*.db-wal" -o -name "*.db-shm" | while read -r file; do
    echo "🗑️  Removing SQLite WAL/SHM file: $file"
    rm -f "$file"
done

echo "✅ Cleanup complete!"
echo ""
echo "📋 Summary of what was cleaned:"
echo "   - Test SQLite database files (*.db)"
echo "   - Test output directories"
echo "   - SQLite WAL/SHM files"
echo "   - Log files"
echo ""
echo "🔄 Next time you run tests, fresh databases will be created with the correct schema."