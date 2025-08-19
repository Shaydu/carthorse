#!/bin/bash

# Database Backup Script
# Backs up trail_master_db to shaydu/dev directory with timestamp

set -e

# Configuration
DB_NAME="trail_master_db"
DB_USER="carthorse"
DB_HOST="localhost"
BACKUP_DIR="/Users/shaydu/dev"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/trail_master_db_backup_${TIMESTAMP}.sql"

echo "🗄️ Starting database backup..."
echo "   Database: ${DB_NAME}"
echo "   Backup file: ${BACKUP_FILE}"

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# Create backup
echo "📦 Creating backup..."
pg_dump -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" --verbose --clean --if-exists --no-owner --no-privileges > "${BACKUP_FILE}"

# Check if backup was successful
if [ $? -eq 0 ]; then
    BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    echo "✅ Backup completed successfully!"
    echo "   File: ${BACKUP_FILE}"
    echo "   Size: ${BACKUP_SIZE}"
    echo "   Timestamp: ${TIMESTAMP}"
else
    echo "❌ Backup failed!"
    exit 1
fi

# List recent backups
echo ""
echo "📋 Recent backups in ${BACKUP_DIR}:"
ls -la "${BACKUP_DIR}"/trail_master_db_backup_*.sql 2>/dev/null | tail -5 || echo "   No previous backups found"

echo ""
echo "🎯 Backup ready for cleanup operations!"
