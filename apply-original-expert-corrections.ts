#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

interface ProblemNode {
  node_id?: number;
  lat?: number;
  lng?: number;
  elevation?: number;
  correct_label: number; // 0=keep, 1=merge degree-2, 2=split Y/T
  reason: string;
}

async function applyOriginalExpertCorrections() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node apply-original-expert-corrections.ts <schema>');
    process.exit(1);
  }

  console.log(`🔄 Applying original expert corrections for schema: ${schema}`);

  // Define the original problem nodes from train-with-problem-nodes.ts
  const problemNodes: ProblemNode[] = [
    // From carthorse_1757205521274 schema
    {
      node_id: 165,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Connector that should be degree 3 intersection"
    },
    {
      node_id: 351,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Endpoint that should be degree 3 intersection"
    },
    {
      node_id: 413,
      correct_label: 1, // Should be merged (degree-2 connector)
      reason: "Degree-2 connector that should be merged"
    },
    {
      node_id: 849,
      correct_label: 1, // Should be merged (degree-2 connector)
      reason: "Degree-2 connector that should be merged"
    },
    {
      node_id: 606,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Endpoint that should be degree 3 T intersection"
    },
    {
      node_id: 589,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 node that should be merged out"
    },
    {
      node_id: 612,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 node that should be merged out"
    },
    {
      node_id: 580,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 connector that should be merged out"
    },
    // Additional degree-2 nodes to merge
    {
      node_id: 110,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 connector that should be merged out"
    },
    {
      node_id: 105,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 connector that should be merged out"
    },
    {
      node_id: 2,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 connector that should be merged out"
    },
    {
      node_id: 109,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 connector that should be merged out"
    },
    {
      node_id: 57,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 connector that should be merged out"
    },
    {
      node_id: 52,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 connector that should be merged out"
    },
    // Y intersection split at visited by visitor endpoint
    {
      node_id: 4,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Y intersection split at visited by visitor endpoint"
    },
    // Additional degree-2 nodes to merge
    {
      node_id: 576,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 connector that should be merged out"
    },
    {
      node_id: 561,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 connector that should be merged out"
    },
    // Degree 3 Y intersections that should split visited paths
    {
      node_id: 574,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Degree 3 node which should split visited path at touch/intersection point"
    },
    {
      node_id: 560,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Degree 3 Y intersection (but is an endpoint currently) - needs to split visited at coordinate by visitor endpoint"
    },
    {
      node_id: 577,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Degree 3 Y intersection (but is an endpoint currently) - needs to split visited path"
    },
    {
      node_id: 526,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Degree 3 Y intersection (but is an endpoint currently) - needs to split visited path"
    },
    // Additional degree-2 nodes to merge
    {
      node_id: 542,
      correct_label: 1, // Should be merged (degree-2)
      reason: "Degree-2 connector that should be merged out"
    },
    // Endpoints that should be split to degree-3 intersections
    {
      node_id: 553,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Endpoint that should be split where it touches visitor and joined as degree 3"
    },
    {
      node_id: 552,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Endpoint that should be split and joined as degree 3 intersection"
    },
    {
      node_id: 537,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Endpoint that should be split and merged to degree 3"
    },
    {
      node_id: 77,
      correct_label: 2, // Should be split Y/T intersection
      reason: "Endpoint that should be split and merged to degree 3"
    }
  ];

  console.log(`📊 Found ${problemNodes.length} expert corrections to apply`);

  // Connect to database
  const dbConfig = getDatabasePoolConfig();
  const pool = new Pool(dbConfig);

  try {
    // First, let's check current state
    const currentCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${schema}.graphsage_predictions 
      WHERE confidence = 1.0
    `);
    console.log(`📈 Current expert corrections in database: ${currentCount.rows[0].count}`);

    // Apply expert corrections
    console.log('🔄 Applying expert corrections...');
    
    let appliedCount = 0;
    let skippedCount = 0;

    for (const correction of problemNodes) {
      if (!correction.node_id) {
        console.log(`⚠️  Skipping correction without node_id: ${correction.reason}`);
        skippedCount++;
        continue;
      }

      try {
        // Update the prediction with expert correction
        const result = await pool.query(`
          UPDATE ${schema}.graphsage_predictions 
          SET 
            prediction = $1,
            confidence = 1.0,
            reason = $2,
            updated_at = NOW()
          WHERE node_id = $3
        `, [correction.correct_label, correction.reason, correction.node_id]);

        if (result.rowCount && result.rowCount > 0) {
          appliedCount++;
          console.log(`✅ Applied correction for node ${correction.node_id}: ${correction.correct_label} (${correction.reason})`);
        } else {
          skippedCount++;
          console.log(`⚠️  Node ${correction.node_id} not found in database`);
        }
      } catch (error) {
        console.error(`❌ Error applying correction for node ${correction.node_id}:`, error);
        skippedCount++;
      }
    }

    console.log(`\n📊 Application Summary:`);
    console.log(`✅ Successfully applied: ${appliedCount} corrections`);
    console.log(`⚠️  Skipped (not found): ${skippedCount} corrections`);
    console.log(`📈 Total expert corrections now in database: ${appliedCount}`);

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
    console.error('❌ Error applying expert corrections:', error);
  } finally {
    await pool.end();
  }
}

// Run the application
applyOriginalExpertCorrections().catch(console.error);
