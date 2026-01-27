from flask import Flask, render_template, jsonify, request
from livereload import Server
from config import LAJI_API_ACCESS_TOKEN, LAJI_API_BASE_URL, SIMPLIFY_IN_METERS
from models import init_db, Session, Observation, ConvexHull, engine
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

@app.route("/")
@app.route("/simple")
def simple():
    return render_template("simple.html")

@app.route("/stats")
def stats():
    return render_template("stats.html")

@app.route("/raw")
def raw():
    return render_template("raw.html")
    
@app.route("/convex_hull")
def convex_hull():
    return render_template("convex_hull.html")

@app.route("/map")
def map():
    return render_template("map.html")

@app.route("/api/config")
def get_config():
    return jsonify({
        "access_token": LAJI_API_ACCESS_TOKEN,
        "base_url": LAJI_API_BASE_URL
    })

@app.route("/api/observations", methods=["POST"])
def save_observations():
    """Save observations to database using batched inserts for scalability"""
    try:
        data = request.json
        dataset_id = data.get('dataset_id')
        dataset_name = data.get('dataset_name', 'Unnamed Dataset')
        dataset_url = data.get('dataset_url', '')
        features = data.get('features', [])
        
        if not features:
            return jsonify({"success": False, "error": "No features provided"}), 400
        
        from datetime import datetime
        from sqlalchemy import insert
        current_time = datetime.utcnow()
        
        session = Session()
        
        # Process in chunks for memory efficiency
        chunk_size = 1000
        total_inserted = 0
        
        try:
            for i in range(0, len(features), chunk_size):
                chunk = features[i:i+chunk_size]
                
                # Prepare batch insert data
                observations = []
                for feature in chunk:
                    # Extract geometry
                    geom = None
                    if feature.get('geometry'):
                        geom = shape(feature['geometry']).wkt
                    
                    observations.append({
                        'dataset_id': dataset_id,
                        'dataset_name': dataset_name,
                        'dataset_url': dataset_url,
                        'created_at': current_time,
                        'properties': feature.get('properties', {}),
                        'geometry': (f'SRID=3067;{geom}' if geom else None)
                    })
                
                # Bulk insert chunk
                if observations:
                    session.execute(insert(Observation), observations)
                    session.commit()
                    total_inserted += len(observations)
            
            # Invalidate cache for this dataset since new data was added
            stats_cache.delete(f"stats:{dataset_id}")
            
            return jsonify({"success": True, "count": total_inserted})
            
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<dataset_id>", methods=["GET"])
def get_observations(dataset_id):
    """Get observations for a dataset with pagination and spatial filtering
    
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
            'dataset_id': dataset_id,
            'limit': per_page,
            'offset': offset
        }

        # Parameterize SIMPLIFY_IN_METERS to avoid inlining dynamic values into SQL
        if SIMPLIFY_IN_METERS > 0:
            geom_sql = "ST_AsGeoJSON(ST_Simplify(geometry, :SIMPLIFY_IN_METERS))"
            params['_SIMPLIFY_IN_METERS'] = float(SIMPLIFY_IN_METERS)
        else:
            geom_sql = "ST_AsGeoJSON(geometry)"

        # Execute optimized query with window function for count
        query = text(f"""
            SELECT 
                id,
                dataset_name,
                dataset_url,
                created_at,
                properties,
                {geom_sql} as geometry_json,
                COUNT(*) OVER() as total_count
            FROM observations
            WHERE dataset_id = :dataset_id
            ORDER BY id
            LIMIT :limit OFFSET :offset
        """)
        
        results = session.execute(query, params).fetchall()
        
        if not results:
            session.close()
            return jsonify({
                "type": "FeatureCollection",
                "features": [],
                "dataset_id": dataset_id,
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
            feature = {
                "type": "Feature",
                "properties": props,
                "geometry": json.loads(row.geometry_json) if row.geometry_json else None
            }
            features.append(feature)
        
        # Get dataset metadata from first row
        dataset_name = results[0].dataset_name
        dataset_url = results[0].dataset_url
        created_at = results[0].created_at
        
        session.close()
        
        total_pages = (total + per_page - 1) // per_page
        
        return jsonify({
            "type": "FeatureCollection",
            "features": features,
            "dataset_id": dataset_id,
            "dataset_name": dataset_name,
            "dataset_url": dataset_url,
            "created_at": created_at.isoformat() if created_at else None,
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
        session.add(obs)
        session.commit()
        session.close()

        return jsonify({"success": True, "excluded": excluded})
    except Exception as e:
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

@app.route("/api/observations/<dataset_id>/stats", methods=["GET"])
def get_dataset_stats(dataset_id):
    """Calculate dataset statistics in the database for scalability"""
    try:
        # Check cache first
        cache_key = f"stats:{dataset_id}"
        cached_result = stats_cache.get(cache_key)
        if cached_result:
            return jsonify(cached_result)
        
        session = Session()
        from sqlalchemy import func, cast, String, text
        from sqlalchemy.dialects.postgresql import ARRAY
        
        # Get total count
        total = session.query(func.count(Observation.id)).filter_by(dataset_id=dataset_id).scalar()
        
        if total == 0:
            session.close()
            return jsonify({"success": False, "error": "Dataset not found or empty"}), 404
        
        # Get dataset metadata
        metadata = session.query(
            Observation.dataset_name,
            Observation.dataset_url,
            Observation.created_at
        ).filter_by(dataset_id=dataset_id).first()
        
        # Calculate statistics using PostgreSQL aggregations
        # Note: JSONB keys are accessed using -> or ->>
        
        # Unique species count
        unique_species = session.query(
            func.count(func.distinct(
                Observation.properties['unit.linkings.taxon.scientificName'].astext
            ))
        ).filter(
            Observation.dataset_id == dataset_id,
            Observation.properties['unit.linkings.taxon.scientificName'].astext.isnot(None)
        ).scalar() or 0
        
        # Unique localities count
        unique_localities = session.query(
            func.count(func.distinct(
                Observation.properties['gathering.locality'].astext
            ))
        ).filter(
            Observation.dataset_id == dataset_id,
            Observation.properties['gathering.locality'].astext.isnot(None)
        ).scalar() or 0
        
        # Date range
        dates = session.query(
            func.min(Observation.properties['gathering.displayDateTime'].astext),
            func.max(Observation.properties['gathering.displayDateTime'].astext)
        ).filter_by(dataset_id=dataset_id).first()
        
        date_range = {
            "earliest": dates[0].split(' ')[0] if dates[0] else None,
            "latest": dates[1].split(' ')[0] if dates[1] else None
        }
        
        # Record basis counts (group by)
        record_basis_results = session.query(
            Observation.properties['unit.recordBasis'].astext.label('basis'),
            func.count(Observation.id).label('count')
        ).filter_by(
            dataset_id=dataset_id
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
            Observation.dataset_id == dataset_id,
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
            Observation.dataset_id == dataset_id,
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
            WHERE dataset_id = :dataset_id
              AND kv.key LIKE 'gathering.team%'
              AND kv.value IS NOT NULL
            GROUP BY kv.value
            ORDER BY count DESC
            LIMIT 10
        """

        top_observers_results = session.execute(text(observer_query), {'dataset_id': dataset_id}).fetchall()
        top_observers = [
            {"observer": row[0], "count": row[1]}
            for row in top_observers_results
        ]

        # Count unique observers (flattened keys only)
        unique_observers_query = """
            SELECT COUNT(DISTINCT kv.value) FROM observations, jsonb_each_text(properties) AS kv(key, value)
            WHERE dataset_id = :dataset_id
              AND kv.key LIKE 'gathering.team%'
              AND kv.value IS NOT NULL
        """
        unique_observers = session.execute(text(unique_observers_query), {'dataset_id': dataset_id}).scalar() or 0
        
        session.close()
        
        result = {
            "success": True,
            "dataset_id": dataset_id,
            "dataset_name": metadata[0] if metadata else "Unknown",
            "dataset_url": metadata[1] if metadata else None,
            "created_at": metadata[2].isoformat() if metadata and metadata[2] else None,
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

@app.route("/api/observations/<dataset_id>/convex_hull", methods=["GET"])
def get_convex_hull(dataset_id):
    """Get the pre-calculated convex hull for a dataset"""
    try:
        session = Session()
        
        convex_hull = session.query(ConvexHull).filter_by(dataset_id=dataset_id).first()
        
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
            "dataset_id": dataset_id,
            "geometry": geometry_geojson,
            "area_km2": convex_hull.area_km2,
            "calculated_at": convex_hull.calculated_at.isoformat() if convex_hull.calculated_at else None
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<dataset_id>/convex_hull", methods=["POST"])
def calculate_convex_hull(dataset_id):
    """Calculate convex hull for a dataset using PostGIS and store in database"""
    try:
        session = Session()
        
        # Check if dataset exists
        dataset_count = session.query(Observation).filter_by(dataset_id=dataset_id).count()
        if dataset_count == 0:
            session.close()
            return jsonify({"success": False, "error": "Dataset not found"}), 404
        
        # Use PostGIS to calculate convex hull of all non-excluded geometries
        # ST_ConvexHull works on collections, so we use ST_Collect to aggregate all geometries
        convex_hull_query = text("""
            WITH non_excluded AS (
                SELECT geometry
                FROM observations
                WHERE dataset_id = :dataset_id
                  AND geometry IS NOT NULL
                  AND (properties->>'excluded' IS NULL 
                       OR properties->>'excluded' = 'false' 
                       OR properties->>'excluded' = '0')
            ),
            collected AS (
                SELECT ST_Collect(geometry) as geom_collection
                FROM non_excluded
            )
            SELECT 
                ST_ConvexHull(geom_collection) as hull_geom,
                ST_Area(ST_ConvexHull(geom_collection)) / 1000000.0 as area_km2
            FROM collected
            WHERE geom_collection IS NOT NULL
        """)
        
        result = session.execute(convex_hull_query, {'dataset_id': dataset_id}).fetchone()
        
        if not result or not result[0]:
            session.close()
            return jsonify({
                "success": False, 
                "error": "Could not calculate convex hull. Dataset may have insufficient non-excluded geometries."
            }), 400
        
        hull_wkb = result[0]
        area_km2 = float(result[1]) if result[1] else 0.0
        
        # Check if convex hull already exists for this dataset
        existing_hull = session.query(ConvexHull).filter_by(dataset_id=dataset_id).first()
        
        if existing_hull:
            # Update existing
            existing_hull.geometry = hull_wkb
            existing_hull.area_km2 = area_km2
            existing_hull.calculated_at = datetime.utcnow()
        else:
            # Create new
            new_hull = ConvexHull(
                dataset_id=dataset_id,
                geometry=hull_wkb,
                area_km2=area_km2,
                calculated_at=datetime.utcnow()
            )
            session.add(new_hull)
        
        session.commit()
        
        # Get the geometry as GeoJSON for response
        convex_hull = session.query(ConvexHull).filter_by(dataset_id=dataset_id).first()
        geometry_geojson = None
        if convex_hull and convex_hull.geometry:
            geometry_geojson = json.loads(session.scalar(convex_hull.geometry.ST_AsGeoJSON()))
        
        session.close()
        
        return jsonify({
            "success": True,
            "dataset_id": dataset_id,
            "geometry": geometry_geojson,
            "area_km2": area_km2,
            "calculated_at": datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<dataset_id>", methods=["DELETE"])
def delete_observations(dataset_id):
    """Delete a dataset and its convex hull"""
    try:
        session = Session()
        
        # Delete observations
        obs_count = session.query(Observation).filter_by(dataset_id=dataset_id).delete()
        
        # Delete convex hull if exists
        hull_count = session.query(ConvexHull).filter_by(dataset_id=dataset_id).delete()
        
        session.commit()
        session.close()
        
        # Invalidate cache for this dataset
        stats_cache.delete(f"stats:{dataset_id}")
        
        return jsonify({
            "success": True, 
            "deleted_observations": obs_count,
            "deleted_convex_hull": hull_count > 0
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    server = Server(app.wsgi_app)
    server.watch("templates/*.html")
    server.watch("static/*.js")
    server.serve(port=5000, host="0.0.0.0")
