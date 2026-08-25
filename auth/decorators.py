from functools import wraps
from flask import session, redirect, url_for, request
from config import USE_AUTHENTICATION


def login_required(f):
    """Decorator: enforces authentication only when USE_AUTHENTICATION=true."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if USE_AUTHENTICATION and 'token' not in session:
            next_path = request.full_path.rstrip('?')
            return redirect(url_for('auth.login', next=next_path))
        return f(*args, **kwargs)
    return decorated_function

