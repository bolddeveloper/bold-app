"""Opt-in localhost PostgreSQL acceptance; never inherit production services."""
import json
import os
from pathlib import Path
from .settings_test import *  # noqa: F403

config_path=Path(os.environ['BOLD_REPORTS_TEST_CONFIG']).resolve()
private_root=(Path(os.environ['LOCALAPPDATA'])/'BOLDApp'/'validation').resolve()
if (config_path.parent.parent!=private_root or not config_path.parent.name.startswith('bold-reports-postgres-')
        or config_path.name!='connection.json'):
    raise RuntimeError('Use a fresh private BOLD reports validation configuration.')
database=json.loads(config_path.read_text(encoding='utf-8'))
if (database.get('HOST')!='127.0.0.1' or database.get('PORT')!=55483
        or database.get('NAME')!='bold_reports_validation' or database.get('USER')!='bold_reports_test'):
    raise RuntimeError('Only the isolated localhost reports database is permitted.')
DATABASES={'default':{'ENGINE':'django.db.backends.postgresql',**database,
    'CONN_MAX_AGE':0,'TEST':{'NAME':'test_bold_reports_validation'}}}
