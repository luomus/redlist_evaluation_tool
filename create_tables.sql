-- Create PostGIS extension if not exists
CREATE EXTENSION IF NOT EXISTS postgis;

-- Drop existing tables (clean slate)
DROP TABLE IF EXISTS grid_cells CASCADE;
DROP TABLE IF EXISTS convex_hulls CASCADE;
DROP TABLE IF EXISTS observations CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS taxons CASCADE;
DROP TABLE IF EXISTS base_grid_cells CASCADE;

-- Taxon hierarchy (static, loaded from hierarchy.json)
CREATE TABLE taxons (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    scientific_name VARCHAR(255),
    level INTEGER NOT NULL DEFAULT 1,
    parent_id INTEGER REFERENCES taxons(id) ON DELETE CASCADE,
    is_leaf BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_taxons_parent ON taxons(parent_id);
CREATE INDEX idx_taxons_level ON taxons(level);
CREATE INDEX idx_taxons_leaf ON taxons(is_leaf);

-- Projects represent individual species under leaf taxons
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    taxon_id INTEGER NOT NULL REFERENCES taxons(id) ON DELETE CASCADE,
    iucn_category VARCHAR(100),   -- e.g. "LC – Elinvoimaiset" from red-list TSV
    mx_id VARCHAR(50),            -- FinBIF MX-identifier, e.g. "MX.5"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_projects_taxon ON projects(taxon_id);
CREATE INDEX idx_projects_mx_id ON projects(mx_id);

-- Observations with spatial data
CREATE TABLE observations (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_id VARCHAR(100) NOT NULL,
    dataset_name VARCHAR(255),
    dataset_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    excluded BOOLEAN DEFAULT FALSE,
    properties JSONB NOT NULL,
    geometry GEOMETRY(GEOMETRY, 4326)
);
CREATE INDEX idx_observations_project ON observations(project_id);
CREATE INDEX idx_observations_dataset ON observations(dataset_id);
CREATE INDEX idx_observations_excluded ON observations(excluded);
CREATE INDEX idx_observations_created ON observations(created_at);

-- Convex hulls (EOO)
CREATE TABLE convex_hulls (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    geometry GEOMETRY(POLYGON, 4326),
    area_km2 DOUBLE PRECISION,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Grid cells (AOO)
CREATE TABLE grid_cells (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cell_row INTEGER,
    cell_col INTEGER,
    geom GEOMETRY(POLYGON, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Finland-wide base grid (2km cells, created once)
CREATE TABLE base_grid_cells (
    id SERIAL PRIMARY KEY,
    grid_x INTEGER,
    grid_y INTEGER,
    geom_3067 GEOMETRY(POLYGON, 3067),
    geom_4326 GEOMETRY(POLYGON, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
