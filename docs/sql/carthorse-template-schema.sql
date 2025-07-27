CREATE TABLE spatial_ref_sys (
srid INTEGER NOT NULL PRIMARY KEY,
auth_name TEXT NOT NULL,
auth_srid INTEGER NOT NULL,
ref_sys_name TEXT NOT NULL DEFAULT 'Unknown',
proj4text TEXT NOT NULL,
srtext TEXT NOT NULL DEFAULT 'Undefined');
CREATE TABLE spatialite_history (
event_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
table_name TEXT NOT NULL,
geometry_column TEXT,
event TEXT NOT NULL,
timestamp TEXT NOT NULL,
ver_sqlite TEXT NOT NULL,
ver_splite TEXT NOT NULL);
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE geometry_columns (
f_table_name TEXT NOT NULL,
f_geometry_column TEXT NOT NULL,
geometry_type INTEGER NOT NULL,
coord_dimension INTEGER NOT NULL,
srid INTEGER NOT NULL,
spatial_index_enabled INTEGER NOT NULL,
CONSTRAINT pk_geom_cols PRIMARY KEY (f_table_name, f_geometry_column),
CONSTRAINT fk_gc_srs FOREIGN KEY (srid) REFERENCES spatial_ref_sys (srid),
CONSTRAINT ck_gc_rtree CHECK (spatial_index_enabled IN (0,1,2)));
CREATE TABLE spatial_ref_sys_aux (
	srid INTEGER NOT NULL PRIMARY KEY,
	is_geographic INTEGER,
	has_flipped_axes INTEGER,
	spheroid TEXT,
	prime_meridian TEXT,
	datum TEXT,
	projection TEXT,
	unit TEXT,
	axis_1_name TEXT,
	axis_1_orientation TEXT,
	axis_2_name TEXT,
	axis_2_orientation TEXT,
	CONSTRAINT fk_sprefsys FOREIGN KEY (srid) 	REFERENCES spatial_ref_sys (srid));
CREATE TABLE views_geometry_columns (
view_name TEXT NOT NULL,
view_geometry TEXT NOT NULL,
view_rowid TEXT NOT NULL,
f_table_name TEXT NOT NULL,
f_geometry_column TEXT NOT NULL,
read_only INTEGER NOT NULL,
CONSTRAINT pk_geom_cols_views PRIMARY KEY (view_name, view_geometry),
CONSTRAINT fk_views_geom_cols FOREIGN KEY (f_table_name, f_geometry_column) REFERENCES geometry_columns (f_table_name, f_geometry_column) ON DELETE CASCADE,
CONSTRAINT ck_vw_rdonly CHECK (read_only IN (0,1)));
CREATE TABLE virts_geometry_columns (
virt_name TEXT NOT NULL,
virt_geometry TEXT NOT NULL,
geometry_type INTEGER NOT NULL,
coord_dimension INTEGER NOT NULL,
srid INTEGER NOT NULL,
CONSTRAINT pk_geom_cols_virts PRIMARY KEY (virt_name, virt_geometry),
CONSTRAINT fk_vgc_srid FOREIGN KEY (srid) REFERENCES spatial_ref_sys (srid));
CREATE TABLE geometry_columns_statistics (
f_table_name TEXT NOT NULL,
f_geometry_column TEXT NOT NULL,
last_verified TIMESTAMP,
row_count INTEGER,
extent_min_x DOUBLE,
extent_min_y DOUBLE,
extent_max_x DOUBLE,
extent_max_y DOUBLE,
CONSTRAINT pk_gc_statistics PRIMARY KEY (f_table_name, f_geometry_column),
CONSTRAINT fk_gc_statistics FOREIGN KEY (f_table_name, f_geometry_column) REFERENCES geometry_columns (f_table_name, f_geometry_column) ON DELETE CASCADE);
CREATE TABLE views_geometry_columns_statistics (
view_name TEXT NOT NULL,
view_geometry TEXT NOT NULL,
last_verified TIMESTAMP,
row_count INTEGER,
extent_min_x DOUBLE,
extent_min_y DOUBLE,
extent_max_x DOUBLE,
extent_max_y DOUBLE,
CONSTRAINT pk_vwgc_statistics PRIMARY KEY (view_name, view_geometry),
CONSTRAINT fk_vwgc_statistics FOREIGN KEY (view_name, view_geometry) REFERENCES views_geometry_columns (view_name, view_geometry) ON DELETE CASCADE);
CREATE TABLE virts_geometry_columns_statistics (
virt_name TEXT NOT NULL,
virt_geometry TEXT NOT NULL,
last_verified TIMESTAMP,
row_count INTEGER,
extent_min_x DOUBLE,
extent_min_y DOUBLE,
extent_max_x DOUBLE,
extent_max_y DOUBLE,
CONSTRAINT pk_vrtgc_statistics PRIMARY KEY (virt_name, virt_geometry),
CONSTRAINT fk_vrtgc_statistics FOREIGN KEY (virt_name, virt_geometry) REFERENCES virts_geometry_columns (virt_name, virt_geometry) ON DELETE CASCADE);
CREATE TABLE geometry_columns_field_infos (
f_table_name TEXT NOT NULL,
f_geometry_column TEXT NOT NULL,
ordinal INTEGER NOT NULL,
column_name TEXT NOT NULL,
null_values INTEGER NOT NULL,
integer_values INTEGER NOT NULL,
double_values INTEGER NOT NULL,
text_values INTEGER NOT NULL,
blob_values INTEGER NOT NULL,
max_size INTEGER,
integer_min INTEGER,
integer_max INTEGER,
double_min DOUBLE,
double_max DOUBLE,
CONSTRAINT pk_gcfld_infos PRIMARY KEY (f_table_name, f_geometry_column, ordinal, column_name),
CONSTRAINT fk_gcfld_infos FOREIGN KEY (f_table_name, f_geometry_column) REFERENCES geometry_columns (f_table_name, f_geometry_column) ON DELETE CASCADE);
CREATE TABLE views_geometry_columns_field_infos (
view_name TEXT NOT NULL,
view_geometry TEXT NOT NULL,
ordinal INTEGER NOT NULL,
column_name TEXT NOT NULL,
null_values INTEGER NOT NULL,
integer_values INTEGER NOT NULL,
double_values INTEGER NOT NULL,
text_values INTEGER NOT NULL,
blob_values INTEGER NOT NULL,
max_size INTEGER,
integer_min INTEGER,
integer_max INTEGER,
double_min DOUBLE,
double_max DOUBLE,
CONSTRAINT pk_vwgcfld_infos PRIMARY KEY (view_name, view_geometry, ordinal, column_name),
CONSTRAINT fk_vwgcfld_infos FOREIGN KEY (view_name, view_geometry) REFERENCES views_geometry_columns (view_name, view_geometry) ON DELETE CASCADE);
CREATE TABLE virts_geometry_columns_field_infos (
virt_name TEXT NOT NULL,
virt_geometry TEXT NOT NULL,
ordinal INTEGER NOT NULL,
column_name TEXT NOT NULL,
null_values INTEGER NOT NULL,
integer_values INTEGER NOT NULL,
double_values INTEGER NOT NULL,
text_values INTEGER NOT NULL,
blob_values INTEGER NOT NULL,
max_size INTEGER,
integer_min INTEGER,
integer_max INTEGER,
double_min DOUBLE,
double_max DOUBLE,
CONSTRAINT pk_vrtgcfld_infos PRIMARY KEY (virt_name, virt_geometry, ordinal, column_name),
CONSTRAINT fk_vrtgcfld_infos FOREIGN KEY (virt_name, virt_geometry) REFERENCES virts_geometry_columns (virt_name, virt_geometry) ON DELETE CASCADE);
CREATE TABLE geometry_columns_time (
f_table_name TEXT NOT NULL,
f_geometry_column TEXT NOT NULL,
last_insert TIMESTAMP NOT NULL DEFAULT '0000-01-01T00:00:00.000Z',
last_update TIMESTAMP NOT NULL DEFAULT '0000-01-01T00:00:00.000Z',
last_delete TIMESTAMP NOT NULL DEFAULT '0000-01-01T00:00:00.000Z',
CONSTRAINT pk_gc_time PRIMARY KEY (f_table_name, f_geometry_column),
CONSTRAINT fk_gc_time FOREIGN KEY (f_table_name, f_geometry_column) REFERENCES geometry_columns (f_table_name, f_geometry_column) ON DELETE CASCADE);
CREATE TABLE geometry_columns_auth (
f_table_name TEXT NOT NULL,
f_geometry_column TEXT NOT NULL,
read_only INTEGER NOT NULL,
hidden INTEGER NOT NULL,
CONSTRAINT pk_gc_auth PRIMARY KEY (f_table_name, f_geometry_column),
CONSTRAINT fk_gc_auth FOREIGN KEY (f_table_name, f_geometry_column) REFERENCES geometry_columns (f_table_name, f_geometry_column) ON DELETE CASCADE,
CONSTRAINT ck_gc_ronly CHECK (read_only IN (0,1)),
CONSTRAINT ck_gc_hidden CHECK (hidden IN (0,1)));
CREATE TABLE views_geometry_columns_auth (
view_name TEXT NOT NULL,
view_geometry TEXT NOT NULL,
hidden INTEGER NOT NULL,
CONSTRAINT pk_vwgc_auth PRIMARY KEY (view_name, view_geometry),
CONSTRAINT fk_vwgc_auth FOREIGN KEY (view_name, view_geometry) REFERENCES views_geometry_columns (view_name, view_geometry) ON DELETE CASCADE,
CONSTRAINT ck_vwgc_hidden CHECK (hidden IN (0,1)));
CREATE TABLE virts_geometry_columns_auth (
virt_name TEXT NOT NULL,
virt_geometry TEXT NOT NULL,
hidden INTEGER NOT NULL,
CONSTRAINT pk_vrtgc_auth PRIMARY KEY (virt_name, virt_geometry),
CONSTRAINT fk_vrtgc_auth FOREIGN KEY (virt_name, virt_geometry) REFERENCES virts_geometry_columns (virt_name, virt_geometry) ON DELETE CASCADE,
CONSTRAINT ck_vrtgc_hidden CHECK (hidden IN (0,1)));
CREATE TABLE sql_statements_log (
id INTEGER PRIMARY KEY AUTOINCREMENT,
time_start TIMESTAMP NOT NULL DEFAULT '0000-01-01T00:00:00.000Z',
time_end TIMESTAMP NOT NULL DEFAULT '0000-01-01T00:00:00.000Z',
user_agent TEXT NOT NULL,
sql_statement TEXT NOT NULL,
success INTEGER NOT NULL DEFAULT 0,
error_cause TEXT NOT NULL DEFAULT 'ABORTED',
CONSTRAINT sqllog_success CHECK (success IN (0,1)));
CREATE TABLE IF NOT EXISTS "idx_trails_geometry_rowid"(rowid INTEGER PRIMARY KEY,nodeno);
CREATE TABLE IF NOT EXISTS "idx_trails_geometry_node"(nodeno INTEGER PRIMARY KEY,data);
CREATE TABLE IF NOT EXISTS "idx_trails_geometry_parent"(nodeno INTEGER PRIMARY KEY,parentnode);
CREATE TABLE sqlite_stat1(tbl,idx,stat);
CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample);
CREATE TABLE elevation_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    elevation INTEGER NOT NULL,
    source_file TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_spatial_ref_sys 
ON spatial_ref_sys (auth_srid, auth_name);
CREATE INDEX idx_srid_geocols ON geometry_columns
(srid) ;
CREATE INDEX idx_viewsjoin ON views_geometry_columns
(f_table_name, f_geometry_column);
CREATE INDEX idx_virtssrid ON virts_geometry_columns
(srid);
CREATE UNIQUE INDEX idx_coords ON elevation_points(lat, lng);
CREATE INDEX idx_elevation ON elevation_points(elevation);
CREATE TRIGGER geometry_columns_f_table_name_insert
BEFORE INSERT ON 'geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on geometry_columns violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on geometry_columns violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on geometry_columns violates constraint: 
f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER geometry_columns_f_table_name_update
BEFORE UPDATE OF 'f_table_name' ON 'geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on geometry_columns violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on geometry_columns violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on geometry_columns violates constraint: f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER geometry_columns_f_geometry_column_insert
BEFORE INSERT ON 'geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on geometry_columns violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'insert on geometry_columns violates constraint: 
f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'insert on geometry_columns violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER geometry_columns_f_geometry_column_update
BEFORE UPDATE OF 'f_geometry_column' ON 'geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on geometry_columns violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'update on geometry_columns violates constraint: f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'update on geometry_columns violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER geometry_columns_geometry_type_insert
BEFORE INSERT ON 'geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'geometry_type must be one of 0,1,2,3,4,5,6,7,1000,1001,1002,1003,1004,1005,1006,1007,2000,2001,2002,2003,2004,2005,2006,2007,3000,3001,3002,3003,3004,3005,3006,3007')
WHERE NOT(NEW.geometry_type IN (0,1,2,3,4,5,6,7,1000,1001,1002,1003,1004,1005,1006,1007,2000,2001,2002,2003,2004,2005,2006,2007,3000,3001,3002,3003,3004,3005,3006,3007));
END;
CREATE TRIGGER geometry_columns_geometry_type_update
BEFORE UPDATE OF 'geometry_type' ON 'geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'geometry_type must be one of 0,1,2,3,4,5,6,7,1000,1001,1002,1003,1004,1005,1006,1007,2000,2001,2002,2003,2004,2005,2006,2007,3000,3001,3002,3003,3004,3005,3006,3007')
WHERE NOT(NEW.geometry_type IN (0,1,2,3,4,5,6,7,1000,1001,1002,1003,1004,1005,1006,1007,2000,2001,2002,2003,2004,2005,2006,2007,3000,3001,3002,3003,3004,3005,3006,3007));
END;
CREATE TRIGGER geometry_columns_coord_dimension_insert
BEFORE INSERT ON 'geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'coord_dimension must be one of 2,3,4')
WHERE NOT(NEW.coord_dimension IN (2,3,4));
END;
CREATE TRIGGER geometry_columns_coord_dimension_update
BEFORE UPDATE OF 'coord_dimension' ON 'geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'coord_dimension must be one of 2,3,4')
WHERE NOT(NEW.coord_dimension IN (2,3,4));
END;
CREATE VIEW geom_cols_ref_sys AS
SELECT f_table_name, f_geometry_column, geometry_type,
coord_dimension, spatial_ref_sys.srid AS srid,
auth_name, auth_srid, ref_sys_name, proj4text, srtext
FROM geometry_columns, spatial_ref_sys
WHERE geometry_columns.srid = spatial_ref_sys.srid
/* geom_cols_ref_sys(f_table_name,f_geometry_column,geometry_type,coord_dimension,srid,auth_name,auth_srid,ref_sys_name,proj4text,srtext) */;
CREATE VIEW spatial_ref_sys_all AS
SELECT a.srid AS srid, a.auth_name AS auth_name, a.auth_srid AS auth_srid, a.ref_sys_name AS ref_sys_name,
b.is_geographic AS is_geographic, b.has_flipped_axes AS has_flipped_axes, b.spheroid AS spheroid, b.prime_meridian AS prime_meridian, b.datum AS datum, b.projection AS projection, b.unit AS unit,
b.axis_1_name AS axis_1_name, b.axis_1_orientation AS axis_1_orientation,
b.axis_2_name AS axis_2_name, b.axis_2_orientation AS axis_2_orientation,
a.proj4text AS proj4text, a.srtext AS srtext
FROM spatial_ref_sys AS a
LEFT JOIN spatial_ref_sys_aux AS b ON (a.srid = b.srid)
/* spatial_ref_sys_all(srid,auth_name,auth_srid,ref_sys_name,is_geographic,has_flipped_axes,spheroid,prime_meridian,datum,projection,unit,axis_1_name,axis_1_orientation,axis_2_name,axis_2_orientation,proj4text,srtext) */;
CREATE TRIGGER vwgc_view_name_insert
BEFORE INSERT ON 'views_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: view_name value must not contain a single quote')
WHERE NEW.view_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: view_name value must not contain a double quote')
WHERE NEW.view_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: 
view_name value must be lower case')
WHERE NEW.view_name <> lower(NEW.view_name);
END;
CREATE TRIGGER vwgc_view_name_update
BEFORE UPDATE OF 'view_name' ON 'views_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: view_name value must not contain a single quote')
WHERE NEW.view_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: view_name value must not contain a double quote')
WHERE NEW.view_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: view_name value must be lower case')
WHERE NEW.view_name <> lower(NEW.view_name);
END;
CREATE TRIGGER vwgc_view_geometry_insert
BEFORE INSERT ON 'views_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: view_geometry value must not contain a single quote')
WHERE NEW.view_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: 
view_geometry value must not contain a double quote')
WHERE NEW.view_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: view_geometry value must be lower case')
WHERE NEW.view_geometry <> lower(NEW.view_geometry);
END;
CREATE TRIGGER vwgc_view_geometry_update
BEFORE UPDATE OF 'view_geometry' ON 'views_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: view_geometry value must not contain a single quote')
WHERE NEW.view_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: 
view_geometry value must not contain a double quote')
WHERE NEW.view_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: view_geometry value must be lower case')
WHERE NEW.view_geometry <> lower(NEW.view_geometry);
END;
CREATE TRIGGER vwgc_view_rowid_update
BEFORE UPDATE OF 'view_rowid' ON 'views_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: view_rowid value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: view_rowid value must not contain a double quote')
WHERE NEW.view_rowid LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: view_rowid value must be lower case')
WHERE NEW.view_rowid <> lower(NEW.view_rowid);
END;
CREATE TRIGGER vwgc_view_rowid_insert
BEFORE INSERT ON 'views_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: view_rowid value must not contain a single quote')
WHERE NEW.view_rowid LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: 
view_rowid value must not contain a double quote')
WHERE NEW.view_rowid LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: view_rowid value must be lower case')
WHERE NEW.view_rowid <> lower(NEW.view_rowid);
END;
CREATE TRIGGER vwgc_f_table_name_insert
BEFORE INSERT ON 'views_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: 
f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER vwgc_f_table_name_update
BEFORE UPDATE OF 'f_table_name' ON 'views_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER vwgc_f_geometry_column_insert
BEFORE INSERT ON 'views_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: 
f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER vwgc_f_geometry_column_update
BEFORE UPDATE OF 'f_geometry_column' ON 'views_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER vtgc_virt_name_insert
BEFORE INSERT ON 'virts_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on virts_geometry_columns violates constraint: virt_name value must not contain a single quote')
WHERE NEW.virt_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns violates constraint: virt_name value must not contain a double quote')
WHERE NEW.virt_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns violates constraint: 
virt_name value must be lower case')
WHERE NEW.virt_name <> lower(NEW.virt_name);
END;
CREATE TRIGGER vtgc_virt_name_update
BEFORE UPDATE OF 'virt_name' ON 'virts_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on virts_geometry_columns violates constraint: virt_name value must not contain a single quote')
WHERE NEW.virt_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on virts_geometry_columns violates constraint: virt_name value must not contain a double quote')
WHERE NEW.virt_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on virts_geometry_columns violates constraint: virt_name value must be lower case')
WHERE NEW.virt_name <> lower(NEW.virt_name);
END;
CREATE TRIGGER vtgc_virt_geometry_insert
BEFORE INSERT ON 'virts_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on virts_geometry_columns violates constraint: virt_geometry value must not contain a single quote')
WHERE NEW.virt_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns violates constraint: 
virt_geometry value must not contain a double quote')
WHERE NEW.virt_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns violates constraint: virt_geometry value must be lower case')
WHERE NEW.virt_geometry <> lower(NEW.virt_geometry);
END;
CREATE TRIGGER vtgc_virt_geometry_update
BEFORE UPDATE OF 'virt_geometry' ON 'virts_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on virts_geometry_columns violates constraint: virt_geometry value must not contain a single quote')
WHERE NEW.virt_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'update on virts_geometry_columns violates constraint: 
virt_geometry value must not contain a double quote')
WHERE NEW.virt_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'update on virts_geometry_columns violates constraint: virt_geometry value must be lower case')
WHERE NEW.virt_geometry <> lower(NEW.virt_geometry);
END;
CREATE TRIGGER vtgc_geometry_type_insert
BEFORE INSERT ON 'virts_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'geometry_type must be one of 0,1,2,3,4,5,6,7,1000,1001,1002,1003,1004,1005,1006,1007,2000,2001,2002,2003,2004,2005,2006,2007,3000,3001,3002,3003,3004,3005,3006,3007')
WHERE NOT(NEW.geometry_type IN (0,1,2,3,4,5,6,7,1000,1001,1002,1003,1004,1005,1006,1007,2000,2001,2002,2003,2004,2005,2006,2007,3000,3001,3002,3003,3004,3005,3006,3007));
END;
CREATE TRIGGER vtgc_geometry_type_update
BEFORE UPDATE OF 'geometry_type' ON 'virts_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'geometry_type must be one of 0,1,2,3,4,5,6,7,1000,1001,1002,1003,1004,1005,1006,1007,2000,2001,2002,2003,2004,2005,2006,2007,3000,3001,3002,3003,3004,3005,3006,3007')
WHERE NOT(NEW.geometry_type IN (0,1,2,3,4,5,6,7,1000,1001,1002,1003,1004,1005,1006,1007,2000,2001,2002,2003,2004,2005,2006,2007,3000,3001,3002,3003,3004,3005,3006,3007));
END;
CREATE TRIGGER vtgc_coord_dimension_insert
BEFORE INSERT ON 'virts_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'coord_dimension must be one of 2,3,4')
WHERE NOT(NEW.coord_dimension IN (2,3,4));
END;
CREATE TRIGGER vtgc_coord_dimension_update
BEFORE UPDATE OF 'coord_dimension' ON 'virts_geometry_columns'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'coord_dimension must be one of 2,3,4')
WHERE NOT(NEW.coord_dimension IN (2,3,4));
END;
CREATE TRIGGER gcs_f_table_name_insert
BEFORE INSERT ON 'geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on geometry_columns_statistics violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on geometry_columns_statistics violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on geometry_columns_statistics violates constraint: 
f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER gcs_f_table_name_update
BEFORE UPDATE OF 'f_table_name' ON 'geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on geometry_columns_statistics violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on geometry_columns_statistics violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on geometry_columns_statistics violates constraint: f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER gcs_f_geometry_column_insert
BEFORE INSERT ON 'geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on geometry_columns_statistics violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'insert on geometry_columns_statistics violates constraint: 
f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'insert on geometry_columns_statistics violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER gcs_f_geometry_column_update
BEFORE UPDATE OF 'f_geometry_column' ON 'geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on geometry_columns_statistics violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'update on geometry_columns_statistics violates constraint: f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'update on geometry_columns_statistics violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER vwgcs_view_name_insert
BEFORE INSERT ON 'views_geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns_statistics violates constraint: view_name value must not contain a single quote')
WHERE NEW.view_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_statistics violates constraint: view_name value must not contain a double quote')
WHERE NEW.view_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_statistics violates constraint: 
view_name value must be lower case')
WHERE NEW.view_name <> lower(NEW.view_name);
END;
CREATE TRIGGER vwgcs_view_name_update
BEFORE UPDATE OF 'view_name' ON 'views_geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns_statistics violates constraint: view_name value must not contain a single quote')
WHERE NEW.view_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns_statistics violates constraint: view_name value must not contain a double quote')
WHERE NEW.view_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns_statistics violates constraint: view_name value must be lower case')
WHERE NEW.view_name <> lower(NEW.view_name);
END;
CREATE TRIGGER vwgcs_view_geometry_insert
BEFORE INSERT ON 'views_geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns_statistics violates constraint: view_geometry value must not contain a single quote')
WHERE NEW.view_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_statistics violates constraint: 
view_geometry value must not contain a double quote')
WHERE NEW.view_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_statistics violates constraint: view_geometry value must be lower case')
WHERE NEW.view_geometry <> lower(NEW.view_geometry);
END;
CREATE TRIGGER vwgcs_view_geometry_update
BEFORE UPDATE OF 'view_geometry' ON 'views_geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns_statistics violates constraint: view_geometry value must not contain a single quote')
WHERE NEW.view_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns_statistics violates constraint: 
view_geometry value must not contain a double quote')
WHERE NEW.view_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns_statistics violates constraint: view_geometry value must be lower case')
WHERE NEW.view_geometry <> lower(NEW.view_geometry);
END;
CREATE TRIGGER vtgcs_virt_name_insert
BEFORE INSERT ON 'virts_geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on virts_geometry_columns_statistics violates constraint: virt_name value must not contain a single quote')
WHERE NEW.virt_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_statistics violates constraint: virt_name value must not contain a double quote')
WHERE NEW.virt_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_statistics violates constraint: 
virt_name value must be lower case')
WHERE NEW.virt_name <> lower(NEW.virt_name);
END;
CREATE TRIGGER vtgcs_virt_name_update
BEFORE UPDATE OF 'virt_name' ON 'virts_geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on virts_geometry_columns_statistics violates constraint: virt_name value must not contain a single quote')
WHERE NEW.virt_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_statistics violates constraint: virt_name value must not contain a double quote')
WHERE NEW.virt_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_statistics violates constraint: virt_name value must be lower case')
WHERE NEW.virt_name <> lower(NEW.virt_name);
END;
CREATE TRIGGER vtgcs_virt_geometry_insert
BEFORE INSERT ON 'virts_geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on virts_geometry_columns_statistics violates constraint: virt_geometry value must not contain a single quote')
WHERE NEW.virt_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_statistics violates constraint: 
virt_geometry value must not contain a double quote')
WHERE NEW.virt_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_statistics violates constraint: virt_geometry value must be lower case')
WHERE NEW.virt_geometry <> lower(NEW.virt_geometry);
END;
CREATE TRIGGER vtgcs_virt_geometry_update
BEFORE UPDATE OF 'virt_geometry' ON 'virts_geometry_columns_statistics'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on virts_geometry_columns_statistics violates constraint: virt_geometry value must not contain a single quote')
WHERE NEW.virt_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_statistics violates constraint: 
virt_geometry value must not contain a double quote')
WHERE NEW.virt_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_statistics violates constraint: virt_geometry value must be lower case')
WHERE NEW.virt_geometry <> lower(NEW.virt_geometry);
END;
CREATE TRIGGER gcfi_f_table_name_insert
BEFORE INSERT ON 'geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on geometry_columns_field_infos violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on geometry_columns_field_infos violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on geometry_columns_field_infos violates constraint: 
f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER gcfi_f_table_name_update
BEFORE UPDATE OF 'f_table_name' ON 'geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on geometry_columns_field_infos violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on geometry_columns_field_infos violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on geometry_columns_field_infos violates constraint: f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER gcfi_f_geometry_column_insert
BEFORE INSERT ON 'geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on geometry_columns_field_infos violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'insert on geometry_columns_field_infos violates constraint: 
f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'insert on geometry_columns_field_infos violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER gcfi_f_geometry_column_update
BEFORE UPDATE OF 'f_geometry_column' ON 'geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on geometry_columns_field_infos violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'update on geometry_columns_field_infos violates constraint: f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'update on geometry_columns_field_infos violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER vwgcfi_view_name_insert
BEFORE INSERT ON 'views_geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns_field_infos violates constraint: view_name value must not contain a single quote')
WHERE NEW.view_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_field_infos violates constraint: view_name value must not contain a double quote')
WHERE NEW.view_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_field_infos violates constraint: 
view_name value must be lower case')
WHERE NEW.view_name <> lower(NEW.view_name);
END;
CREATE TRIGGER vwgcfi_view_name_update
BEFORE UPDATE OF 'view_name' ON 'views_geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns_field_infos violates constraint: view_name value must not contain a single quote')
WHERE NEW.view_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns_field_infos violates constraint: view_name value must not contain a double quote')
WHERE NEW.view_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns_field_infos violates constraint: view_name value must be lower case')
WHERE NEW.view_name <> lower(NEW.view_name);
END;
CREATE TRIGGER vwgcfi_view_geometry_insert
BEFORE INSERT ON 'views_geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns_field_infos violates constraint: view_geometry value must not contain a single quote')
WHERE NEW.view_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_field_infos violates constraint: 
view_geometry value must not contain a double quote')
WHERE NEW.view_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_field_infos violates constraint: view_geometry value must be lower case')
WHERE NEW.view_geometry <> lower(NEW.view_geometry);
END;
CREATE TRIGGER vwgcfi_view_geometry_update
BEFORE UPDATE OF 'view_geometry' ON 'views_geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns_field_infos violates constraint: view_geometry value must not contain a single quote')
WHERE NEW.view_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns_field_infos violates constraint: 
view_geometry value must not contain a double quote')
WHERE NEW.view_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns_field_infos violates constraint: view_geometry value must be lower case')
WHERE NEW.view_geometry <> lower(NEW.view_geometry);
END;
CREATE TRIGGER vtgcfi_virt_name_insert
BEFORE INSERT ON 'virts_geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on virts_geometry_columns_field_infos violates constraint: virt_name value must not contain a single quote')
WHERE NEW.virt_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_field_infos violates constraint: virt_name value must not contain a double quote')
WHERE NEW.virt_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_field_infos violates constraint: 
virt_name value must be lower case')
WHERE NEW.virt_name <> lower(NEW.virt_name);
END;
CREATE TRIGGER vtgcfi_virt_name_update
BEFORE UPDATE OF 'virt_name' ON 'virts_geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on virts_geometry_columns_field_infos violates constraint: virt_name value must not contain a single quote')
WHERE NEW.virt_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_field_infos violates constraint: virt_name value must not contain a double quote')
WHERE NEW.virt_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_field_infos violates constraint: virt_name value must be lower case')
WHERE NEW.virt_name <> lower(NEW.virt_name);
END;
CREATE TRIGGER vtgcfi_virt_geometry_insert
BEFORE INSERT ON 'virts_geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on virts_geometry_columns_field_infos violates constraint: virt_geometry value must not contain a single quote')
WHERE NEW.virt_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_field_infos violates constraint: 
virt_geometry value must not contain a double quote')
WHERE NEW.virt_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_field_infos violates constraint: virt_geometry value must be lower case')
WHERE NEW.virt_geometry <> lower(NEW.virt_geometry);
END;
CREATE TRIGGER vtgcfi_virt_geometry_update
BEFORE UPDATE OF 'virt_geometry' ON 'virts_geometry_columns_field_infos'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on virts_geometry_columns_field_infos violates constraint: virt_geometry value must not contain a single quote')
WHERE NEW.virt_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_field_infos violates constraint: 
virt_geometry value must not contain a double quote')
WHERE NEW.virt_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_field_infos violates constraint: virt_geometry value must be lower case')
WHERE NEW.virt_geometry <> lower(NEW.virt_geometry);
END;
CREATE TRIGGER gctm_f_table_name_insert
BEFORE INSERT ON 'geometry_columns_time'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on geometry_columns_time violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on geometry_columns_time violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on geometry_columns_time violates constraint: 
f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER gctm_f_table_name_update
BEFORE UPDATE OF 'f_table_name' ON 'geometry_columns_time'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on geometry_columns_time violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on geometry_columns_time violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on geometry_columns_time violates constraint: f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER gctm_f_geometry_column_insert
BEFORE INSERT ON 'geometry_columns_time'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on geometry_columns_time violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'insert on geometry_columns_time violates constraint: 
f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'insert on geometry_columns_time violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER gctm_f_geometry_column_update
BEFORE UPDATE OF 'f_geometry_column' ON 'geometry_columns_time'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on geometry_columns_time violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'update on geometry_columns_time violates constraint: f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'update on geometry_columns_time violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER gcau_f_table_name_insert
BEFORE INSERT ON 'geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on geometry_columns_auth violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on geometry_columns_auth violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on geometry_columns_auth violates constraint: 
f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER gcau_f_table_name_update
BEFORE UPDATE OF 'f_table_name' ON 'geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on geometry_columns_auth violates constraint: f_table_name value must not contain a single quote')
WHERE NEW.f_table_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on geometry_columns_auth violates constraint: f_table_name value must not contain a double quote')
WHERE NEW.f_table_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on geometry_columns_auth violates constraint: f_table_name value must be lower case')
WHERE NEW.f_table_name <> lower(NEW.f_table_name);
END;
CREATE TRIGGER gcau_f_geometry_column_insert
BEFORE INSERT ON 'geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on geometry_columns_auth violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'insert on geometry_columns_auth violates constraint: 
f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'insert on geometry_columns_auth violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER gcau_f_geometry_column_update
BEFORE UPDATE OF 'f_geometry_column' ON 'geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on geometry_columns_auth violates constraint: f_geometry_column value must not contain a single quote')
WHERE NEW.f_geometry_column LIKE ('%''%');
SELECT RAISE(ABORT,'update on geometry_columns_auth violates constraint: f_geometry_column value must not contain a double quote')
WHERE NEW.f_geometry_column LIKE ('%"%');
SELECT RAISE(ABORT,'update on geometry_columns_auth violates constraint: f_geometry_column value must be lower case')
WHERE NEW.f_geometry_column <> lower(NEW.f_geometry_column);
END;
CREATE TRIGGER vwgcau_view_name_insert
BEFORE INSERT ON 'views_geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns_auth violates constraint: view_name value must not contain a single quote')
WHERE NEW.view_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_auth violates constraint: view_name value must not contain a double quote')
WHERE NEW.view_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_auth violates constraint: 
view_name value must be lower case')
WHERE NEW.view_name <> lower(NEW.view_name);
END;
CREATE TRIGGER vwgcau_view_name_update
BEFORE UPDATE OF 'view_name' ON 'views_geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns_auth violates constraint: view_name value must not contain a single quote')
WHERE NEW.view_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns_auth violates constraint: view_name value must not contain a double quote')
WHERE NEW.view_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns_auth violates constraint: view_name value must be lower case')
WHERE NEW.view_name <> lower(NEW.view_name);
END;
CREATE TRIGGER vwgcau_view_geometry_insert
BEFORE INSERT ON 'views_geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on views_geometry_columns_auth violates constraint: view_geometry value must not contain a single quote')
WHERE NEW.view_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_auth violates constraint: 
view_geometry value must not contain a double quote')
WHERE NEW.view_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'insert on views_geometry_columns_auth violates constraint: view_geometry value must be lower case')
WHERE NEW.view_geometry <> lower(NEW.view_geometry);
END;
CREATE TRIGGER vwgcau_view_geometry_update
BEFORE UPDATE OF 'view_geometry'  ON 'views_geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on views_geometry_columns_auth violates constraint: view_geometry value must not contain a single quote')
WHERE NEW.view_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'update on views_geometry_columns_auth violates constraint: 
view_geometry value must not contain a double quote')
WHERE NEW.view_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'update on views_geometry_columns_auth violates constraint: view_geometry value must be lower case')
WHERE NEW.view_geometry <> lower(NEW.view_geometry);
END;
CREATE TRIGGER vtgcau_virt_name_insert
BEFORE INSERT ON 'virts_geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on virts_geometry_columns_auth violates constraint: virt_name value must not contain a single quote')
WHERE NEW.virt_name LIKE ('%''%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_auth violates constraint: virt_name value must not contain a double quote')
WHERE NEW.virt_name LIKE ('%"%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_auth violates constraint: 
virt_name value must be lower case')
WHERE NEW.virt_name <> lower(NEW.virt_name);
END;
CREATE TRIGGER vtgcau_virt_name_update
BEFORE UPDATE OF 'virt_name' ON 'virts_geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on virts_geometry_columns_auth violates constraint: virt_name value must not contain a single quote')
WHERE NEW.virt_name LIKE ('%''%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_auth violates constraint: virt_name value must not contain a double quote')
WHERE NEW.virt_name LIKE ('%"%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_auth violates constraint: virt_name value must be lower case')
WHERE NEW.virt_name <> lower(NEW.virt_name);
END;
CREATE TRIGGER vtgcau_virt_geometry_insert
BEFORE INSERT ON 'virts_geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'insert on virts_geometry_columns_auth violates constraint: virt_geometry value must not contain a single quote')
WHERE NEW.virt_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_auth violates constraint: 
virt_geometry value must not contain a double quote')
WHERE NEW.virt_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'insert on virts_geometry_columns_auth violates constraint: virt_geometry value must be lower case')
WHERE NEW.virt_geometry <> lower(NEW.virt_geometry);
END;
CREATE TRIGGER vtgcau_virt_geometry_update
BEFORE UPDATE OF 'virt_geometry' ON 'virts_geometry_columns_auth'
FOR EACH ROW BEGIN
SELECT RAISE(ABORT,'update on virts_geometry_columns_auth violates constraint: virt_geometry value must not contain a single quote')
WHERE NEW.virt_geometry LIKE ('%''%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_auth violates constraint: 
virt_geometry value must not contain a double quote')
WHERE NEW.virt_geometry LIKE ('%"%');
SELECT RAISE(ABORT,'update on virts_geometry_columns_auth violates constraint: virt_geometry value must be lower case')
WHERE NEW.virt_geometry <> lower(NEW.virt_geometry);
END;
CREATE VIEW vector_layers AS
SELECT 'SpatialTable' AS layer_type, f_table_name AS table_name, f_geometry_column AS geometry_column, geometry_type AS geometry_type, coord_dimension AS coord_dimension, srid AS srid, spatial_index_enabled AS spatial_index_enabled
FROM geometry_columns
UNION
SELECT 'SpatialView' AS layer_type, a.view_name AS table_name, a.view_geometry AS geometry_column, b.geometry_type AS geometry_type, b.coord_dimension AS coord_dimension, b.srid AS srid, b.spatial_index_enabled AS spatial_index_enabled
FROM views_geometry_columns AS a
LEFT JOIN geometry_columns AS b ON (Upper(a.f_table_name) = Upper(b.f_table_name) AND Upper(a.f_geometry_column) = Upper(b.f_geometry_column))
UNION
SELECT 'VirtualShape' AS layer_type, virt_name AS table_name, virt_geometry AS geometry_column, geometry_type AS geometry_type, coord_dimension AS coord_dimension, srid AS srid, 0 AS spatial_index_enabled
FROM virts_geometry_columns
/* vector_layers(layer_type,table_name,geometry_column,geometry_type,coord_dimension,srid,spatial_index_enabled) */;
CREATE VIEW vector_layers_auth AS
SELECT 'SpatialTable' AS layer_type, f_table_name AS table_name, f_geometry_column AS geometry_column, read_only AS read_only, hidden AS hidden
FROM geometry_columns_auth
UNION
SELECT 'SpatialView' AS layer_type, a.view_name AS table_name, a.view_geometry AS geometry_column, b.read_only AS read_only, a.hidden AS hidden
FROM views_geometry_columns_auth AS a
JOIN views_geometry_columns AS b ON (Upper(a.view_name) = Upper(b.view_name) AND Upper(a.view_geometry) = Upper(b.view_geometry))
UNION
SELECT 'VirtualShape' AS layer_type, virt_name AS table_name, virt_geometry AS geometry_column, 1 AS read_only, hidden AS hidden
FROM virts_geometry_columns_auth
/* vector_layers_auth(layer_type,table_name,geometry_column,read_only,hidden) */;
CREATE VIEW vector_layers_statistics AS
SELECT 'SpatialTable' AS layer_type, f_table_name AS table_name, f_geometry_column AS geometry_column, last_verified AS last_verified, row_count AS row_count, extent_min_x AS extent_min_x, extent_min_y AS extent_min_y, extent_max_x AS extent_max_x, extent_max_y AS extent_max_y
FROM geometry_columns_statistics
UNION
SELECT 'SpatialView' AS layer_type, view_name AS table_name, view_geometry AS geometry_column, last_verified AS last_verified, row_count AS row_count, extent_min_x AS extent_min_x, extent_min_y AS extent_min_y, extent_max_x AS extent_max_x, extent_max_y AS extent_max_y
FROM views_geometry_columns_statistics
UNION
SELECT 'VirtualShape' AS layer_type, virt_name AS table_name, virt_geometry AS geometry_column, last_verified AS last_verified, row_count AS row_count, extent_min_x AS extent_min_x, extent_min_y AS extent_min_y, extent_max_x AS extent_max_x, extent_max_y AS extent_max_y
FROM virts_geometry_columns_statistics
/* vector_layers_statistics(layer_type,table_name,geometry_column,last_verified,row_count,extent_min_x,extent_min_y,extent_max_x,extent_max_y) */;
CREATE VIEW vector_layers_field_infos AS
SELECT 'SpatialTable' AS layer_type, f_table_name AS table_name, f_geometry_column AS geometry_column, ordinal AS ordinal, column_name AS column_name, null_values AS null_values, integer_values AS integer_values, double_values AS double_values, text_values AS text_values, blob_values AS blob_values, max_size AS max_size, integer_min AS integer_min, integer_max AS integer_max, double_min AS double_min, double_max double_max
FROM geometry_columns_field_infos
UNION
SELECT 'SpatialView' AS layer_type, view_name AS table_name, view_geometry AS geometry_column, ordinal AS ordinal, column_name AS column_name, null_values AS null_values, integer_values AS integer_values, double_values AS double_values, text_values AS text_values, blob_values AS blob_values, max_size AS max_size, integer_min AS integer_min, integer_max AS integer_max, double_min AS double_min, double_max double_max
FROM views_geometry_columns_field_infos
UNION
SELECT 'VirtualShape' AS layer_type, virt_name AS table_name, virt_geometry AS geometry_column, ordinal AS ordinal, column_name AS column_name, null_values AS null_values, integer_values AS integer_values, double_values AS double_values, text_values AS text_values, blob_values AS blob_values, max_size AS max_size, integer_min AS integer_min, integer_max AS integer_max, double_min AS double_min, double_max double_max
FROM virts_geometry_columns_field_infos
/* vector_layers_field_infos(layer_type,table_name,geometry_column,ordinal,column_name,null_values,integer_values,double_values,text_values,blob_values,max_size,integer_min,integer_max,double_min,double_max) */;
CREATE VIRTUAL TABLE SpatialIndex USING VirtualSpatialIndex();
CREATE VIRTUAL TABLE ElementaryGeometries USING VirtualElementary();
CREATE VIRTUAL TABLE KNN2 USING VirtualKNN2();
CREATE VIRTUAL TABLE "idx_trails_geometry" USING rtree(pkid, xmin, xmax, ymin, ymax)
/* idx_trails_geometry(pkid,xmin,xmax,ymin,ymax) */;
CREATE TABLE IF NOT EXISTS "trails"(
  id INT,
  app_uuid TEXT,
  source TEXT,
  name TEXT,
  trail_type TEXT,
  surface TEXT,
  difficulty TEXT,
  elevation_gain REAL,
  max_elevation REAL,
  min_elevation REAL,
  avg_elevation REAL,
  length_km REAL,
  source_tags TEXT,
  created_at NUM,
  updated_at NUM,
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  geo2 NUM,
  osm_id TEXT
, elevation_loss REAL);
CREATE TABLE routing_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  elevation REAL,
  node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
  connected_trails TEXT, -- JSON array of trail UUIDs
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  geo2 POINT
);
CREATE TABLE routing_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node_id INTEGER NOT NULL,
  to_node_id INTEGER NOT NULL,
  trail_id TEXT NOT NULL, -- Trail UUID
  trail_name TEXT NOT NULL,
  distance_km REAL NOT NULL,
  elevation_gain REAL NOT NULL DEFAULT 0,
  elevation_loss REAL NOT NULL DEFAULT 0,
  is_bidirectional BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  geo2 LINESTRING,
  FOREIGN KEY (from_node_id) REFERENCES routing_nodes(id),
  FOREIGN KEY (to_node_id) REFERENCES routing_nodes(id)
);
CREATE INDEX idx_routing_nodes_location ON routing_nodes(lat, lng);
CREATE INDEX idx_routing_nodes_type ON routing_nodes(node_type);
CREATE INDEX idx_routing_edges_trail ON routing_edges(trail_id);
CREATE INDEX idx_routing_edges_nodes ON routing_edges(from_node_id, to_node_id);
CREATE INDEX idx_routing_edges_distance ON routing_edges(distance_km);
CREATE TABLE route_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_uuid TEXT UNIQUE,
  region TEXT NOT NULL, -- Region identifier for multi-region support
  gpx_distance_km REAL NOT NULL,
  gpx_elevation_gain REAL NOT NULL,
  gpx_name TEXT,
  recommended_distance_km REAL NOT NULL,
  recommended_elevation_gain REAL NOT NULL,
  route_type TEXT CHECK(route_type IN ('out-and-back', 'loop', 'lollipop', 'point-to-point')) NOT NULL,
  route_edges TEXT NOT NULL, -- JSON array of edge IDs
  route_path TEXT NOT NULL, -- GeoJSON of the complete route
  similarity_score REAL NOT NULL, -- 0-1 score of how well it matches
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Additional fields from gainiac schema for enhanced functionality
  input_distance_km REAL, -- Input distance for recommendations
  input_elevation_gain REAL, -- Input elevation for recommendations
  input_distance_tolerance REAL, -- Distance tolerance
  input_elevation_tolerance REAL, -- Elevation tolerance
  expires_at TIMESTAMP, -- Expiration timestamp
  usage_count INTEGER DEFAULT 0, -- Usage tracking
  complete_route_data TEXT, -- Complete route information as JSON
  trail_connectivity_data TEXT, -- Trail connectivity data as JSON
  request_hash TEXT -- Request hash for deduplication
);
CREATE INDEX idx_route_recommendations_distance ON route_recommendations(gpx_distance_km, recommended_distance_km);
CREATE INDEX idx_route_recommendations_elevation ON route_recommendations(gpx_elevation_gain, recommended_elevation_gain);
CREATE INDEX idx_route_recommendations_type ON route_recommendations(route_type);
CREATE INDEX idx_route_recommendations_score ON route_recommendations(similarity_score);
CREATE INDEX idx_route_recommendations_uuid ON route_recommendations(route_uuid);
-- Additional indexes from gainiac schema for enhanced query performance
CREATE INDEX idx_route_recommendations_region ON route_recommendations(region);
CREATE INDEX idx_route_recommendations_input ON route_recommendations(input_distance_km, input_elevation_gain);
CREATE INDEX idx_route_recommendations_created ON route_recommendations(created_at);
CREATE INDEX idx_route_recommendations_expires ON route_recommendations(expires_at);
CREATE INDEX idx_route_recommendations_request_hash ON route_recommendations(request_hash);

-- NEW: Performance indices from gainiac schema-v9-with-optimizations.md (purely additive optimizations)

-- Trails Indices (NEW)
CREATE INDEX idx_trails_length ON trails(length_km);
CREATE INDEX idx_trails_elevation ON trails(elevation_gain);

-- Enhanced Route Recommendations Indices (NEW)
CREATE INDEX idx_route_recommendations_region_hash ON route_recommendations(region, request_hash);

-- Routing Indices (NEW - Most Critical for Performance)
CREATE INDEX idx_routing_nodes_coords ON routing_nodes(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX idx_routing_nodes_elevation ON routing_nodes(elevation) WHERE elevation IS NOT NULL;
CREATE INDEX idx_routing_nodes_route_finding ON routing_nodes(id, lat, lng, elevation);
CREATE INDEX idx_routing_edges_from_node ON routing_edges(from_node_id, to_node_id);
CREATE INDEX idx_routing_edges_trail_distance ON routing_edges(trail_id, distance_km);
CREATE INDEX idx_routing_edges_elevation ON routing_edges(elevation_gain, elevation_loss);
CREATE INDEX idx_routing_edges_route_finding ON routing_edges(from_node_id, to_node_id, trail_id, distance_km, elevation_gain);
CREATE VIEW route_stats AS
SELECT 
  COUNT(*) as total_routes,
  AVG(recommended_distance_km) as avg_distance_km,
  AVG(recommended_elevation_gain) as avg_elevation_gain,
  COUNT(CASE WHEN route_type = 'loop' THEN 1 END) as loop_routes,
  COUNT(CASE WHEN route_type = 'out-and-back' THEN 1 END) as out_and_back_routes,
  COUNT(CASE WHEN route_type = 'lollipop' THEN 1 END) as lollipop_routes,
  COUNT(CASE WHEN route_type = 'point-to-point' THEN 1 END) as point_to_point_routes
FROM route_recommendations
/* route_stats(total_routes,avg_distance_km,avg_elevation_gain,loop_routes,out_and_back_routes,lollipop_routes,point_to_point_routes) */;
-- Ensure RTree indexes for all geometry columns
CREATE VIRTUAL TABLE IF NOT EXISTS idx_trails_geometry USING rtree(pkid, xmin, xmax, ymin, ymax);
CREATE VIRTUAL TABLE IF NOT EXISTS idx_routing_nodes_geometry USING rtree(pkid, xmin, xmax, ymin, ymax);
CREATE VIRTUAL TABLE IF NOT EXISTS idx_routing_edges_geometry USING rtree(pkid, xmin, xmax, ymin, ymax);
