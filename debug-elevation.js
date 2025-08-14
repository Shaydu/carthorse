const { Client } = require('pg');

async function debugElevation() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: '',
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Get trail 166 geometry
    const result = await client.query(`
      SELECT ST_AsText(geometry) as geometry_text 
      FROM public.cotrex_trails 
      WHERE id = 166
    `);
    
    const geometryText = result.rows[0].geometry_text;
    console.log('Trail 166 geometry:', geometryText);
    
    // Parse coordinates
    const match = geometryText.match(/LINESTRING\s*Z?\s*\(([^)]+)\)/i);
    if (match) {
      const coordPairs = match[1].split(',').map(pair => pair.trim());
      const coordinates = coordPairs.map(pair => {
        const coords = pair.split(/\s+/).map(Number);
        return [coords[0], coords[1]]; // [lng, lat]
      });
      
      console.log('Coordinates:', coordinates);
      console.log('Coordinate count:', coordinates.length);
      
      // Check if coordinates are in TIFF coverage
      coordinates.forEach((coord, i) => {
        const [lng, lat] = coord;
        const inN40W106 = lng >= -106.0006 && lng <= -104.9994 && lat >= 39.9994 && lat <= 41.0006;
        console.log(`Point ${i}: [${lng}, ${lat}] - In n40w106: ${inN40W106}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

debugElevation();
