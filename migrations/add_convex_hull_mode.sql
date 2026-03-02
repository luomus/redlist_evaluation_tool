-- Add mode column to convex_hulls table and adjust unique constraint

ALTER TABLE convex_hulls ADD COLUMN mode VARCHAR(10) NOT NULL DEFAULT 'max';

-- drop old unique constraint on project_id (and its accompanying unique index)
ALTER TABLE convex_hulls DROP CONSTRAINT IF EXISTS convex_hulls_project_id_key;
-- the old constraint created a unique index which remains; remove it too
DROP INDEX IF EXISTS ix_convex_hulls_project_id;

-- add new unique constraint on (project_id, mode) which creates the proper index
ALTER TABLE convex_hulls ADD CONSTRAINT ux_convex_hulls_project_mode UNIQUE (project_id, mode);

-- add a regular (non-unique) index on project_id for convenience
CREATE INDEX IF NOT EXISTS idx_convex_hulls_project_id ON convex_hulls(project_id);

-- backfill existing rows (the default already sets mode='max')
UPDATE convex_hulls SET mode='max' WHERE mode IS NULL;
