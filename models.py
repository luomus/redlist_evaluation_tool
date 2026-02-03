from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Index, Float, text, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship, backref
from sqlalchemy.dialects.postgresql import JSONB
from geoalchemy2 import Geometry
from datetime import datetime
import os
import time

Base = declarative_base()

class Project(Base):
    __tablename__ = 'projects'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    parent_id = Column(Integer, ForeignKey('projects.id', ondelete='CASCADE'), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Self-referential relationship for parent-child hierarchy
    children = relationship('Project', 
                          backref=backref('parent', remote_side=[id]))
    
    # Relationship to observations (only child projects have observations)
    observations = relationship('Observation', back_populates='project', cascade='all, delete-orphan')

    # Relationship to grid cells and convex hull
    grid_cells = relationship('GridCell', back_populates='project', cascade='all, delete-orphan')
    convex_hull = relationship('ConvexHull', back_populates='project', uselist=False, cascade='all, delete-orphan')

class Observation(Base):
    __tablename__ = 'observations'
    
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    dataset_id = Column(String(100), nullable=False, index=True)  # Keep for tracking individual datasets within project
    dataset_name = Column(String(255))
    dataset_url = Column(Text)  # Store the original URL used to fetch the dataset
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Excluded flag for quick queries and indexing
    excluded = Column(Boolean, default=False, index=True)
    
    # Store properties as JSONB for efficient querying
    properties = Column(JSONB, nullable=False)
    
    # PostGIS geometry column (WGS84 / EPSG:4326)
    geometry = Column(Geometry(geometry_type='GEOMETRY', srid=4326))
    
    # Relationship to project
    project = relationship('Project', back_populates='observations')

class ConvexHull(Base):
    __tablename__ = 'convex_hulls'
    
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    
    # PostGIS geometry column for the convex hull (WGS84 / EPSG:4326)
    geometry = Column(Geometry(geometry_type='POLYGON', srid=4326))
    
    # Area in square kilometers
    area_km2 = Column(Float)
    
    # Track when it was calculated
    calculated_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Relationship back to project (one-to-one)
    project = relationship('Project', back_populates='convex_hull')

class GridCell(Base):
    __tablename__ = 'grid_cells'

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    cell_row = Column(Integer)
    cell_col = Column(Integer)
    geom = Column(Geometry(geometry_type='POLYGON', srid=4326))
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationship to project
    project = relationship('Project', back_populates='grid_cells')

class BaseGridCell(Base):
    __tablename__ = 'base_grid_cells'

    id = Column(Integer, primary_key=True)
    grid_x = Column(Integer)
    grid_y = Column(Integer)
    geom_3067 = Column(Geometry(geometry_type='POLYGON', srid=3067))
    geom_4326 = Column(Geometry(geometry_type='POLYGON', srid=4326))
    created_at = Column(DateTime, default=datetime.utcnow)

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


def populate_projects_from_json():
    """Populate projects from red-list-evaluation-groups.json if not already present."""
    import json
    import os
    
    session = Session()
    try:
        # Check if projects already exist
        project_count = session.query(Project).count()
        if project_count > 0:
            print(f"Projects already exist ({project_count} projects), skipping auto-population")
            return
        
        # Load the JSON file
        json_path = os.path.join(os.path.dirname(__file__), 'static', 'resources', 'red-list-evaluation-groups.json')
        if not os.path.exists(json_path):
            print(f"Warning: {json_path} not found, skipping project population")
            return
        
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract project names from results
        results = data.get('results', [])
        if not results:
            print("Warning: No results found in red-list-evaluation-groups.json")
            return
        
        # Create projects
        projects_to_add = []
        for item in results:
            name = item.get('name')
            if name:
                projects_to_add.append(Project(name=name, description=''))
        
        if projects_to_add:
            session.bulk_save_objects(projects_to_add)
            session.commit()
            print(f"✓ Created {len(projects_to_add)} projects from red-list-evaluation-groups.json")
        else:
            print("Warning: No valid project names found in JSON")
            
    except Exception as e:
        session.rollback()
        print(f"Warning: Failed to populate projects from JSON: {e}")
        import traceback
        traceback.print_exc()
    finally:
        session.close()


def init_db():
    """Initialize database tables with retry logic"""
    max_retries = 3
    retry_interval = 2
    
    for attempt in range(max_retries):
        try:
            # Create tables (this is idempotent - won't recreate existing tables)
            Base.metadata.create_all(engine, checkfirst=True)
            
            # Verify tables were actually created by checking if they exist
            with engine.connect() as conn:
                result = conn.execute(text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_name IN ('projects', 'observations', 'convex_hulls', 'grid_cells', 'base_grid_cells')"
                ))
                existing_tables = {row[0] for row in result}
                
                required = {'projects', 'observations', 'convex_hulls', 'grid_cells', 'base_grid_cells'}
                if required.issubset(existing_tables):
                    print("Database initialized successfully - all tables exist")
                    # Create base grid if missing (idempotent)
                    try:
                        create_base_grid_if_missing()
                    except Exception as e:
                        print(f"Warning: Base grid creation failed: {e}")
                    # Populate projects from JSON if not already present (idempotent)
                    try:
                        populate_projects_from_json()
                    except Exception as e:
                        print(f"Warning: Failed to populate projects from JSON: {e}")
                    # Ensure 'excluded' column exists, create index and backfill from properties if present
                    try:
                        s = Session()
                        s.execute(text("ALTER TABLE observations ADD COLUMN IF NOT EXISTS excluded BOOLEAN DEFAULT FALSE"))
                        s.execute(text("CREATE INDEX IF NOT EXISTS idx_observations_excluded ON observations(excluded)"))
                        s.execute(text("""
                            UPDATE observations
                            SET excluded = (properties->>'excluded')::boolean
                            WHERE properties ? 'excluded' AND (properties->>'excluded') IS NOT NULL
                        """))
                        s.commit()
                        s.close()
                        print("Schema migration applied: ensured 'excluded' column and backfilled values")
                    except Exception as e:
                        print(f"Warning: Failed to apply schema migration for 'excluded': {e}")
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
