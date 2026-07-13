"""MML tile proxy endpoints (taustakartta, maastokartta).

Shared auth logic for MML tiles to eliminate duplication between endpoints.
"""
import os
import base64
import requests
from flask import Blueprint, request, jsonify, current_app

bp = Blueprint('proxy_mml', __name__, url_prefix='/mml')


def _build_mml_headers_and_params(user_id_from_request=None):
    """
    Build HTTP headers and query params for MML WMTS requests.
    
    Priority:
    1. Server-side MML_API_KEY env var (most secure) → Basic auth header + user-id param
    2. Client-provided user-id query param → fallback
    """
    headers = {}
    params = {}
    
    # Prefer server-side API key
    api_key = os.getenv('MML_API_KEY')
    if api_key:
        try:
            token = base64.b64encode(f"{api_key}:".encode('utf-8')).decode('ascii')
            headers['Authorization'] = f'Basic {token}'
            params['user-id'] = api_key
            current_app.logger.debug('MML proxy: using server-side MML_API_KEY')
        except Exception as e:
            current_app.logger.warning(f'Failed to build MML auth header: {e}')
        return headers, params
    
    # Fallback: client-provided user-id (less secure, but forward it if given)
    user_id = user_id_from_request or request.args.get('user-id')
    if user_id:
        try:
            token = base64.b64encode(f"{user_id}:".encode('utf-8')).decode('ascii')
            headers['Authorization'] = f'Basic {token}'
            params['user-id'] = user_id
            current_app.logger.debug('MML proxy: forwarded client-provided user-id')
        except Exception:
            pass
    
    return headers, params


def _proxy_mml_tile(layer_name, z, x, y):
    """
    Generic MML WMTS tile proxy handler.
    """
    try:
        # WMTS REST URL: layer/style/tileMatrixSet/z/row/col.format
        # Note: TileRow (y) comes before TileCol (x) in WMTS URL
        tile_url = f'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/{layer_name}/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png'
        
        headers, params = _build_mml_headers_and_params()
        
        current_app.logger.debug(f'MML proxy ({layer_name}): fetching tile {z}/{y}/{x}')
        resp = requests.get(tile_url, headers=headers, params=(params or None), timeout=10, stream=True)
        
        if resp.status_code != 200:
            sent_auth = 'Authorization' in headers
            current_app.logger.warning(
                f'MML {layer_name} tile fetch failed: status={resp.status_code} sent_auth={sent_auth} '
                f'params={params or {}} body_preview={(resp.text or "")[:200]}'
            )
        
        content_type = resp.headers.get('Content-Type', 'image/png')
        response = current_app.response_class(resp.content, status=resp.status_code, mimetype=content_type)
        
        # Allow browser tile requests and enable caching
        response.headers['Cache-Control'] = 'public, max-age=86400'
        response.headers['Access-Control-Allow-Origin'] = '*'
        
        return response
    
    except Exception as e:
        current_app.logger.exception(f'MML {layer_name} tile proxy failed')
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/taustakartta/<int:z>/<int:x>/<int:y>.png')
def mml_taustakartta_tile(z, x, y):
    """
    Server-side proxy for MML `taustakartta` WMTS tiles.
    - Preferred: set `MML_API_KEY` in server environment (sent as HTTP Basic `user-id:`).
    - Fallback: client may call with `?user-id=KEY` query param (less secure).
    """
    return _proxy_mml_tile('taustakartta', z, x, y)


@bp.route('/maastokartta/<int:z>/<int:x>/<int:y>.png')
def mml_maastokartta_tile(z, x, y):
    """
    Server-side proxy for MML `maastokartta` WMTS tiles (same behavior as taustakartta).
    """
    return _proxy_mml_tile('maastokartta', z, x, y)
