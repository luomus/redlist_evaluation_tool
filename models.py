from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Index
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

def init_db():
    """Initialize database tables with retry logic"""
    max_retries = 30
    retry_interval = 2
    
    for attempt in range(max_retries):
        try:
            # Create tables (this is idempotent - won't recreate existing tables)
            Base.metadata.create_all(engine, checkfirst=True)
            print("Database initialized successfully")
            return
        except Exception as e:
            error_msg = str(e).lower()
            # If the error is just about indexes already existing, that's fine - continue
            if 'already exists' in error_msg and 'idx_' in error_msg:
                print(f"Note: Some indexes already exist (this is normal on restart)")
                return
            
            if attempt < max_retries - 1:
                print(f"Database connection attempt {attempt + 1} failed: {e}")
                print(f"Retrying in {retry_interval} seconds...")
                time.sleep(retry_interval)
            else:
                print(f"Failed to connect to database after {max_retries} attempts")
                raise
