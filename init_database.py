"""
Database initialization script.
Creates all tables, loads the taxon hierarchy from hierarchy.json,
and generates the Finland base grid.
"""
from models import init_db

if __name__ == "__main__":
    print("Initializing database...")
    try:
        init_db()
        print("Database initialization complete!")
        print("  - taxons table (hierarchy from hierarchy.json)")
        print("  - projects table (species seeded from species_and_groups.tsv)")
        print("  - observations table")
        print("  - convex_hulls table")
        print("  - grid_cells table")
        print("  - base_grid_cells table")
    except Exception as e:
        print(f"Error initializing database: {e}")
        import traceback
        traceback.print_exc()
