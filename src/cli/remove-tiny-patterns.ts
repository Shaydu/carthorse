#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trail_master_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

async function removeTinyPatterns(): Promise<void> {
  const client = new Pool(config);
  
  try {
    console.log('🗑️  Removing Micro and Tiny route patterns...');
    
    // Read the SQL script
    const sqlPath = path.join(__dirname, '../../scripts/remove-tiny-route-patterns.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute the script
    const result = await client.query(sql);
    
    console.log('✅ Successfully removed Micro and Tiny route patterns');
    console.log('📊 Check the output above for details of what was removed');
    
  } catch (error) {
    console.error('❌ Error removing tiny patterns:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run if called directly
if (require.main === module) {
  removeTinyPatterns()
    .then(() => {
      console.log('✅ Tiny pattern removal completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Tiny pattern removal failed:', error);
      process.exit(1);
    });
}

export { removeTinyPatterns };
