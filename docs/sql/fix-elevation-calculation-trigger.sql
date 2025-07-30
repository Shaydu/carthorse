-- Fix Elevation Calculation Trigger
-- This script adds a trigger to automatically calculate elevation data from 3D geometry

-- Function to automatically calculate elevation data from geometry
CREATE OR REPLACE FUNCTION auto_calculate_elevation_from_geometry()
RETURNS TRIGGER AS $$
DECLARE
    elevation_result record;
BEGIN
    -- Only calculate if geometry is 3D and elevation data is missing or zero
    IF NEW.geometry IS NOT NULL 
       AND ST_NDims(NEW.geometry) = 3 
       AND (NEW.max_elevation IS NULL OR NEW.max_elevation = 0 
            OR NEW.min_elevation IS NULL OR NEW.min_elevation = 0
            OR NEW.avg_elevation IS NULL OR NEW.avg_elevation = 0) THEN
        
        -- Calculate elevation data from 3D geometry
        SELECT * INTO elevation_result 
        FROM recalculate_elevation_data(NEW.geometry);
        
        -- Update the trail with calculated elevation data
        NEW.max_elevation := elevation_result.max_elevation;
        NEW.min_elevation := elevation_result.min_elevation;
        NEW.avg_elevation := elevation_result.avg_elevation;
        NEW.elevation_gain := elevation_result.elevation_gain;
        NEW.elevation_loss := elevation_result.elevation_loss;
        
        RAISE NOTICE 'Auto-calculated elevation for trail %: max=%, min=%, avg=%', 
                    NEW.name, NEW.max_elevation, NEW.min_elevation, NEW.avg_elevation;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic elevation calculation
DROP TRIGGER IF EXISTS trigger_auto_calculate_elevation ON trails;
CREATE TRIGGER trigger_auto_calculate_elevation
    BEFORE INSERT OR UPDATE ON trails
    FOR EACH ROW
    EXECUTE FUNCTION auto_calculate_elevation_from_geometry();

-- Function to update all existing trails with missing elevation data
CREATE OR REPLACE FUNCTION update_all_missing_elevation_data()
RETURNS TABLE(updated_count integer, total_count integer) AS $$
DECLARE
    trail_record record;
    elevation_result record;
    updated_count_var integer := 0;
    total_count_var integer := 0;
BEGIN
    -- Get count of trails that need elevation calculation
    SELECT COUNT(*) INTO total_count_var
    FROM trails 
    WHERE geometry IS NOT NULL 
      AND ST_NDims(geometry) = 3
      AND (max_elevation IS NULL OR max_elevation = 0 
           OR min_elevation IS NULL OR min_elevation = 0
           OR avg_elevation IS NULL OR avg_elevation = 0);
    
    -- Update each trail that needs elevation calculation
    FOR trail_record IN 
        SELECT id, name, geometry
        FROM trails 
        WHERE geometry IS NOT NULL 
          AND ST_NDims(geometry) = 3
          AND (max_elevation IS NULL OR max_elevation = 0 
               OR min_elevation IS NULL OR min_elevation = 0
               OR avg_elevation IS NULL OR avg_elevation = 0)
    LOOP
        -- Calculate elevation data from 3D geometry
        SELECT * INTO elevation_result 
        FROM recalculate_elevation_data(trail_record.geometry);
        
        -- Update the trail with calculated elevation data
        UPDATE trails 
        SET 
            max_elevation = elevation_result.max_elevation,
            min_elevation = elevation_result.min_elevation,
            avg_elevation = elevation_result.avg_elevation,
            elevation_gain = elevation_result.elevation_gain,
            elevation_loss = elevation_result.elevation_loss,
            updated_at = NOW()
        WHERE id = trail_record.id;
        
        updated_count_var := updated_count_var + 1;
        
        -- Log progress every 100 trails
        IF updated_count_var % 100 = 0 THEN
            RAISE NOTICE 'Updated elevation for % trails...', updated_count_var;
        END IF;
    END LOOP;
    
    RETURN QUERY SELECT updated_count_var, total_count_var;
END;
$$ LANGUAGE plpgsql; 