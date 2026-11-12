from django.utils import timezone
from rest_framework.exceptions import ValidationError
from boldApp.calendario.service import google_request,event_path
from .access import require
from . import service
from .google import event_id


def reconcile(job,request):
    require(request)
    if job.state!='uncertain':return service.pack(job,request)
    proposal=service.current(job)
    for receipt in job.receipts.filter(state='uncertain'):
        step=next(s for s in proposal.steps if s['id']==receipt.step_id)
        if step['capability']!='google.create':continue
        # Lookup only. A 404 or unavailable provider is not authority to resend invitations.
        result=google_request(job.account,'GET',event_path(event_id(job,step)))
        if result.get('extendedProperties',{}).get('private',{}).get('boldAssistantOperation')==str(job.execution_id):
            receipt.state='completed';receipt.result={'id':result['id']};receipt.finished_at=timezone.now();receipt.save()
    if not job.receipts.filter(state='uncertain').exists():
        job.state='completed' if job.receipts.filter(state='completed').count()==len(proposal.steps) else 'partial'
        job.error='';job.finished_at=timezone.now();job.save();service.notify(job)
    return service.pack(job,request)
