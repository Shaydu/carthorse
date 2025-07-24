-- Add NOT NULL constraints for required elevation and geometry fields
ALTER TABLE trails
  ALTER COLUMN elevation_gain SET NOT NULL,
  ALTER COLUMN elevation_loss SET NOT NULL,
  ALTER COLUMN max_elevation SET NOT NULL,
  ALTER COLUMN min_elevation SET NOT NULL,
  ALTER COLUMN avg_elevation SET NOT NULL,
  ALTER COLUMN geo2 SET NOT NULL;

-- Add basic CHECK constraints for elevation logic and geometry validity
ALTER TABLE trails
  ADD CONSTRAINT trails_elevation_gain_positive CHECK (elevation_gain >= 0),
  ADD CONSTRAINT trails_elevation_loss_positive CHECK (elevation_loss >= 0),
  ADD CONSTRAINT trails_max_elevation_valid CHECK (max_elevation > 0),
  ADD CONSTRAINT trails_min_elevation_valid CHECK (min_elevation > 0),
  ADD CONSTRAINT trails_avg_elevation_range CHECK (avg_elevation >= min_elevation AND avg_elevation <= max_elevation),
  ADD CONSTRAINT trails_elevation_order CHECK (max_elevation >= min_elevation),
  ADD CONSTRAINT trails_valid_geometry CHECK (ST_IsValid(geo2)),
  ADD CONSTRAINT trails_3d_geometry CHECK (ST_NDims(geo2) = 3),
  ADD CONSTRAINT trails_min_points CHECK (ST_NPoints(geo2) >= 2); 