from rest_framework.exceptions import ValidationError
from .access import pilot_enabled


def prevent_public_request(request,body):
    from boldApp.mensajeria.support_bot import mentioned
    if pilot_enabled(request.assignment) and mentioned(body):
        raise ValidationError({'assistant_private':'Abre la solicitud en el asistente privado. No se publicó el mensaje; tu borrador se conserva.'})
