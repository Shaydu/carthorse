#!/bin/bash
# Create a test database from a full backup, restoring only Boulder or Seattle region
# Usage: ./create_test_db_from_backup.sh [boulder|seattle]
# Example: ./create_test_db_from_backup.sh boulder

set -euo pipefail

REGION="${1:-boulder}"
BACKUP_FILE="../../../backups/backup_trail_master_db_full_20250723_072033.sql"
TEST_DB="trail_master_db_test"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file $BACKUP_FILE not found!"
  exit 1
fi

# Step 1: Drop and recreate the test database
echo "[Step 1] Dropping and recreating $TEST_DB..."
dropdb --if-exists "$TEST_DB"
createdb "$TEST_DB"
echo "Test database $TEST_DB created."

# Step 2: Restore schema and all data
echo "[Step 2] Restoring full schema and data to $TEST_DB (this may take a while)..."
psql "$TEST_DB" < "$BACKUP_FILE"
echo "Restore complete."

# Step 3: Remove all trails except the selected region
echo "[Step 3] Removing all trails except region: $REGION..."
psql "$TEST_DB" -c "DELETE FROM public.trails WHERE region <> '$REGION';"
echo "Region filter complete."

echo "Test database $TEST_DB is ready with only the $REGION region." 