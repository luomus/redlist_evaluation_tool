from flask import Flask, render_template, jsonify, request
from livereload import Server
from config import LAJI_API_ACCESS_TOKEN, LAJI_API_BASE_URL
from models import init_db, Session, Observation, ConvexHull, Project, GridCell
from sqlalchemy import Integer, text
import json
from shapely.geometry import shape
from datetime import datetime, timedelta

app = Flask(__name__)
app.debug = True

# Simple in-memory cache for stats
class SimpleCache:
    def __init__(self, ttl_seconds=300):
        self.cache = {}
        self.ttl = timedelta(seconds=ttl_seconds)
    
    def get(self, key):
        if key in self.cache:
            value, timestamp = self.cache[key]
            if datetime.utcnow() - timestamp < self.ttl:
                return value
            else:
                del self.cache[key]
        return None
    
    def set(self, key, value):
        self.cache[key] = (value, datetime.utcnow())
    
    def delete(self, key):
        if key in self.cache:
            del self.cache[key]
    
    def clear(self):
        self.cache.clear()

stats_cache = SimpleCache(ttl_seconds=300)  # 5 minutes TTL

# Initialize database on startup
with app.app_context():
    init_db()

# Generate unique ID
def generate_id():
    from time import time
    from random import randint
    # Millisecond timestamp plus small random suffix to reduce collision risk
    return int(time() * 1000) + randint(0, 999)

@app.route("/")
@app.route("/simple")
def simple():
    return render_template("simple.html")

@app.route("/stats")
def stats():
    return render_template("stats.html")
    
@app.route("/convex_hull")
def convex_hull():
    return render_template("convex_hull.html")

@app.route("/grid")
def grid():
    return render_template("grid.html")

@app.route("/map")
def map():
    return render_template("map.html")

@app.route("/api/config")
def get_config():
    return jsonify({
        "access_token": LAJI_API_ACCESS_TOKEN,
        "base_url": LAJI_API_BASE_URL
    })

# ===== PROJECT ENDPOINTS =====

@app.route("/api/projects", methods=["GET"])
def list_projects():
    """List all projects with their dataset counts"""
    try:
        session = Session()
        from sqlalchemy import func
        
        # Get projects with observation counts and dataset counts
        results = session.query(
            Project.id,
            Project.name,
            Project.description,
            Project.created_at,
            Project.updated_at,
            func.count(Observation.id).label('observation_count'),
            func.count(func.distinct(Observation.dataset_id)).label('dataset_count')
        ).outerjoin(Observation).group_by(
            Project.id, Project.name, Project.description, Project.created_at, Project.updated_at
        ).order_by(Project.created_at.desc()).all()
        
        projects = []
        for row in results:
            projects.append({
                "id": row.id,
                "name": row.name,
                "description": row.description,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "observation_count": row.observation_count,
                "dataset_count": row.dataset_count
            })
        
        session.close()
        return jsonify({"projects": projects})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

# Project creation is disabled - projects are auto-created from red-list-evaluation-groups.json
# @app.route("/api/projects", methods=["POST"])
# def create_project():
#     """Create a new project"""
#     return jsonify({"success": False, "error": "Project creation is disabled. Projects are automatically created from the red-list evaluation groups."}), 403

@app.route("/api/projects/<int:project_id>", methods=["PUT", "PATCH"])
def update_project(project_id):
    """Update project description (name cannot be changed)"""
    try:
        data = request.json
        description = data.get('description', '').strip()
        
        session = Session()
        project = session.query(Project).filter_by(id=project_id).first()
        
        if not project:
            session.close()
            return jsonify({"success": False, "error": "Project not found"}), 404
        
        # Only allow updating description, not name
        project.description = description
        session.commit()
        
        result = {
            "success": True,
            "project": {
                "id": project.id,
                "name": project.name,
                "description": project.description,
                "created_at": project.created_at.isoformat(),
                "updated_at": project.updated_at.isoformat()
            }
        }
        session.close()
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/projects/<int:project_id>", methods=["DELETE"])
def delete_project(project_id):
    """Delete a project and all its observations"""
    try:
        session = Session()
        project = session.query(Project).filter_by(id=project_id).first()
        
        if not project:
            session.close()
            return jsonify({"success": False, "error": "Project not found"}), 404
        
        # Get counts before deletion
        obs_count = session.query(Observation).filter_by(project_id=project_id).count()
        
        # Delete convex hull if exists
        session.query(ConvexHull).filter_by(project_id=project_id).delete()
        
        # Delete any grid cells referencing this project (some DB schemas may not have ON DELETE CASCADE)
        session.query(GridCell).filter_by(project_id=project_id).delete(synchronize_session=False)
        
        # Delete project (cascade will delete observations)
        session.delete(project)
        session.commit()
        session.close()
        
        # Invalidate cache
        stats_cache.delete(f"stats:{project_id}")
        
        return jsonify({
            "success": True,
            "deleted_observations": obs_count
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/projects/<int:project_id>/datasets", methods=["GET"])
def list_project_datasets(project_id):
    """List all datasets within a project"""
    try:
        session = Session()
        from sqlalchemy import func
        
        # Get distinct datasets in the project
        results = session.query(
            Observation.dataset_id,
            func.max(Observation.dataset_name).label('dataset_name'),
            func.max(Observation.dataset_url).label('dataset_url'),
            func.max(Observation.created_at).label('created_at'),
            func.count(Observation.id).label('count')
        ).filter_by(
            project_id=project_id
        ).group_by(
            Observation.dataset_id
        ).order_by(
            func.max(Observation.created_at).desc()
        ).all()
        
        datasets = []
        for row in results:
            datasets.append({
                "dataset_id": row.dataset_id,
                "dataset_name": row.dataset_name,
                "dataset_url": row.dataset_url,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "count": row.count
            })
        
        session.close()
        return jsonify({"datasets": datasets, "project_id": project_id})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/projects/<int:project_id>/datasets/<dataset_id>", methods=["DELETE"])
def delete_dataset_from_project(project_id, dataset_id):
    """Delete a specific dataset from a project"""
    try:
        session = Session()
        
        # Delete observations with matching project_id and dataset_id
        obs_count = session.query(Observation).filter_by(
            project_id=project_id,
            dataset_id=dataset_id
        ).delete()
        
        session.commit()
        session.close()
        
        # Invalidate cache
        stats_cache.delete(f"stats:{project_id}")
        
        return jsonify({
            "success": True,
            "deleted_observations": obs_count
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations", methods=["POST"])
def save_observations():
    """Save observations to database using batched inserts for scalability"""
    try:
        data = request.json
        project_id = data.get('project_id')
        dataset_id = data.get('dataset_id')
        dataset_name = data.get('dataset_name', 'Unnamed Dataset')
        dataset_url = data.get('dataset_url', '')
        features = data.get('features', [])
        
        if not project_id:
            return jsonify({"success": False, "error": "project_id is required"}), 400
        
        if not features:
            return jsonify({"success": False, "error": "No features provided"}), 400
        
        # Verify project exists
        session = Session()
        project = session.query(Project).filter_by(id=project_id).first()
        if not project:
            session.close()
            return jsonify({"success": False, "error": "Project not found"}), 404
        
        from datetime import datetime
        from sqlalchemy import insert
        current_time = datetime.utcnow()
        
        # Process in chunks for memory efficiency
        chunk_size = 1000
        total_inserted = 0
        
        try:
            for i in range(0, len(features), chunk_size):
                chunk = features[i:i+chunk_size]
                
                # Prepare batch insert data
                observations = []
                for feature in chunk:
                    # Extract geometry (assume incoming GeoJSON is EPSG:4326/WGS84)
                    geom = None
                    if feature.get('geometry'):
                        geom = shape(feature['geometry']).wkt
                    
                    observations.append({
                        'project_id': project_id,
                        'dataset_id': dataset_id,
                        'dataset_name': dataset_name,
                        'dataset_url': dataset_url,
                        'created_at': current_time,
                        'properties': feature.get('properties', {}),
                        # Store geometries as WGS84 (EPSG:4326)
                        'geometry': (f'SRID=4326;{geom}' if geom else None)
                    })
                
                # Bulk insert chunk
                if observations:
                    session.execute(insert(Observation), observations)
                    session.commit()
                    total_inserted += len(observations)
            
            # Update project's updated_at timestamp
            project.updated_at = datetime.utcnow()
            session.commit()
            
            # Invalidate cache for this project since new data was added
            stats_cache.delete(f"stats:{project_id}")
            
            return jsonify({"success": True, "count": total_inserted})
            
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<int:project_id>", methods=["GET"])
def get_observations(project_id):
    """Get observations for a project with pagination and spatial filtering
    
    Query Parameters:
    - page: Page number (default: 1)
    - per_page: Records per page (default: 1000, max: 5000)
    - bbox: Bounding box filter as 'minx,miny,maxx,maxy' in EPSG:3067
    """
    try:
        # Pagination parameters
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 1000, type=int)
                
        session = Session()
        
        # Build optimized SQL query with bulk geometry conversion
        # This does everything in a single database query for maximum performance
        offset = (page - 1) * per_page
        params = {
            'project_id': project_id,
            'limit': per_page,
            'offset': offset
        }

        geom_sql = "ST_AsGeoJSON(geometry)"

        # Execute optimized query with window function for count
        query = text(f"""
            SELECT 
                id,
                dataset_id,
                dataset_name,
                dataset_url,
                created_at,
                properties,
                {geom_sql} as geometry_json,
                COUNT(*) OVER() as total_count
            FROM observations
            WHERE project_id = :project_id
            ORDER BY id
            LIMIT :limit OFFSET :offset
        """)
        
        results = session.execute(query, params).fetchall()
        
        if not results:
            session.close()
            return jsonify({
                "type": "FeatureCollection",
                "features": [],
                "project_id": project_id,
                "pagination": {
                    "page": page,
                    "per_page": per_page,
                    "total": 0,
                    "pages": 0
                }
            })
        
        # Get total from first row (window function gives same total for all rows)
        total = results[0].total_count
        
        # Reconstruct GeoJSON features - geometry is already JSON
        features = []
        for row in results:
            props = dict(row.properties or {})
            props['_db_id'] = row.id
            props['_dataset_id'] = row.dataset_id
            feature = {
                "type": "Feature",
                "properties": props,
                "geometry": json.loads(row.geometry_json) if row.geometry_json else None
            }
            features.append(feature)
        
        session.close()
        
        total_pages = (total + per_page - 1) // per_page
        
        return jsonify({
            "type": "FeatureCollection",
            "features": features,
            "project_id": project_id,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "pages": total_pages
            }
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/observation/<int:obs_id>/exclude", methods=["POST"])
def set_observation_excluded(obs_id):
    """Set or unset the 'excluded' flag on an observation's properties JSONB."""
    try:
        data = request.get_json() or {}
        excluded = bool(data.get('excluded', True))

        session = Session()
        obs = session.query(Observation).get(obs_id)
        if not obs:
            session.close()
            return jsonify({"success": False, "error": "Observation not found"}), 404

        props = dict(obs.properties or {})
        props['excluded'] = excluded
        obs.properties = props
        # Also set the indexed excluded boolean column for fast queries
        try:
            obs.excluded = excluded
        except Exception:
            pass
        session.add(obs)
        session.commit()
        session.close()

        return jsonify({"success": True, "excluded": excluded})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/exclude", methods=["POST"])
def set_observations_excluded():
    """Set or unset 'excluded' for many observations in a single batch."""
    try:
        data = request.get_json() or {}
        ids = data.get('ids') or []
        excluded = bool(data.get('excluded', True))
        if not ids or not isinstance(ids, list):
            return jsonify({"success": False, "error": "ids must be a non-empty list"}), 400
        # Sanitize and coerce to integers
        try:
            ids = [int(i) for i in ids]
        except Exception:
            return jsonify({"success": False, "error": "ids must be a list of integers"}), 400
        session = Session()
        try:
            sql = text("""
                WITH updated AS (
                    UPDATE observations
                    SET properties = jsonb_set(properties, '{excluded}', to_jsonb(CAST(:excluded AS boolean)), true),
                        excluded = CAST(:excluded AS boolean)
                    WHERE id = ANY(:ids)
                    RETURNING id
                )
                SELECT id FROM updated
            """)
            # Pass excluded as a boolean to avoid casting issues
            result = session.execute(sql, {'excluded': bool(excluded), 'ids': ids})
            updated = [row[0] for row in result.fetchall()]
            processed = len(updated)
            failed = len(ids) - processed
            session.commit()
            return jsonify({"success": True, "processed": processed, "failed": failed, "updated_ids": updated})
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/datasets", methods=["GET"])
def list_datasets():
    """List all available datasets"""
    try:
        session = Session()
        # Get distinct dataset IDs with their names and record counts
        from sqlalchemy import func
        
        # Get distinct datasets grouped by dataset_id
        results = session.query(
            Observation.dataset_id,
            func.max(Observation.dataset_name).label('dataset_name'),
            func.max(Observation.created_at).label('created_at'),
            func.count(Observation.id).label('count')
        ).group_by(Observation.dataset_id).order_by(
            func.max(Observation.created_at).desc()
        ).all()
        
        datasets = []
        for dataset_id, dataset_name, created_at, count in results:
            datasets.append({
                "id": dataset_id,
                "name": dataset_name,
                "created_at": created_at.isoformat() if created_at else None,
                "count": count
            })
        
        session.close()
        return jsonify({"datasets": datasets})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<int:project_id>/stats", methods=["GET"])
def get_dataset_stats(project_id):
    """Calculate project statistics in the database for scalability"""
    try:
        # Check cache first
        cache_key = f"stats:{project_id}"
        cached_result = stats_cache.get(cache_key)
        if cached_result:
            return jsonify(cached_result)
        
        session = Session()
        from sqlalchemy import func, cast, String, text
        from sqlalchemy.dialects.postgresql import ARRAY
        
        # Get project info
        project = session.query(Project).filter_by(id=project_id).first()
        if not project:
            session.close()
            return jsonify({"success": False, "error": "Project not found"}), 404
        
        # Get total count
        total = session.query(func.count(Observation.id)).filter_by(project_id=project_id).scalar()
        
        if total == 0:
            session.close()
            return jsonify({"success": False, "error": "Project has no observations"}), 404
        
        # Calculate statistics using PostgreSQL aggregations
        # Note: JSONB keys are accessed using -> or ->>
        
        # Unique species count
        unique_species = session.query(
            func.count(func.distinct(
                Observation.properties['unit.linkings.taxon.scientificName'].astext
            ))
        ).filter(
            Observation.project_id == project_id,
            Observation.properties['unit.linkings.taxon.scientificName'].astext.isnot(None)
        ).scalar() or 0
        
        # Unique localities count
        unique_localities = session.query(
            func.count(func.distinct(
                Observation.properties['gathering.locality'].astext
            ))
        ).filter(
            Observation.project_id == project_id,
            Observation.properties['gathering.locality'].astext.isnot(None)
        ).scalar() or 0
        
        # Date range
        dates = session.query(
            func.min(Observation.properties['gathering.displayDateTime'].astext),
            func.max(Observation.properties['gathering.displayDateTime'].astext)
        ).filter_by(project_id=project_id).first()
        
        date_range = {
            "earliest": dates[0].split(' ')[0] if dates[0] else None,
            "latest": dates[1].split(' ')[0] if dates[1] else None
        }
        
        # Record basis counts (group by)
        record_basis_results = session.query(
            Observation.properties['unit.recordBasis'].astext.label('basis'),
            func.count(Observation.id).label('count')
        ).filter_by(
            project_id=project_id
        ).group_by(
            Observation.properties['unit.recordBasis'].astext
        ).all()
        
        record_basis_counts = {
            (row.basis or 'Unknown'): row.count 
            for row in record_basis_results
        }
        
        # Individual count statistics
        individual_stats_raw = session.query(
            func.min(cast(Observation.properties['unit.interpretations.individualCount'].astext, Integer)),
            func.max(cast(Observation.properties['unit.interpretations.individualCount'].astext, Integer)),
            func.sum(cast(Observation.properties['unit.interpretations.individualCount'].astext, Integer)),
            func.avg(cast(Observation.properties['unit.interpretations.individualCount'].astext, Integer)),
            func.count(Observation.id)
        ).filter(
            Observation.project_id == project_id,
            Observation.properties['unit.interpretations.individualCount'].astext.isnot(None),
            Observation.properties['unit.interpretations.individualCount'].astext.cast(Integer).isnot(None)
        ).first()
        
        individual_count_stats = None
        if individual_stats_raw and individual_stats_raw[4] > 0:
            individual_count_stats = {
                "min": individual_stats_raw[0],
                "max": individual_stats_raw[1],
                "sum": individual_stats_raw[2],
                "average": float(individual_stats_raw[3]) if individual_stats_raw[3] else 0,
                "count": individual_stats_raw[4]
            }
        
        # Top 10 species
        top_species_results = session.query(
            Observation.properties['unit.linkings.taxon.scientificName'].astext.label('species'),
            func.count(Observation.id).label('count')
        ).filter(
            Observation.project_id == project_id,
            Observation.properties['unit.linkings.taxon.scientificName'].astext.isnot(None)
        ).group_by(
            Observation.properties['unit.linkings.taxon.scientificName'].astext
        ).order_by(
            func.count(Observation.id).desc()
        ).limit(10).all()
        
        top_species = [
            {"species": row.species, "count": row.count}
            for row in top_species_results
        ]
        
        # Top 10 observers (flattened keys only)
        observer_query = """
            SELECT kv.value as observer, COUNT(*) as count
            FROM observations, jsonb_each_text(properties) AS kv(key, value)
            WHERE project_id = :project_id
              AND kv.key LIKE 'gathering.team%'
              AND kv.value IS NOT NULL
            GROUP BY kv.value
            ORDER BY count DESC
            LIMIT 10
        """

        top_observers_results = session.execute(text(observer_query), {'project_id': project_id}).fetchall()
        top_observers = [
            {"observer": row[0], "count": row[1]}
            for row in top_observers_results
        ]

        # Count unique observers (flattened keys only)
        unique_observers_query = """
            SELECT COUNT(DISTINCT kv.value) FROM observations, jsonb_each_text(properties) AS kv(key, value)
            WHERE project_id = :project_id
              AND kv.key LIKE 'gathering.team%'
              AND kv.value IS NOT NULL
        """
        unique_observers = session.execute(text(unique_observers_query), {'project_id': project_id}).scalar() or 0
        
        session.close()
        
        result = {
            "success": True,
            "project_id": project_id,
            "project_name": project.name,
            "project_description": project.description,
            "created_at": project.created_at.isoformat() if project.created_at else None,
            "stats": {
                "totalRecords": total,
                "uniqueSpecies": unique_species,
                "uniqueLocalities": unique_localities,
                "uniqueObservers": unique_observers,
                "dateRange": date_range,
                "recordBasisCounts": record_basis_counts,
                "individualCountStats": individual_count_stats,
                "topSpecies": top_species,
                "topObservers": top_observers
            }
        }
        
        # Cache the result
        stats_cache.set(cache_key, result)
        
        return jsonify(result)
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<int:project_id>/convex_hull", methods=["GET"])
def get_convex_hull(project_id):
    """Get the pre-calculated convex hull for a project"""
    try:
        session = Session()
        
        convex_hull = session.query(ConvexHull).filter_by(project_id=project_id).first()
        
        if not convex_hull:
            session.close()
            return jsonify({
                "success": False, 
                "error": "Convex hull not calculated yet. Click 'Re-calculate Hull' to generate it."
            }), 404
        
        # Convert geometry to GeoJSON
        geometry_geojson = None
        if convex_hull.geometry:
            geometry_geojson = json.loads(session.scalar(convex_hull.geometry.ST_AsGeoJSON()))
        
        session.close()
        
        return jsonify({
            "success": True,
            "project_id": project_id,
            "geometry": geometry_geojson,
            "area_km2": convex_hull.area_km2,
            "calculated_at": convex_hull.calculated_at.isoformat() if convex_hull.calculated_at else None
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<int:project_id>/convex_hull", methods=["POST"])
def calculate_convex_hull(project_id):
    """Calculate convex hull for a project using PostGIS and store in database"""
    try:
        session = Session()
        
        # Check if project exists
        project_count = session.query(Observation).filter_by(project_id=project_id).count()
        if project_count == 0:
            session.close()
            return jsonify({"success": False, "error": "Project not found or has no observations"}), 404
        
        # Use PostGIS to calculate convex hull of all non-excluded geometries
        # ST_ConvexHull works on collections, so we use ST_Collect to aggregate all geometries
        convex_hull_query = text("""
            WITH non_excluded AS (
                SELECT geometry
                FROM observations
                WHERE project_id = :project_id
                  AND geometry IS NOT NULL
                  AND (excluded IS NULL OR excluded = FALSE)
            ),
            collected AS (
                SELECT ST_Collect(geometry) as geom_collection
                FROM non_excluded
            )
            SELECT 
                ST_ConvexHull(geom_collection) as hull_geom,
                ST_Area(ST_Transform(ST_ConvexHull(geom_collection), 3067)) / 1000000.0 as area_km2
            FROM collected
            WHERE geom_collection IS NOT NULL
        """)
        
        result = session.execute(convex_hull_query, {'project_id': project_id}).fetchone()
        
        if not result or not result[0]:
            session.close()
            return jsonify({
                "success": False, 
                "error": "Could not calculate convex hull. Project may have insufficient non-excluded geometries."
            }), 400
        
        hull_wkb = result[0]
        area_km2 = float(result[1]) if result[1] else 0.0


        # Check if convex hull already exists for this project
        existing_hull = session.query(ConvexHull).filter_by(project_id=project_id).first()

        if existing_hull:
            # Update existing via ORM; if we need to set dataset_id (fallback) do a direct UPDATE
            existing_hull.geometry = hull_wkb
            existing_hull.area_km2 = area_km2
            existing_hull.calculated_at = datetime.utcnow()
        else:
            # Create new via ORM
            new_hull = ConvexHull(
                project_id=project_id,
                geometry=hull_wkb,
                area_km2=area_km2,
                calculated_at=datetime.utcnow()
            )
            session.add(new_hull)

        session.commit()
        
        # Get the geometry as GeoJSON for response
        convex_hull = session.query(ConvexHull).filter_by(project_id=project_id).first()
        geometry_geojson = None
        if convex_hull and convex_hull.geometry:
            geometry_geojson = json.loads(session.scalar(convex_hull.geometry.ST_AsGeoJSON()))
        
        session.close()
        
        return jsonify({
            "success": True,
            "project_id": project_id,
            "geometry": geometry_geojson,
            "area_km2": area_km2,
            "calculated_at": datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<int:project_id>/grid", methods=["GET"])
def get_grid(project_id):
    """Get the stored grid cells for a project as a GeoJSON FeatureCollection"""
    try:
        session = Session()
        rows = session.execute(text("SELECT id, ST_AsGeoJSON(geom) as geom_json FROM grid_cells WHERE project_id = :project_id"), {'project_id': project_id}).fetchall()
        features = []
        for r in rows:
            features.append({
                "type": "Feature",
                "properties": {"_db_id": r.id},
                "geometry": json.loads(r.geom_json) if r.geom_json else None
            })
        session.close()
        return jsonify({"type": "FeatureCollection", "features": features, "project_id": project_id, "success": True})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<int:project_id>/grid", methods=["POST"])
def calculate_grid(project_id):
    """Generate grid for project by selecting base grid cells that intersect observations."""

    session = Session()
    
    try:
        # Delete previous grid cells for the project
        session.execute(text("DELETE FROM grid_cells WHERE project_id = :project_id"), {'project_id': project_id})

        # Use base grid: select cells that intersect project observations
        generation_sql = text("""
            INSERT INTO grid_cells (project_id, geom)
            SELECT DISTINCT :project_id, bg.geom_4326
            FROM base_grid_cells bg
            JOIN observations o
              ON o.project_id = :project_id
              AND o.geometry IS NOT NULL
              AND (o.excluded IS NULL OR o.excluded = FALSE)
              -- bbox operator first to allow index usage, then exact check
              AND bg.geom_4326 && o.geometry
              AND ST_Intersects(bg.geom_4326, o.geometry)
        """)
        session.execute(generation_sql, {'project_id': project_id})

        session.commit()
        
        # Count inserted cells
        cell_count = session.execute(text("SELECT COUNT(*) FROM grid_cells WHERE project_id = :project_id"), {'project_id': project_id}).scalar()
        
        session.close()
        return jsonify({"success": True, "project_id": project_id, "message": "Grid generated", "cell_count": cell_count})
    except Exception as e:
        session.rollback()
        session.close()
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    server = Server(app.wsgi_app)
    server.watch("templates/*.html")
    server.watch("static/*.js")
    server.serve(port=5000, host="0.0.0.0")
