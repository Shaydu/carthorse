#!/bin/bash

# Cleanup remaining staging schemas in batches
echo "🧹 Cleaning up remaining staging schemas..."

# Get count of remaining schemas
REMAINING=$(psql -d trail_master_db -t -c "SELECT COUNT(*) FROM pg_namespace WHERE nspname LIKE 'carthorse_%';" | tr -d ' ')
echo "📊 Found $REMAINING staging schemas to clean up"

# Process in batches of 10
BATCH_SIZE=10
PROCESSED=0

while [ $REMAINING -gt 0 ]; do
    echo "🔄 Processing batch... ($PROCESSED processed, $REMAINING remaining)"
    
    # Generate and execute DROP statements for next batch
    psql -d trail_master_db -c "
        SELECT 'DROP SCHEMA IF EXISTS ' || nspname || ' CASCADE;' 
        FROM pg_namespace 
        WHERE nspname LIKE 'carthorse_%' 
        ORDER BY nspname 
        LIMIT $BATCH_SIZE;
    " | grep "DROP SCHEMA" | psql -d trail_master_db
    
    # Update counts
    PROCESSED=$((PROCESSED + BATCH_SIZE))
    REMAINING=$(psql -d trail_master_db -t -c "SELECT COUNT(*) FROM pg_namespace WHERE nspname LIKE 'carthorse_%';" | tr -d ' ')
    
    # Safety check to prevent infinite loop
    if [ $REMAINING -eq $(psql -d trail_master_db -t -c "SELECT COUNT(*) FROM pg_namespace WHERE nspname LIKE 'carthorse_%';" | tr -d ' ') ]; then
        echo "⚠️ No progress made, stopping to prevent infinite loop"
        break
    fi
    
    # Small delay to prevent overwhelming the database
    sleep 1
done

echo "✅ Cleanup complete! Processed $PROCESSED schemas"
echo "📊 Remaining staging schemas: $REMAINING"
