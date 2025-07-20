#!/bin/bash
# Post-Run Database Validation Script
# 
# This script runs comprehensive validation on a trail database after build completion.
# It can be run independently or called from the orchestrator.
#
# Usage:
#   ./post-run-validation.sh <database_path>
#   ./post-run-validation.sh /path/to/data/boulder-complete.db

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if database path is provided
if [ $# -eq 0 ]; then
    echo -e "${RED}❌ Error: Please provide database path${NC}"
    echo "Usage: $0 <database_path>"
    echo "Example: $0 /path/to/data/boulder-complete.db"
    exit 1
fi

DB_PATH="$1"

# Check if database file exists
if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}❌ Error: Database file not found: $DB_PATH${NC}"
    exit 1
fi

echo -e "${BLUE}🔍 Running post-build validation...${NC}"
echo -e "${BLUE}📁 Database: $DB_PATH${NC}"
echo ""

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run the validation script
if npx ts-node "$SCRIPT_DIR/validate-database.ts" --db "$DB_PATH"; then
    echo ""
    echo -e "${GREEN}✅ Validation completed successfully!${NC}"
    exit 0
else
    echo ""
    echo -e "${YELLOW}⚠️ Validation completed with warnings or errors${NC}"
    echo -e "${YELLOW}Check the output above for details${NC}"
    exit 1
fi 