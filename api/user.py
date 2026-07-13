"""User and configuration API endpoints."""
import os
from flask import Blueprint, session, jsonify
from auth.decorators import login_required

bp = Blueprint('api_user', __name__, url_prefix='/api')


@bp.route('/user', methods=['GET'])
@login_required
def get_user_info():
    """Return current user information from session"""
    return jsonify({
        "user_id": session.get('user_id', ''),
        "user_name": session.get('user_name', ''),
        "user_email": session.get('user_email', '')
    })


@bp.route('/config', methods=['GET'])
@login_required
def get_config():
    """Return client-side configuration including API base URL and access token
    and the current user's LajiAuth token (session token) so the client can
    include it in requests to the API as a Person-Token header."""
    return jsonify({
        "base_url": os.getenv('LAJI_API_BASE_URL', ''),
        "access_token": os.getenv('LAJI_API_ACCESS_TOKEN', ''),
        "person_token": session.get('token')
    })
