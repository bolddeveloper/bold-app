"""Add only named synthetic fixtures to the already-approved persistent staging."""
import uuid
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from .bootstrap_messaging_staging import checked_profile, CLIENT, PROJECT

CHANNEL='22222222-3333-4444-8555-666666666661'
TASK_PROJECT='22222222-3333-4444-8555-666666666662'
TASK='22222222-3333-4444-8555-666666666663'
TEMPLATE='22222222-3333-4444-8555-666666666664'


def check_automation_staging():
    checked_profile()
    from boldApp.core.models import UserAccount
    from boldApp.workspace.models import GoogleOAuthConfiguration
    if (not settings.MESSAGING_AUTOMATIONS_ENABLED or
            set(UserAccount.objects.values_list('email',flat=True))!={'samuel@bold.gt','slack.pruebas.beta@bold.gt'} or
            UserAccount.objects.filter(is_superuser=True).exists() or UserAccount.objects.filter(is_staff=True).exists() or
            not GoogleOAuthConfiguration.objects.filter(pk=1,project_id=PROJECT,client_id=CLIENT).exists()):
        raise CommandError('Solo se admite el staging autorizado de dos cuentas sintéticas, sin operadores privilegiados.')


class Command(BaseCommand):
    help='Prepara un canal, proyecto, tarea y plantilla sintéticos; no toca Google ni sustituye cambios existentes.'

    def handle(self,*args,**options):
        check_automation_staging()
        return self.prepare()

    @transaction.atomic
    def prepare(self):
        from boldApp.core.models import UserAccount,PositionAssignment,Permission,JobRolePermission
        from boldApp.tareas.models import Project,Task,TaskStatus,TaskProject,ProjectMember
        from boldApp.mensajeria.models import DepartmentChannel,PageTemplate
        sam=UserAccount.objects.get(email='samuel@bold.gt');beta=UserAccount.objects.get(email='slack.pruebas.beta@bold.gt')
        first=PositionAssignment.objects.select_related('position').get(employee=sam.employee,is_active=True,released_at__isnull=True)
        second=PositionAssignment.objects.select_related('position').get(employee=beta.employee,is_active=True,released_at__isnull=True)
        if first.position.job_role_id!=second.position.job_role_id or str(first.position.unit_id)!=settings.MESSAGING_PILOT_UNIT_IDS[0]:
            raise CommandError('Las asignaciones no corresponden a las identidades del ensayo.')
        for code in ('tasks.project.read','tasks.task.read','tasks.task.update'):
            row,_=JobRolePermission.objects.get_or_create(job_role_id=first.position.job_role_id,permission=Permission.objects.get(code=code),
                scope_type='global',defaults={'effect':'allow'})
            if row.effect!='allow':
                raise CommandError('Existe una restricción de prueba. No se sustituye para hacer pasar la aceptación.')
        channel,_=DepartmentChannel.objects.get_or_create(pk=CHANNEL,defaults={'name':'Automatizaciones · Pruebas locales',
            'description':'Canal sintético de aceptación. Sin datos de producción.','unit_id':first.position.unit_id,'creator':first,'visibility':'public'})
        if channel.creator_id!=first.pk or channel.archived_at or channel.name!='Automatizaciones · Pruebas locales':
            raise CommandError('El canal de prueba existente cambió; no se restablece sin revisión.')
        project,_=Project.objects.get_or_create(pk=TASK_PROJECT,defaults={'unit_id':first.position.unit_id,
            'owner_assignment':first,'created_by_assignment':first,'name':'Aceptación local de automatizaciones','status':'active'})
        if project.owner_assignment_id!=first.pk or project.name!='Aceptación local de automatizaciones' or project.is_archived:
            raise CommandError('El proyecto existente no coincide con el ensayo.')
        ProjectMember.objects.get_or_create(project=project,assignment=second,defaults={'member_role':'member','status':'active','added_by_assignment':first})
        initial=TaskStatus.objects.filter(unit_id=first.position.unit_id,category='todo').first()
        task,_=Task.objects.get_or_create(pk=TASK,defaults={'unit_id':first.position.unit_id,'created_by_assignment':first,
            'assignee_assignment':second,'title':'Tarea sintética sin información de producción','status':initial,'priority':'Media'})
        if task.created_by_assignment_id!=first.pk or task.title!='Tarea sintética sin información de producción':
            raise CommandError('La tarea existente no coincide con el ensayo.')
        TaskProject.objects.get_or_create(task=task,project=project,defaults={'position':1000,'added_by_assignment':first})
        PageTemplate.objects.get_or_create(pk=TEMPLATE,defaults={'channel':channel,'creator':sam.employee,'client_id':uuid.uuid4(),
            'creation_digest':'0'*64,'name':'Modelo de seguimiento sintético','title':'Seguimiento periódico de prueba','icon':'checklist',
            'blocks':[{'id':str(uuid.uuid4()),'type':'check','text':'Comprobar avance sintético','checked':False}]})
        self.stdout.write('Fixtures locales preparados sin reemplazar datos: canal, proyecto, tarea y plantilla sintéticos. Google no se utilizó.')
