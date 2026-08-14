"""Observation and taxon data API endpoints."""
import csv
import io
import json
import os
from datetime import datetime
from flask import Blueprint, jsonify, request, current_app, make_response
from sqlalchemy import text, insert
from shapely.geometry import shape
from shapely import wkt as shapely_wkt
from models import Observation
from data_loaders.database import Session
from utils.helpers import generate_id, guess_delimeter, get_taxon_by_name
from auth.decorators import login_required
from models import Taxon

bp = Blueprint('api_observations', __name__, url_prefix='/api')

WKT_COLUMNS = ['wgs84 wkt', 'wkt', 'geometry', 'wgs84wkt', 'geometry_wkt', 'geom', 'geom_wkt']
LAT_COLUMNS = ['lat', 'latitude', 'y']
LON_COLUMNS = ['lon', 'lng', 'longitude', 'x']
SKIP_CSV_KEYS = LAT_COLUMNS + LON_COLUMNS + WKT_COLUMNS


@bp.route('/config', methods=['GET'])
def get_config():
    """Return client-side configuration."""
    return jsonify({
        "base_url": os.getenv('LAJI_API_BASE_URL', ''),
        "access_token": os.getenv('LAJI_API_ACCESS_TOKEN', ''),
    })


@bp.route('/taxons/<string:mx_id>', methods=['GET'])
def get_taxon(mx_id):
    """Return taxon metadata by MX identifier."""
    with Session() as db:
        taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
    if not taxon:
        return jsonify({"success": False, "error": "Taxon not found"}), 404
    return jsonify({
        "success": True,
        "taxon": {
            "id": taxon.id,
            "mx_id": taxon.mx_id,
            "name": taxon.name,
            "category": taxon.category,
            "elio_ryhma": taxon.elio_ryhma,
        }
    })


@bp.route('/observations/<string:mx_id>', methods=['GET'])
def get_observations(mx_id):
    """Return paginated observations for a taxon."""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = min(int(request.args.get('per_page', 1000)), 1000)

        with Session() as db:
            taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
            if not taxon:
                return jsonify({"success": False, "error": "Taxon not found"}), 404

            offset = (page - 1) * per_page
            results = db.execute(text("""
                SELECT
                    id, dataset_id, dataset_name, dataset_url, created_at, properties,
                    ST_AsGeoJSON(geometry) as geometry_json,
                    COUNT(*) OVER() as total_count
                FROM observations
                WHERE taxon_id = :taxon_id
                ORDER BY id
                LIMIT :limit OFFSET :offset
            """), {'taxon_id': taxon.id, 'limit': per_page, 'offset': offset}).fetchall()

        if not results:
            return jsonify({
                "type": "FeatureCollection",
                "features": [],
                "mx_id": mx_id,
                "pagination": {"page": page, "per_page": per_page, "total": 0, "pages": 0}
            })

        total = results[0].total_count
        features = []
        for row in results:
            props = dict(row.properties or {})
            props['_db_id'] = row.id
            props['_dataset_id'] = row.dataset_id
            features.append({
                "type": "Feature",
                "properties": props,
                "geometry": json.loads(row.geometry_json) if row.geometry_json else None
            })

        total_pages = (total + per_page - 1) // per_page
        return jsonify({
            "type": "FeatureCollection",
            "features": features,
            "dataset_name": results[0].dataset_name if hasattr(results[0], 'dataset_name') else None,
            "mx_id": mx_id,
            "pagination": {"page": page, "per_page": per_page, "total": total, "pages": total_pages}
        })
    except Exception as e:
        current_app.logger.error(f"Failed to get observations: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observations', methods=['POST'])
@login_required
def save_observations():
    """Save a batch of GeoJSON features as observations for a taxon."""
    try:
        data = request.json
        mx_id = data.get('mx_id')
        dataset_id = data.get('dataset_id')
        dataset_name = data.get('dataset_name', 'Unnamed Dataset')
        dataset_url = data.get('dataset_url', '')
        features = data.get('features', [])

        if not mx_id:
            return jsonify({"success": False, "error": "mx_id is required"}), 400
        if not features:
            return jsonify({"success": False, "error": "No features provided"}), 400

        with Session() as db:
            taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
            if not taxon:
                return jsonify({"success": False, "error": "Taxon not found"}), 404

            current_time = datetime.utcnow()
            chunk_size = 1000
            total_inserted = 0
            try:
                for i in range(0, len(features), chunk_size):
                    chunk = features[i:i + chunk_size]
                    rows = []
                    for feature in chunk:
                        geom = None
                        if feature.get('geometry'):
                            geom = shape(feature['geometry']).wkt
                        rows.append({
                            'taxon_id': taxon.id,
                            'dataset_id': dataset_id,
                            'dataset_name': dataset_name,
                            'dataset_url': dataset_url,
                            'created_at': current_time,
                            'properties': feature.get('properties', {}),
                            'geometry': (f'SRID=4326;{geom}' if geom else None)
                        })
                    if rows:
                        db.execute(insert(Observation), rows)
                        db.commit()
                        total_inserted += len(rows)
                return jsonify({"success": True, "count": total_inserted})
            except Exception as e:
                db.rollback()
                raise e
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/taxons/<string:mx_id>/upload_csv', methods=['POST'])
@login_required
def upload_csv(mx_id):
    """Upload a CSV file and insert observations for the taxon."""
    try:
        if 'file' not in request.files:
            return jsonify({"success": False, "error": "No file provided"}), 400
        f = request.files.get('file')
        if not f or f.filename == '':
            return jsonify({"success": False, "error": "Empty file"}), 400

        dataset_name = request.form.get('dataset_name') or request.form.get('dataset') or f.filename
        dataset_id = request.form.get('dataset_id') or str(generate_id())

        content = f.stream.read().decode('utf-8', errors='replace')
        
        # Remove BOM if present
        if content.startswith('\ufeff'):
            content = content[1:]
        
        delimiter = guess_delimeter(content)
        
        current_app.logger.info(f"Detected CSV delimiter: {repr(delimiter)}")
        reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)

        if reader.fieldnames:
            current_app.logger.info(f"CSV columns found: {reader.fieldnames}")

        features = []
        row_num = 0
        parse_errors = []
        for row in reader:
            row_num += 1
            wkt_str = None
            wkt_col_name = None
            for k, v in (row or {}).items():
                if k is None or v is None:
                    continue
                if k.strip().lower() in WKT_COLUMNS and v:
                    wkt_str = v.strip()
                    wkt_col_name = k
                    break

            lat = lon = None
            for k, v in (row or {}).items():
                if k is None:
                    continue
                kl = k.strip().lower()
                if kl in LAT_COLUMNS and v:
                    lat = v
                if kl in LON_COLUMNS and v:
                    lon = v

            geom_obj = None
            wkt_error = None
            if wkt_str:
                try:
                    geom_obj = shapely_wkt.loads(wkt_str)
                except Exception as e:
                    wkt_error = str(e)
                    current_app.logger.warning(f"Row {row_num}: WKT parsing failed for column '{wkt_col_name}': {wkt_error}")

            if geom_obj is None:
                if wkt_str and wkt_error:
                    parse_errors.append(f"Row {row_num}: WKT parsing error: {wkt_error}")
                    continue
                
                try:
                    latf = float(lat) if lat is not None else None
                    lonf = float(lon) if lon is not None else None
                except (ValueError, TypeError) as e:
                    parse_errors.append(f"Row {row_num}: Invalid lat/lon values (lat={lat}, lon={lon})")
                    continue
                
                if latf is None or lonf is None:
                    parse_errors.append(f"Row {row_num}: Missing coordinates (lat={lat}, lon={lon})")
                    continue
                feature_geometry = {"type": "Point", "coordinates": [lonf, latf]}
            else:
                feature_geometry = geom_obj.__geo_interface__

            props = {k: v for k, v in (row or {}).items()
                     if k is not None and k.strip().lower() not in SKIP_CSV_KEYS}
            features.append({"type": "Feature", "properties": props, "geometry": feature_geometry})

        if not features:
            error_msg = "No valid rows with coordinates found in CSV"
            if reader.fieldnames:
                error_msg += f". Columns found: {', '.join(reader.fieldnames)}"
            if parse_errors:
                error_msg += f". First errors: {'; '.join(parse_errors[:3])}"
            current_app.logger.error(f"CSV upload failed: {error_msg}")
            return jsonify({"success": False, "error": error_msg}), 400

        with Session() as db:
            taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
            if not taxon:
                return jsonify({"success": False, "error": "Taxon not found"}), 404

            current_time = datetime.utcnow()
            observations = []
            for feature in features:
                geom = None
                if feature.get('geometry'):
                    geom = shape(feature['geometry']).wkt
                observations.append({
                    'taxon_id': taxon.id,
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
                    chunk = observations[i:i + chunk_size]
                    db.execute(insert(Observation), chunk)
                    db.commit()
                    total_inserted += len(chunk)
                return jsonify({"success": True, "count": total_inserted, "dataset_id": str(dataset_id)})
            except Exception as e:
                db.rollback()
                raise e
    except Exception as e:
        current_app.logger.error(f"Failed to upload CSV: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/taxons/<string:mx_id>/download_csv', methods=['GET'])
def download_csv(mx_id):
    """Download observations for a taxon as CSV."""
    try:
        with Session() as db:
            taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
            if not taxon:
                return jsonify({"success": False, "error": "Taxon not found"}), 404

            dataset_id = request.args.get('dataset_id')
            params = {'taxon_id': taxon.id}
            if dataset_id:
                query_sql = text("""
                    SELECT id, dataset_id, dataset_name, properties, ST_AsText(geometry) as geometry_wkt
                    FROM observations WHERE taxon_id = :taxon_id AND dataset_id = :dataset_id ORDER BY id
                """)
                params['dataset_id'] = dataset_id
            else:
                query_sql = text("""
                    SELECT id, dataset_id, dataset_name, properties, ST_AsText(geometry) as geometry_wkt
                    FROM observations WHERE taxon_id = :taxon_id ORDER BY id
                """)

            observations = db.execute(query_sql, params).fetchall()

        if not observations:
            return jsonify({"success": False, "error": "No observations found"}), 400

        all_property_keys = set()
        for obs in observations:
            props = obs.properties or {}
            if isinstance(props, dict):
                all_property_keys.update(props.keys())

        property_keys = sorted(all_property_keys)
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=['wkt'] + property_keys)
        writer.writeheader()
        for obs in observations:
            row = {'wkt': obs.geometry_wkt or ''}
            props = obs.properties or {}
            if isinstance(props, dict):
                for key in property_keys:
                    row[key] = props.get(key, '')
            writer.writerow(row)

        csv_content = output.getvalue()
        output.close()
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        safe_mx = mx_id.replace('.', '_')
        filename = f"{safe_mx}_{timestamp}.csv"
        response = make_response(csv_content)
        response.headers['Content-Disposition'] = f'attachment; filename={filename}'
        response.headers['Content-Type'] = 'text/csv'
        return response
    except Exception as e:
        current_app.logger.error(f"Failed to download CSV: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/taxons/<string:mx_id>/datasets', methods=['GET'])
def get_datasets(mx_id):
    """List datasets for a taxon grouped by dataset_id."""
    try:
        with Session() as db:
            taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
            if not taxon:
                return jsonify({"success": False, "error": "Taxon not found"}), 404

            result = db.execute(text("""
                SELECT dataset_id, dataset_name, dataset_url,
                    COUNT(*) as count, MIN(created_at) as created_at
                FROM observations
                WHERE taxon_id = :taxon_id
                GROUP BY dataset_id, dataset_name, dataset_url
                ORDER BY MIN(created_at) DESC
            """), {'taxon_id': taxon.id}).fetchall()

            datasets = [{
                "dataset_id": r.dataset_id,
                "dataset_name": r.dataset_name,
                "dataset_url": r.dataset_url,
                "count": r.count,
                "created_at": r.created_at.isoformat() if r.created_at else None
            } for r in result]

            return jsonify({"success": True, "datasets": datasets})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/taxons/<string:mx_id>/datasets/<string:dataset_id>', methods=['DELETE'])
@login_required
def delete_dataset(mx_id, dataset_id):
    """Delete all observations belonging to a dataset."""
    try:
        with Session() as db:
            taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
            if not taxon:
                return jsonify({"success": False, "error": "Taxon not found"}), 404

            result = db.execute(
                text("DELETE FROM observations WHERE taxon_id = :taxon_id AND dataset_id = :dataset_id"),
                {'taxon_id': taxon.id, 'dataset_id': dataset_id}
            )
            db.commit()
            return jsonify({"success": True, "deleted": result.rowcount})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observations/exclude', methods=['POST'])
@login_required
def set_observations_excluded():
    """Batch-set the excluded flag on observations by DB id."""
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

        with Session() as db:
            try:
                result = db.execute(text("""
                    WITH updated AS (
                        UPDATE observations
                        SET properties = jsonb_set(properties, '{excluded}', to_jsonb(CAST(:excluded AS boolean)), true),
                            excluded = CAST(:excluded AS boolean)
                        WHERE id = ANY(:ids)
                        RETURNING id
                    )
                    SELECT id FROM updated
                """), {'excluded': bool(excluded), 'ids': ids})
                updated = [row[0] for row in result.fetchall()]
                db.commit()
                return jsonify({"success": True, "processed": len(updated),
                                "failed": len(ids) - len(updated), "updated_ids": updated})
            except Exception as e:
                db.rollback()
                raise e
    except Exception as e:
        current_app.logger.error(f"Failed to set observations excluded: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observation/<int:obs_id>/exclude', methods=['POST'])
@login_required
def set_observation_excluded(obs_id):
    """Set excluded flag on a single observation."""
    try:
        data = request.get_json() or {}
        excluded = bool(data.get('excluded', True))
        with Session() as db:
            obs = db.query(Observation).get(obs_id)
            if not obs:
                return jsonify({"success": False, "error": "Observation not found"}), 404
            props = dict(obs.properties or {})
            props['excluded'] = excluded
            obs.properties = props
            obs.excluded = excluded
            db.add(obs)
            db.commit()
            return jsonify({"success": True, "excluded": excluded})
    except Exception as e:
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

        with Session() as db:
            obs = db.query(Observation).get(obs_id)
            if not obs:
                return jsonify({"success": False, "error": "Observation not found"}), 404
            obs.geometry = wkt_str
            db.add(obs)
            db.commit()
            return jsonify({"success": True, "obs_id": obs_id})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
