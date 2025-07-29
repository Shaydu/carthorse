#!/bin/bash

# Carthorse v2.0 Release Cleanup Script
# This script removes test data, legacy files, and cleans up the repository

set -e

echo "🧹 Starting Carthorse v2.0 Release Cleanup..."
echo "================================================"

# Create backup directory for important files
BACKUP_DIR="backups/pre-v2-cleanup-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "📦 Creating backup of important files in $BACKUP_DIR..."

# Backup important files before deletion
if [ -f "garbage/README.md" ]; then
    cp -r garbage/README.md "$BACKUP_DIR/"
fi

if [ -f "garbage/LEARNING.md" ]; then
    cp -r garbage/LEARNING.md "$BACKUP_DIR/"
fi

if [ -f "garbage/ONBOARDING.md" ]; then
    cp -r garbage/ONBOARDING.md "$BACKUP_DIR/"
fi

# Backup any important SQL files
if [ -d "garbage" ]; then
    find garbage -name "*.sql" -type f | head -5 | while read file; do
        cp "$file" "$BACKUP_DIR/"
    done
fi

echo "🗑️  Cleaning up data directory (841MB)..."
echo "   Removing test database files..."

# Remove all .db files in data directory
find data/ -name "*.db" -type f -delete

# Remove .dump files
find data/ -name "*.dump" -type f -delete

echo "🗑️  Cleaning up garbage directory (665MB)..."
echo "   Removing legacy scripts and test files..."

# Remove entire garbage directory
rm -rf garbage/

echo "🗑️  Cleaning up root level test files..."

# Remove root level test files
rm -f amphitheater-test.db
rm -f full-boulder-test.db
rm -f test-output.db

echo "🗑️  Cleaning up empty directories..."

# Remove empty directories
rmdir tmp/ 2>/dev/null || true
rmdir logs/ 2>/dev/null || true

echo "🗑️  Cleaning up old backups..."

# Keep only the latest backup, remove older ones
if [ -d "backups" ]; then
    # Keep the most recent backup file
    find backups/ -name "*.sql" -type f | head -1 | while read file; do
        echo "   Keeping: $file"
    done
    # Remove other backup files (keep only the latest)
    find backups/ -name "*.sql" -type f | tail -n +2 | xargs rm -f 2>/dev/null || true
fi

echo "🧹 Running final cleanup..."

# Remove any remaining empty directories
find . -type d -empty -delete 2>/dev/null || true

# Clean up any temporary files
find . -name "*.tmp" -delete 2>/dev/null || true
find . -name "*.log" -delete 2>/dev/null || true

echo "📊 Cleanup Summary:"
echo "==================="

# Show space freed
echo "📁 Directory sizes after cleanup:"
du -sh data/ 2>/dev/null || echo "data/ - cleaned"
du -sh garbage/ 2>/dev/null || echo "garbage/ - removed"
du -sh backups/ 2>/dev/null || echo "backups/ - cleaned"
du -sh tmp/ 2>/dev/null || echo "tmp/ - cleaned"
du -sh logs/ 2>/dev/null || echo "logs/ - cleaned"

echo ""
echo "✅ Cleanup completed successfully!"
echo "📦 Important files backed up to: $BACKUP_DIR"
echo "🚀 Repository is now clean for v2.0 release!"