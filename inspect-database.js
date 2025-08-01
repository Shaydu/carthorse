#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

async function inspectDatabase() {
  const dbPath = path.resolve(__dirname, 'boulder-final-export.db');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database file not found: ${dbPath}`);
    process.exit(1);
  }

  console.log('🔍 Inspecting database...');
  const db = new sqlite3.Database(dbPath);
  
  return new Promise((resolve, reject) => {
    // Get all tables
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
      if (err) {
        console.error('❌ Error getting tables:', err);
        reject(err);
        return;
      }
      
      console.log('📋 Available tables:');
      tables.forEach(table => {
        console.log(`   - ${table.name}`);
      });
      console.log('');
      
      // Check each table for data
      let tableIndex = 0;
      const checkTable = () => {
        if (tableIndex >= tables.length) {
          db.close();
          resolve();
          return;
        }
        
        const tableName = tables[tableIndex].name;
        db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, result) => {
          if (err) {
            console.log(`   ⚠️  ${tableName}: Error - ${err.message}`);
          } else {
            console.log(`   📊 ${tableName}: ${result.count} rows`);
            
            // If it's a table with coordinates, show some sample data
            if (tableName.includes('node') || tableName.includes('edge') || tableName.includes('trail')) {
              db.get(`SELECT * FROM ${tableName} LIMIT 1`, (err, sample) => {
                if (!err && sample) {
                  console.log(`      Sample columns: ${Object.keys(sample).join(', ')}`);
                  if (sample.lat && sample.lng) {
                    console.log(`      Sample coordinates: (${sample.lat}, ${sample.lng})`);
                  }
                }
                tableIndex++;
                checkTable();
              });
            } else {
              tableIndex++;
              checkTable();
            }
          }
        });
      };
      
      checkTable();
    });
  });
}

// Run the inspection
inspectDatabase().catch(err => {
  console.error('❌ Inspection failed:', err);
  process.exit(1);
}); 