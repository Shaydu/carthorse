const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/orchestrator/CarthorseOrchestrator.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Replace the hardcoded > 5 with the configurable parameter
content = content.replace(
  /AND ST_Length\(t1\.geometry::geography\) > 5/g,
  'AND ST_Length(t1.geometry::geography) > $${batchQueryParams.length}'
);
content = content.replace(
  /AND ST_Length\(t2\.geometry::geography\) > 5/g,
  'AND ST_Length(t2.geometry::geography) > $${batchQueryParams.length}'
);

fs.writeFileSync(filePath, content);
console.log('✅ Updated SQL queries to use configurable minTrailLengthMeters parameter'); 