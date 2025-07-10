#!/usr/bin/env ts-node
/**
 * Fetch Specific Trail by Name
 * 
 * This script fetches a specific trail by name to debug why it might not be included
 * in our regular queries.
 */

import fetch from 'node-fetch';

// Overpass API query for specific trail
function buildSpecificTrailQuery(trailName: string): string {
  return `
[out:json][timeout:60];
(
  way["name"~"${trailName}"](39.78208,-105.67025,40.52739,-105.16744);
);
out geom tags;
`;
}

async function fetchSpecificTrail(trailName: string) {
  console.log(`🔍 Fetching trail: "${trailName}"`);
  
  const query = buildSpecificTrailQuery(trailName);
  console.log('Query:', query);
  
  try {
    console.log('📡 Sending request to Overpass API...');
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json() as { elements: any[] };
    console.log(`📥 Received ${data.elements.length} elements from Overpass API`);
    
    if (data.elements.length === 0) {
      console.log(`❌ No trails found with name containing "${trailName}"`);
      return;
    }
    
    console.log('\n📋 Found trails:');
    for (const element of data.elements) {
      if (element.type === 'way' && element.tags) {
        console.log(`\n   🛤️  Trail: "${element.tags.name}"`);
        console.log(`   🆔 OSM ID: ${element.id}`);
        console.log(`   🛣️  Highway: ${element.tags.highway || 'N/A'}`);
        console.log(`   🏷️  Route: ${element.tags.route || 'N/A'}`);
        console.log(`   🏔️  Surface: ${element.tags.surface || 'N/A'}`);
        console.log(`   📍 Coordinates: ${element.geometry?.length || 0} points`);
        
        // Check if it would pass our filters
        const hasValidHighway = element.tags.highway && /^(path|track|footway|cycleway|bridleway)$/.test(element.tags.highway);
        const hasValidRoute = element.tags.route && /^(hiking|foot|walking)$/.test(element.tags.route);
        const hasValidSurface = element.tags.surface && /^(dirt|unpaved|ground|grass|sand|rock|earth|natural)$/.test(element.tags.surface);
        const hasName = element.tags.name && element.tags.name.trim() !== '';
        const hasGeometry = element.geometry && element.geometry.length >= 2;
        
        console.log(`   ✅ Valid highway: ${hasValidHighway}`);
        console.log(`   ✅ Valid route: ${hasValidRoute}`);
        console.log(`   ✅ Valid surface: ${hasValidSurface}`);
        console.log(`   ✅ Has name: ${hasName}`);
        console.log(`   ✅ Has geometry: ${hasGeometry}`);
        
        const wouldPassFilter = (hasValidHighway || hasValidRoute) && hasValidSurface && hasName && hasGeometry;
        console.log(`   🎯 Would pass our filter: ${wouldPassFilter ? 'YES' : 'NO'}`);
        
        if (!wouldPassFilter) {
          console.log(`   ❌ Reason for rejection:`);
          if (!hasValidHighway && !hasValidRoute) console.log(`      - Invalid highway/route type`);
          if (!hasValidSurface) console.log(`      - Invalid surface type`);
          if (!hasName) console.log(`      - Missing or empty name`);
          if (!hasGeometry) console.log(`      - Insufficient geometry`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to fetch trail:', error);
  }
}

// Main execution
async function main() {
  const trailName = process.argv[2] || 'Hogback Ridge Trail';
  await fetchSpecificTrail(trailName);
}

if (require.main === module) {
  main();
} 