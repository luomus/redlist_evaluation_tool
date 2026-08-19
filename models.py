from sqlalchemy import Column, Integer, String, DateTime, Text, Float, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from geoalchemy2 import Geometry
from datetime import datetime

Base = declarative_base()


class Taxon(Base):
    """Taxon loaded from species_and_groups.tsv, identified by MX-identifier."""
    __tablename__ = 'taxons'

    id = Column(Integer, primary_key=True)
    mx_id = Column(String(50), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    category = Column(String(100))
    elio_ryhma = Column(String(255))

    observations = relationship('Observation', back_populates='taxon', cascade='all, delete-orphan')
    convex_hulls = relationship('ConvexHull', back_populates='taxon', cascade='all, delete-orphan')
    grid_metadata = relationship('GridMetadata', back_populates='taxon', cascade='all, delete-orphan', uselist=False)


class Observation(Base):
    __tablename__ = 'observations'

    id = Column(Integer, primary_key=True)
    taxon_id = Column(Integer, ForeignKey('taxons.id', ondelete='CASCADE'), nullable=False, index=True)
    dataset_id = Column(String(100), nullable=False, index=True)
    dataset_name = Column(String(255))
    dataset_url = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    excluded = Column(Boolean, default=False, index=True)
    properties = Column(JSONB, nullable=False)
    geometry = Column(Geometry(geometry_type='GEOMETRY', srid=4326))
    # Set on the first user-driven geometry edit; the current geometry remains
    # in `geometry` so existing map and export behaviour is unchanged.
    original_geometry = Column(Geometry(geometry_type='GEOMETRY', srid=4326))

    taxon = relationship('Taxon', back_populates='observations')


class ConvexHull(Base):
    __tablename__ = 'convex_hulls'
    __table_args__ = (UniqueConstraint('taxon_id', 'mode', name='ux_convex_hulls_taxon_mode'),)

    id = Column(Integer, primary_key=True)
    taxon_id = Column(Integer, ForeignKey('taxons.id', ondelete='CASCADE'), nullable=False, index=True)
    mode = Column(String(10), nullable=False, default='max', server_default='max', index=True)
    geometry = Column(Geometry(geometry_type='POLYGON', srid=4326))
    area_km2 = Column(Float)
    calculated_at = Column(DateTime, default=datetime.utcnow, index=True)

    taxon = relationship('Taxon', back_populates='convex_hulls')


class GridMetadata(Base):
    """Grid calculation metadata: stores aggregated 2km AOO grid for a taxon."""
    __tablename__ = 'grid_metadata'

    id = Column(Integer, primary_key=True)
    taxon_id = Column(Integer, ForeignKey('taxons.id', ondelete='CASCADE'), nullable=False, index=True, unique=True)
    grid_geometry = Column(Geometry(geometry_type='GEOMETRY', srid=4326))
    calculated_at = Column(DateTime, default=datetime.utcnow, index=True)
    cell_count = Column(Integer, default=0)

    taxon = relationship('Taxon', back_populates='grid_metadata')


class BaseGridCell(Base):
    """Finland-wide base grid (2km cells in both EPSG:3067 and EPSG:4326)."""
    __tablename__ = 'base_grid_cells'

    id = Column(Integer, primary_key=True)
    grid_x = Column(Integer)
    grid_y = Column(Integer)
    geom_3067 = Column(Geometry(geometry_type='POLYGON', srid=3067))
    geom_4326 = Column(Geometry(geometry_type='POLYGON', srid=4326))
    created_at = Column(DateTime, default=datetime.utcnow)
