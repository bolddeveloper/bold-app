from celery import shared_task
from .automations import drain


@shared_task(ignore_result=True)
def run_channel_automations():
    return drain(limit=25)
