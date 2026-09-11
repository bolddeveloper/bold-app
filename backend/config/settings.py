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
    "rest_framework.authtoken",
    "channels",
    "rest_framework",
    "corsheaders",
    "boldApp.core",
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


# Define la configuracion base de Django REST Framework.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
}


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
# En desarrollo los webhooks se ejecutan dentro del proceso de Django. Una
# integracion externa caida debe quedar registrada como entrega fallida, pero
# nunca convertir en 500 la operacion principal que genero el evento.
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
