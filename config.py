"""
Configuration module for redlisttools application.
Loads environment variables and defines Flask configuration.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from project root (if present)
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)


# ===== FLASK CONFIGURATION =====
DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable must be set")

MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # 100MB max upload size

# ===== LAJIAUTH CONFIGURATION =====
TARGET = os.getenv("TARGET")
if not TARGET:
    raise RuntimeError("TARGET environment variable must be set")

LAJIAUTH_URL = os.getenv("LAJIAUTH_URL")
if not LAJIAUTH_URL:
    raise RuntimeError("LAJIAUTH_URL environment variable must be set")

SECRET_TIMEOUT_PERIOD = int(os.getenv("SECRET_TIMEOUT_PERIOD", "10"))
ALLOWED_ROLES = ['MA.admin', 'MA.taxonEditorUser']

# ===== LAJIAPI CONFIGURATION =====
LAJI_API_ACCESS_TOKEN = os.getenv("LAJI_API_ACCESS_TOKEN")
if not LAJI_API_ACCESS_TOKEN:
    raise RuntimeError("LAJI_API_ACCESS_TOKEN environment variable must be set")

LAJI_API_BASE_URL = os.getenv("LAJI_API_BASE_URL")
if not LAJI_API_BASE_URL:
    raise RuntimeError("LAJI_API_BASE_URL environment variable must be set")

# ===== MML TILE CONFIGURATION =====
MML_API_KEY = os.getenv('MML_API_KEY')
if not MML_API_KEY:
    raise RuntimeError("MML_API_KEY environment variable must be set")

# ===== CACHE CONFIGURATION =====
STATS_CACHE_TTL_SECONDS = 300  # 5 minutes

def get_flask_config():
    """Return Flask app configuration dict."""
    return {
        'DEBUG': DEBUG,
        'SECRET_KEY': SECRET_KEY,
        'MAX_CONTENT_LENGTH': MAX_CONTENT_LENGTH,
    }
