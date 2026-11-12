"""Bounded graph and assignment validation shared by templates and live tasks."""
from uuid import UUID, uuid4
from rest_framework.exceptions import ValidationError
from rest_framework.fields import DateTimeField
from boldApp.core.models import PositionAssignment

MAX_PHASES = 60


class ObjectRequestMixin:
    def finalize_response(self,request,response,*args,**kwargs):
        response=super().finalize_response(request,response,*args,**kwargs)
        response['Cache-Control']='private, no-store'
        return response

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method in {'POST','PUT','PATCH','DELETE'} and not isinstance(request.data,dict):
            raise ValidationError('Envía un objeto JSON con los campos de la operación.')


def identity(value, field):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError({field: 'Se requiere un identificador UUID válido.'})


def validate_definition(rows):
    if not isinstance(rows, list) or len(rows) > MAX_PHASES:
        raise ValidationError({'phases': f'Incluye hasta {MAX_PHASES} etapas.'})
    clean, people_ids = [], set()
    keys = {'id','name','description','completion_criteria','unit','lead','responsible',
            'prerequisites','required','due_at','estimated_minutes'}
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) - keys:
            raise ValidationError({'phases': 'La etapa incluye campos no admitidos.'})
        item = {'id': identity(row.get('id') or uuid4(), 'id'), 'position': index}
        for field, maximum in [('name',120),('description',5000),('completion_criteria',1000)]:
            value = row.get(field, '')
            if not isinstance(value,str) or len(value.strip()) > maximum or (field == 'name' and not value.strip()):
                raise ValidationError({field: f'Revisa el texto (máximo {maximum} caracteres).'})
            item[field] = value.strip()
        item['unit'] = identity(row.get('unit'), 'unit')
        item['lead'] = identity(row.get('lead'), 'lead')
        for field in ('responsible', 'prerequisites'):
            values = row.get(field, [])
            if not isinstance(values,list) or len(values) > MAX_PHASES:
                raise ValidationError({field: 'Selecciona una lista acotada de personas o etapas.'})
            item[field] = list(dict.fromkeys(identity(value,field) for value in values))
        item['responsible'] = list(dict.fromkeys([item['lead'], *item['responsible']]))
        people_ids.update(item['responsible'])
        required = row.get('required', True)
        estimate = row.get('estimated_minutes')
        if type(required) is not bool or (estimate is not None and (type(estimate) is not int or not 1 <= estimate <= 525600)):
            raise ValidationError('Revisa el carácter obligatorio y la estimación de la etapa.')
        item.update(required=required, estimated_minutes=estimate,
                    due_at=DateTimeField().run_validation(row['due_at']) if row.get('due_at') else None)
        clean.append(item)
    by_id = {item['id']: item for item in clean}
    if len(by_id) != len(clean):
        raise ValidationError({'id': 'No repitas identificadores de etapas.'})
    if clean and not any(item['required'] for item in clean):
        raise ValidationError({'required': 'Conserva al menos una etapa obligatoria.'})
    visiting, visited = set(), set()
    def visit(key):
        if key not in by_id or key in visiting:
            raise ValidationError({'prerequisites': 'Las dependencias deben pertenecer a la tarea y no formar ciclos.'})
        if key in visited:
            return
        visiting.add(key)
        for before in by_id[key]['prerequisites']:
            visit(before)
        visiting.remove(key); visited.add(key)
    for key in by_id:
        visit(key)
    people = {str(p.pk): p for p in PositionAssignment.objects.select_related('employee__user_account','position__unit')
        .filter(pk__in=people_ids, is_active=True, released_at__isnull=True,
                employee__is_active=True, employee__user_account__is_active=True)}
    if set(people) != people_ids:
        raise ValidationError({'responsible': 'Selecciona cargos y cuentas activos.'})
    for item in clean:
        if str(people[item['lead']].position.unit_id) != item['unit']:
            raise ValidationError({'lead': 'El responsable principal debe pertenecer al departamento encargado.'})
    return clean
