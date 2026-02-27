-- Migration: add iucn_category and mx_id columns to projects table
-- Safe to run on an existing database (uses IF NOT EXISTS guards).
-- Run once on the remote OpenShift database, then re-run species seeding.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS iucn_category VARCHAR(100),
    ADD COLUMN IF NOT EXISTS mx_id         VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_projects_mx_id ON projects(mx_id);
