"""
Endpoint Audit Dashboard – Django settings (Local-Only)

Database: SQLite (local development)
Storage: Filebase S3-compatible (audit reports)
"""
import logging
from pathlib import Path
from decouple import config, Csv

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config('SECRET_KEY')
DEBUG = config('DEBUG', cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', cast=Csv())

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework.authtoken",
    "dashboard",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"

# ── Templates Configuration ────────────────────────────────────────────────────
# Admin interface needs templates, but API views don't
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = "core.wsgi.application"

# ── Database Configuration ────────────────────────────────────────────────────
# Support both SQLite (local) and PostgreSQL (Supabase cloud)
DB_ENGINE = config("DB_ENGINE", default="django.db.backends.sqlite3")

if DB_ENGINE == "django.db.backends.postgresql":
    DATABASES = {
        "default": {
            "ENGINE": DB_ENGINE,
            "NAME": config("DB_NAME"),
            "USER": config("DB_USER"),
            "PASSWORD": config("DB_PASSWORD"),
            "HOST": config("DB_HOST"),
            "PORT": config("DB_PORT", cast=int),
            "CONN_MAX_AGE": 600,  # Keep connections alive for 10 minutes
            "OPTIONS": {
                "connect_timeout": 10,
                "keepalives": 1,
                "keepalives_idle": 30,
                "keepalives_interval": 10,
                "keepalives_count": 5,
            },
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": DB_ENGINE,
            "NAME": config("DB_NAME", default=str(BASE_DIR / "db.sqlite3")),
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = config('TIME_ZONE', default='Asia/Kolkata')
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── Report Storage ────────────────────────────────────────────────────────
REPORT_STORAGE = config('REPORT_STORAGE', default='local').lower()

# ── Filebase S3-Compatible Storage ─────────────────────────────────────────────
# For storing audit reports
FILEBASE_ENDPOINT = config('FILEBASE_ENDPOINT', default='https://s3.filebase.com')
FILEBASE_BUCKET = config('FILEBASE_BUCKET', default='endpoint-dashboard-reports')
FILEBASE_ACCESS_KEY = config('FILEBASE_ACCESS_KEY', default='')
FILEBASE_SECRET_KEY = config('FILEBASE_SECRET_KEY', default='')

# ── Backblaze B2 Storage ───────────────────────────────────────────────────────
# For storing and retrieving audit reports from anywhere
B2_APPLICATION_KEY_ID = config('B2_APPLICATION_KEY_ID', default='')
B2_APPLICATION_KEY = config('B2_APPLICATION_KEY', default='')
B2_BUCKET = config('B2_BUCKET', default='Endpoint-Dashboard')

# Local reports directory (fallback if Filebase unavailable)
REPORTS_BASE_DIR = BASE_DIR / "Reports"
REPORTS_BASE_DIR.mkdir(exist_ok=True)

# ── Heartbeat API Key ──────────────────────────────────────────────────────────
# REQUIRED: All agents must send: Authorization: Bearer <this value>
HEARTBEAT_API_KEY = config('HEARTBEAT_API_KEY')

# ── CSRF & Security ────────────────────────────────────────────────────────────
# REQUIRED: Trusted origins for CSRF protection
CSRF_TRUSTED_ORIGINS = config('CSRF_TRUSTED_ORIGINS', cast=Csv())

# ── Agent Configuration ────────────────────────────────────────────────────────
# Wake-on-LAN
WOL_BROADCAST_IP = config('WOL_BROADCAST_IP', default='255.255.255.255')
WOL_PORT = config('WOL_PORT', default=9, cast=int)

# Command polling
COMMAND_POLL_INTERVAL = config('COMMAND_POLL_INTERVAL', default=60, cast=int)
COMMAND_EXPIRATION_SECONDS = config('COMMAND_EXPIRATION_SECONDS', default=3600, cast=int)

# ── CORS Configuration ─────────────────────────────────────────────────────────
# Allow TypeScript frontend to call Django REST API
CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS', cast=Csv(), default='http://localhost:3000,http://localhost:5173')
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_METHODS = [
    'DELETE',
    'GET',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
]
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]

# ── REST Framework Configuration ───────────────────────────────────────────────
REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
}

# ── Django Admin Configuration ──────────────────────────────────────────────────
# Use atomic requests to prevent cursor timeout issues with Supabase pooler
ATOMIC_REQUESTS = True

