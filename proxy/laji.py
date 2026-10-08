"""LAJI API CORS proxy endpoint.

Forwards requests to the configured LAJI API with authentication headers.
"""
from urllib.parse import urlencode

import requests
from flask import Blueprint, request, session, jsonify
from auth.decorators import login_required
from auth.token import check_user
from config import LAJI_API_BASE_URL, LAJI_API_ACCESS_TOKEN

bp = Blueprint('proxy_laji', __name__, url_prefix='/api')

TAXON_SELECTED_FIELDS = 'vernacularName,scientificNameDisplayName,observationCountFinland,latestRedListStatusFinland'


def fetch_taxon_info(mx_id, timeout=10):
    """Fetch vernacular/scientific name, observation count and red list status for a taxon from the LAJI API.

    Raises RuntimeError if the API is not configured, or requests.RequestException on failure.
    """
    if not LAJI_API_BASE_URL or not LAJI_API_ACCESS_TOKEN:
        raise RuntimeError("LAJI_API_BASE_URL/LAJI_API_ACCESS_TOKEN not configured on server")

    url = f"{LAJI_API_BASE_URL}/taxa/{mx_id}"
    params = {
        'selectedFields': TAXON_SELECTED_FIELDS,
        'checklistVersion': 'current',
    }
    headers = {'Authorization': f'Bearer {LAJI_API_ACCESS_TOKEN}', 'Api-Version': '1', 'Accept-Language': 'fi'}

    resp = requests.get(url, params=params, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


@bp.route('/laji', methods=['GET'])
@login_required
def laji_proxy():
    """
    Proxy GET requests to the configured LAJI API base URL to avoid CORS.
    
    The query string is forwarded, except that any client-supplied `target` is
    discarded and replaced with the required `mx_id` parameter. The server adds:
    - Authorization header with configured access token
    - Person-Token header with session token
    """
    try:
        mx_id = request.args.get('mx_id', '')
        if not session.get('allowed_mx_ids', {}).get(mx_id):
            return jsonify({"success": False, "error": "Not authorized for this taxon"}), 403
        
        try:
            check_user(session.get('iucn_user_id'), session.get('lajiauth_user_id'))
        except PermissionError:
            return jsonify({"success": False, "error": "Forbidden"}), 403

        params = [(k, v) for k, v in request.args.items(multi=True) if k not in ('target', 'mx_id')]
        params.append(('target', mx_id))
        query = urlencode(params)
        
        if not LAJI_API_BASE_URL:
            return jsonify({"success": False, "error": "LAJI_API_BASE_URL not configured on server"}), 500
        
        target_url = f"{LAJI_API_BASE_URL}/warehouse/private-query/unit/list?{query}"
        
        # Validate tokens
        if not LAJI_API_ACCESS_TOKEN:
            return jsonify({"success": False, "error": "LAJI_API_ACCESS_TOKEN not configured on server"}), 500
        
        person_token = session.get('lajiauth_token')
        if not person_token:
            return jsonify({"success": False, "error": "Person token missing – please log in again"}), 401
        
        # Forward headers — api.laji.fi uses headers for authorization
        forward_headers = {
            'Authorization': f'Bearer {LAJI_API_ACCESS_TOKEN}',
            'Person-Token': person_token,
            'Api-Version': request.headers.get('Api-Version', '1'),
            'Accept-Language': request.headers.get('Accept-Language', 'fi')
        }
        
        print(f"Proxying request to LAJI API: {target_url}")
        
        resp = requests.get(target_url, headers=forward_headers, timeout=30)
        
        # Return response content and status code with original content-type
        content_type = resp.headers.get('Content-Type', 'application/json')
        return (resp.content, resp.status_code, {'Content-Type': content_type})
    
    except Exception as e:
        print(f"LAJI proxy request failed: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
