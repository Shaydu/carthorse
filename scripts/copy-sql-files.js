// scripts/copy-sql-files.js
const fs = require('fs');
const path = require('path');

const sqlDir = path.resolve(__dirname, '../sql');
const filesToCopy = [
  'carthorse-postgis-intersection-functions.sql',
  'carthorse-postgres-schema.sql',
  'carthorse-template-schema.sql',
  'carthorse-postgres-constraints.sql',
  'add-basic-elevation-constraints.sql'
];

if (!fs.existsSync(sqlDir)) {
  fs.mkdirSync(sqlDir);
}

filesToCopy.forEach(filename => {
  const src = path.resolve(__dirname, '../', filename);
  const dest = path.join(sqlDir, filename);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${filename} to sql/`);
  } else {
    console.warn(`Warning: ${filename} not found in project root, skipping.`);
  }
}); 