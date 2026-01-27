-- Create PostGIS extension if not exists
CREATE EXTENSION IF NOT EXISTS postgis;

-- Drop existing tables if they exist (to ensure clean slate)
DROP TABLE IF EXISTS convex_hulls CASCADE;
DROP TABLE IF EXISTS observations CASCADE;

-- Create observations table
CREATE TABLE observations (
    id SERIAL PRIMARY KEY,
    dataset_id VARCHAR(100) NOT NULL,
    dataset_name VARCHAR(255),
    dataset_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    properties JSONB NOT NULL,
    geometry GEOMETRY(GEOMETRY, 3067)
);

-- Create indexes for observations
CREATE INDEX idx_observations_dataset_id ON observations(dataset_id);
CREATE INDEX idx_observations_created_at ON observations(created_at DESC);
CREATE INDEX idx_observations_properties ON observations USING gin(properties);
CREATE INDEX idx_observations_geometry ON observations USING gist(geometry);
CREATE INDEX idx_observations_dataset_created ON observations(dataset_id, created_at DESC);

-- Create convex_hulls table
CREATE TABLE convex_hulls (
    id SERIAL PRIMARY KEY,
    dataset_id VARCHAR(100) NOT NULL UNIQUE,
    geometry GEOMETRY(POLYGON, 3067),
    area_km2 DOUBLE PRECISION,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for convex_hulls
CREATE INDEX idx_convex_hulls_dataset_id ON convex_hulls(dataset_id);
CREATE INDEX idx_convex_hulls_calculated_at ON convex_hulls(calculated_at DESC);
CREATE INDEX idx_convex_hulls_geometry ON convex_hulls USING gist(geometry);

-- Create grid_cells table for WGS84 grids
CREATE TABLE IF NOT EXISTS grid_cells (
    id SERIAL PRIMARY KEY,
    dataset_id VARCHAR(100) NOT NULL,
    cell_row INTEGER,
    cell_col INTEGER,
    geom GEOMETRY(POLYGON, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_grid_cells_dataset_id ON grid_cells(dataset_id);
CREATE INDEX IF NOT EXISTS idx_grid_cells_geom ON grid_cells USING gist(geom);

-- Create base_grid_cells table (Finland-wide base grid, created once)
CREATE TABLE IF NOT EXISTS base_grid_cells (
    id SERIAL PRIMARY KEY,
    grid_x INTEGER,
    grid_y INTEGER,
    geom_3067 GEOMETRY(POLYGON, 3067),
    geom_4326 GEOMETRY(POLYGON, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_base_grid_geom3067 ON base_grid_cells USING gist(geom_3067);
CREATE INDEX IF NOT EXISTS idx_base_grid_geom4326 ON base_grid_cells USING gist(geom_4326);

-- Verify tables were created
\dt
