"""Opt-in, real-provider acceptance fenced to the approved local test setup.

Only synthetic content; no fixture substitution for Google requests. Controlled
lost-response/worker interruption is labelled separately from a real outage.
The private journal preserves bytes/nonces across reruns; no permanent deletion.
"""
import base64
from datetime import timedelta
import hashlib
import io
import json
import os
import shutil
import subprocess
import uuid
import zipfile
from unittest.mock import patch

import requests
from PIL import Image,ImageDraw
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand,CommandError
from django.db import connection as database
from django.utils import timezone
from .bootstrap_messaging_staging import checked_profile,CLIENT,PROJECT

BASE='http://127.0.0.1:5193'
FOLDER='1r7DLaKq97Tjo0KsTtkR7ANevO9dy9mbb'
FOLDER_NAME='BOLD APP — Pruebas Slack — 2026-10-21'
JOURNAL='staged-drive-acceptance-v1.json'


def require(condition,label):
    if not condition:
        raise CommandError('Aceptación detenida: '+label+'. Se conservan el registro y los intentos; no se crea otro envío por su cuenta.')


def save_json(path,value):
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    with temporary.open('x',encoding='utf-8') as stream:
        json.dump(value,stream,indent=2);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)


def synthetic_samples():
    """Small valid containers, never personal files or hardware recordings."""
    from ...document_uploads import DOCUMENT_MIMES,MAIN,CT_NS,REL_NS
    image=Image.new('RGB',(180,100),'#ad2344')
    ImageDraw.Draw(image).text((10,35),'BOLD LOCAL TEST',fill='white')
    output=io.BytesIO();image.save(output,'PNG')
    samples=[('image','staging-image.png','image/png',output.getvalue())]
    ffmpeg,ffprobe=shutil.which('ffmpeg'),shutil.which('ffprobe')
    require(ffmpeg and ffprobe,'faltan FFmpeg/FFprobe ya instalados')
    for label,codec,container,mime in (('webm','libopus','webm','audio/webm'),
            ('ogg','libopus','ogg','audio/ogg'),('m4a','aac','mp4','audio/mp4')):
        arguments=[ffmpeg,'-hide_banner','-loglevel','error','-f','lavfi','-i',
            'sine=frequency=440:duration=0.8','-af','volume=0.1','-ar','48000','-ac','1','-c:a',codec]
        if container=='mp4':arguments+=['-movflags','frag_keyframe+empty_moov']
        content=subprocess.run(arguments+['-f',container,'pipe:1'],check=True,capture_output=True,timeout=20).stdout
        probe=subprocess.run([ffprobe,'-v','error','-show_entries','stream=codec_name','-of','json','pipe:0'],
            input=content,check=True,capture_output=True,timeout=15)
        require(json.loads(probe.stdout)['streams'][0]['codec_name']==('aac' if label=='m4a' else 'opus'),'audio sintético inválido')
        samples.append((label,'staging-audio.'+label,mime,content))
    pdf=b'%PDF-1.7\n';positions=[]
    for index,body in enumerate((b'<< /Type /Catalog /Pages 2 0 R >>',
            b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << >> >>'),1):
        positions.append(len(pdf));pdf+=str(index).encode()+b' 0 obj\n'+body+b'\nendobj\n'
    offset=len(pdf)
    pdf+=b'xref\n0 4\n0000000000 65535 f \n'+b''.join(f'{n:010d} 00000 n \n'.encode() for n in positions)
    pdf+=b'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n'+str(offset).encode()+b'\n%%EOF\n'
    for extension,mime in DOCUMENT_MIMES.items():
        if extension in MAIN:
            path,main_type,family,name=MAIN[extension]
            parts={'[Content_Types].xml':f'<Types xmlns="{CT_NS}"><Override PartName="/{path}" ContentType="{main_type}"/></Types>',
                '_rels/.rels':f'<Relationships xmlns="{REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="{path}"/></Relationships>',
                path:f'<{name} xmlns="http://schemas.openxmlformats.org/{family}/2006/main"/>'}
            output=io.BytesIO()
            with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
                for key,value in parts.items():archive.writestr(key,value)
            content=output.getvalue()
        else:
            content=pdf if extension=='pdf' else b'Columna,Valor\nPrueba,2\n'
        samples.append((extension,'staging-document.'+extension,mime,content))
    return samples


class InjectedWorkerInterruption(BaseException):
    pass


class Command(BaseCommand):
    help='Comprueba Drive privado de staging; --run crea archivos sintéticos y prueba cancelación con Papelera recuperable.'

    def add_arguments(self,parser):
        parser.add_argument('--run',action='store_true',help='Ejecutar las pruebas con archivos sintéticos, no solo el preflight de lectura.')
        parser.add_argument('--verify-existing',action='store_true',help='Revisar los archivos publicados del registro previo, sin reservar ni enviar archivos.')

    def checked_response(self,response,expected,label):
        require(response.status_code in expected,label+' (HTTP '+str(response.status_code)+')')
        return response

    def login(self):
        clients=[]
        for identity in self.identities:
            client=requests.Session();client.trust_env=False
            response=self.checked_response(client.get(BASE+'/api/v2/auth/session/',timeout=15),{200},'sesión local')
            client.headers.update({'Origin':BASE,'X-CSRFToken':response.json()['csrf_token']})
            response=self.checked_response(client.post(BASE+'/api/v2/auth/login/',json={
                'email':identity['email'],'password':identity['password']},timeout=20),{200},'login local')
            require(response.json().get('authenticated'),'identidad local no autenticada')
            response=self.checked_response(client.get(BASE+'/api/v2/auth/session/',timeout=15),{200},'sesión tras login')
            client.headers.update({'X-CSRFToken':response.json()['csrf_token'],'X-Assignment-ID':identity['assignment']})
            clients.append(client)
        return clients

    def private_acl(self,identity):
        value=self.google(self.owner,'GET','/files/'+identity+'/permissions',params={
            'fields':'nextPageToken,permissions(type,role,emailAddress)','pageSize':100,'supportsAllDrives':'true'})
        require(not value.get('nextPageToken') and value.get('permissions')==[
            {'type':'user','role':'owner','emailAddress':'samuel@bold.gt'}],'permisos remotos distintos del propietario privado aprobado')

    def write_journal(self):save_json(self.root/JOURNAL,self.journal)

    def handle(self,*args,**options):
        self.root=checked_profile()
        from boldApp.workspace.models import GoogleConnection,GoogleOAuthConfiguration,ImageStorageRoot
        from boldApp.core.models import UserAccount
        from boldApp.workspace.service import google
        self.google=google
        config=GoogleOAuthConfiguration.objects.get(pk=1,enabled=True,project_id=PROJECT)
        self.owner=UserAccount.objects.get(email='samuel@bold.gt',is_active=True,is_staff=False,is_superuser=False)
        linked=GoogleConnection.objects.get(user=self.owner,email='samuel@bold.gt',client_id=CLIENT)
        require(config.client_id==CLIENT and GoogleConnection.objects.count()==1,'cliente o número de conexiones no esperado')
        require(set(linked.scopes.split())=={'openid','https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/drive'},'alcance de Google no esperado')
        remote=google(self.owner,'GET','/files/'+FOLDER,params={'fields':
            'id,name,mimeType,trashed,owners(emailAddress),capabilities(canAddChildren)','supportsAllDrives':'true'})
        require(remote.get('id')==FOLDER and remote.get('name')==FOLDER_NAME and
            remote.get('mimeType')=='application/vnd.google-apps.folder' and not remote.get('trashed') and
            remote.get('capabilities',{}).get('canAddChildren') and
            [owner['emailAddress'] for owner in remote.get('owners',[])]==['samuel@bold.gt'],'carpeta aprobada no disponible')
        self.private_acl(FOLDER)
        self.stdout.write('Preflight: conexión independiente y carpeta privada aprobadas; producción no utilizada.');self.stdout.flush()
        if not options['run'] and not options['verify_existing']:return
        require(not (options['run'] and options['verify_existing']),'elige ejecutar o verificar el ensayo existente')
        root=ImageStorageRoot.objects.filter(active=True).first()
        if root:
            require((root.folder_id,root.user_id,root.client_id,root.subject)==(FOLDER,self.owner.pk,CLIENT,linked.subject),'otro destino activo')
        else:
            require(not options['verify_existing'],'falta el destino del ensayo anterior')
            require(not ImageStorageRoot.objects.exists(),'destinos inactivos requieren inspección')
            root=ImageStorageRoot.objects.create(user=self.owner,subject=linked.subject,client_id=CLIENT,
                google_email=linked.email,folder_id=FOLDER,folder_name=FOLDER_NAME,active=True)
        self.storage=root
        if options['verify_existing']:
            self.journal=json.loads((self.root/JOURNAL).read_text(encoding='utf-8'))
            require(self.journal['version']==1 and self.journal['folder']==FOLDER,'registro de otro ensayo')
            self.check_published_files()
            report_path=self.root/'acceptance-staged-drive-20261029.json'
            report=json.loads(report_path.read_text(encoding='utf-8'))
            require(report.get('accepted') is True,'el ensayo completo no está aceptado')
            report['post_cleanup_published_file_count']=len(self.journal['cases'])
            report['published_files_not_trashed']=True
            save_json(report_path,report)
            self.stdout.write('Verificación posterior: diez archivos publicados conservados fuera de Papelera; no se reservaron ni enviaron archivos.');self.stdout.flush()
            return
        credentials=json.loads((self.root/'staging-accounts.json').read_text(encoding='utf-8'))
        require(credentials['local_only'] is True and credentials['url']==BASE,'registro de cuentas no local')
        self.identities=credentials['accounts']
        require([row['email'] for row in self.identities]==['samuel@bold.gt','slack.pruebas.beta@bold.gt'],'cuentas de prueba distintas')
        self.accounts=[UserAccount.objects.get(pk=uuid.UUID(row['id']),email=row['email'],is_staff=False,is_superuser=False)
            for row in self.identities]
        self.clients=self.login()
        self.prepare_journal()
        outcomes=[]
        for index,case in enumerate(self.journal['cases']):
            outcomes.append(self.case(index,case))
        cancelled=self.cancel_case()
        revoked=self.revoke_case()
        self.check_folders()
        self.check_published_files()
        require(GoogleConnection.objects.count()==1,'la segunda cuenta adquirió conexión Google')
        report={'accepted':True,'profile':'isolated-persistent-postgresql','real_google_provider':True,
            'private_approved_folder':True,'two_authenticated_local_accounts':True,'one_google_connection':True,
            'cases':outcomes,'cancelled_preparation_trashed':cancelled,'revoked_download_status':revoked,
            'published_files_not_trashed':True,'folder_ancestry_private':True,'production_touched':False,
            'post_cleanup_published_file_count':len(outcomes),
            'faults_are_controlled_simulations':True,'microphone_hardware_verified':False,
            'distributed_redis_celery_verified':False}
        save_json(self.root/'acceptance-staged-drive-20261029.json',report)
        self.stdout.write('REAL STAGED DRIVE ACCEPTANCE PASSED');self.stdout.flush()

    def prepare_journal(self):
        from ...models import DepartmentChannel
        path=self.root/JOURNAL
        if path.exists():
            self.journal=json.loads(path.read_text(encoding='utf-8'))
            require(self.journal['version']==1 and self.journal['folder']==FOLDER and
                self.journal['accounts']==[str(row.pk) for row in self.accounts],'registro pertenece a otro ensayo')
        else:
            cases=[]
            scopes=['chat','thread','channel','chat','thread','chat','channel','chat','thread','chat']
            for index,(label,name,mime,content) in enumerate(synthetic_samples()):
                cases.append({'label':label,'name':name,'mime':mime,'content':base64.b64encode(content).decode('ascii'),
                    'client_id':str(uuid.uuid4()),'scope':scopes[index],'author':index%2})
            self.journal={'version':1,'run_id':uuid.uuid4().hex,'folder':FOLDER,
                'accounts':[str(row.pk) for row in self.accounts],'cases':cases,'cancel_nonce':str(uuid.uuid4()),
                'parent_nonce':str(uuid.uuid4())}
            self.write_journal()
        if 'conversation' not in self.journal:
            response=self.checked_response(self.clients[0].post(BASE+'/api/v2/messaging/conversations/',
                json={'employee_id':str(self.accounts[1].employee_id)},timeout=20),{200,201},'abrir Chat')
            self.journal['conversation']=response.json()['id'];self.write_journal()
        if 'channel' not in self.journal:
            name='Aceptación archivos '+self.journal['run_id'][:8]
            existing=DepartmentChannel.objects.filter(name=name,creator_id=self.identities[0]['assignment']).first()
            if existing:self.journal['channel']=str(existing.pk)
            else:
                response=self.checked_response(self.clients[0].post(BASE+'/api/v2/messaging/channels/',json={
                    'name':name,'unit_id':'11111111-2222-4333-8444-555555555551','visibility':'public'},timeout=20),{201},'crear canal de pruebas')
                self.journal['channel']=response.json()['id']
            self.write_journal()
        if 'parent' not in self.journal:
            response=self.checked_response(self.clients[0].post(self.scope_url('channel')+'messages/',json={
                'body':'Hilo sintético de aceptación de archivos.','client_id':self.journal['parent_nonce']},timeout=20),{200,201},'crear raíz de hilo')
            self.journal['parent']=response.json()['message']['id'];self.write_journal()

    def scope_url(self,scope):
        return BASE+'/api/v2/messaging/'+('conversations/'+self.journal['conversation'] if scope=='chat'
            else 'channels/'+self.journal['channel'])+'/'

    def case(self,index,case):
        from ...models import MediaUpload,DirectMessage,ChannelMessage
        from ...media import prepare
        from ...upload_outbox import perform
        from boldApp.workspace.service import GoogleUnavailable
        content=base64.b64decode(case['content'],validate=True)
        expected=prepare(SimpleUploadedFile(case['name'],content,content_type=case['mime']))
        author=case['author'];url=self.scope_url(case['scope']);nonce=str(uuid.UUID(case['client_id']))
        queued=self.checked_response(self.clients[author].post(url+'uploads/',data={'client_id':nonce},
            files={'file':(case['name'],content,case['mime'])},timeout=50),{200,202},case['label']+' reservar')
        row=MediaUpload.objects.get(pk=queued.json()['id'],root=self.storage,account=self.accounts[author])
        model=DirectMessage if case['scope']=='chat' else ChannelMessage
        where={'conversation_id':self.journal['conversation']} if case['scope']=='chat' else {'channel_id':self.journal['channel']}
        if queued.status_code==202:
            require(row.state=='queued' and not row.drive_id and not model.objects.filter(**where,
                author_id=self.accounts[author].employee_id,client_id=nonce).exists(),'la reserva publicó antes del trabajador')
        self.checked_response(self.clients[1-author].get(url+'uploads/'+str(row.pk)+'/',timeout=15),{404},'preparación privada')
        if row.state not in ('ready','attached'):
            real=self.google
            def fault(user,method,path,**kwargs):
                require(not database.in_atomic_block,'petición externa bajo transacción')
                result=real(user,method,path,**kwargs)
                if method=='POST' and path=='/files' and kwargs.get('files') and index in (0,1) and not case.get('fault_injected'):
                    case['fault_injected']=True;self.write_journal()
                    if index==0:raise InjectedWorkerInterruption()
                    raise GoogleUnavailable()
                return result
            try:
                with patch('boldApp.mensajeria.upload_provider.google',side_effect=fault):perform(row.pk)
            except InjectedWorkerInterruption:
                row.refresh_from_db();require(row.state=='uploading' and bool(row.drive_id),'interrupción no retuvo la reserva remota')
                # Controlled test clock/lease expiry, not an unplanned real outage.
                MediaUpload.objects.filter(pk=row.pk).update(lease_until=timezone.now()-timedelta(seconds=1))
                case['expired_lease_simulated']=True;self.write_journal()
                perform(row.pk)
            row.refresh_from_db()
        require(row.state in ('ready','attached'),case['label']+' trabajador '+row.state+'/'+row.error_code)
        remote_id=row.drive_id;attempts=row.attempts
        # Fresh actual HTTP sessions imitate resuming after connection loss.
        if index==0:self.clients=self.login()
        lookup=self.checked_response(self.clients[author].get(url+'uploads/',params={'client_id':nonce},timeout=20),{200},'recuperación por nonce')
        require(lookup.json()['results'][0]['id']==str(row.pk),'se perdió la reserva al reconectar')
        duplicate=self.checked_response(self.clients[author].post(url+'uploads/',data={'client_id':nonce},
            files={'file':(case['name'],content,case['mime'])},timeout=50),{200},'reserva idempotente')
        require(duplicate.json()['id']==str(row.pk),'reserva duplicada')
        data={'client_id':nonce,'body':'Aceptación sintética '+case['label'],'upload_id':str(row.pk)}
        if case['scope']=='thread':data['parent_id']=self.journal['parent']
        sent=self.checked_response(self.clients[author].post(url+'messages/',json=data,timeout=20),{200,201},'publicación '+case['label'])
        message=sent.json()['message'];case['message_id']=message['id'];self.write_journal()
        replay=self.checked_response(self.clients[author].post(url+'messages/',json=data,timeout=20),{200},'publicación idempotente')
        require(replay.json()['message']['id']==message['id'] and model.objects.filter(**where,
            author_id=self.accounts[author].employee_id,client_id=nonce).count()==1,'mensaje duplicado')
        row.refresh_from_db();require(row.drive_id==remote_id and row.attempts==attempts,'reintento repitió subida')
        media=url+'messages/'+message['id']+'/media/'
        received=self.checked_response(self.clients[1-author].get(media,timeout=50),{200},'descarga del compañero')
        require(received.content==expected['content'] and hashlib.sha256(received.content).hexdigest()==row.digest,
            'bytes descargados distintos')
        require(received.headers['Content-Type'].split(';')[0]==expected['mime_type'] and
            'no-store' in received.headers.get('Cache-Control','') and received.headers.get('X-Content-Type-Options')=='nosniff'
            and 'sandbox' in received.headers.get('Content-Security-Policy',''),'cabeceras privadas de descarga')
        if expected['kind']=='document':require(received.headers['Content-Disposition'].startswith('attachment;'),'documento no se descarga como adjunto')
        self.checked_response(requests.get(media,timeout=15),{401},'descarga anónima')
        require(remote_id not in json.dumps(message) and FOLDER not in json.dumps(message),'identificadores Google expuestos')
        actual=self.google(self.owner,'GET','/files/'+remote_id,params={'fields':'id,parents,trashed,size,sha256Checksum','supportsAllDrives':'true'})
        require(not actual.get('trashed') and actual['parents']==[row.folder_id] and
            str(actual.get('size'))==str(row.size_bytes) and actual.get('sha256Checksum')==row.digest,'metadatos remotos distintos')
        self.private_acl(remote_id)
        found=self.google(self.owner,'GET','/files',params={'q':f"'{row.folder_id}' in parents and trashed=false and appProperties has {{ key='bold_media_upload' and value='{row.pk}' }}",
            'fields':'nextPageToken,files(id)','supportsAllDrives':'true','includeItemsFromAllDrives':'true'})
        require(not found.get('nextPageToken') and found['files']==[{'id':remote_id}],'archivo remoto duplicado')
        library=self.checked_response(self.clients[1-author].get(url+'library/',params={'kind':'file'},timeout=20),{200},'biblioteca de archivos')
        require(message['id'] in [item['source_id'] for item in library.json()['results']],'archivo ausente en biblioteca')
        outcome={'kind':case['label'],'scope':case['scope'],'worker_attempts':row.attempts,'upload_idempotent':True,
            'message_idempotent':True,'peer_download':200,'anonymous':401,'private_acl':True,'sha256':row.digest,
            'controlled_worker_interruption':bool(case.get('expired_lease_simulated')),
            'controlled_lost_response':index==1 and bool(case.get('fault_injected'))}
        self.stdout.write(json.dumps(outcome));self.stdout.flush()
        return outcome

    def cancel_case(self):
        from ...models import MediaUpload,DirectMessage
        from ...upload_outbox import perform
        from ...upload_cleanup import reconcile
        url=self.scope_url('chat');nonce=self.journal['cancel_nonce']
        response=self.checked_response(self.clients[0].post(url+'uploads/',data={'client_id':nonce},files={
            'file':('staging-cancel.txt',b'Only this synthetic preparation is cancelled.','text/plain')},timeout=40),{200,202},'reservar cancelación')
        row=MediaUpload.objects.get(pk=response.json()['id'],root=self.storage,account=self.accounts[0])
        if row.state not in ('ready','cancelled'):
            perform(row.pk);row.refresh_from_db()
        require(row.state in ('ready','cancelled') and bool(row.drive_id),'preparación de cancelación no lista')
        response=self.checked_response(self.clients[0].post(url+'uploads/discard/',json={'client_id':nonce},timeout=20),{200},'descartar preparación')
        require(response.json()['outcome']=='cancelled','descarte no confirmado')
        row.refresh_from_db()
        if not row.cleaned_at:require(reconcile(row.pk),'conciliación no confirmada')
        row.refresh_from_db()
        remote=self.google(self.owner,'GET','/files/'+row.drive_id,params={'fields':'trashed','supportsAllDrives':'true'})
        require(remote.get('trashed') is True and row.cleaned_at and row.cipher_bytes==0 and not row.message_id and
            not DirectMessage.objects.filter(conversation_id=self.journal['conversation'],author=self.accounts[0].employee,client_id=nonce).exists(),
            'cancelación publicó un mensaje o no movió el archivo de prueba a Papelera')
        return True

    def revoke_case(self):
        from ...models import ChannelAccessRule,DepartmentChannel
        case=next(value for value in self.journal['cases'] if value['scope']!='chat')
        url=self.scope_url('channel')+'messages/'+case['message_id']+'/media/'
        channel=DepartmentChannel.objects.get(pk=self.journal['channel'])
        require(not ChannelAccessRule.objects.filter(channel=channel,employee=self.accounts[1].employee).exists(),'existe otra regla de acceso de pruebas')
        rule=ChannelAccessRule.objects.create(channel=channel,employee=self.accounts[1].employee,access='blocked')
        try:
            result=self.clients[1].get(url,timeout=20)
            require(result.status_code==404,'la descarga sigue disponible tras revocar el acceso')
        finally:rule.delete()
        self.checked_response(self.clients[1].get(url,timeout=50),{200},'restaurar acceso de pruebas')
        return 404

    def check_folders(self):
        from boldApp.workspace.models import ImageStorageFolder
        folders={row.key:row for row in ImageStorageFolder.objects.filter(root=self.storage)}
        for key,row in folders.items():
            parent=folders[key.rsplit('/',1)[0]].drive_id if '/' in key else FOLDER
            value=self.google(self.owner,'GET','/files/'+row.drive_id,params={'fields':'parents,trashed','supportsAllDrives':'true'})
            require(value.get('parents')==[parent] and not value.get('trashed'),'carpeta fuera de la raíz aprobada')
            self.private_acl(row.drive_id)

    def check_published_files(self):
        from ...models import MediaUpload
        require(len(self.journal['cases'])==10,'número de muestras no esperado')
        for case in self.journal['cases']:
            row=MediaUpload.objects.get(root=self.storage,client_id=uuid.UUID(case['client_id']),
                account_id=uuid.UUID(self.journal['accounts'][case['author']]))
            require(row.state=='attached' and str(row.message_id)==case['message_id'],'publicación ausente tras conciliación')
            value=self.google(self.owner,'GET','/files/'+row.drive_id,params={'fields':'id,parents,trashed,size,sha256Checksum',
                'supportsAllDrives':'true'})
            require(value.get('id')==row.drive_id and value.get('parents')==[row.folder_id] and
                value.get('trashed') is False and str(value.get('size'))==str(row.size_bytes) and
                value.get('sha256Checksum')==row.digest,'un archivo publicado cambió tras la conciliación')
