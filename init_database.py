"""
Database initialization script
Run this to create all necessary tables in the database.
"""
from models import init_db

if __name__ == "__main__":
    print("Initializing database...")
    try:
        init_db()
        print("✓ Database tables created successfully!")
        print("  - projects table")
        print("  - observations table")
        print("  - convex_hulls table")
        print("  - grid_cells table")
        print("  - base_grid_cells table (base grid)")
        print("  - Indexes and base grid created")
    except Exception as e:
        print(f"✗ Error initializing database: {e}")
        import traceback
        traceback.print_exc()
