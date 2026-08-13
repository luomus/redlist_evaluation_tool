"""LAJI API CORS proxy endpoint.

Forwards requests to the configured LAJI API with authentication headers.
"""
import os
import requests
from flask import Blueprint, request, session, jsonify, current_app

bp = Blueprint('proxy_laji', __name__, url_prefix='/api')


@bp.route('/laji', methods=['GET'])
def laji_proxy():
    """
    Proxy GET requests to the configured LAJI API base URL to avoid CORS.
    
    The original query string is forwarded as-is. The server adds:
    - Authorization header with configured access token
    - Person-Token header with session token
    """
    try:
        # Rebuild target URL from base and original query string
        query = request.query_string.decode('utf-8')
        laji_api_base_url = os.getenv('LAJI_API_BASE_URL')
        
        if not laji_api_base_url:
            return jsonify({"success": False, "error": "LAJI_API_BASE_URL not configured on server"}), 500
        
        target_url = f"{laji_api_base_url}?{query}"
        
        # Validate tokens
        laji_api_access_token = os.getenv('LAJI_API_ACCESS_TOKEN')
        if not laji_api_access_token:
            return jsonify({"success": False, "error": "LAJI_API_ACCESS_TOKEN not configured on server"}), 500
        
        #person_token = session.get('token')
        #if not person_token:
        #    return jsonify({"success": False, "error": "Person token missing – please log in again"}), 401
        
        # Forward headers — api.laji.fi uses headers for authorization
        forward_headers = {
            #'Authorization': f'Bearer {laji_api_access_token}',
            #'Person-Token': person_token,
            'Api-Version': request.headers.get('Api-Version', '1'),
            'Accept-Language': request.headers.get('Accept-Language', 'fi')
        }
        
        current_app.logger.debug(f"Proxying request to LAJI API: {target_url}")
        
        resp = requests.get(target_url, headers=forward_headers, timeout=30)
        
        # Return response content and status code with original content-type
        content_type = resp.headers.get('Content-Type', 'application/json')
        return (resp.content, resp.status_code, {'Content-Type': content_type})
    
    except Exception as e:
        current_app.logger.error(f"LAJI proxy request failed: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
