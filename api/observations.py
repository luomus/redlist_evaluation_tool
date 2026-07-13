"""Observation data management API endpoints (CRUD, CSV I/O, exclusion, geometry)."""
import csv
import io
import json
from datetime import datetime
from flask import Blueprint, jsonify, request, current_app, make_response
from sqlalchemy import text, insert
from shapely.geometry import shape
from shapely import wkt as shapely_wkt
from models import Session, Project, Observation
from cache import stats_cache
from utils.helpers import generate_id
from auth.decorators import login_required

bp = Blueprint('api_observations', __name__, url_prefix='/api')


@bp.route('/observations', methods=['POST'])
@login_required
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
        db = Session()
        project = db.query(Project).filter_by(id=project_id).first()
        if not project:
            db.close()
            return jsonify({"success": False, "error": "Project not found"}), 404
        
        current_time = datetime.utcnow()
        
        # Process in chunks for memory efficiency
        chunk_size = 1000
        total_inserted = 0
        
        try:
            for i in range(0, len(features), chunk_size):
                chunk = features[i:i+chunk_size]
                
                observations = []
                for feature in chunk:
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
                        'geometry': (f'SRID=4326;{geom}' if geom else None)
                    })
                
                if observations:
                    db.execute(insert(Observation), observations)
                    db.commit()
                    total_inserted += len(observations)
            
            project.updated_at = datetime.utcnow()
            db.commit()
            stats_cache.delete(f"stats:{project_id}")
            
            return jsonify({"success": True, "count": total_inserted})
            
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/species/<int:project_id>/upload_csv', methods=['POST'])
@login_required
def upload_csv_to_species(project_id):
    """Upload CSV file and insert observations for the project.
    Expected CSV: rows with latitude/longitude OR a geometry WKT column.
    """
    try:
        if 'file' not in request.files:
            return jsonify({"success": False, "error": "No file provided"}), 400
        f = request.files.get('file')
        if not f or f.filename == '':
            return jsonify({"success": False, "error": "Empty file"}), 400

        dataset_name = request.form.get('dataset_name') or request.form.get('dataset') or f.filename
        dataset_id = request.form.get('dataset_id') or generate_id()

        content = f.stream.read().decode('utf-8', errors='replace')
        reader = csv.DictReader(io.StringIO(content))

        features = []
        for row in reader:
            # Prefer WKT column when present
            wkt_str = None
            for k, v in (row or {}).items():
                if k is None or v is None:
                    continue
                kl = k.strip().lower()
                if kl in ('wkt', 'geometry', 'wgs84wkt', 'geometry_wkt', 'geom', 'geom_wkt') and v:
                    wkt_str = v.strip()
                    break

            lat = None
            lon = None
            for k, v in (row or {}).items():
                if k is None:
                    continue
                kl = k.strip().lower()
                if kl in ('lat', 'latitude', 'y') and v:
                    lat = v
                if kl in ('lon', 'lng', 'longitude', 'x') and v:
                    lon = v

            # Try to parse WKT geometry if available
            geom_obj = None
            if wkt_str:
                try:
                    geom_obj = shapely_wkt.loads(wkt_str)
                except Exception:
                    geom_obj = None

            if geom_obj is None:
                try:
                    latf = float(lat) if lat is not None else None
                    lonf = float(lon) if lon is not None else None
                except Exception:
                    latf = None
                    lonf = None

                if latf is None or lonf is None:
                    continue

                feature_geometry = {"type": "Point", "coordinates": [lonf, latf]}
            else:
                feature_geometry = geom_obj.__geo_interface__

            props = {}
            for k, v in (row or {}).items():
                if k is None:
                    continue
                kl = k.strip().lower()
                if kl in ('lat', 'latitude', 'lon', 'lng', 'longitude', 'x', 'y', 'wkt', 'geometry', 'wgs84wkt', 'geometry_wkt', 'geom', 'geom_wkt'):
                    continue
                props[k] = v

            feature = {"type": "Feature", "properties": props, "geometry": feature_geometry}
            features.append(feature)

        if not features:
            return jsonify({"success": False, "error": "No valid rows with coordinates found in CSV"}), 400

        # Insert observations
        db = Session()
        project = db.query(Project).filter_by(id=project_id).first()
        if not project:
            db.close()
            return jsonify({"success": False, "error": "Project not found"}), 404

        current_time = datetime.utcnow()

        observations = []
        for feature in features:
            geom = None
            if feature.get('geometry'):
                geom = shape(feature['geometry']).wkt
            observations.append({
                'project_id': project_id,
                'dataset_id': str(dataset_id),
                'dataset_name': dataset_name,
                'dataset_url': '',
                'created_at': current_time,
                'properties': feature.get('properties', {}),
                'geometry': (f'SRID=4326;{geom}' if geom else None)
            })

        chunk_size = 1000
        total_inserted = 0
        try:
            for i in range(0, len(observations), chunk_size):
                chunk = observations[i:i+chunk_size]
                db.execute(insert(Observation), chunk)
                db.commit()
                total_inserted += len(chunk)

            project.updated_at = datetime.utcnow()
            db.commit()
            stats_cache.delete(f"stats:{project_id}")

            db.close()
            return jsonify({"success": True, "count": total_inserted, "dataset_id": str(dataset_id)})
        except Exception as e:
            db.rollback()
            db.close()
            raise e

    except Exception as e:
        current_app.logger.error(f"Failed to upload CSV: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/species/<int:project_id>/download_csv', methods=['GET'])
@login_required
def download_csv_from_species(project_id):
    """Download observations from a project as CSV."""
    try:
        session = Session()
        project = session.query(Project).filter_by(id=project_id).first()
        if not project:
            session.close()
            return jsonify({"success": False, "error": "Project not found"}), 404

        dataset_id = request.args.get('dataset_id', None)

        if dataset_id:
            query_text = text("""
                SELECT 
                    id, dataset_id, dataset_name, properties,
                    ST_AsText(geometry) as geometry_wkt
                FROM observations
                WHERE project_id = :project_id AND dataset_id = :dataset_id
                ORDER BY id
            """)
            result = session.execute(query_text, {'project_id': project_id, 'dataset_id': dataset_id})
        else:
            query_text = text("""
                SELECT 
                    id, dataset_id, dataset_name, properties,
                    ST_AsText(geometry) as geometry_wkt
                FROM observations
                WHERE project_id = :project_id
                ORDER BY id
            """)
            result = session.execute(query_text, {'project_id': project_id})
        
        observations = result.fetchall()
        session.close()

        if not observations:
            return jsonify({"success": False, "error": "No observations found"}), 400

        all_property_keys = set()
        for obs in observations:
            props = obs.properties or {}
            if isinstance(props, dict):
                all_property_keys.update(props.keys())

        property_keys = sorted(all_property_keys)

        output = io.StringIO()
        fieldnames = ['wkt'] + property_keys
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        for obs in observations:
            row = {}
            if obs.geometry_wkt:
                row['wkt'] = obs.geometry_wkt
            props = obs.properties or {}
            if isinstance(props, dict):
                for key in property_keys:
                    row[key] = props.get(key, '')
            writer.writerow(row)

        csv_content = output.getvalue()
        output.close()

        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        if dataset_id:
            filename = f"species_{project_id}_dataset_{dataset_id}_{timestamp}.csv"
        else:
            filename = f"species_{project_id}_{timestamp}.csv"

        response = make_response(csv_content)
        response.headers['Content-Disposition'] = f'attachment; filename={filename}'
        response.headers['Content-Type'] = 'text/csv'
        return response

    except Exception as e:
        current_app.logger.error(f"Failed to download CSV: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observations/<int:project_id>', methods=['GET'])
@login_required
def get_observations(project_id):
    """Get observations for a project with pagination."""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = min(int(request.args.get('per_page', 1000)), 1000)
                
        session = Session()
        
        offset = (page - 1) * per_page
        params = {
            'project_id': project_id,
            'limit': per_page,
            'offset': offset
        }

        query = text("""
            SELECT 
                id, dataset_id, dataset_name, dataset_url, created_at, properties,
                ST_AsGeoJSON(geometry) as geometry_json,
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
        
        total = results[0].total_count
        
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
        dataset_name = results[0].dataset_name if hasattr(results[0], 'dataset_name') else None

        return jsonify({
            "type": "FeatureCollection",
            "features": features,
            "dataset_name": dataset_name,
            "project_id": project_id,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "pages": total_pages
            }
        })
    except Exception as e:
        current_app.logger.error(f"Failed to get observations: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observation/<int:obs_id>/exclude', methods=['POST'])
@login_required
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


@bp.route('/observations/exclude', methods=['POST'])
@login_required
def set_observations_excluded():
    """Set or unset 'excluded' for many observations in a single batch."""
    try:
        data = request.get_json() or {}
        ids = data.get('ids') or []
        excluded = bool(data.get('excluded', True))
        if not ids or not isinstance(ids, list):
            return jsonify({"success": False, "error": "ids must be a non-empty list"}), 400
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
        current_app.logger.error(f"Failed to set observations excluded: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observation/<int:obs_id>/geometry', methods=['PATCH'])
@login_required
def update_observation_geometry(obs_id):
    """Replace the geometry of a single observation."""
    try:
        data = request.get_json() or {}
        geometry = data.get('geometry')
        if not geometry or not isinstance(geometry, dict):
            return jsonify({"success": False, "error": "geometry required"}), 400
        try:
            geom_shape = shape(geometry)
            wkt_str = f'SRID=4326;{geom_shape.wkt}'
        except Exception as e:
            return jsonify({"success": False, "error": f"Invalid geometry: {str(e)}"}), 400

        session = Session()
        obs = session.query(Observation).get(obs_id)
        if not obs:
            session.close()
            return jsonify({"success": False, "error": "Observation not found"}), 404

        obs.geometry = wkt_str
        session.add(obs)
        session.commit()
        session.close()

        return jsonify({"success": True, "obs_id": obs_id})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
