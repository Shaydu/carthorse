#!/bin/bash

# Auto-Create Indexes for Staging Schemas
# This script automatically creates optimized indexes for new staging schemas

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --schema=SCHEMA_NAME    Create indexes for specific schema"
    echo "  --dry-run               Show what would be executed without running"
    echo "  --help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Create indexes for latest staging schema"
    echo "  $0 --schema=carthorse_1234567890  # Create indexes for specific schema"
    echo "  $0 --dry-run            # Show what would be executed"
    echo ""
    echo "Environment variables:"
    echo "  DB_HOST                 Database host (default: localhost)"
    echo "  DB_USER                 Database user (default: carthorse)"
    echo "  DB_PASSWORD             Database password"
    echo "  DB_NAME                 Database name (default: trail_master_db)"
    echo "  DB_PORT                 Database port (default: 5432)"
}

# Parse command line arguments
DRY_RUN=false
SCHEMA_ARG=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --schema=*)
            SCHEMA_ARG="$1"
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed or not in PATH"
    exit 1
fi

# Check if the script exists
SCRIPT_PATH="$(dirname "$0")/auto-create-indexes.js"
if [[ ! -f "$SCRIPT_PATH" ]]; then
    print_error "Script not found: $SCRIPT_PATH"
    exit 1
fi

# Build command
CMD="node $SCRIPT_PATH"
if [[ "$DRY_RUN" == true ]]; then
    CMD="$CMD --dry-run"
fi
if [[ -n "$SCHEMA_ARG" ]]; then
    CMD="$CMD $SCHEMA_ARG"
fi

print_status "Starting index creation..."
print_status "Command: $CMD"

# Execute the script
if eval "$CMD"; then
    print_success "Index creation completed successfully!"
else
    print_error "Index creation failed!"
    exit 1
fi
