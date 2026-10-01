"""Configuration module for biotools application."""

import os
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

# ===== FLASK =====
DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
LOGGING_LEVEL = os.getenv('LOGGING_LEVEL', 'INFO').upper()
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable must be set")

MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # 100 MB

# ===== AUTHENTICATION =====
USE_AUTHENTICATION = os.getenv('USE_AUTHENTICATION', 'true').lower() == 'true'
SHARED_SECRET = os.getenv("SHARED_SECRET")

# LajiAuth – only validated when USE_AUTHENTICATION=true
TARGET = os.getenv("TARGET")
LAJIAUTH_URL = os.getenv("LAJIAUTH_URL")
SECRET_TIMEOUT_PERIOD = int(os.getenv("SECRET_TIMEOUT_PERIOD", "10"))
ALLOWED_ROLES = ['MA.admin', 'MA.taxonEditorUser']
# How long a personToken validation result is trusted before re-checking the Person API
PERSON_TOKEN_REVALIDATION_INTERVAL = int(os.getenv("PERSON_TOKEN_REVALIDATION_INTERVAL", "600"))

if USE_AUTHENTICATION:
    if not TARGET:
        raise RuntimeError("TARGET must be set when USE_AUTHENTICATION=true")
    if not LAJIAUTH_URL:
        raise RuntimeError("LAJIAUTH_URL must be set when USE_AUTHENTICATION=true")
    if not SHARED_SECRET:
        raise RuntimeError("SHARED_SECRET must be set when USE_AUTHENTICATION=true")

# ===== LAJI API =====
LAJI_API_ACCESS_TOKEN = os.getenv("LAJI_API_ACCESS_TOKEN", "")
LAJI_API_BASE_URL = os.getenv("LAJI_API_BASE_URL", "")

# ===== IUCN EDITOR =====
IUCN_EDITOR_URL = os.getenv("IUCN_EDITOR_URL", "https://taxoneditor.laji.fi/iucn")

# ===== MML TILES =====
MML_API_KEY = os.getenv('MML_API_KEY', '')
CARTO_BASEMAP_API_KEY = os.getenv('CARTO_BASEMAP_API_KEY', '')

# ===== CACHE =====
STATS_CACHE_TTL_SECONDS = 300


def get_flask_config():
    return {
        'DEBUG': DEBUG,
        'SECRET_KEY': SECRET_KEY,
        'MAX_CONTENT_LENGTH': MAX_CONTENT_LENGTH,
        'SESSION_COOKIE_SECURE': False,  # Set to True in production with HTTPS
        'SESSION_COOKIE_HTTPONLY': True,
        'SESSION_COOKIE_SAMESITE': 'Lax',
        'PERMANENT_SESSION_LIFETIME': 1209600,  # 2 weeks
    }

