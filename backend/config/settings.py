"""
Configuracion de Django para el proyecto boldApp.

Este proyecto expone unicamente la capa de datos (modelos, migraciones,
admin) y un esqueleto de Django REST Framework para el modulo de tareas.
La configuracion esta preparada para desplegarse en Render usando
PostgreSQL, y hace fallback a SQLite en desarrollo local si no se define
DATABASE_URL.
"""

import os
from pathlib import Path

import dj_database_url
from corsheaders.defaults import default_headers


# Define las rutas base del proyecto.
base_dir = Path(__file__).resolve().parent.parent


# Define los valores sensibles leidos desde variables de entorno.
# Nota: Django exige que los settings sean atributos en MAYUSCULAS a nivel
# de modulo para poder detectarlos; por eso SECRET_KEY, DEBUG y
# ALLOWED_HOSTS rompen la convencion snake_case usada en el resto del codigo.
SECRET_KEY = os.environ.get("SECRET_KEY", "django-insecure-boldapp-dev-key")
DEBUG = os.environ.get("DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

# Render termina TLS en su proxy y comunica el esquema original mediante
# X-Forwarded-Proto. Estas opciones solo aplican al entorno de producción.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = os.environ.get("SECURE_HSTS_INCLUDE_SUBDOMAINS", "false").lower() == "true"
    SECURE_CONTENT_TYPE_NOSNIFF = True


# Define las aplicaciones instaladas del proyecto. "daphne" va primero
# siguiendo la convencion de Channels: reemplaza el runserver de Django por
# uno que sirve ASGI+WebSockets, asi que tambien funciona en desarrollo
# local sin comandos extra.
INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "channels",
    "rest_framework",
    "corsheaders",
    "boldApp.core",
    "boldApp.autenticacion",
    "boldApp.tareas",
]


# Define la cadena de middlewares, incluyendo CORS y whitenoise para estaticos.
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]


ROOT_URLCONF = "config.urls"


# Define el motor de plantillas, requerido por el admin de Django.
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"


# Define la base de datos usando DATABASE_URL (Render/Postgres) con fallback a SQLite.
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{base_dir / 'db.sqlite3'}",
        conn_max_age=600,
    )
}


# Define el modelo de usuario personalizado del proyecto.
AUTH_USER_MODEL = "boldApp_core.UserAccount"


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Los hashes existentes siguen siendo verificables y se actualizan a Argon2
# automaticamente cuando el usuario vuelve a autenticarse.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]


LANGUAGE_CODE = "es"
TIME_ZONE = "America/Guatemala"
USE_I18N = True
USE_TZ = True


# Define la configuracion de archivos estaticos para Render (whitenoise).
STATIC_URL = "static/"
STATIC_ROOT = base_dir / "staticfiles"
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}


DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Define los origenes permitidos para que el PWA (frontend) consuma la API.
cors_origins_env = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)
CORS_ALLOWED_ORIGINS = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
CORS_ALLOW_ALL_ORIGINS = DEBUG and not CORS_ALLOWED_ORIGINS
CORS_ALLOW_HEADERS = (*default_headers, "x-assignment-id")
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS


# Define la configuracion base de Django REST Framework.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "boldApp.autenticacion.authentication.CookieSessionAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    # Render agrega una capa proxy; en desarrollo no se confía en X-Forwarded-For.
    "NUM_PROXIES": int(os.environ.get("AUTH_NUM_PROXIES", "0" if DEBUG else "1")),
    "DEFAULT_THROTTLE_RATES": {
        "auth_login_ip": "20/15min",
        "auth_login_account": "5/15min",
        "auth_mfa": "5/5min",
        "auth_recovery_ip": "10/hour",
        "auth_recovery_account": "3/hour",
        "auth_websocket_ticket": "30/min",
    },
}

# Autenticacion web. La inactividad queda modelada pero deshabilitada con 0.
AUTH_SESSION_COOKIE_NAME = os.environ.get("AUTH_SESSION_COOKIE_NAME", "bold_session")
AUTH_SESSION_IDLE_SECONDS = int(os.environ.get("AUTH_SESSION_IDLE_SECONDS", "0"))
AUTH_SESSION_CUTOFF_TIME = os.environ.get("AUTH_SESSION_CUTOFF_TIME", "07:00")
AUTH_SESSION_TIME_ZONE = os.environ.get("AUTH_SESSION_TIME_ZONE", "America/Guatemala")
AUTH_SESSION_COOKIE_SAMESITE = os.environ.get("AUTH_SESSION_COOKIE_SAMESITE", "Lax")
CSRF_COOKIE_SAMESITE = AUTH_SESSION_COOKIE_SAMESITE
CSRF_COOKIE_SECURE = not DEBUG
AUTH_MFA_REQUIRED = os.environ.get("AUTH_MFA_REQUIRED", "false").lower() == "true"
AUTH_CHALLENGE_TTL_SECONDS = int(os.environ.get("AUTH_CHALLENGE_TTL_SECONDS", "3600"))
AUTH_WEBSOCKET_TICKET_TTL_SECONDS = int(os.environ.get("AUTH_WEBSOCKET_TICKET_TTL_SECONDS", "45"))
AUTH_ENCRYPTION_KEY = os.environ.get("AUTH_ENCRYPTION_KEY", "")
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "no-reply@bold.gt")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")


# Define la configuracion de Celery para la entrega asincrona de webhooks.
# REDIS_URL lo provee Render al agregar el addon de Redis; si la variable no
# existe, las tareas corren en modo "eager" (sincrono, dentro del mismo
# proceso) para que la demo local funcione sin infraestructura.
redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_BROKER_URL = redis_url
CELERY_RESULT_BACKEND = redis_url
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_ALWAYS_EAGER = os.environ.get(
    "CELERY_TASK_ALWAYS_EAGER",
    "true" if "REDIS_URL" not in os.environ else "false",
).lower() == "true"
CELERY_TASK_EAGER_PROPAGATES = False


# Define la capa de canales de Django Channels (push en vivo por WebSocket).
# En desarrollo sin REDIS_URL, la capa en memoria permite probar HTTP y
# WebSockets con el proceso unico de runserver sin instalar Redis. Render y
# cualquier entorno que defina REDIS_URL siguen usando la capa compartida de
# Redis, necesaria cuando hay mas de un proceso o instancia.
if "REDIS_URL" not in os.environ:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        },
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [redis_url],
            },
        },
    }
