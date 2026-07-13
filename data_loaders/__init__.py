"""
Data loaders package for biotools.

Handles consolidated database initialization, including:
- Table creation and schema setup
- Loading taxon hierarchy from hierarchy.json
- Loading species (projects) from species_and_groups.tsv
- Creating Finland base grid

Main entry point: seed_database(app_context_or_engine, db_session_factory)
"""
