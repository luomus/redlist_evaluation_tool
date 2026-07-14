from sqlalchemy import Column, Integer, String, DateTime, Text, Float, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from geoalchemy2 import Geometry
from datetime import datetime

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
