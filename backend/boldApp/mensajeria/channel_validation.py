"""Real HTTP/socket browser acceptance with fictitious accounts and a Drive double.

Run from backend: python -m boldApp.mensajeria.channel_validation
Always creates a NEW temp SQLite database. Never imports sessions/OAuth from the
developer's database. Drive operations are intercepted in-process, not transmitted.
This verifies integration, not the real Google provider or PostgreSQL concurrency.
"""
import io
import json
import os
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import uuid
from contextlib import ExitStack
from unittest.mock import patch

PASSWORD = "Synthetic-Channel-Only-2026!"


class LocalDrive:
    """Small strict Drive protocol double; no HTTP client or real credentials."""
    def __init__(self):
        self.files = {}

    def google(self, user, method, path, **options):
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
            identity = "validation_" + uuid.uuid4().hex
            self.files[identity] = {"metadata":metadata,"content":multipart["file"][1] if multipart else b""}
            return {"id":identity}
        if method == "GET" and path.startswith("/files/") and options.get("raw"):
            return SimpleNamespace(content=self.files[path.rsplit("/",1)[1]]["content"])
        raise RuntimeError(f"Unsupported isolated Drive operation: {method} {path}")


def seed():
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
    for index,(label,unit_name,color) in enumerate((("alfa","IT · Pruebas","#4760A8"),("beta","Diseño · Pruebas","#9250A3"))):
        unit=OrganizationalUnit.objects.create(id=settings.MESSAGING_PILOT_UNIT_IDS[index],name=unit_name,unit_type="department",sensitivity_level="low",color_hex=color)
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


def main():
    directory=Path(tempfile.mkdtemp(prefix="bold-channel-validation-"))
    os.environ["BOLD_CHANNEL_VALIDATION_DIR"]=str(directory)
    os.environ["DJANGO_SETTINGS_MODULE"]="config.settings_channel_validation"
    import django
    django.setup()
    identities,channel_id,storage_user=seed()
    drive=LocalDrive()
    with ExitStack() as stack:
        for path in ("boldApp.workspace.service.google","boldApp.workspace.image_storage.google","boldApp.mensajeria.channel_media.google","boldApp.mensajeria.media.google"):
            stack.enter_context(patch(path,drive.google))
        for path in ("boldApp.workspace.image_storage.storage_user","boldApp.mensajeria.channel_media.storage_user","boldApp.mensajeria.media.storage_user"):
            stack.enter_context(patch(path,storage_user))
        from django.core.management import call_command
        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image,ImageDraw
        picture=Image.new("RGB",(800,440),"#edf0f6");draw=ImageDraw.Draw(picture)
        draw.rounded_rectangle((55,55,745,385),radius=24,fill="#a81f42")
        draw.text((90,95),"BOLD / VALIDACION LOCAL",fill="white")
        draw.text((90,140),"Imagen sintetica - sin datos de la empresa",fill="white")
        content=io.BytesIO();picture.save(content,"PNG")
        result=identities[1][2].post(f"/api/v2/messaging/channels/{channel_id}/messages/",{"body":"Una referencia visual para revisar juntos.","client_id":str(uuid.uuid4()),
            "file":SimpleUploadedFile("referencia-local.png",content.getvalue(),content_type="image/png")},format="multipart")
        if result.status_code!=201:raise RuntimeError(str(result.data))
        print(f"Channel validation ready. Isolated database: {directory}",flush=True)
        print("Frontend: http://127.0.0.1:5192/ and http://localhost:5192/ (separate cookie hosts). Synthetic accounts only; Drive is simulated.",flush=True)
        call_command("runserver","127.0.0.1:8159",use_reloader=False,verbosity=0)


if __name__=="__main__":
    main()
