from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Float, text, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from sqlalchemy.dialects.postgresql import JSONB
from geoalchemy2 import Geometry
from datetime import datetime
import os
import time

Base = declarative_base()


class Taxon(Base):
    """Static taxon hierarchy loaded from hierarchy.json. Read-only after init."""
    __tablename__ = 'taxons'

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    scientific_name = Column(String(255))
    level = Column(Integer, nullable=False, default=1)
    parent_id = Column(Integer, ForeignKey('taxons.id', ondelete='CASCADE'), index=True)
    is_leaf = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    parent = relationship('Taxon', remote_side='Taxon.id',
                          foreign_keys='Taxon.parent_id', uselist=False)
    children = relationship('Taxon',
                            foreign_keys='Taxon.parent_id',
                            order_by='Taxon.sort_order',
                            lazy='joined',
                            overlaps='parent')
    projects = relationship('Project', back_populates='taxon')


class Project(Base):
    """A species project belonging to a leaf taxon."""
    __tablename__ = 'projects'

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    taxon_id = Column(Integer, ForeignKey('taxons.id', ondelete='CASCADE'), nullable=False, index=True)
    iucn_category = Column(String(100))   # e.g. "LC – Elinvoimaiset" from red-list TSV
    mx_id = Column(String(50))            # FinBIF MX-identifier, e.g. "MX.5"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    taxon = relationship('Taxon', back_populates='projects')
    observations = relationship('Observation', back_populates='project', cascade='all, delete-orphan')
    grid_cells = relationship('GridCell', back_populates='project', cascade='all, delete-orphan')
    # allow multiple hull records (max/min)
    convex_hulls = relationship('ConvexHull', back_populates='project', cascade='all, delete-orphan')


class Observation(Base):
    __tablename__ = 'observations'

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    dataset_id = Column(String(100), nullable=False, index=True)
    dataset_name = Column(String(255))
    dataset_url = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    excluded = Column(Boolean, default=False, index=True)
    properties = Column(JSONB, nullable=False)
    geometry = Column(Geometry(geometry_type='GEOMETRY', srid=4326))

    project = relationship('Project', back_populates='observations')


class ConvexHull(Base):
    __tablename__ = 'convex_hulls'

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    mode = Column(String(10), nullable=False, default='max', server_default='max', index=True)
    geometry = Column(Geometry(geometry_type='POLYGON', srid=4326))
    area_km2 = Column(Float)
    calculated_at = Column(DateTime, default=datetime.utcnow, index=True)

    project = relationship('Project', back_populates='convex_hulls')


class GridCell(Base):
    __tablename__ = 'grid_cells'

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    cell_row = Column(Integer)
    cell_col = Column(Integer)
    geom = Column(Geometry(geometry_type='POLYGON', srid=4326))
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship('Project', back_populates='grid_cells')


class BaseGridCell(Base):
    """Finland-wide base grid (2km cells in both EPSG:3067 and EPSG:4326)."""
    __tablename__ = 'base_grid_cells'

    id = Column(Integer, primary_key=True)
    grid_x = Column(Integer)
    grid_y = Column(Integer)
    geom_3067 = Column(Geometry(geometry_type='POLYGON', srid=3067))
    geom_4326 = Column(Geometry(geometry_type='POLYGON', srid=4326))
    created_at = Column(DateTime, default=datetime.utcnow)

# ---------------------------------------------------------------------------
# Database connection
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://biotools:biotools@localhost:5432/biotools')
engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
)
Session = sessionmaker(bind=engine)


def create_base_grid_if_missing():
    """Create the Finland base grid (2 km cells in EPSG:3067) if not present."""
    session = Session()
    try:
        base_count = session.execute(text("SELECT COUNT(*) FROM base_grid_cells")).scalar()
        if base_count and int(base_count) > 0:
            print(f"Base grid already exists with {base_count} cells")
            return

        print("Creating Finland base grid (2 km cells in EPSG:3067) ...")
        base_grid_sql = text("""
            WITH fin_bbox AS (
              SELECT ST_Transform(ST_MakeEnvelope(19.0, 59.0, 31.6, 70.1, 4326), 3067) AS fin_3067
            ),
            coords AS (
              SELECT
                (floor(ST_XMin(fin_3067)/2000.0)*2000)::bigint AS xmin,
                (floor(ST_YMin(fin_3067)/2000.0)*2000)::bigint AS ymin,
                (ceil(ST_XMax(fin_3067)/2000.0)*2000)::bigint  AS xmax,
                (ceil(ST_YMax(fin_3067)/2000.0)*2000)::bigint  AS ymax
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
    """Initialize database tables with retry logic, load taxon hierarchy and base grid."""
    from taxon_loader import load_taxons_to_db

    max_retries = 3
    retry_interval = 2

    for attempt in range(max_retries):
        try:
            Base.metadata.create_all(engine, checkfirst=True)

            with engine.connect() as conn:
                result = conn.execute(text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_name IN "
                    "('taxons','projects','observations','convex_hulls','grid_cells','base_grid_cells')"
                ))
                existing_tables = {row[0] for row in result}

                required = {'taxons', 'projects', 'observations', 'convex_hulls', 'grid_cells', 'base_grid_cells'}
                if required.issubset(existing_tables):
                    print("Database initialized successfully - all tables exist")

                    # Load taxon hierarchy from hierarchy.json (idempotent)
                    try:
                        load_taxons_to_db(Session)
                    except Exception as e:
                        print(f"Warning: Taxon hierarchy loading failed: {e}")

                    # Seed species from species_and_groups.tsv (idempotent)
                    try:
                        from species_loader import load_species_to_db
                        load_species_to_db(Session)
                    except Exception as e:
                        print(f"Warning: Species seeding failed: {e}")

                    # Create base grid (idempotent)
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
