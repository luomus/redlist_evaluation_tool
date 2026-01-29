-- Create PostGIS extension if not exists
CREATE EXTENSION IF NOT EXISTS postgis;

-- Drop existing tables if they exist (to ensure clean slate)
DROP TABLE IF EXISTS convex_hulls CASCADE;
DROP TABLE IF EXISTS observations CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

-- Create observations table
CREATE TABLE observations (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_id VARCHAR(100) NOT NULL,
    dataset_name VARCHAR(255),
    dataset_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    properties JSONB NOT NULL,
    geometry GEOMETRY(GEOMETRY, 3067)
);

-- Create convex_hulls table
CREATE TABLE convex_hulls (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id),
    geometry GEOMETRY(POLYGON, 3067),
    area_km2 DOUBLE PRECISION,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create grid_cells table for WGS84 grids
CREATE TABLE IF NOT EXISTS grid_cells (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    cell_row INTEGER,
    cell_col INTEGER,
    geom GEOMETRY(POLYGON, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create projects table
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create base_grid_cells table (Finland-wide base grid, created once)
CREATE TABLE IF NOT EXISTS base_grid_cells (
    id SERIAL PRIMARY KEY,
    grid_x INTEGER,
    grid_y INTEGER,
    geom_3067 GEOMETRY(POLYGON, 3067),
    geom_4326 GEOMETRY(POLYGON, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Verify tables were created
\dt
