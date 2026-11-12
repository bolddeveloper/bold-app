from uuid import uuid5
from rest_framework.exceptions import ValidationError
from boldApp.calendario.service import validate_event, google_event_data, public_event, event_path, google_request
from boldApp.calendario.views import _event_for_write


def events(job,args):
    """Read-only projection: unlike the calendar UI, never updates presence."""
    from datetime import datetime,timedelta
    from boldApp.calendario.models import CalendarDraft
    from boldApp.calendario.service import is_task_mirror
    from .access import validate_session
    if set(args)!={'start','end'}:raise ValidationError('Selecciona inicio y fin de la consulta Google.')
    try:
        start=datetime.fromisoformat(args['start'].replace('Z','+00:00'));end=datetime.fromisoformat(args['end'].replace('Z','+00:00'))
        if not start.tzinfo or not end.tzinfo or not start<end<=start+timedelta(days=93):raise ValueError()
    except (ValueError,TypeError,AttributeError):raise ValidationError('Consulta hasta 93 días con zona horaria.') from None
    drafts=set(CalendarDraft.objects.filter(owner=job.account).values_list('event_id',flat=True));page=None;items=[]
    for _ in range(30):
        validate_session(job.session,job.assignment)
        params={'timeMin':start.isoformat(),'timeMax':end.isoformat(),'singleEvents':'true','maxResults':250,'orderBy':'startTime'}
        if page:params['pageToken']=page
        result=google_request(job.account,'GET',event_path(),params=params)
        items.extend(public_event(row) for row in result.get('items',[]) if row.get('status')!='cancelled' and row.get('id') not in drafts and not is_task_mirror(row))
        page=result.get('nextPageToken')
        if not page:return {'events':items}
    raise ValidationError('Hay demasiadas reuniones. Acota el rango de consulta.')


def event_id(job, step):
    return uuid5(job.execution_id,step['id']).hex


def perform(job,step,args,target):
    from .access import require
    from .models import AssistantRequest
    from types import SimpleNamespace
    def authorize_write():
        require(SimpleNamespace(assignment=job.assignment,auth=job.session,user=job.account,META={}), 'assistant.request.execute')
        if AssistantRequest.objects.get(pk=job.pk).cancel_requested:raise ValidationError('Se cancelaron los pasos pendientes.')
    data=google_event_data(validate_event(args))
    if step['capability']=='google.create':
        if not all(data.get(key) for key in ('summary','start','end')):raise ValidationError('Título e intervalo son obligatorios.')
        data['id']=event_id(job,step)
        data['extendedProperties']={'private':{'boldAssistantOperation':str(job.execution_id)}}
        if data.pop('addMeet',False):
            data['conferenceData']={'createRequest':{'requestId':data['id'],'conferenceSolutionKey':{'type':'hangoutsMeet'}}}
        authorize_write()
        result=google_request(job.account,'POST',event_path(),params={'sendUpdates':'all','conferenceDataVersion':1},body=data)
    else:
        current=_event_for_write(job.account,target)
        expected=getattr(job,'_google_etags',{}).get(target) or next((source['etag'] for source in job._proposal.sources if source.get('google_id')==target),None)
        if not expected or current.get('etag')!=expected:raise ValidationError('El evento cambió; prepara una propuesta nueva.')
        if data.pop('removeMeet',False):data['conferenceData']=None
        if data.pop('addMeet',False):
            data['conferenceData']={'createRequest':{'requestId':event_id(job,step),'conferenceSolutionKey':{'type':'hangoutsMeet'}}}
        authorize_write()
        result=google_request(job.account,'PATCH',event_path(target),params={'sendUpdates':'all','conferenceDataVersion':1},body=data,extra_headers={'If-Match':expected})
    if not hasattr(job,'_google_etags'):job._google_etags={}
    job._google_etags[result['id']]=result.get('etag')
    return public_event(result)
