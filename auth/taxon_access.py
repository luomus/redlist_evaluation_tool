from flask import jsonify, session

from auth.token import check_user
from config import USE_AUTHENTICATION


def has_taxon_access(mx_id):
    if not USE_AUTHENTICATION:
        return True
    try:
        check_user(session.get('iucn_user_id'), session.get('lajiauth_user_id'))
    except PermissionError:
        return False
    allowed_mx_ids = session.get('allowed_mx_ids')
    has_access = isinstance(allowed_mx_ids, dict) and bool(allowed_mx_ids.get(mx_id))
    return has_access


def taxon_access_denied():
    return jsonify({"success": False, "error": "Not authorized for this taxon"}), 403
