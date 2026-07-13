"""
Main database seeding orchestration.

This module provides the single entry point for all database initialization:
- Table creation
- Taxon hierarchy loading from hierarchy.json
- Species loading from species_and_groups.tsv
- Base grid creation for Finland

Usage:
    from data_loaders.seed import seed_database
    from models import engine, Session
    
    seed_database(engine, Session)
"""

import time
from . import database, taxons, species


def seed_database(engine, session_factory, max_retries=3, retry_interval=2):
    """Initialize database with tables, taxon hierarchy, species, and base grid.
    
    This is the main entry point for all database initialization.
    Handles retry logic for database connection issues (useful in Docker).
    All operations are idempotent: safe to run multiple times.
    
    Args:
        engine: SQLAlchemy engine instance
        session_factory: SQLAlchemy session factory (e.g., models.Session)
        max_retries: Number of connection attempts before failing
        retry_interval: Seconds to wait between retry attempts
        
    Raises:
        Exception: If database initialization fails after max_retries attempts
    """
    for attempt in range(max_retries):
        try:
            # Step 1: Create tables
            database.create_tables(engine)

            # Step 2: Verify all tables exist
            database.verify_tables_exist(engine)

            # Step 3: Load taxon hierarchy (idempotent)
            try:
                taxons.load_taxons_to_db(session_factory)
            except Exception as e:
                print(f"Warning: Taxon hierarchy loading failed: {e}")

            # Step 4: Seed species (idempotent)
            try:
                species.load_species_to_db(session_factory)
            except Exception as e:
                print(f"Warning: Species seeding failed: {e}")

            # Step 5: Create base grid (idempotent)
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
