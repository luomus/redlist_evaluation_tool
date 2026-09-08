"""Authentication routes for LajiAuth integration."""
from flask import Blueprint, session, redirect, request, url_for, jsonify
from config import LAJIAUTH_URL, TARGET, ALLOWED_ROLES, SECRET_TIMEOUT_PERIOD, LAJI_API_BASE_URL, LAJI_API_ACCESS_TOKEN
from urllib.parse import urlencode
import requests
import json

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/login', methods=['GET'])
def login():
    """
    Redirect to LajiAuth login endpoint.
    
    After successful authentication, LajiAuth redirects back to /auth/callback
    with a token in the query string.
    """

    next_url = request.args.get('next') or '/'
    session['post_login_redirect'] = next_url
    provider_next = f"{request.host_url.rstrip('/')}{next_url}"

    params = {
        'target': TARGET,
        'next': provider_next,
        'redirectMethod': 'GET',
    }

    laji_auth_login_url = f"{LAJIAUTH_URL}login?{urlencode(params)}"
    
    return redirect(laji_auth_login_url)

@auth_bp.route("/login/callback", methods=["GET", "POST"])
def login_callback():
    """Handle callback from laji-auth system"""
    print("Received login callback from LajiAuth")
    token = request.args.get('token') or request.form.get('token')
    next_url = request.args.get('next') or request.form.get('next')
    if not token:
        return jsonify({"success": False, "error": "No token provided"}), 400
    
    # Fetch and store user information
    authentication_info = _get_authentication_info(token)

    if not authentication_info:
        return jsonify({"success": False, "error": "Failed to retrieve user information"}), 401
    
    # Check user role
    user_roles = authentication_info.get('role', [])
    
    # Only allow users with configured allowed roles
    if not any(role in ALLOWED_ROLES for role in user_roles):
        return jsonify({"success": False, "error": f"Access denied. Your roles {user_roles} are not authorized to use this application. Contact helpdesk@laji.fi"}), 403
    
    # Store token in session
    session['token'] = token
    session.permanent = True  # Make session persistent
    
    # Store user information
    session['user_id'] = authentication_info.get('id')
    session['user_name'] = authentication_info.get('fullName')
    session['user_email'] = authentication_info.get('emailAddress')
    session['user_roles'] = user_roles
    session.modified = True  # Explicitly mark session as modified to ensure cookie is set
    
    return redirect(next_url)

def _get_authentication_info(token):
    """
    Get authentication info for the token.
    :param token: The token returned by LajiAuth.
    :return: Authentication info content.
    """
    try:
        url = LAJI_API_BASE_URL + "/person"
        headers = {'accept':'application/json', 'Api-Version': '1', 'Person-Token': token, 'Authorization': f'Bearer {LAJI_API_ACCESS_TOKEN}', 'Accept-Language': 'fi'}
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(f"Failed to get authentication info: {response.status_code} {response.text}")
            return None
        else:
            content = json.loads(response.content.decode('utf-8'))
            return content
    except Exception as e:
        # Use app.logger if available; fallback to print for now
        import logging
        logging.error(f"Failed to get authentication info: {str(e)}", exc_info=True)
        return None


@auth_bp.route("/logout")
def logout():
    """Clear session and redirect to login"""
    # Delete token from laji-auth if it exists
    token = session.get('token')
    if token:
        _delete_authentication_token(token)
    
    session.clear()
    return redirect(url_for('auth.login'))


def _delete_authentication_token(token):
    """
    Logs the user out by deleting the authentication token
    :param token: LajiAuth token
    :return: true if user was successfully logged out
    """
    try:
        url = LAJI_API_BASE_URL + "/authentication-event"
        headers = {'accept':'application/json', 'Api-Version': '1', 'Person-Token': token, 'Authorization': f'Bearer {LAJI_API_ACCESS_TOKEN}', 'Accept-Language': 'fi'}
        response = requests.delete(url, headers=headers)
        return response.status_code == 200
    except Exception as e:
        # Use app.logger if available; fallback to print for now
        import logging
        logging.error(f"Failed to delete authentication token: {str(e)}", exc_info=True)
        return False