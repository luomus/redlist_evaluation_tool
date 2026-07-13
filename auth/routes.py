from flask import Blueprint, redirect, url_for, request, session, jsonify
from urllib.parse import urlencode
import requests
import json
from config import (
    LAJIAUTH_URL, SECRET_TIMEOUT_PERIOD, ALLOWED_ROLES
)

auth_bp = Blueprint('auth', __name__)


@auth_bp.route("/login")
def login():
    """Redirect to laji-auth login with callback URL"""
    # Build laji-auth login URL
    from config import TARGET
    params = {
        'target': TARGET,
        'next': '/'
    }
    laji_auth_login_url = f"{LAJIAUTH_URL}login?{urlencode(params)}"
    
    return redirect(laji_auth_login_url)


@auth_bp.route("/login/callback", methods=["POST"])
def login_callback():
    """Handle callback from laji-auth system"""
    token = request.form.get('token') or (request.get_json(silent=True) or {}).get('token')
    next_url = request.form.get('next') or (request.get_json(silent=True) or {}).get('next', '/')

    # Restrict next_url to relative paths to prevent open redirect (block protocol-relative URLs like //attacker.com)
    if not next_url or not next_url.startswith('/'):
        next_url = '/'    
    if not token:
        return jsonify({"success": False, "error": "No token provided"}), 400
    
    # Fetch and store user information
    authentication_info = _get_authentication_info(token)
    if not authentication_info or 'user' not in authentication_info:
        return jsonify({"success": False, "error": "Failed to retrieve user information"}), 401
    
    # Check user role
    user_info = authentication_info['user']
    user_roles = user_info.get('roles', [])
    
    # Only allow users with configured allowed roles
    if not any(role in ALLOWED_ROLES for role in user_roles):
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


@auth_bp.route("/logout")
def logout():
    """Clear session and redirect to login"""
    # Delete token from laji-auth if it exists
    token = session.get('token')
    if token:
        _delete_authentication_token(token)
    
    session.clear()
    return redirect(url_for('auth.login'))


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
        # Use app.logger if available; fallback to print for now
        import logging
        logging.error(f"Failed to get authentication info: {str(e)}", exc_info=True)
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
        # Use app.logger if available; fallback to print for now
        import logging
        logging.error(f"Failed to delete authentication token: {str(e)}", exc_info=True)
        return False
