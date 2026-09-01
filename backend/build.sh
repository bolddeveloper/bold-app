#!/usr/bin/env bash
# Script de build usado por Render para preparar boldApp antes de arrancar.
set -o errexit

pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate
