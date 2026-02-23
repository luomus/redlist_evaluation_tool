from flask import Flask, render_template, jsonify, request, session, redirect, url_for, make_response
from livereload import Server
from models import init_db, Session, Observation, ConvexHull, Project, GridCell, Taxon
from sqlalchemy import Integer, text, func
from sqlalchemy.orm import joinedload
import json
import csv
import io
from shapely.geometry import shape
from shapely import wkt as shapely_wkt
from datetime import datetime, timedelta
from pathlib import Path
import os
from dotenv import load_dotenv
from functools import wraps
from urllib.parse import urlencode
import requests


app = Flask(__name__)
app.debug = True

# Load .env file from project root (if present)
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

# Session configuration
app.secret_key = os.getenv("SECRET_KEY")

LAJI_API_ACCESS_TOKEN = os.getenv("LAJI_API_ACCESS_TOKEN", "")
LAJI_API_BASE_URL = os.getenv("LAJI_API_BASE_URL", "")
TARGET = os.getenv("TARGET", "")
LAJIAUTH_URL = os.getenv("LAJIAUTH_URL", "")
SECRET_TIMEOUT_PERIOD = int(os.getenv("SECRET_TIMEOUT_PERIOD", "10"))

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

# Authentication decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'token' not in session:
            # Store the original URL to redirect back after login
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

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
@login_required
def simple():
    return render_template("simple.html")

@app.route("/stats")
@login_required
def stats():
    return render_template("stats.html")
    
@app.route("/convex_hull")
@login_required
def convex_hull():
    return render_template("convex_hull.html")

@app.route("/grid")
@login_required
def grid():
    return render_template("grid.html")

@app.route("/login")
def login():
    """Redirect to laji-auth login with callback URL"""
    # Build laji-auth login URL
    params = {
        'target': TARGET,
        'next': '/'
    }
    laji_auth_login_url = f"{LAJIAUTH_URL}login?{urlencode(params)}"
    
    return redirect(laji_auth_login_url)

@app.route("/login/callback", methods=["POST"])
def login_callback():
    """Handle callback from laji-auth system"""
    # Get data from POST body (form data or JSON)
    token = request.form.get('token') or (request.get_json(silent=True) or {}).get('token')
    next_url = request.form.get('next') or (request.get_json(silent=True) or {}).get('next', '/')    
    if not token:
        return jsonify({"success": False, "error": "No token provided"}), 400
    
    # Fetch and store user information
    authentication_info = _get_authentication_info(token)
    if not authentication_info or 'user' not in authentication_info:
        return jsonify({"success": False, "error": "Failed to retrieve user information"}), 401
    
    # Check user role
    user_info = authentication_info['user']
    user_roles = user_info.get('roles', [])
    
    # Only allow users with MA.admin or MA.taxonEditorUser roles
    allowed_roles = ['MA.admin', 'MA.taxonEditorUser']
    if not any(role in allowed_roles for role in user_roles):
        return jsonify({"success": False, "error": f"Access denied. Your roles {user_roles} are not authorized to use this application. Contact helpdesk@laji.fi"}), 403
    
    # Store token in session
    session['token'] = token
    session.permanent = True  # Make session persistent
    
    # Store user information
    session['user_id'] = user_info.get('qname')
    session['user_name'] = user_info.get('name')
    session['user_email'] = user_info.get('email')
    session['user_roles'] = user_roles
    
    # Redirect to the original page or home
    return redirect(next_url or '/')

def _get_authentication_info(token):
    """
    Get authentication info for the token.
    :param token: The token returned by LajiAuth.
    :return: Authentication info content.
    """
    try:
        url = LAJIAUTH_URL + "token/" + token
        response = requests.get(url, timeout=SECRET_TIMEOUT_PERIOD)
        if response.status_code != 200:
            return None
        else:
            content = json.loads(response.content.decode('utf-8'))
            return content
    except Exception as e:
        import traceback
        traceback.print_exc()
        return None

def _delete_authentication_token(token):
    """
    Logs the user out by deleting the authentication token
    :param token: LajiAuth token
    :return: true if user was successfully logged out
    """
    try:
        url = LAJIAUTH_URL + "token/" + token
        response = requests.delete(url, timeout=SECRET_TIMEOUT_PERIOD)
        return response.status_code == 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return False

@app.route("/logout")
def logout():
    """Clear session and redirect to login"""
    # Delete token from laji-auth if it exists
    token = session.get('token')
    if token:
        _delete_authentication_token(token)
    
    session.clear()
    return redirect(url_for('login'))

@app.route("/api/user", methods=["GET"])
@login_required
def get_user_info():
    """Return current user information from session"""
    return jsonify({
        "user_id": session.get('user_id', ''),
        "user_name": session.get('user_name', ''),
        "user_email": session.get('user_email', '')
    })

@app.route("/api/config", methods=["GET"])
@login_required
def get_config():
    """Return client-side configuration including API base URL and access token
    and the current user's LajiAuth token (session token) so the client can
    include it in requests to the API as a Person-Token header."""
    return jsonify({
        "base_url": LAJI_API_BASE_URL,
        "access_token": LAJI_API_ACCESS_TOKEN,
        "person_token": session.get('token')
    })


@app.route('/api/laji', methods=['GET'])
@login_required
def laji_proxy():
    """Proxy GET requests to the configured LAJI API base URL to avoid CORS.
    The original query string is forwarded as-is. The server will add the
    configured access token and the session person-token header before
    forwarding the request to the LAJI API."""
    try:
        # Rebuild target URL from base and original query string
        query = request.query_string.decode('utf-8')
        if not LAJI_API_BASE_URL:
            return jsonify({"success": False, "error": "LAJI_API_BASE_URL not configured on server"}), 500

        target_url = f"{LAJI_API_BASE_URL}?{query}" if query else LAJI_API_BASE_URL

        # Validate tokens
        if not LAJI_API_ACCESS_TOKEN:
            return jsonify({"success": False, "error": "LAJI_API_ACCESS_TOKEN not configured on server"}), 500
        person_token = session.get('token')
        if not person_token:
            return jsonify({"success": False, "error": "Person token missing – please log in again"}), 401

        # Forward headers — api.laji.fi uses headers for authorization
        forward_headers = {
            'Authorization': f'Bearer {LAJI_API_ACCESS_TOKEN}',
            'Person-Token': person_token,
            'Api-Version': request.headers.get('Api-Version', '1'),
            'Accept-Language': request.headers.get('Accept-Language', 'fi')
        }

        # Debug: log what we're sending (mask tokens for safety)
        print(f"[laji_proxy] Target: {target_url}...")
        print(f"[laji_proxy] Authorization: Bearer {LAJI_API_ACCESS_TOKEN}")
        print(f"[laji_proxy] Person-Token: {person_token}")

        resp = requests.get(target_url, headers=forward_headers, timeout=30)

        # Debug: log response status
        print(f"[laji_proxy] Response status: {resp.status_code}")
        if resp.status_code != 200:
            print(f"[laji_proxy] Response body: {resp.text[:500]}")

        # Return response content and status code with original content-type
        content_type = resp.headers.get('Content-Type', 'application/json')
        return (resp.content, resp.status_code, {'Content-Type': content_type})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/mml/taustakartta/<int:z>/<int:x>/<int:y>.png')
def mml_taustakartta_tile(z, x, y):
    """
    Server-side proxy for MML `taustakartta` WMTS tiles.
    - Preferred: set `MML_API_KEY` in server environment (sent as HTTP Basic `user-id:`).
    - Fallback: client may call /mml/taustakartta/...?user-id=KEY which will be forwarded (less secure).
    """
    try:
        # WMTS REST URL format is: /{Layer}/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.{format}
        # Use style='default' and TileMatrixSet='WGS84_Pseudo-Mercator'. Note TileRow comes before TileCol.
        tile_url = f'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/taustakartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png'
        params = {}
        headers = {}

        # Prefer server-side API key (sent as HTTP Basic `user-id:`).
        # Also add the `user-id` query param as a fallback because some MML endpoints
        # accept the key in the query string instead of (or in addition to) Basic auth.
        api_key = os.getenv('MML_API_KEY')
        if api_key:
            import base64
            token = base64.b64encode(f"{api_key}:".encode('utf-8')).decode('ascii')
            headers['Authorization'] = f'Basic {token}'
            params['user-id'] = api_key
            app.logger.debug('MML proxy: using server-side MML_API_KEY (Authorization header + user-id param)')
        else:
            # Optional: forward client-provided user-id as query param; also construct
            # a Basic Authorization header from it so MML sees both forms.
            user_id = request.args.get('user-id')
            if user_id:
                params['user-id'] = user_id
                try:
                    import base64
                    token = base64.b64encode(f"{user_id}:".encode('utf-8')).decode('ascii')
                    headers['Authorization'] = f'Basic {token}'
                except Exception:
                    pass
                app.logger.debug('MML proxy: forwarded client-provided user-id and built Authorization header')

        resp = requests.get(tile_url, headers=headers, params=(params or None), timeout=10, stream=True)

        # If the upstream MML returns a non-200 status, log helpful diagnostics
        if resp.status_code != 200:
            sent_auth = 'Authorization' in headers
            app.logger.warning('MML tile fetch failed status=%s sent_auth=%s params=%s body_preview=%s',
                               resp.status_code, sent_auth, params or {}, (resp.text or '')[:200])

        content_type = resp.headers.get('Content-Type', 'image/png')
        response = app.response_class(resp.content, status=resp.status_code, mimetype=content_type)
        # Allow browser tile requests and enable caching
        response.headers['Cache-Control'] = 'public, max-age=86400'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    except Exception as e:
        app.logger.exception('MML tile proxy failed')
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/mml/maastokartta/<int:z>/<int:x>/<int:y>.png')
def mml_maastokartta_tile(z, x, y):
    """
    Server-side proxy for MML `maastokartta` WMTS tiles (same behaviour as taustakartta).
    """
    try:
        # WMTS REST URL: layer/style/tileMatrixSet/z/row/col.format
        tile_url = f'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/maastokartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png'
        params = {}
        headers = {}

        api_key = os.getenv('MML_API_KEY')
        if api_key:
            import base64
            token = base64.b64encode(f"{api_key}:".encode('utf-8')).decode('ascii')
            headers['Authorization'] = f'Basic {token}'
            params['user-id'] = api_key
            app.logger.debug('MML proxy (maastokartta): using server-side MML_API_KEY')
        else:
            user_id = request.args.get('user-id')
            if user_id:
                params['user-id'] = user_id
                try:
                    import base64
                    token = base64.b64encode(f"{user_id}:".encode('utf-8')).decode('ascii')
                    headers['Authorization'] = f'Basic {token}'
                except Exception:
                    pass
                app.logger.debug('MML proxy (maastokartta): forwarded client-provided user-id')

        resp = requests.get(tile_url, headers=headers, params=(params or None), timeout=10, stream=True)
        if resp.status_code != 200:
            app.logger.warning('MML maastokartta tile fetch failed status=%s sent_auth=%s params=%s body_preview=%s',
                               resp.status_code, 'Authorization' in headers, params or {}, (resp.text or '')[:200])

        content_type = resp.headers.get('Content-Type', 'image/png')
        response = app.response_class(resp.content, status=resp.status_code, mimetype=content_type)
        response.headers['Cache-Control'] = 'public, max-age=86400'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    except Exception as e:
        app.logger.exception('MML maastokartta tile proxy failed')
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== TAXON HIERARCHY ENDPOINTS =====

def _taxon_to_dict(taxon, include_children=True, include_projects=False):
    """Convert a Taxon ORM object to a dict, optionally with children and projects."""
    d = {
        'id': taxon.id,
        'name': taxon.name,
        'scientific_name': taxon.scientific_name,
        'level': taxon.level,
        'parent_id': taxon.parent_id,
        'is_leaf': taxon.is_leaf,
    }
    if include_children and taxon.children:
        d['children'] = [_taxon_to_dict(c, include_children=True, include_projects=include_projects)
                         for c in sorted(taxon.children, key=lambda t: t.sort_order)]
    else:
        d['children'] = []
    if include_projects and taxon.is_leaf:
        d['projects'] = [_project_to_dict(p) for p in (taxon.projects or [])]
    else:
        d['projects'] = []
    return d


def _project_to_dict(project):
    """Convert a Project ORM object to a dict."""
    return {
        'id': project.id,
        'name': project.name,
        'description': project.description,
        'taxon_id': project.taxon_id,
        'created_at': project.created_at.isoformat() if project.created_at else None,
        'updated_at': project.updated_at.isoformat() if project.updated_at else None,
    }


@app.route("/api/taxons", methods=["GET"])
@login_required
def list_taxons():
    """Return the full taxon hierarchy as a tree, optionally with projects."""
    try:
        include_projects = request.args.get('projects', '0') == '1'
        db = Session()

        # Eagerly load the whole tree
        roots = (db.query(Taxon)
                 .filter(Taxon.parent_id.is_(None))
                 .order_by(Taxon.sort_order)
                 .all())

        # If projects requested, prefetch all projects keyed by taxon_id
        project_map = {}
        if include_projects:
            all_projects = db.query(Project).all()
            for p in all_projects:
                project_map.setdefault(p.taxon_id, []).append(p)

        def build(taxon):
            d = {
                'id': taxon.id,
                'name': taxon.name,
                'scientific_name': taxon.scientific_name,
                'level': taxon.level,
                'parent_id': taxon.parent_id,
                'is_leaf': taxon.is_leaf,
                'children': [build(c) for c in sorted(taxon.children or [], key=lambda t: t.sort_order)],
            }
            if include_projects and taxon.is_leaf:
                d['projects'] = [_project_to_dict(p) for p in project_map.get(taxon.id, [])]
            else:
                d['projects'] = []
            return d

        tree = [build(r) for r in roots]
        db.close()
        return jsonify({'taxons': tree})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route("/api/taxons/<int:taxon_id>", methods=["GET"])
@login_required
def get_taxon(taxon_id):
    """Return a single taxon with its children and projects."""
    try:
        db = Session()
        taxon = db.query(Taxon).filter_by(id=taxon_id).first()
        if not taxon:
            db.close()
            return jsonify({'success': False, 'error': 'Taxon not found'}), 404
        result = _taxon_to_dict(taxon, include_projects=True)
        db.close()
        return jsonify(result)
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ===== SPECIES / PROJECT ENDPOINTS =====

@app.route("/api/species", methods=["POST"])
@login_required
def create_species():
    """Create a new species project under a leaf taxon."""
    try:
        data = request.json
        name = (data.get('name') or '').strip()
        description = (data.get('description') or '').strip()
        taxon_id = data.get('taxon_id')

        if not name:
            return jsonify({'success': False, 'error': 'Species name is required'}), 400
        if not taxon_id:
            return jsonify({'success': False, 'error': 'taxon_id is required'}), 400

        db = Session()
        taxon = db.query(Taxon).filter_by(id=taxon_id).first()
        if not taxon:
            db.close()
            return jsonify({'success': False, 'error': 'Taxon not found'}), 404
        if not taxon.is_leaf:
            db.close()
            return jsonify({'success': False, 'error': 'Species can only be added to leaf taxons'}), 400

        project = Project(name=name, description=description, taxon_id=taxon_id)
        db.add(project)
        db.commit()
        result = _project_to_dict(project)
        db.close()
        return jsonify({'success': True, 'project': result})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route("/api/species/<int:project_id>", methods=["GET"])
@login_required
def get_species(project_id):
    """Get a single species project with observation/dataset counts."""
    try:
        db = Session()
        project = db.query(Project).filter_by(id=project_id).first()
        if not project:
            db.close()
            return jsonify({'success': False, 'error': 'Project not found'}), 404

        obs_count = db.query(func.count(Observation.id)).filter_by(project_id=project_id).scalar() or 0
        dataset_count = db.query(func.count(func.distinct(Observation.dataset_id))).filter_by(project_id=project_id).scalar() or 0

        result = _project_to_dict(project)
        result['observation_count'] = obs_count
        result['dataset_count'] = dataset_count
        db.close()
        return jsonify(result)
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route("/api/species/<int:project_id>", methods=["PUT", "PATCH"])
@login_required
def update_species(project_id):
    """Update species project description."""
    try:
        data = request.json
        description = (data.get('description') or '').strip()

        db = Session()
        project = db.query(Project).filter_by(id=project_id).first()
        if not project:
            db.close()
            return jsonify({'success': False, 'error': 'Project not found'}), 404

        project.description = description
        db.commit()
        result = _project_to_dict(project)
        db.close()
        return jsonify({'success': True, 'project': result})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route("/api/species/<int:project_id>", methods=["DELETE"])
@login_required
def delete_species(project_id):
    """Delete a species project and all its data."""
    try:
        db = Session()
        project = db.query(Project).filter_by(id=project_id).first()
        if not project:
            db.close()
            return jsonify({'success': False, 'error': 'Project not found'}), 404

        obs_count = db.query(Observation).filter_by(project_id=project_id).count()
        db.query(ConvexHull).filter_by(project_id=project_id).delete()
        db.query(GridCell).filter_by(project_id=project_id).delete(synchronize_session=False)
        db.delete(project)
        db.commit()
        db.close()
        stats_cache.delete(f"stats:{project_id}")
        return jsonify({'success': True, 'deleted_observations': obs_count})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route("/api/species/<int:project_id>/datasets", methods=["GET"])
@login_required
def list_species_datasets(project_id):
    """List all datasets within a species project."""
    try:
        db = Session()
        results = db.query(
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

        datasets = [{
            'dataset_id': row.dataset_id,
            'dataset_name': row.dataset_name,
            'dataset_url': row.dataset_url,
            'created_at': row.created_at.isoformat() if row.created_at else None,
            'count': row.count
        } for row in results]

        db.close()
        return jsonify({'datasets': datasets, 'project_id': project_id})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route("/api/species/<int:project_id>/datasets/<dataset_id>", methods=["DELETE"])
@login_required
def delete_species_dataset(project_id, dataset_id):
    """Delete a specific dataset from a species project."""
    try:
        db = Session()
        obs_count = db.query(Observation).filter_by(project_id=project_id, dataset_id=dataset_id).delete()
        db.commit()
        db.close()
        stats_cache.delete(f"stats:{project_id}")
        return jsonify({'success': True, 'deleted_observations': obs_count})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route("/api/observations", methods=["POST"])
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
        
        from sqlalchemy import insert
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

@app.route("/api/species/<int:project_id>/upload_csv", methods=["POST"])
@login_required
def upload_csv_to_species(project_id):
    """Upload CSV file and insert observations for the project.
    Expected CSV: rows with latitude/longitude (field names case-insensitive: lat, latitude; lon, lng, longitude)
    OR a geometry WKT column (case-insensitive: wkt, geometry, wgs84wkt, geometry_wkt).
    Any other properties will be stored in properties JSON.
    Minimal fields: latitude,longitude OR a WKT column with a valid WKT string (e.g., "POINT(lon lat)").
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
                    # Skip rows without valid coordinates or WKT
                    continue

                feature_geometry = {"type": "Point", "coordinates": [lonf, latf]}
            else:
                # Convert shapely geometry to GeoJSON-like mapping
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

        # Insert observations similar to /api/observations
        db = Session()
        project = db.query(Project).filter_by(id=project_id).first()
        if not project:
            db.close()
            return jsonify({"success": False, "error": "Project not found"}), 404

        from sqlalchemy import insert
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

            # Invalidate cache
            stats_cache.delete(f"stats:{project_id}")

            db.close()
            return jsonify({"success": True, "count": total_inserted, "dataset_id": str(dataset_id)})
        except Exception as e:
            db.rollback()
            db.close()
            raise e

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/species/<int:project_id>/download_csv", methods=["GET"])
@login_required
def download_csv_from_species(project_id):
    """Download observations from a project (or specific dataset) as CSV.
    Query parameters:
    - dataset_id: Optional, download only this dataset. If not provided, downloads all.
    Format uses WKT geometry column plus all property columns.
    """
    try:
        session = Session()
        project = session.query(Project).filter_by(id=project_id).first()
        if not project:
            session.close()
            return jsonify({"success": False, "error": "Project not found"}), 404

        # Get optional dataset_id from query parameters
        dataset_id = request.args.get('dataset_id', None)

        # Get observations for this project (and optionally filter by dataset)
        from sqlalchemy import text
        if dataset_id:
            query_text = text("""
                SELECT 
                    id,
                    dataset_id,
                    dataset_name,
                    properties,
                    ST_AsText(geometry) as geometry_wkt
                FROM observations
                WHERE project_id = :project_id AND dataset_id = :dataset_id
                ORDER BY id
            """)
            result = session.execute(query_text, {'project_id': project_id, 'dataset_id': dataset_id})
        else:
            query_text = text("""
                SELECT 
                    id,
                    dataset_id,
                    dataset_name,
                    properties,
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

        # Collect all unique property keys across all observations
        all_property_keys = set()
        for obs in observations:
            props = obs.properties or {}
            if isinstance(props, dict):
                all_property_keys.update(props.keys())

        # Sort property keys for consistent column order
        property_keys = sorted(all_property_keys)

        # Create CSV output - always use wkt column for geometry
        output = io.StringIO()
        fieldnames = ['wkt'] + property_keys
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        # Write each observation
        for obs in observations:
            row = {}
            
            # Add WKT geometry (all geometry types in one column)
            if obs.geometry_wkt:
                row['wkt'] = obs.geometry_wkt
            
            # Add properties
            props = obs.properties or {}
            if isinstance(props, dict):
                for key in property_keys:
                    row[key] = props.get(key, '')
            
            writer.writerow(row)

        # Prepare response with CSV content
        csv_content = output.getvalue()
        output.close()

        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        
        # Generate filename based on whether it's a specific dataset or all
        if dataset_id:
            filename = f"species_{project_id}_dataset_{dataset_id}_{timestamp}.csv"
        else:
            filename = f"species_{project_id}_{timestamp}.csv"

        response = make_response(csv_content)
        response.headers['Content-Disposition'] = f'attachment; filename={filename}'
        response.headers['Content-Type'] = 'text/csv'
        return response

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observations/<int:project_id>", methods=["GET"])
@login_required
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
        
        # Expose dataset_name (if present) at top-level for clients to use directly
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
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/observation/<int:obs_id>/exclude", methods=["POST"])
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
@login_required
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
@login_required
def list_datasets():
    """List all available datasets"""
    try:
        session = Session()
        
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
@login_required
def get_dataset_stats(project_id):
    """Calculate project statistics in the database for scalability"""
    try:
        # Check cache first
        cache_key = f"stats:{project_id}"
        cached_result = stats_cache.get(cache_key)
        if cached_result:
            return jsonify(cached_result)
        
        session = Session()
        from sqlalchemy import cast, String
        
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
        
        # Get latest dataset info (most recent observation) so we can show dataset name/url on the stats page
        latest_obs = session.query(Observation).filter_by(project_id=project_id).order_by(Observation.created_at.desc()).first()
        latest_dataset = None
        if latest_obs:
            latest_dataset = {
                'dataset_id': latest_obs.dataset_id,
                'dataset_name': latest_obs.dataset_name,
                'dataset_url': latest_obs.dataset_url,
                'created_at': latest_obs.created_at.isoformat() if latest_obs.created_at else None
            }
        
        # Temporal trends: observations per year
        temporal_trends_query = """
            SELECT 
                EXTRACT(YEAR FROM 
                    TO_DATE(SUBSTRING(properties->>'gathering.displayDateTime', 1, 10), 'YYYY-MM-DD')
                )::INTEGER as year,
                COUNT(*) as count
            FROM observations
            WHERE project_id = :project_id
              AND properties->>'gathering.displayDateTime' IS NOT NULL
              AND properties->>'gathering.displayDateTime' ~ '^\d{4}-\d{2}-\d{2}'
            GROUP BY year
            ORDER BY year ASC
        """
        temporal_results = session.execute(text(temporal_trends_query), {'project_id': project_id}).fetchall()
        
        temporal_trends = []
        if temporal_results:
            for row in temporal_results:
                if row[0] is not None:  # Ensure year is valid
                    temporal_trends.append({
                        "year": int(row[0]),
                        "count": int(row[1])
                    })
        
        # Calculate decline percentage based on temporal trends
        decline_percentage = None
        trend_direction = None
        if len(temporal_trends) >= 2:
            # Compare first half vs second half of the time period
            mid_point = len(temporal_trends) // 2
            
            # Sum counts in first and second halves
            first_half_count = sum(t['count'] for t in temporal_trends[:mid_point]) or 1
            second_half_count = sum(t['count'] for t in temporal_trends[mid_point:]) or 1
            
            # Calculate percentage change
            decline_percentage = round(
                ((second_half_count - first_half_count) / first_half_count) * 100, 
                2
            )
            
            # Determine trend direction
            if decline_percentage < -5:
                trend_direction = "declining"
            elif decline_percentage > 5:
                trend_direction = "increasing"
            else:
                trend_direction = "stable"
            
            # Also calculate simple linear trend (observations per year change)
            # Get earliest and latest year counts for quick reference
            earliest_year_count = temporal_trends[0]['count']
            latest_year_count = temporal_trends[-1]['count']
            earliest_year = temporal_trends[0]['year']
            latest_year = temporal_trends[-1]['year']
            
            if latest_year > earliest_year:
                annual_change = round(
                    (latest_year_count - earliest_year_count) / (latest_year - earliest_year),
                    2
                )
            else:
                annual_change = 0
        else:
            annual_change = 0
        
        session.close()
        
        result = {
            "success": True,
            "project_id": project_id,
            "project_name": project.name,
            "project_description": project.description,
            "created_at": project.created_at.isoformat() if project.created_at else None,
            "dataset_id": latest_dataset['dataset_id'] if latest_dataset else None,
            "dataset_name": latest_dataset['dataset_name'] if latest_dataset else None,
            "dataset_url": latest_dataset['dataset_url'] if latest_dataset else None,
            "dataset_created_at": latest_dataset['created_at'] if latest_dataset else None,
            "stats": {
                "totalRecords": total,
                "uniqueSpecies": unique_species,
                "uniqueLocalities": unique_localities,
                "uniqueObservers": unique_observers,
                "dateRange": date_range,
                "recordBasisCounts": record_basis_counts,
                "individualCountStats": individual_count_stats,
                "topSpecies": top_species,
                "topObservers": top_observers,
                "temporalTrends": {
                    "byYear": temporal_trends,
                    "declinePercentage": decline_percentage,
                    "trendDirection": trend_direction,
                    "annualChange": annual_change
                }
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
@login_required
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
@login_required
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
@login_required
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
@login_required
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
