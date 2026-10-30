from celery import shared_task
from .push import drain


@shared_task(ignore_result=True, soft_time_limit=45, time_limit=60)
def drain_web_push():
    return drain()
