"""Use the existing Celery worker; never inline/eager provider calls in HTTP."""
from celery import shared_task
from django.db.models import Q
from django.utils import timezone
from .models import MediaUpload
from .upload_outbox import perform, expire_pending


@shared_task(ignore_result=True)
def drain_media_uploads():
    expire_pending()
    from .upload_cleanup import reconcile_pending
    cleaned=reconcile_pending()
    now=timezone.now()
    ids=list(MediaUpload.objects.filter(state__in=['queued','retry','uploading'],next_at__lte=now,expires_at__gt=now)
        .filter(Q(lease_until__isnull=True)|Q(lease_until__lte=now)).order_by('next_at','created_at','pk')
        .values_list('pk',flat=True)[:4])
    result={'examined':len(ids),'ready':sum(bool(perform(identity)) for identity in ids),'cleaned':cleaned}
    result['cleanup_review']=MediaUpload.objects.filter(state__in=['cancelled','expired'],cleaned_at__isnull=True,
        cleanup_attempts__gte=6).count()
    return result
