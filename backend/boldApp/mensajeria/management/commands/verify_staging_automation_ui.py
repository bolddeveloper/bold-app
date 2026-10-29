"""Verify browser-created synthetic rules through real HTTP, never production."""
import json
from django.core.management.base import BaseCommand,CommandError
from .prepare_staging_automations import check_automation_staging,CHANNEL,TASK
from .bootstrap_messaging_staging import checked_profile
from .verify_staged_messaging_drive import Command as DriveAcceptance,BASE,save_json


class Command(BaseCommand):
    help='Comprueba reglas creadas en navegador; --change-task mueve solo la tarea sintética al estado revisado.'

    def add_arguments(self,parser):
        parser.add_argument('--change-task',action='store_true')

    def handle(self,*args,**options):
        check_automation_staging();root=checked_profile()
        from boldApp.mensajeria.models import ChannelAutomation,AutomationRun
        from boldApp.tareas.models import Task
        def require(value,label):
            if not value:raise CommandError('Aceptación detenida: '+label)
        credentials=json.loads((root/'staging-accounts.json').read_text(encoding='utf-8'))
        require(credentials['local_only'] is True and credentials['url']==BASE,'cuentas no locales')
        helper=DriveAcceptance();helper.identities=credentials['accounts'];sam,beta=helper.login()
        path=BASE+'/api/v2/messaging/channels/'+CHANNEL+'/automations/'
        own=beta.get(path,timeout=20);other=sam.get(path,timeout=20)
        require(own.status_code==other.status_code==200,'lista de reglas')
        rules=own.json()['results'];require(len(rules)==3,'se esperaban tres reglas nativas')
        require(not other.json()['results'],'la otra cuenta ve reglas ajenas')
        require({row['kind'] for row in rules}=={'reminder','task_status','recurring_page'},'tipos incompletos')
        for row in rules:
            foreign=sam.get(path+row['id']+'/',timeout=20)
            require(foreign.status_code==404,'detalle ajeno visible')
        status=next(row for row in rules if row['kind']=='task_status')
        if options['change_task']:
            require(status['active'] is True,'regla de estado no activa')
            task=Task.objects.get(pk=TASK)
            if str(task.status_id)!=status['to_status_id']:
                moved=beta.patch(BASE+'/api/v2/tasks/'+TASK+'/',json={'status':status['to_status_id']},timeout=20)
                require(moved.status_code==200,'cambio de tarea HTTP '+str(moved.status_code))
            require(str(Task.objects.get(pk=TASK).status_id)==status['to_status_id'],'estado no persistido')
            self.stdout.write('Dos sesiones HTTP reales aisladas; tres reglas propias, detalles ajenos 404; tarea sintética en el estado revisado.');return
        outcomes=[]
        for row in rules:
            runs=beta.get(path+row['id']+'/runs/',timeout=20)
            require(runs.status_code==200,'historial propio')
            published=[run for run in runs.json()['results'] if run['state']=='published']
            require(len(published)==1,'se esperaba un resultado publicado por regla')
            run=AutomationRun.objects.get(pk=published[0]['id'])
            require(bool(run.page_id) if row['kind']=='recurring_page' else bool(run.message_id),'falta efecto durable')
            outcomes.append({'kind':row['kind'],'published_results':len(published),'durable_effect':True})
        report={'accepted':True,'environment':'persistent-local-postgresql','native_created_rules':3,
            'two_real_http_sessions':True,'foreign_rules_hidden':True,'real_clock_watch_worker':True,
            'redis_celery_beat_verified':False,'outcomes':outcomes,'production_changed':False}
        save_json(root/'automation-ui-acceptance.json',report)
        self.stdout.write(json.dumps(report,ensure_ascii=False))
