#!/bin/bash
set -e

# --- CONFIGURATION ---
PROD_DB="trail_master_db"      # Local production-like DB
TEST_DB="trail_master_db_test" # Local test DB
USER="shaydu"                  # Local DB user
REGION="seattle"               # Region to copy
LIMIT=50                        # Number of trails to copy
TABLE="trails"

# --- EXPORT FROM LOCAL PROD ---
echo "Exporting $LIMIT trails from region '$REGION' in $PROD_DB..."
psql -U "$USER" -d "$PROD_DB" -c \
  "COPY (SELECT * FROM $TABLE WHERE region = '$REGION' LIMIT $LIMIT) TO STDOUT WITH CSV HEADER" > /tmp/test_trails.csv

# --- IMPORT INTO TEST DB ---
echo "Truncating $TABLE in $TEST_DB..."
psql -U "$USER" -d "$TEST_DB" -c "TRUNCATE $TABLE RESTART IDENTITY CASCADE;"

echo "Importing trails into $TEST_DB..."
psql -U "$USER" -d "$TEST_DB" -c "COPY $TABLE FROM STDIN WITH CSV HEADER" < /tmp/test_trails.csv

echo "✅ Test data import complete!" 