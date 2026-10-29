"""Explicit bootstrap for the already-approved LOCAL Drive acceptance only.

Never install an OAuth client into an ordinary application database. Generated
local account credentials stay in the private staging directory, not stdout/Git.
No external request, elevated operator or production credential is required.
"""
import json
import os
from pathlib import Path
import secrets
import tempfile
import re

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

PROJECT = 'bold-app-slack-pruebas'
CLIENT = '929589116740-l92km87gv033ipi07qo4pcg3dno4a4cp.apps.googleusercontent.com'
CALLBACK = 'http://127.0.0.1:5193/api/v2/workspace/oauth/callback/'


def checked_profile():
    root=Path(os.environ.get('BOLD_CHANNEL_STAGING_DIR','')).resolve()
    parents={Path(tempfile.gettempdir()).resolve()}
    local_data=os.environ.get('LOCALAPPDATA','')
    if local_data and Path(local_data).is_absolute():
        parents.add((Path(local_data)/'BOLDApp'/'validation').resolve())
    db=settings.DATABASES['default']
    if (os.environ.get('DJANGO_SETTINGS_MODULE')!='config.settings_channel_staging' or
            root.parent not in parents or not re.fullmatch(r'bold-channel-postgres-[a-f0-9]{32}',root.name) or
            not root.is_dir() or
            (db.get('HOST'),str(db.get('PORT')),db.get('NAME'),db.get('USER'))!=
                ('127.0.0.1','55432','bold_validation','bold_validation_admin') or
            not settings.MESSAGING_PILOT_ENABLED or
            settings.MESSAGING_PILOT_UNIT_IDS!=('11111111-2222-4333-8444-555555555551','11111111-2222-4333-8444-555555555552') or
            settings.GOOGLE_WORKSPACE_OAUTH_ALLOWED_SERVICES!=('drive',) or
            settings.GOOGLE_WORKSPACE_REDIRECT_URI!=CALLBACK or
            settings.FRONTEND_URL!='http://127.0.0.1:5193' or
            settings.SEED_DEMO_ACCOUNTS or settings.SEED_PRIVILEGED_DEMO_ACCOUNTS):
        raise CommandError('Solo se permite el perfil local aislado de aceptación; no se modificó otra base.')
    return root


def checked_client(path):
    try:
        if path.stat().st_size>65536:
            raise ValueError()
        web=json.loads(path.read_text(encoding='utf-8-sig'))['web']
        if (web['project_id']!=PROJECT or web['client_id']!=CLIENT or
                web['redirect_uris']!=[CALLBACK] or
                not isinstance(web['client_secret'],str) or not 1<=len(web['client_secret'])<=4096):
            raise ValueError()
    except (OSError,ValueError,KeyError,TypeError):
        raise CommandError('El JSON no corresponde al cliente independiente de pruebas aprobado.') from None
    return web


class Command(BaseCommand):
    help='Provisiona dos identidades locales sin privilegios y el cliente OAuth de pruebas; no conecta Google.'

    def add_arguments(self,parser):
        parser.add_argument('--google-client',required=True,type=Path)

    def handle(self,*args,**options):
        root=checked_profile()
        web=checked_client(options['google_client'])
        from boldApp.autenticacion.services import encrypt_secret
        from boldApp.core.models import Employee,UserAccount,OrganizationalUnit,JobRole,Position,PositionAssignment
        from boldApp.workspace.models import GoogleOAuthConfiguration,GoogleConnection,ImageStorageRoot
        if any(model.objects.exists() for model in (UserAccount,GoogleConnection,ImageStorageRoot,GoogleOAuthConfiguration)):
            raise CommandError('La base de staging no está vacía. No se reemplazan cuentas, conexiones ni destinos existentes.')
        credential_file=root/'staging-accounts.json'
        try:
            # Exclusive create: a retry must never rotate credentials silently.
            stream=credential_file.open('x',encoding='utf-8')
        except FileExistsError:
            raise CommandError('Ya existe el registro privado de cuentas. Inspecciónelo antes de repetir el bootstrap.') from None
        accounts=[]
        with stream,transaction.atomic():
            role=JobRole.objects.create(title='Participante de aceptación local')
            for index,(email,name,label) in enumerate((
                ('samuel@bold.gt','Samuel · Pruebas locales','IT · Pruebas'),
                ('slack.pruebas.beta@bold.gt','Beta · Cuenta sintética','Equipo secundario · Pruebas'),
            )):
                unit=OrganizationalUnit.objects.create(id=settings.MESSAGING_PILOT_UNIT_IDS[index],
                    name=label,unit_type='department',sensitivity_level='low',color_hex=('#4760A8','#9250A3')[index])
                employee=Employee.objects.create(full_name=name)
                password=secrets.token_urlsafe(32)
                account=UserAccount.objects.create_user(email=email,employee=employee,password=password,
                    email_verified_at=timezone.now())
                assignment=PositionAssignment.objects.create(employee=employee,
                    position=Position.objects.create(unit=unit,job_role=role))
                accounts.append({'email':email,'password':password,'assignment':str(assignment.pk),'id':str(account.pk)})
            GoogleOAuthConfiguration.objects.create(pk=1,enabled=True,client_id=web['client_id'],
                client_secret_encrypted=encrypt_secret(web['client_secret']),project_id=web['project_id'])
            json.dump({'local_only':True,'url':settings.FRONTEND_URL,'accounts':accounts},stream,indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        self.stdout.write('Dos identidades locales sin privilegios y cliente cifrado preparados. Google aún no está autorizado. Credenciales solo en el registro privado de staging.')
