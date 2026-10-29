"""Real HTTP/socket browser acceptance with fictitious accounts and a Drive double.

Run from backend: python -m boldApp.mensajeria.channel_validation
Always creates a NEW temp SQLite database. Never imports sessions/OAuth from the
developer's database. Drive operations are intercepted in-process, not transmitted.
This verifies integration, not the real Google provider or PostgreSQL concurrency.
"""
import io
import hashlib
import argparse
import json
import os
from pathlib import Path
import re
import tempfile
import time
from threading import Event,Thread
from types import SimpleNamespace
import uuid
from contextlib import ExitStack
from unittest.mock import patch

PASSWORD = "Synthetic-Channel-Only-2026!"


class LocalDrive:
    """Small strict Drive protocol double; no HTTP client or real credentials."""
    def __init__(self,upload_delay=0):
        self.files = {}
        self.upload_delay=upload_delay

    def google(self, user, method, path, **options):
        if method=='GET' and path=='/files/generateIds':
            return {'ids':['validation_'+uuid.uuid4().hex]}
        if method == "GET" and path == "/files":
            query = options.get("params", {}).get("q", "")
            parent = re.search(r"'([^']+)' in parents", query)
            marker = re.search(r"key='([^']+)' and value='([^']+)'", query)
            if not parent or not marker:
                raise RuntimeError("Unexpected validation Drive listing")
            return {"files": [{"id":key} for key,row in self.files.items() if parent[1] in row["metadata"].get("parents", [])
                and row["metadata"].get("appProperties", {}).get(marker[1]) == marker[2]]}
        if method == "POST" and path == "/files":
            multipart = options.get("files")
            metadata = json.loads(multipart["metadata"][1]) if multipart else options["body"]
            if "permissions" in metadata:
                raise RuntimeError("Validation never creates sharing permissions")
            if multipart and metadata.get('appProperties',{}).get('bold_media_upload'):
                time.sleep(self.upload_delay)  # Isolated fault simulation, never production.
            identity = metadata.get('id') or "validation_" + uuid.uuid4().hex
            if identity in self.files:
                from rest_framework.exceptions import ValidationError
                raise ValidationError('Synthetic duplicate reserved ID')
            content=multipart["file"][1] if multipart else b""
            metadata={**metadata,'id':identity,'size':str(len(content)),'sha256Checksum':hashlib.sha256(content).hexdigest(),'trashed':False}
            self.files[identity] = {"metadata":metadata,"content":content}
            return metadata.copy()
        if path.startswith('/files/') and method in ('GET','PATCH'):
            from rest_framework.exceptions import NotFound
            row=self.files.get(path.rsplit('/',1)[1])
            if row is None:raise NotFound('Synthetic file missing')
            if method=='PATCH':row['metadata'].update(options['body']);return row['metadata'].copy()
            return SimpleNamespace(content=row['content']) if options.get('raw') else row['metadata'].copy()
        raise RuntimeError(f"Unsupported isolated Drive operation: {method} {path}")


def seed(forward_fixtures=False):
    from django.conf import settings
    from django.core.management import call_command
    from django.core.files.uploadedfile import SimpleUploadedFile
    from rest_framework.test import APIClient
    from boldApp.core.models import Employee, UserAccount, JobRole, OrganizationalUnit, Position, PositionAssignment, Permission, JobRolePermission
    from boldApp.tareas.models import Task, TaskStatus, TaskFollower
    from boldApp.workspace.models import ImageStorageRoot
    call_command("migrate",interactive=False,verbosity=0)
    role=JobRole.objects.create(title="Validación local de canales")
    for code in ("tasks.task.read","tasks.project.read"):
        permission=Permission.objects.get(code=code)
        JobRolePermission.objects.create(job_role=role,permission=permission,effect="allow",scope_type="own_unit")
    identities=[]
    labels=[("alfa","IT · Pruebas","#4760A8"),("beta","Diseño · Pruebas","#9250A3")]
    if forward_fixtures:labels.append(('gamma','IT · Pruebas','#4760A8'))
    for index,(label,unit_name,color) in enumerate(labels):
        unit=identities[0][1].position.unit if label=='gamma' else OrganizationalUnit.objects.create(id=settings.MESSAGING_PILOT_UNIT_IDS[index],name=unit_name,unit_type="department",sensitivity_level="low",color_hex=color)
        employee=Employee.objects.create(full_name=f"Prueba de canales {label.title()}")
        account=UserAccount.objects.create_user(email=f"canal.validacion.{label}@bold.gt",employee=employee,password=PASSWORD,
            notification_settings={"enabled":False,"desktop_enabled":False})
        assignment=PositionAssignment.objects.create(employee=employee,position=Position.objects.create(unit=unit,job_role=role))
        client=APIClient(enforce_csrf_checks=True)
        csrf=client.get("/api/v2/auth/session/").data["csrf_token"]
        result=client.post("/api/v2/auth/login/",{"email":account.email,"password":PASSWORD},format="json",HTTP_X_CSRFTOKEN=csrf)
        if result.status_code!=200 or not result.data.get("authenticated"):
            raise RuntimeError("Synthetic login failed")
        csrf=client.get("/api/v2/auth/session/").data["csrf_token"]
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk),HTTP_X_CSRFTOKEN=csrf)
        identities.append((account,assignment,client))
    root=ImageStorageRoot.objects.create(user=identities[0][0],subject="channel-validation",client_id="channel-validation",google_email="drive@example.invalid",
        folder_id="validation_root",folder_name="BOLD APP (simulado)",active=True)
    def storage_user(value):
        if value.pk!=root.pk or value.subject!="channel-validation":
            raise RuntimeError("Refusing non-validation storage")
        return value.user
    alfa,beta=identities[0][2],identities[1][2]
    channel=alfa.post("/api/v2/messaging/channels/",{"unit_id":settings.MESSAGING_PILOT_UNIT_IDS[0],"name":"coordinación","description":"Entorno local con dos cuentas ficticias. Drive simulado; sin acceso a producción."},format="json")
    if channel.status_code!=201:raise RuntimeError(str(channel.data))
    channel_id=channel.data["id"];url=f"/api/v2/messaging/channels/{channel_id}/"
    beta.put(url+"following/",{"following":True},format="json")
    def send(client,body,**extra):
        result=client.post(url+"messages/",{"body":body,"client_id":str(uuid.uuid4()),**extra},format="json")
        if result.status_code!=201:raise RuntimeError(str(result.data))
        return result.data["message"]
    first=send(alfa,"Bienvenidos al canal. Aquí compartimos avances, tareas y contexto del equipo.")
    send(beta,"Revisé el material. Podemos coordinar la siguiente entrega aquí: https://example.com/guia-del-proyecto")
    send(beta,"Incluyamos los pendientes en este hilo para conservar el contexto.",parent_id=first["id"])
    status=TaskStatus.objects.create(unit=identities[0][1].position.unit,name="En revisión",category="todo",position=1)
    task=Task.objects.create(unit=status.unit,title="Revisar la propuesta compartida del equipo",status=status,created_by_assignment=identities[0][1])
    TaskFollower.objects.create(task=task,assignment=identities[1][1],notification_level="all",added_by_assignment=identities[0][1])
    send(alfa,"Esta es la tarea que estamos coordinando.",task_id=str(task.pk))
    return identities,channel_id,storage_user


def seed_history(identities, channel_id):
    """Opt-in historical fixtures, confined to this brand-new disposable DB."""
    from datetime import timedelta
    from django.utils import timezone
    from boldApp.mensajeria.models import ChannelMessage, DepartmentChannel, DirectConversation, DirectMessage
    channel = DepartmentChannel.objects.get(pk=channel_id)
    assignment = identities[0][1]
    sequence = channel.messages.order_by("-sequence").values_list("sequence", flat=True).first() or 0
    for index in range(76):
        sequence += 1
        message = ChannelMessage.objects.create(channel=channel, author_assignment=assignment, author=assignment.employee,
            department_name=assignment.position.unit.name, department_color="#4760A8", client_id=uuid.uuid4(),
            payload_digest="isolated-history-fixture", sequence=sequence,
            body="Acuerdo histórico Aurora: el resultado antiguo conserva su contexto." if index == 0 else f"Avance reciente de validación {index}.")
        if index == 0:
            message.created_at = timezone.now() - timedelta(days=35)
            message.save(update_fields=["created_at"])
    channel.activity_version += 76
    channel.save(update_fields=["activity_version"])
    first, second = sorted([identities[0][1].employee_id, identities[1][1].employee_id])
    conversation = DirectConversation.objects.create(first_employee_id=first, second_employee_id=second)
    for index in range(25):
        message = DirectMessage.objects.create(conversation=conversation, author=assignment.employee, client_id=uuid.uuid4(),
            body=f"Bitácora histórica de pruebas {index+1:02d}: conservar la paginación.")
        message.created_at = timezone.now() - timedelta(days=20, minutes=25-index)
        message.save(update_fields=["created_at"])
    alfa = identities[0][2]
    blocks = [{"id":str(uuid.uuid4()), "type":"paragraph", "text":f"Paso de comprobación {index+1}."} for index in range(30)]
    blocks.append({"id":str(uuid.uuid4()), "type":"paragraph", "text":"Aurora: bloque exacto situado al final del documento de prueba."})
    page = alfa.post(f"/api/v2/messaging/channels/{channel_id}/pages/", {"client_id":str(uuid.uuid4()),
        "title":"Guía de validación histórica", "icon":"book", "blocks":blocks}, format="json")
    if page.status_code != 201:
        raise RuntimeError("Historical page fixture failed")
    private = alfa.post("/api/v2/messaging/channels/", {"name":"reserva interna", "visibility":"private"}, format="json")
    if private.status_code != 201:
        raise RuntimeError("Private history fixture failed")
    result = alfa.post(f"/api/v2/messaging/channels/{private.data['id']}/messages/", {"client_id":str(uuid.uuid4()),
        "body":"Reservadodelta: contenido de prueba solo para Alfa."}, format="json")
    if result.status_code != 201:
        raise RuntimeError("Private history message fixture failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upload-delay',type=int,choices=range(31),default=0,help='Simulated upload latency, 0–30 seconds; no real provider')
    parser.add_argument("--history-fixtures", action="store_true", help="Seed old messages, a long page and a private channel in the new isolated DB")
    parser.add_argument("--attention-fixtures", action="store_true", help="Enable internal notices after seeding; no desktop/audio and no automatic channel follows")
    parser.add_argument("--task-conversion-fixtures", action="store_true", help="Create two synthetic projects and own-unit Task create/manage grants in this new disposable database")
    parser.add_argument('--forward-fixtures',action='store_true',help='Add fictitious Gamma and a source Chat/image for local forward recovery; no Google or production')
    options = parser.parse_args()
    directory=Path(tempfile.mkdtemp(prefix="bold-channel-validation-"))
    os.environ["BOLD_CHANNEL_VALIDATION_DIR"]=str(directory)
    os.environ["DJANGO_SETTINGS_MODULE"]="config.settings_channel_validation"
    import django
    django.setup()
    identities,channel_id,storage_user=seed(options.forward_fixtures)
    if options.task_conversion_fixtures:
        from boldApp.core.models import Permission, JobRolePermission
        from boldApp.tareas.models import Project, Section
        for code in ("tasks.task.create", "tasks.project.manage"):
            JobRolePermission.objects.get_or_create(job_role=identities[0][1].position.job_role,
                permission=Permission.objects.get(code=code),scope_type="own_unit",defaults={"effect":"allow"})
        for _, assignment, _ in identities:
            project=Project.objects.create(unit=assignment.position.unit,owner_assignment=assignment,
                created_by_assignment=assignment,name="Proyecto de validación " + assignment.employee.full_name.split()[-1],status="active",unsectioned_hidden=True)
            Section.objects.create(project=project,name="Pendientes de revisión",position=1)
            Section.objects.create(project=project,name="Trabajo en curso",position=2)
    drive=LocalDrive()
    with ExitStack() as stack:
        for path in ("boldApp.workspace.service.google","boldApp.workspace.image_storage.google","boldApp.mensajeria.channel_media.google","boldApp.mensajeria.media.google","boldApp.mensajeria.upload_provider.google","boldApp.mensajeria.upload_cleanup.google"):
            stack.enter_context(patch(path,drive.google))
        for path in ("boldApp.workspace.image_storage.storage_user","boldApp.mensajeria.channel_media.storage_user","boldApp.mensajeria.media.storage_user","boldApp.mensajeria.upload_provider.storage_user","boldApp.mensajeria.upload_cleanup.storage_user"):
            stack.enter_context(patch(path,storage_user))
        from django.core.management import call_command
        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image,ImageDraw
        picture=Image.new("RGB",(800,440),"#edf0f6");draw=ImageDraw.Draw(picture)
        draw.rounded_rectangle((55,55,745,385),radius=24,fill="#a81f42")
        draw.text((90,95),"BOLD / VALIDACION LOCAL",fill="white")
        draw.text((90,140),"Imagen sintetica - sin datos de la empresa",fill="white")
        content=io.BytesIO();picture.save(content,"PNG")
        from .upload_outbox import perform
        base=f'/api/v2/messaging/channels/{channel_id}/';nonce=str(uuid.uuid4())
        queued=identities[1][2].post(base+'uploads/',{'client_id':nonce,
            'file':SimpleUploadedFile('referencia-local.png',content.getvalue(),content_type='image/png')},format='multipart')
        if queued.status_code!=202:raise RuntimeError(str(queued.data))
        if not perform(queued.data['id']):raise RuntimeError('Synthetic seed upload did not become ready')
        result=identities[1][2].post(base+'messages/',{'body':'Una referencia visual para revisar juntos.',
            'client_id':nonce,'upload_id':queued.data['id']},format='json')
        if result.status_code!=201:raise RuntimeError(str(result.data))
        if options.history_fixtures:
            seed_history(identities, channel_id)
        if options.forward_fixtures:
            source=identities[0][2].post('/api/v2/messaging/conversations/',{'employee_id':str(identities[1][1].employee_id)},format='json')
            if source.status_code not in (200,201):raise RuntimeError('Synthetic source Chat failed')
            direct=f"/api/v2/messaging/conversations/{source.data['id']}/"
            for body in ('Reenvío local: primero el texto.','Reenvío local: conservar el orden y la revisión.'):
                result=identities[1][2].post(direct+'messages/',{'client_id':str(uuid.uuid4()),'body':body},format='json')
                if result.status_code!=201:raise RuntimeError('Synthetic text seed failed')
            nonce=str(uuid.uuid4())
            queued=identities[1][2].post(direct+'uploads/',{'client_id':nonce,'file':SimpleUploadedFile('imagen-reenvio-local.png',content.getvalue(),content_type='image/png')},format='multipart')
            if queued.status_code!=202 or not perform(queued.data['id']):raise RuntimeError('Synthetic forward upload failed')
            result=identities[1][2].post(direct+'messages/',{'client_id':nonce,'upload_id':queued.data['id'],'body':'Reenvío local: imagen sintética.'},format='json')
            if result.status_code!=201:raise RuntimeError('Synthetic forward image seed failed')
        if options.attention_fixtures:
            from django.db.models import F
            from django.utils import timezone
            from boldApp.autenticacion.notification_settings import EVENT_TYPES
            from boldApp.notificaciones.models import Notification
            from .models import ChannelSubscription
            for account, _, _ in identities:
                account.notification_settings = {"enabled": True, "desktop_enabled": False, "volume": 0,
                    "events": {event: event in ("slack.message_created", "slack.mentioned", "messaging.message_created") for event in EVENT_TYPES}}
                account.save(update_fields=["notification_settings"])
            ChannelSubscription.objects.filter(channel_id=channel_id).update(following=False, revision=F("revision") + 1)
            Notification.objects.filter(recipient_assignment__employee_id__in=[assignment.employee_id for _, assignment, _ in identities],
                is_read=False).update(is_read=True, read_at=timezone.now())
        # An independent in-process worker wakes on commit. It shares only this
        # strict fake provider; no eager HTTP upload and no new Redis service.
        drive.upload_delay=options.upload_delay
        wake,stop=Event(),Event()
        stack.enter_context(patch('boldApp.mensajeria.upload_outbox.wake',wake.set))
        def worker():
            from django.db import close_old_connections,connections
            from .upload_tasks import drain_media_uploads
            while not stop.is_set():
                wake.wait(60);wake.clear()
                if stop.is_set():break
                close_old_connections()
                try:drain_media_uploads.run()
                except Exception as exc:print('Synthetic upload worker stopped batch: '+type(exc).__name__,flush=True)
                finally:connections.close_all()
        thread=Thread(target=worker,daemon=True,name='bold-synthetic-upload-worker');thread.start()
        print(f"Channel validation ready. Isolated database: {directory}",flush=True)
        print("Frontend: http://127.0.0.1:5192/ and http://localhost:5192/ (separate cookie hosts). Synthetic accounts only; Drive is simulated.",flush=True)
        try:call_command("runserver","127.0.0.1:8159",use_reloader=False,verbosity=0)
        finally:stop.set();wake.set();thread.join(timeout=45)


if __name__=="__main__":
    main()
