# Type System Organization - Carthorse

## Type Categories

### Canonical Types
Define these in `@/types/` for shared use:
- `GeoJSONCoordinate` - Geographic coordinates
- `BoundingBox` - Geographic bounds
- `CenterCoordinate` - Center point coordinates

### API Types
Define these in `@/api-types/`:
- Request/response interfaces
- API contract types
- Validation schemas

### UI Types
Define these in `@/frontend-types/`:
- Component props
- UI state types
- Form data types

## Type Rules
- Never use inline types
- Always import from correct location
- Use descriptive, specific names
- Document complex types
