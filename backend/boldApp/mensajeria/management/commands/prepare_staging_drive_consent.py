"""Generate a private, expiring HUMAN consent handoff through the real local API."""
from datetime import datetime,timedelta,timezone
from html import escape
import json
from urllib.parse import urlsplit,parse_qs
import uuid

import requests
from django.core.management.base import BaseCommand,CommandError
from .bootstrap_messaging_staging import checked_profile,CLIENT,CALLBACK,PROJECT

BASE='http://127.0.0.1:5193'


def checked_authorization_url(value):
    try:
        parsed=urlsplit(value)
        fields=parse_qs(parsed.query)
        if not (parsed.scheme=='https' and parsed.netloc=='accounts.google.com' and
            parsed.path=='/o/oauth2/v2/auth' and not parsed.fragment and
            fields['client_id']==[CLIENT] and fields['redirect_uri']==[CALLBACK] and
            fields['include_granted_scopes']==['false'] and
            fields['access_type']==['offline'] and fields['response_type']==['code'] and
            fields['login_hint']==['samuel@bold.gt'] and fields['hd']==['bold.gt'] and
            set(fields['scope'][0].split())=={'openid','email','https://www.googleapis.com/auth/drive'} and
            len(fields['state'])==1 and fields['state'][0]):
            raise ValueError()
    except (ValueError,KeyError,TypeError):
        raise CommandError('El enlace no corresponde al consentimiento de Drive independiente esperado.') from None
    return value


class Command(BaseCommand):
    help='Prepara el archivo privado de consentimiento de Drive de staging; la persona debe autorizarlo.'

    def handle(self,*args,**options):
        root=checked_profile()
        from boldApp.core.models import UserAccount
        from boldApp.workspace.models import GoogleConnection,GoogleOAuthConfiguration
        config=GoogleOAuthConfiguration.objects.get(pk=1,enabled=True,project_id=PROJECT)
        if config.client_id!=CLIENT or GoogleConnection.objects.exists():
            raise CommandError('Inspecciona la conexión existente antes de emitir otro consentimiento.')
        try:
            stored=json.loads((root/'staging-accounts.json').read_text(encoding='utf-8'))
            if stored['local_only'] is not True or stored['url']!=BASE:
                raise ValueError()
            identity=stored['accounts'][0]
            account=UserAccount.objects.get(pk=uuid.UUID(identity['id']),email='samuel@bold.gt',
                is_active=True,is_staff=False,is_superuser=False)
            if (identity['email']!=account.email or not account.employee.position_assignments.filter(
                    pk=uuid.UUID(identity['assignment']),is_active=True).exists()):
                raise ValueError()
        except (OSError,ValueError,KeyError,TypeError,UserAccount.DoesNotExist):
            raise CommandError('El registro privado de cuentas locales no corresponde al entorno.') from None
        try:
            client=requests.Session();client.trust_env=False
            response=client.get(BASE+'/api/v2/auth/session/',timeout=15)
            if response.status_code!=200:raise ValueError()
            client.headers.update({'Origin':BASE,'X-CSRFToken':response.json()['csrf_token']})
            response=client.post(BASE+'/api/v2/auth/login/',json={'email':identity['email'],
                'password':identity['password']},timeout=20)
            if response.status_code!=200 or not response.json().get('authenticated'):raise ValueError()
            response=client.get(BASE+'/api/v2/auth/session/',timeout=15)
            if response.status_code!=200:raise ValueError()
            client.headers.update({'X-CSRFToken':response.json()['csrf_token'],'X-Assignment-ID':identity['assignment']})
            response=client.post(BASE+'/api/v2/workspace/oauth/start/',json={'service':'drive'},timeout=15)
            if response.status_code!=200:raise ValueError()
            url=checked_authorization_url(response.json()['authorization_url'])
        except (requests.RequestException,ValueError,KeyError):
            raise CommandError('No se pudo preparar el consentimiento mediante el backend/proxy local. No se imprimen credenciales ni respuestas privadas.') from None
        issued=datetime.now(timezone.utc);expires=issued+timedelta(minutes=10)
        html=f'''<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>BOLD · Autorizar Drive de pruebas</title>
<main><h1>Conectar Google Drive al entorno local de pruebas</h1>
<p>Cuenta: samuel@bold.gt. Proyecto independiente: BOLD APP Slack Pruebas. No es producción.</p>
<p>El permiso solicitado permite acceder a Drive de esta cuenta, no solo a una carpeta.
Las pruebas usarán exclusivamente la carpeta privada «BOLD APP — Pruebas Slack — 2026-10-21» y archivos sintéticos.</p>
<p>No se solicitan Gmail, Calendar, Contacts ni Meet. No se crea facturación ni se comparten archivos públicamente.</p>
<p>Este enlace caduca a las {escape(expires.strftime('%H:%M:%S'))} UTC, diez minutos después de prepararlo.</p>
<p><a rel="noreferrer" href="{escape(url,quote=True)}">Revisar y autorizar Google Drive de pruebas</a></p>
<p>Revise la cuenta y el alcance en Google. Puede cancelar allí sin autorizar.
Después de conectar, vuelva a esta conversación y avise; no envíe códigos ni tokens.</p></main></html>'''
        destination=root/'drive-consent.html'
        destination.write_text(html,encoding='utf-8')
        # Audit metadata contains neither state, authorization URL nor tokens.
        (root/'consent-issued.json').write_text(json.dumps({'issued_at':issued.isoformat(),
            'expires_at':expires.isoformat(),'project':PROJECT,'scope':'drive-only'}),encoding='utf-8')
        self.stdout.write('Consentimiento listo en el archivo privado drive-consent.html. Caduca en diez minutos; requiere aprobación humana. No se ha autorizado Google.')
