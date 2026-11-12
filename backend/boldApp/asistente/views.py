from django.db import transaction
from django.db.models import Count, Sum, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from datetime import timedelta, datetime
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from boldApp.autenticacion.authentication import CookieSessionAuthentication
from boldApp.tareas.views import AssignmentScopedViewSetMixin
from boldApp.tareas.execution_validation import ObjectRequestMixin
from .access import require
from .models import AssistantRequest, InferenceAttempt
from . import service


class AssistantView(ObjectRequestMixin, AssignmentScopedViewSetMixin, APIView):
    # Deliberately excludes MCP and the internal executor authentication classes.
    authentication_classes=[CookieSessionAuthentication]

    def initial(self,request,*args,**kwargs):
        length=request.META.get('CONTENT_LENGTH','')
        if length.isdigit() and int(length)>256*1024:raise ValidationError('La propuesta supera 256 KB. Divide la petición.')
        super().initial(request,*args,**kwargs)

    def own(self,pk,lock=False):
        require(self.request)
        qs=AssistantRequest.objects.filter(account=self.request.user,assignment=self.request.assignment)
        if lock:qs=qs.select_for_update()
        return get_object_or_404(qs,pk=pk)


class RequestsView(AssistantView):
    def get(self,request):
        require(request)
        rows=AssistantRequest.objects.filter(account=request.user,assignment=request.assignment).order_by('-created_at')[:50]
        return Response({'results':[{'id':str(r.pk),'text':r.text,'state':r.state,'created_at':r.created_at} for r in rows]})

    def post(self,request):
        job=service.create(request,request.data)
        return Response(service.pack(service.load(job.pk),request),status=202)


class RequestView(AssistantView):
    def get(self,request,pk):
        job=self.own(pk)
        return Response(service.pack(service.load(job.pk),request))

    @transaction.atomic
    def patch(self,request,pk):
        job=service.change(request,self.own(pk,True),request.data)
        return Response(service.pack(service.load(job.pk),request),status=202)


class ActionView(AssistantView):
    @transaction.atomic
    def post(self,request,pk,action):
        job=self.own(pk,True)
        if action=='simulate':
            from .simulation import simulate
            return Response(simulate(service.load(job.pk),request))
        if action=='reconcile':
            from .reconcile import reconcile
            return Response(reconcile(service.load(job.pk),request))
        function={'prepare':service.prepare,'execute':service.execute,'cancel':service.cancel}.get(action)
        if not function:raise ValidationError('Acción no admitida.')
        job=function(request,job,request.data)
        return Response(service.pack(service.load(job.pk),request),status=202)


class ActivityView(AssistantView):
    def get(self,request):
        require(request)
        now=timezone.now();scope=request.query_params.get('scope','self')
        try:
            days=int(request.query_params.get('days','7'))
            if not 1<=days<=93:raise ValueError()
        except (ValueError,TypeError):raise ValidationError('Selecciona entre uno y 93 días.') from None
        rows=AssistantRequest.objects.filter(created_at__gte=now-timedelta(days=days))
        if scope=='self':rows=rows.filter(account=request.user)
        elif scope=='team':
            units=self.allowed_unit_ids('assistant.usage.read')
            if not units:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('No tienes autorización para consultar la actividad de otro equipo.')
            rows=rows.filter(assignment__position__unit_id__in=units)
        else:raise ValidationError('Alcance inválido.')
        ids=rows.values('pk')
        attempts=InferenceAttempt.objects.filter(request_id__in=ids)
        usage=attempts.aggregate(input_tokens=Sum('input_tokens'),cached_input_tokens=Sum('cached_input_tokens'),output_tokens=Sum('output_tokens'))
        durations=[(row.finished_at-row.created_at).total_seconds() for row in rows.only('created_at','finished_at') if row.finished_at]
        waits=[a.wait_seconds for a in attempts if a.wait_seconds is not None]
        inference_times=[(a.finished_at-a.created_at).total_seconds() for a in attempts if a.finished_at]
        return Response({'scope':scope,'days':days,'requests':rows.count(),
            'states':list(rows.values('state').annotate(count=Count('id')).order_by('state')),
            'approved':rows.filter(proposals__approved_at__isnull=False).distinct().count(),
            'actions':list(__import__('boldApp.asistente.models',fromlist=['ActionReceipt']).ActionReceipt.objects.filter(request_id__in=ids).values('state').annotate(count=Count('id')).order_by('state')),
            'inferences':attempts.count(),'usage':usage,'unknown_usage':attempts.filter(input_tokens__isnull=True).count(),
            'mean_elapsed_seconds':sum(durations)/len(durations) if durations else None,
            'mean_wait_seconds':sum(waits)/len(waits) if waits else None,
            'mean_inference_seconds':sum(inference_times)/len(inference_times) if inference_times else None,
            'note':'Actividad del asistente; no mide productividad, horas ahorradas ni saldo de créditos.'})


class EvidenceView(AssistantView):
    def get(self,request,pk,index):
        from .dispatch import call
        job=service.load(self.own(pk).pk);proposal=service.current(job)
        if not proposal or not 0<=index<len(proposal.sources):raise ValidationError('Fuente no disponible.')
        source=proposal.sources[index]['query']
        if source['capability']!='reports.query':raise ValidationError('Esta fuente no es un informe calculado.')
        job.session=request.auth
        return Response(call(job,'POST','/api/v2/reports/preview/',{'definition':source['arguments'],
            'group_key':request.query_params.get('group'), 'offset':0}))


class RecordView(AssistantView):
    def get(self,request,pk,step_id):
        from .capabilities import read
        from .dispatch import call
        job=service.load(self.own(pk).pk);proposal=service.current(job)
        receipt=get_object_or_404(job.receipts,proposal=proposal,step_id=step_id,state='completed')
        step=next(s for s in proposal.steps if s['id']==step_id)
        job.session=request.auth
        cap=step['capability'];result=receipt.result
        if cap.startswith(('tasks.','execution.')):
            key=result.get('task') or result.get('task_id') if cap in {'tasks.organize','execution.define','execution.advance'} else result.get('id')
            query={'capability':'tasks.get','arguments':{'id':str(key)}}
        elif cap.startswith('projects.'):
            query={'capability':'projects.get','arguments':{'id':str(result['id'])}}
        elif cap.startswith('events.'):
            query={'capability':'events.get','arguments':{'calendar':step['target'].split(':')[0],'id':str(result['id'])}}
        elif cap.startswith('google.'):
            query={'capability':'google.event','arguments':{'id':str(result['id'])}}
        else:
            query={'capability':'reports.get','arguments':{'id':str(result['id'])}}
        record=read(job,query)
        response={'capability':cap,'record':record}
        if cap=='reports.save':response['report']=call(job,'POST','/api/v2/reports/preview/',{'id':record['id']})
        require(request)
        return Response(response)
