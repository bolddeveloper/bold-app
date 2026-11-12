"""Fixed semantic capabilities call the ordinary views as the requesting employee."""
import json
from io import BytesIO
from urllib.parse import urlencode
from django.core.handlers.wsgi import WSGIRequest
from django.urls import resolve
from rest_framework.exceptions import APIException
from .access import ExecutionIdentity, validate_session


def call(job, method, path, data=None, query=None):
    validate_session(job.session, job.assignment)
    body = json.dumps(data or {}, ensure_ascii=False).encode()
    request = WSGIRequest({'REQUEST_METHOD': method, 'PATH_INFO': path,
        'QUERY_STRING': urlencode(query or {}, doseq=True), 'SERVER_NAME': 'backend', 'SERVER_PORT': '8000',
        'wsgi.url_scheme': 'http', 'wsgi.input': BytesIO(body), 'CONTENT_LENGTH': str(len(body)),
        'CONTENT_TYPE': 'application/json', 'HTTP_X_ASSIGNMENT_ID': str(job.assignment_id),
        'HTTP_USER_AGENT': 'BOLD Assistant'})
    request._bold_assistant_identity = ExecutionIdentity(job.session, job.assignment)
    request._bold_assistant_request_id = str(job.pk)
    match = resolve(path)
    response = match.func(request, **match.kwargs)
    # This is an in-process domain invocation, not a completed HTTP request.
    # HttpResponse.close() emits request_finished and can close the caller's
    # PostgreSQL connection in the middle of its transaction (CONN_MAX_AGE=0).
    # The fixed catalog only returns in-memory JSON, never streaming resources.
    if getattr(response,'streaming',False):raise RuntimeError('Assistant capabilities must return JSON.')
    if hasattr(response, 'render'):
        response.render()
    if response.status_code >= 400:
        error=APIException(getattr(response,'data','Acción rechazada.'))
        error.status_code=response.status_code
        raise error
    result = getattr(response, 'data', None)
    from django.core.serializers.json import DjangoJSONEncoder
    return json.loads(json.dumps(result, cls=DjangoJSONEncoder))
