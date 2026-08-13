"""
Database initialization: table creation and base grid setup.

This module handles:
- Database connection setup
- Creating all required tables
- Generating the Finland-wide 2km base grid (both EPSG:3067 and EPSG:4326)
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ---------------------------------------------------------------------------
# Database connection
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv('DATABASE_URL')
engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
)
Session = sessionmaker(bind=engine)


def create_tables(engine):
    """Create all tables using SQLAlchemy models.
    
    Args:
        engine: SQLAlchemy engine instance
    """
    from models import Base
    Base.metadata.create_all(engine, checkfirst=True)
    print("Tables created successfully")


def verify_tables_exist(engine):
    """Verify that all required tables have been created.
    
    Args:
        engine: SQLAlchemy engine instance
        
    Returns:
        True if all required tables exist, raises Exception otherwise
    """
    with engine.connect() as conn:
        result = conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name IN "
            "('taxons','observations','convex_hulls','grid_metadata','base_grid_cells')"
        ))
        existing_tables = {row[0] for row in result}

        required = {'taxons', 'observations', 'convex_hulls', 'grid_metadata', 'base_grid_cells'}
        if required.issubset(existing_tables):
            print("Database initialized successfully - all tables exist")
            return True
        else:
            missing = required - existing_tables
            raise Exception(f"Tables not created properly. Missing: {missing}")


def create_base_grid_if_missing(session):
    """Create Finland-wide 2km base grid (if not already created).
    
    Generates grid cells covering Finland in both EPSG:3067 (projected) and
    EPSG:4326 (WGS84) coordinate systems.
    
    Args:
        session: SQLAlchemy session instance
    """
    try:
        count = session.execute(text("SELECT COUNT(*) FROM base_grid_cells")).scalar()
        if count and int(count) > 0:
            print(f"Base grid already created ({count} cells), skipping.")
            return

        base_grid_sql = text("""
            WITH coords AS (
                SELECT
                    50000::bigint AS xmin,
                    761000::bigint AS xmax,
                    6580000::bigint AS ymin,
                    7800000::bigint AS ymax
            ),
            grid AS (
                SELECT
                    x AS gx,
                    y AS gy,
                    ST_Polygon(
                        ST_GeomFromText(
                            'LINESTRING(' || x || ' ' || y || ', ' ||
                            (x + 2000) || ' ' || y || ', ' ||
                            (x + 2000) || ' ' || (y + 2000) || ', ' ||
                            x || ' ' || (y + 2000) || ', ' ||
                            x || ' ' || y || ')',
                            3067
                        ),
                        3067
                    ) AS geom3067
                FROM coords,
                     generate_series(xmin, xmax - 2000, 2000::bigint) AS x,
                     generate_series(ymin, ymax - 2000, 2000::bigint) AS y
            )
            INSERT INTO base_grid_cells (grid_x, grid_y, geom_3067, geom_4326)
            SELECT gx, gy, geom3067, ST_Transform(geom3067, 4326) FROM grid;
        """)
        session.execute(base_grid_sql)
        session.commit()
        cell_count = session.execute(text("SELECT COUNT(*) FROM base_grid_cells")).scalar()
        print(f"Base grid created successfully with {cell_count} cells")
    except Exception:
        session.rollback()
        raise


def init_db():
    """Initialize database tables, load taxon hierarchy and base grid.
    
    Uses the consolidated data_loaders package to handle all initialization.
    All operations are idempotent (safe to run multiple times).
    Includes retry logic for Docker container startup sequencing issues.
    """
    from data_loaders.seed import seed_database
    seed_database(engine, Session)
