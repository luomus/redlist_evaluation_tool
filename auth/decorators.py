from functools import wraps
from flask import session, redirect, url_for, request


def login_required(f):
    """Decorator to require authentication (valid token in session)."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'token' not in session:
            # Store the original URL to redirect back after login
            return redirect(url_for('auth.login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function
