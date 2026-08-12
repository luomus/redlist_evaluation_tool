"""Database seeding orchestration."""
import time
from . import database
from .load_tsv import load_taxons_from_tsv


def seed_database(engine, session_factory, max_retries=3, retry_interval=2):
    """Initialize database with tables, taxons from TSV, and base grid.

    All operations are idempotent: safe to run multiple times.
    """
    for attempt in range(max_retries):
        try:
            database.create_tables(engine)
            database.verify_tables_exist(engine)

            try:
                load_taxons_from_tsv(session_factory)
            except Exception as e:
                print(f"Warning: Taxon loading failed: {e}")

            try:
                session = session_factory()
                database.create_base_grid_if_missing(session)
            except Exception as e:
                print(f"Warning: Base grid creation failed: {e}")

            print("\n✓ Database initialization complete!")
            return

        except Exception as e:
            if attempt < max_retries - 1:
                print(f"Database connection attempt {attempt + 1} failed: {e}")
                print(f"Retrying in {retry_interval} seconds...")
                time.sleep(retry_interval)
            else:
                print(f"Failed to connect to database after {max_retries} attempts")
                raise

