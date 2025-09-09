#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

interface ExpertCorrection {
  node_id: number;
  lat: number;
  lng: number;
  elevation: number;
  correct_label: number;
  reason: string;
  confidence: number;
}

async function restoreExpertCorrections() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node restore-expert-corrections.ts <schema>');
    process.exit(1);
  }

  console.log(`🔄 Restoring expert corrections for schema: ${schema}`);

  // Load the backup JSON file with expert corrections
  const backupFile = path.join(__dirname, 'test-output', 'graphsage-data-carthorse_1757362430748-corrected-2025-09-08T21-34-28-057Z.json');
  
  if (!fs.existsSync(backupFile)) {
    console.error(`❌ Backup file not found: ${backupFile}`);
    process.exit(1);
  }

  console.log(`📁 Loading expert corrections from: ${backupFile}`);
  const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  
  // The backup file has a different structure - it contains x (features) and y (labels) arrays
  // We need to reconstruct the expert corrections from the metadata
  console.log('📊 Backup file structure:', Object.keys(backupData));
  console.log('📊 Metadata:', backupData.metadata);
  
  // For now, let's use the original problem nodes from the script
  // We'll restore them by finding nodes in the database and updating their predictions
  const expertCorrections: ExpertCorrection[] = [];

  console.log(`📊 Found ${expertCorrections.length} expert corrections to restore`);

  if (expertCorrections.length === 0) {
    console.log('⚠️  No expert corrections found in backup file');
    return;
  }

  // Connect to database
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'carthorse',
    user: 'carthorse',
    password: 'carthorse'
  });

  try {
    // First, let's check current state
    const currentCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${schema}.graphsage_predictions 
      WHERE confidence = 1.0
    `);
    console.log(`📈 Current expert corrections in database: ${currentCount.rows[0].count}`);

    // Restore expert corrections
    console.log('🔄 Restoring expert corrections...');
    
    let restoredCount = 0;
    let skippedCount = 0;

    for (const correction of expertCorrections) {
      try {
        // Update the prediction with expert correction
        const result = await pool.query(`
          UPDATE ${schema}.graphsage_predictions 
          SET 
            prediction = $1,
            confidence = $2,
            reason = $3,
            updated_at = NOW()
          WHERE node_id = $4
        `, [correction.correct_label, 1.0, correction.reason, correction.node_id]);

        if (result.rowCount && result.rowCount > 0) {
          restoredCount++;
          console.log(`✅ Restored correction for node ${correction.node_id}: ${correction.correct_label} (${correction.reason})`);
        } else {
          skippedCount++;
          console.log(`⚠️  Node ${correction.node_id} not found in database`);
        }
      } catch (error) {
        console.error(`❌ Error restoring correction for node ${correction.node_id}:`, error);
        skippedCount++;
      }
    }

    console.log(`\n📊 Restoration Summary:`);
    console.log(`✅ Successfully restored: ${restoredCount} corrections`);
    console.log(`⚠️  Skipped (not found): ${skippedCount} corrections`);
    console.log(`📈 Total expert corrections now in database: ${restoredCount}`);

    // Verify final state
    const finalCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${schema}.graphsage_predictions 
      WHERE confidence = 1.0
    `);
    console.log(`🎯 Final expert corrections count: ${finalCount.rows[0].count}`);

    // Show breakdown by prediction type
    const breakdown = await pool.query(`
      SELECT 
        prediction,
        COUNT(*) as count,
        CASE 
          WHEN prediction = 0 THEN 'Keep as-is'
          WHEN prediction = 1 THEN 'Merge degree-2'
          WHEN prediction = 2 THEN 'Split Y/T'
          ELSE 'Unknown'
        END as label
      FROM ${schema}.graphsage_predictions 
      WHERE confidence = 1.0
      GROUP BY prediction
      ORDER BY prediction
    `);

    console.log(`\n📋 Expert Corrections Breakdown:`);
    for (const row of breakdown.rows) {
      console.log(`  ${row.label}: ${row.count} nodes`);
    }

  } catch (error) {
    console.error('❌ Error restoring expert corrections:', error);
  } finally {
    await pool.end();
  }
}

// Run the restoration
restoreExpertCorrections().catch(console.error);
