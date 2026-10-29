"""Idempotent raw-file uploads using persisted Drive pre-generated IDs.

No sharing calls, no conversion, no provider request while a DB lock is held.
"""
import hashlib
import json
from django.db import transaction
from rest_framework.exceptions import APIException, NotFound, ValidationError
from boldApp.workspace.models import ImageStorageFolder
from boldApp.workspace.image_storage import storage_user
from boldApp.workspace.service import google, file_id, MIMES
from .models import MediaUpload, MediaUploadFolder
from .media import EXTENSIONS
from .upload_outbox import renew, StaleLease

FIELDS = 'id,mimeType,parents,appProperties,trashed,size,sha256Checksum,md5Checksum'


def call(row,user,method,path,**options):
    renew(row)
    return google(user,method,path,**options)


def generate(row,user):
    result=call(row,user,'GET','/files/generateIds',params={'count':1,'space':'drive','type':'files'})
    return file_id(result['ids'][0])


def metadata(row,user,identity):
    try:
        return call(row,user,'GET','/files/'+file_id(identity),params={'fields':FIELDS,'supportsAllDrives':'true'})
    except NotFound:
        return None


def matches(value,identity,parent,marker,mime):
    return bool(value and value.get('id')==identity and not value.get('trashed') and
        parent in value.get('parents',[]) and value.get('appProperties',{}).get(marker[0])==marker[1] and
        value.get('mimeType')==mime)


def create(row,user,identity,body,*,content=None):
    options={'params':{'fields':FIELDS,'supportsAllDrives':'true'}}
    if content is None:
        options['body']=body
    else:
        options['api']='upload'; options['params']['uploadType']='multipart'
        options['files']={'metadata':(None,json.dumps(body),'application/json'),
            'file':(body['name'],content,body['mimeType'])}
    try:
        call(row,user,'POST','/files',**options)
    except APIException:
        # A lost response/409 is not permission to generate a second ID. Verify
        # this same reserved object; if it is absent, preserve the original error.
        found=metadata(row,user,identity)
        if found is None:
            raise
        return found
    return metadata(row,user,identity)


def folder(row,user,path):
    parent=row.root.folder_id
    parts=[]
    for key,label in path:
        parts.append(key); key='/'.join(parts)
        cached=ImageStorageFolder.objects.filter(root=row.root,key=key).first()
        if cached:
            parent=cached.drive_id;continue
        reserved=MediaUploadFolder.objects.filter(root=row.root,key=key).first()
        if not reserved:
            generated=generate(row,user)
            with transaction.atomic():
                # Global quota mutex already exists by the time any upload runs.
                from .models import MediaUploadQuota
                MediaUploadQuota.objects.select_for_update().get(pk=1)
                reserved,_=MediaUploadFolder.objects.get_or_create(root=row.root,key=key,defaults={'drive_id':generated})
        identity=reserved.drive_id
        marker=('bold_folder',hashlib.sha256(f'{row.root_id}:{key}'.encode()).hexdigest())
        value=metadata(row,user,identity)
        if value is None:
            value=create(row,user,identity,{'id':identity,'name':label[:240],'mimeType':MIMES['folder'],
                'parents':[parent],'appProperties':dict([marker])})
        if not matches(value,identity,parent,marker,MIMES['folder']):
            raise ValidationError('La carpeta reservada de Drive cambió; requiere revisión.')
        ImageStorageFolder.objects.get_or_create(root=row.root,key=key,defaults={'drive_id':identity,'name':label[:240]})
        parent=identity
    return parent


def upload(row,content):
    user=storage_user(row.root)
    employee=row.assignment.employee_id
    if row.conversation_id:
        path=[('chat','Chat'),(f'employee:{employee}',f'Empleado · {employee}'),
            (f'conversation:{row.conversation_id}',f'Conversación · {row.conversation_id}')]
    else:
        group=(f'department:{row.channel.unit_id}',f'Departamento · {row.channel.unit_id}') if row.channel.unit_id else ('independent','Canales independientes')
        path=[('slack','Slack'),group,(f'channel:{row.channel_id}',f'Canal · {row.channel_id}'),
            (f'employee:{employee}',f'Empleado · {employee}')]
    destination=folder(row,user,path)
    if not row.drive_id:
        generated=generate(row,user)
        with transaction.atomic():
            saved=MediaUpload.objects.select_for_update().get(pk=row.pk)
            if saved.state!='uploading' or saved.lease_token!=row.lease_token:
                raise StaleLease()
            if not saved.drive_id:
                saved.drive_id=generated; saved.folder_id=destination
                saved.save(update_fields=['drive_id','folder_id'])
            row.drive_id=saved.drive_id;row.folder_id=saved.folder_id
    marker=('bold_media_upload',str(row.pk))
    value=metadata(row,user,row.drive_id)
    if value is None:
        name=f'{row.kind}-{row.pk}.{EXTENSIONS[row.mime_type]}'
        value=create(row,user,row.drive_id,{'id':row.drive_id,'name':name,'mimeType':row.mime_type,
            'parents':[row.folder_id],'appProperties':{marker[0]:marker[1],'bold_media_sha256':row.digest}},content=content)
    expected_md5=hashlib.md5(content,usedforsecurity=False).hexdigest()
    if (not matches(value,row.drive_id,row.folder_id,marker,row.mime_type) or
        str(value.get('size'))!=str(row.size_bytes) or
        (value.get('sha256Checksum')!=row.digest if value.get('sha256Checksum') else value.get('md5Checksum')!=expected_md5)):
        raise ValidationError('El archivo reservado de Drive no coincide con la subida.')
