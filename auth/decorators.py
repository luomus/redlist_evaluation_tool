from functools import wraps
import time
from flask import session, redirect, url_for, request
from config import USE_AUTHENTICATION, PERSON_TOKEN_REVALIDATION_INTERVAL
from auth.routes import get_authentication_info


def login_required(f):
    """Decorator: enforces authentication only when USE_AUTHENTICATION=true."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if USE_AUTHENTICATION:
            token = session.get('lajiauth_token')
            last_validated = session.get('lajiauth_validated_at', 0)
            needs_revalidation = time.time() - last_validated > PERSON_TOKEN_REVALIDATION_INTERVAL
            # Re-validate the personToken against the Person API, but only once per cache interval.
            if not token or (needs_revalidation and not get_authentication_info(token)):
                session.clear()
                next_path = request.full_path.rstrip('?')
                return redirect(url_for('auth.login', next=next_path))
            if needs_revalidation:
                session['lajiauth_validated_at'] = time.time()
        return f(*args, **kwargs)
    return decorated_function

