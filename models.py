from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Index, Float, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.dialects.postgresql import JSONB
from geoalchemy2 import Geometry
from datetime import datetime
import os
import time

Base = declarative_base()

class Observation(Base):
    __tablename__ = 'observations'
    
    id = Column(Integer, primary_key=True)
    dataset_id = Column(String(100), nullable=False, index=True)
    dataset_name = Column(String(255))
    dataset_url = Column(Text)  # Store the original URL used to fetch the dataset
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Store properties as JSONB for efficient querying
    properties = Column(JSONB, nullable=False)
    
    # PostGIS geometry column (ETRS-TM35FIN / EPSG:3067)
    geometry = Column(Geometry(geometry_type='GEOMETRY', srid=3067))
    
    # Indexes for performance
    __table_args__ = (
        # GIN index for JSONB queries (fast property searches)
        Index('idx_observations_properties', properties, postgresql_using='gin'),
        # Spatial index for geometry queries
        Index('idx_observations_geometry', geometry, postgresql_using='gist'),
        # Composite index for common query patterns
        Index('idx_observations_dataset_created', dataset_id, created_at.desc()),
    )

class ConvexHull(Base):
    __tablename__ = 'convex_hulls'
    
    id = Column(Integer, primary_key=True)
    dataset_id = Column(String(100), nullable=False, unique=True, index=True)
    
    # PostGIS geometry column for the convex hull (ETRS-TM35FIN / EPSG:3067)
    geometry = Column(Geometry(geometry_type='POLYGON', srid=3067))
    
    # Area in square kilometers
    area_km2 = Column(Float)
    
    # Track when it was calculated
    calculated_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Spatial index for geometry queries
    __table_args__ = (
        Index('idx_convex_hulls_geometry', geometry, postgresql_using='gist'),
    )

class GridCell(Base):
    __tablename__ = 'grid_cells'

    id = Column(Integer, primary_key=True)
    dataset_id = Column(String(100), nullable=False, index=True)
    cell_row = Column(Integer)
    cell_col = Column(Integer)
    geom = Column(Geometry(geometry_type='POLYGON', srid=4326))
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index('idx_grid_cells_geom', geom, postgresql_using='gist'),
    )

class BaseGridCell(Base):
    __tablename__ = 'base_grid_cells'

    id = Column(Integer, primary_key=True)
    grid_x = Column(Integer)
    grid_y = Column(Integer)
    geom_3067 = Column(Geometry(geometry_type='POLYGON', srid=3067))
    geom_4326 = Column(Geometry(geometry_type='POLYGON', srid=4326))
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index('idx_base_grid_geom3067', geom_3067, postgresql_using='gist'),
        Index('idx_base_grid_geom4326', geom_4326, postgresql_using='gist'),
    )

# Database connection with connection pooling
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://biotools:biotools@localhost:5432/biotools')
engine = create_engine(
    DATABASE_URL,
    pool_size=10,          # Number of connections to keep open
    max_overflow=20,       # Allow up to 20 additional connections under load
    pool_pre_ping=True,    # Verify connections before using them
    pool_recycle=3600      # Recycle connections after 1 hour
)
Session = sessionmaker(bind=engine)

def create_base_grid_if_missing():
    """Create the Finland base grid (2km cells in EPSG:3067) if it's not present."""
    session = Session()
    try:
        base_count = session.execute(text("SELECT COUNT(*) FROM base_grid_cells")).scalar()
        if base_count and int(base_count) > 0:
            print(f"Base grid already exists with {base_count} cells")
            return

        print("Creating Finland base grid (2km cells in EPSG:3067)")
        base_grid_sql = text("""
            WITH fin_bbox AS (
              SELECT ST_Transform(ST_MakeEnvelope(19.0, 59.0, 31.6, 70.1, 4326), 3067) AS fin_3067
            ),
            coords AS (
              SELECT
                (floor(ST_XMin(fin_3067)/2000.0)*2000)::bigint AS xmin,
                (floor(ST_YMin(fin_3067)/2000.0)*2000)::bigint AS ymin,
                (ceil(ST_XMax(fin_3067)/2000.0)*2000)::bigint AS xmax,
                (ceil(ST_YMax(fin_3067)/2000.0)*2000)::bigint AS ymax
              FROM fin_bbox
            ),
            grid AS (
              SELECT
                (x/2000)::int AS gx,
                (y/2000)::int AS gy,
                ST_SetSRID(ST_MakeEnvelope(x, y, x + 2000, y + 2000), 3067) AS geom3067
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
    finally:
        session.close()


def init_db():
    """Initialize database tables with retry logic"""
    max_retries = 10
    retry_interval = 2
    
    for attempt in range(max_retries):
        try:
            # Create tables (this is idempotent - won't recreate existing tables)
            Base.metadata.create_all(engine, checkfirst=True)
            
            # Verify tables were actually created by checking if they exist
            with engine.connect() as conn:
                result = conn.execute(text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_name IN ('observations', 'convex_hulls', 'grid_cells', 'base_grid_cells')"
                ))
                existing_tables = {row[0] for row in result}
                
                required = {'observations', 'convex_hulls', 'grid_cells', 'base_grid_cells'}
                if required.issubset(existing_tables):
                    print("Database initialized successfully - all tables exist")
                    # Create base grid if missing (idempotent)
                    try:
                        create_base_grid_if_missing()
                    except Exception as e:
                        print(f"Warning: Base grid creation failed: {e}")
                    return
                else:
                    missing = required - existing_tables
                    raise Exception(f"Tables not created properly. Missing: {missing}")
            
        except Exception as e:          
            if attempt < max_retries - 1:
                print(f"Database connection attempt {attempt + 1} failed: {e}")
                print(f"Retrying in {retry_interval} seconds...")
                time.sleep(retry_interval)
            else:
                print(f"Failed to connect to database after {max_retries} attempts")
                raise
