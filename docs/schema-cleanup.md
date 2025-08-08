# Schema Cleanup Documentation

## Overview

The Carthorse project includes robust schema cleanup functionality that handles cascading drops and resolves connection conflicts automatically.

## Schema Drop Process

### Why Schema Drops Can Be Slow

Schema drops can take a long time due to:

1. **Multiple concurrent DROP commands**: When multiple processes try to drop the same schema simultaneously
2. **Active queries**: Long-running queries that are using the schema create locks
3. **Database locks**: Concurrent operations block each other, creating deadlocks

### Improved Drop Process

The enhanced schema drop process includes:

1. **Connection termination**: Automatically terminates conflicting database connections
2. **Conflict resolution**: Waits for connections to fully terminate before proceeding
3. **Schema verification**: Checks if schema exists before attempting to drop
4. **Table counting**: Reports how many tables will be dropped
5. **Force cascade**: Uses `DROP SCHEMA IF EXISTS ... CASCADE` for complete removal
6. **Verification**: Confirms the schema was actually dropped

## Usage

### CLI Command

```bash
# Drop a specific schema
npm run drop:schema <schema-name>

# Example
npm run drop:schema staging_boulder_1754240373908
```

### Direct Command

```bash
# Using npx directly
npx ts-node src/cli/drop-schema.ts <schema-name>

# Example
npx ts-node src/cli/drop-schema.ts staging_boulder_1754240373908
```

### Orchestrator Integration

The cleanup service in the orchestrator also includes the improved drop functionality:

```typescript
import { CleanupService } from '../utils/cleanup-service';

const cleanupService = new CleanupService(client);
await cleanupService.cleanSpecificStagingSchema('staging_boulder_1754240373908');
```

## Troubleshooting

### If Schema Drop Still Hangs

1. **Check for active connections**:
   ```sql
   SELECT pid, usename, application_name, state, query 
   FROM pg_stat_activity 
   WHERE query LIKE '%schema_name%';
   ```

2. **Manually terminate connections**:
   ```sql
   SELECT pg_terminate_backend(pid) 
   FROM pg_stat_activity 
   WHERE query LIKE '%schema_name%' 
     AND pid != pg_backend_pid();
   ```

3. **Force drop with direct SQL**:
   ```sql
   DROP SCHEMA IF EXISTS "schema_name" CASCADE;
   ```

### Common Issues

- **Permission errors**: Ensure your database user has DROP privileges
- **Foreign key constraints**: The CASCADE option should handle these automatically
- **Long-running queries**: The improved process terminates these automatically

## Best Practices

1. **Use the CLI command**: Always use the provided CLI command rather than manual SQL
2. **Check before dropping**: The command will tell you if the schema doesn't exist
3. **Monitor progress**: The command provides detailed progress information
4. **Verify completion**: The command verifies the drop was successful

## Integration with CarthorseOrchestrator

The schema drop functionality is integrated with the CarthorseOrchestrator and follows the repository rules:

- ✅ Uses CarthorseOrchestrator methods
- ✅ Follows proper cleanup workflows
- ✅ Handles conflicts automatically
- ✅ Provides detailed logging
- ✅ Verifies operations complete successfully 