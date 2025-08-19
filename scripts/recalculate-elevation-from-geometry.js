const { Client } = require('pg');

async function recalculateElevationFromGeometry() {
    const client = new Client({
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        database: 'trail_master_db',
        user: process.env.PGUSER || 'tester',
        password: process.env.PGPASSWORD || ''
    });

    try {
        await client.connect();
        console.log('Connected to trail_master_db');

        // First, check if the recalculate_elevation_data function exists
        const functionCheckQuery = `
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_name = 'recalculate_elevation_data' 
            AND routine_schema = 'public'
        `;
        
        const functionResult = await client.query(functionCheckQuery);
        
        if (functionResult.rows.length === 0) {
            console.log('❌ recalculate_elevation_data function not found. Creating it...');
            
            // Create the elevation calculation function
            const createFunctionQuery = `
                CREATE OR REPLACE FUNCTION recalculate_elevation_data(geometry geometry)
                RETURNS TABLE(
                    elevation_gain real,
                    elevation_loss real,
                    max_elevation real,
                    min_elevation real,
                    avg_elevation real
                ) AS $$
                DECLARE
                    point record;
                    prev_elevation real := NULL;
                    current_elevation real;
                    total_gain real := 0;
                    total_loss real := 0;
                    max_elev real := NULL;
                    min_elev real := NULL;
                    total_elev real := 0;
                    point_count integer := 0;
                BEGIN
                    -- Check if geometry is 3D
                    IF ST_NDims(geometry) < 3 THEN
                        RAISE EXCEPTION 'Geometry must be 3D to calculate elevation data';
                    END IF;
                    
                    -- Iterate through all points in the geometry
                    FOR point IN SELECT (ST_DumpPoints(geometry)).geom AS point LOOP
                        current_elevation := ST_Z(point.point);
                        
                        -- Skip if elevation is null
                        IF current_elevation IS NULL THEN
                            CONTINUE;
                        END IF;
                        
                        -- Update min/max elevation
                        IF max_elev IS NULL OR current_elevation > max_elev THEN
                            max_elev := current_elevation;
                        END IF;
                        
                        IF min_elev IS NULL OR current_elevation < min_elev THEN
                            min_elev := current_elevation;
                        END IF;
                        
                        -- Calculate gain/loss
                        IF prev_elevation IS NOT NULL THEN
                            IF current_elevation > prev_elevation THEN
                                total_gain := total_gain + (current_elevation - prev_elevation);
                            ELSIF current_elevation < prev_elevation THEN
                                total_loss := total_loss + (prev_elevation - current_elevation);
                            END IF;
                        END IF;
                        
                        total_elev := total_elev + current_elevation;
                        point_count := point_count + 1;
                        prev_elevation := current_elevation;
                    END LOOP;
                    
                    -- Calculate average elevation
                    IF point_count > 0 THEN
                        total_elev := total_elev / point_count;
                    END IF;
                    
                    RETURN QUERY SELECT 
                        total_gain,
                        total_loss,
                        max_elev,
                        min_elev,
                        total_elev;
                END;
                $$ LANGUAGE plpgsql;
            `;
            
            await client.query(createFunctionQuery);
            console.log('✅ Created recalculate_elevation_data function');
        } else {
            console.log('✅ recalculate_elevation_data function exists');
        }

        // Get count of trails that need elevation recalculation
        const countQuery = `
            SELECT COUNT(*) as total_trails
            FROM public.trails 
            WHERE geometry IS NOT NULL 
              AND ST_NDims(geometry) = 3
        `;
        
        const countResult = await client.query(countQuery);
        const totalTrails = parseInt(countResult.rows[0].total_trails);
        
        console.log(`\n📊 Found ${totalTrails} trails with 3D geometry to process`);

        // Get all trails with 3D geometry
        const trailsQuery = `
            SELECT 
                id, 
                app_uuid, 
                name, 
                geometry,
                elevation_gain,
                elevation_loss,
                max_elevation,
                min_elevation,
                avg_elevation
            FROM public.trails 
            WHERE geometry IS NOT NULL 
              AND ST_NDims(geometry) = 3
            ORDER BY id
        `;
        
        const trailsResult = await client.query(trailsQuery);
        const trails = trailsResult.rows;
        
        console.log(`\n🔄 Starting elevation recalculation for ${trails.length} trails...`);
        
        let processed = 0;
        let updated = 0;
        let errors = 0;
        const errorDetails = [];
        
        for (const trail of trails) {
            try {
                processed++;
                
                if (processed % 100 === 0) {
                    console.log(`⏳ Progress: ${processed}/${trails.length} trails processed`);
                }
                
                // Recalculate elevation data from geometry
                const elevationQuery = `
                    SELECT * FROM recalculate_elevation_data($1::geometry)
                `;
                
                const elevationResult = await client.query(elevationQuery, [trail.geometry]);
                
                if (elevationResult.rows.length === 0) {
                    throw new Error('No elevation data calculated');
                }
                
                const newElevation = elevationResult.rows[0];
                
                // Update trail with recalculated elevation data
                const updateQuery = `
                    UPDATE public.trails 
                    SET 
                        elevation_gain = $1,
                        elevation_loss = $2,
                        max_elevation = $3,
                        min_elevation = $4,
                        avg_elevation = $5,
                        updated_at = NOW()
                    WHERE id = $6
                `;
                
                await client.query(updateQuery, [
                    newElevation.elevation_gain,
                    newElevation.elevation_loss,
                    newElevation.max_elevation,
                    newElevation.min_elevation,
                    newElevation.avg_elevation,
                    trail.id
                ]);
                
                updated++;
                
                // Log significant changes
                const oldGain = trail.elevation_gain || 0;
                const newGain = newElevation.elevation_gain || 0;
                const gainDiff = Math.abs(newGain - oldGain);
                
                if (gainDiff > 10) { // Log if gain changed by more than 10m
                    console.log(`  📈 Trail "${trail.name}" (${trail.app_uuid}):`);
                    console.log(`     Old gain: ${oldGain}m, New gain: ${newGain}m (diff: ${gainDiff.toFixed(1)}m)`);
                }
                
            } catch (error) {
                errors++;
                const errorMsg = `Error processing trail ${trail.name} (${trail.app_uuid}): ${error.message}`;
                errorDetails.push(errorMsg);
                console.error(`❌ ${errorMsg}`);
            }
        }
        
        console.log(`\n✅ Elevation recalculation complete!`);
        console.log(`📊 Summary:`);
        console.log(`   - Total trails: ${totalTrails}`);
        console.log(`   - Processed: ${processed}`);
        console.log(`   - Updated: ${updated}`);
        console.log(`   - Errors: ${errors}`);
        
        if (errors > 0) {
            console.log(`\n❌ Errors encountered:`);
            errorDetails.forEach(error => console.log(`   - ${error}`));
        }
        
        // Now check for duplicate trails by 2D geometry
        console.log(`\n🔍 Checking for duplicate trails by 2D geometry...`);
        
        const duplicateQuery = `
            WITH geometry_groups AS (
                SELECT 
                    ST_AsText(ST_Force2D(geometry)) as geometry_2d_text,
                    COUNT(*) as count,
                    ARRAY_AGG(id) as trail_ids,
                    ARRAY_AGG(app_uuid) as trail_uuids,
                    ARRAY_AGG(name) as trail_names,
                    ARRAY_AGG(elevation_gain) as elevation_gains,
                    ARRAY_AGG(elevation_loss) as elevation_losses
                FROM public.trails
                WHERE geometry IS NOT NULL
                GROUP BY ST_AsText(ST_Force2D(geometry))
                HAVING COUNT(*) > 1
            )
            SELECT 
                geometry_2d_text,
                count,
                trail_ids,
                trail_uuids,
                trail_names,
                elevation_gains,
                elevation_losses
            FROM geometry_groups
            ORDER BY count DESC, geometry_2d_text
        `;
        
        const duplicateResult = await client.query(duplicateQuery);
        
        console.log(`\n=== DUPLICATE TRAILS BY 2D GEOMETRY ===`);
        console.log(`Total duplicate groups found: ${duplicateResult.rows.length}`);
        
        if (duplicateResult.rows.length > 0) {
            console.log(`\n=== DUPLICATE DETAILS ===`);
            
            let totalDuplicates = 0;
            duplicateResult.rows.forEach((row, index) => {
                console.log(`\nDuplicate Group ${index + 1}:`);
                console.log(`  Count: ${row.count} instances`);
                console.log(`  Trail Names: ${row.trail_names.join(', ')}`);
                console.log(`  Trail UUIDs: ${row.trail_uuids.join(', ')}`);
                console.log(`  Elevation Gains: ${row.elevation_gains.join(', ')}`);
                console.log(`  Elevation Losses: ${row.elevation_losses.join(', ')}`);
                
                totalDuplicates += row.count;
            });
            
            console.log(`\nTotal duplicate trails: ${totalDuplicates}`);
        } else {
            console.log(`\n✅ No duplicate trails found by 2D geometry!`);
        }

    } catch (error) {
        console.error('❌ Error during elevation recalculation:', error);
    } finally {
        await client.end();
    }
}

// Run the recalculation
recalculateElevationFromGeometry()
    .then(() => {
        console.log('\nElevation recalculation complete');
        process.exit(0);
    })
    .catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
