from flask import Flask, render_template, jsonify, request
from livereload import Server
from config import LAJI_API_ACCESS_TOKEN, LAJI_API_BASE_URL
from models import init_db, Session, Observation, engine
from sqlalchemy import Integer, text
import json
from shapely.geometry import shape

app = Flask(__name__)
app.debug = True

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
                        'geometry': f'SRID=4326;{geom}' if geom else None
                    })
                
                # Bulk insert chunk
                if observations:
                    session.execute(insert(Observation), observations)
                    session.commit()
                    total_inserted += len(observations)
            
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
    """Get observations for a dataset with pagination"""
    try:
        # Pagination parameters
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 100, type=int)
        per_page = min(per_page, 1000)  # Max 1000 per page
        
        session = Session()
        
        # Get total count
        total = session.query(Observation).filter_by(dataset_id=dataset_id).count()
        
        if total == 0:
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
        
        # Get paginated observations
        observations = session.query(Observation).filter_by(
            dataset_id=dataset_id
        ).order_by(
            Observation.id
        ).offset((page - 1) * per_page).limit(per_page).all()
        
        # Reconstruct GeoJSON features
        features = []
        for obs in observations:
            feature = {
                "type": "Feature",
                "properties": obs.properties,
                "geometry": json.loads(session.scalar(obs.geometry.ST_AsGeoJSON())) if obs.geometry else None
            }
            features.append(feature)
        
        # Get dataset metadata from first observation
        dataset_name = observations[0].dataset_name if observations else "Unknown"
        dataset_url = observations[0].dataset_url if observations else None
        created_at = observations[0].created_at if observations else None
        
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
        
        return jsonify({
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
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<dataset_id>", methods=["DELETE"])
def delete_observations(dataset_id):
    """Delete a dataset"""
    try:
        session = Session()
        count = session.query(Observation).filter_by(dataset_id=dataset_id).delete()
        session.commit()
        session.close()
        
        return jsonify({"success": True, "deleted": count})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    server = Server(app.wsgi_app)
    server.watch("templates/*.html")
    server.watch("static/*.js")
    server.serve(port=5000, host="0.0.0.0")
