from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from .execution_validation import identity
from .report_metrics import METRICS


def validate_report(value):
    if not isinstance(value,dict) or set(value)-{'metric','group_by','visualization','date_basis','from','to','timezone','filters','scope','include_subtasks'}:
        raise ValidationError('La definición del informe incluye campos no admitidos.')
    metric=value.get('metric','tasks.completed')
    if not isinstance(metric,str) or metric not in METRICS:
        raise ValidationError('Selecciona una métrica del catálogo.')
    source=metric.split('.')[0]
    grouping=value.get('group_by','none')
    groups={'none','day','week','month','project','department','employee','status','phase'}
    if not isinstance(grouping,str) or grouping not in groups or (grouping=='phase' and source!='phases') or (source=='meetings' and grouping not in {'none','day','week','month','project'}):
        raise ValidationError('La agrupación no es compatible con la métrica.')
    visualization=value.get('visualization','number')
    if not isinstance(visualization,str) or visualization not in {'number','bar','line','distribution','table'}:
        raise ValidationError('Selecciona una visualización válida.')
    if visualization=='distribution' and METRICS[metric][1]!='count' and metric!='meetings.scheduled_hours':
        raise ValidationError('Una distribución requiere cantidades o duración programada sumable; no porcentajes ni promedios.')
    if visualization=='line' and grouping not in {'day','week','month'}:
        raise ValidationError('Las líneas requieren una agrupación por día, semana o mes.')
    zone=value.get('timezone',getattr(settings,'AUTH_SESSION_TIME_ZONE','America/Guatemala'))
    try:
        tz=ZoneInfo(zone)
        today=timezone.now().astimezone(tz).date()
        start=date.fromisoformat(value.get('from',(today-timedelta(days=29)).isoformat()))
        end=date.fromisoformat(value.get('to',today.isoformat()))
        if not 0<=(end-start).days<=365:raise ValueError()
    except (TypeError,ValueError,ZoneInfoNotFoundError):
        raise ValidationError('Indica una zona horaria válida y un período de hasta 366 días.')
    bases={'tasks':{'created','completed','due','activity'},'phases':{'created','completed','due','activity'},
           'projects':{'created','due'},'meetings':{'start'}}
    default='start' if source=='meetings' else 'completed' if metric.endswith(('completed','lead_hours','on_time','cycle_hours')) else 'activity' if source in {'tasks','phases'} else 'created'
    basis=value.get('date_basis',default)
    if not isinstance(basis,str) or basis not in bases[source]:
        raise ValidationError('La fecha de referencia no es compatible con la fuente.')
    filters=value.get('filters',{})
    if not isinstance(filters,dict) or set(filters)-{'tasks','projects','units','assignments','statuses','tags','calendars','phases','phase_states'}:
        raise ValidationError('Revisa los filtros del informe.')
    clean_filters={}
    for key,items in filters.items():
        if not isinstance(items,list) or len(items)>50:
            raise ValidationError('Cada filtro admite hasta 50 selecciones.')
        if key=='phase_states':
            states={'pending','available','in_progress','blocked','completed','skipped'}
            if any(not isinstance(item,str) or item not in states for item in items):raise ValidationError('Revisa los estados de etapas.')
            clean_filters[key]=list(dict.fromkeys(items))
        elif key=='phases':
            if any(not isinstance(item,str) or not 1<=len(item)<=120 for item in items):
                raise ValidationError('Revisa los nombres de etapas.')
            clean_filters[key]=list(dict.fromkeys(items))
        else:
            clean_filters[key]=list(dict.fromkeys(identity(item,key) for item in items))
    scope=value.get('scope','accessible')
    if (source!='phases' and any(clean_filters.get(key) for key in ('phases','phase_states'))) or (source!='meetings' and clean_filters.get('calendars')):
        raise ValidationError('Hay filtros que no pertenecen a la fuente seleccionada.')
    if source=='meetings' and (set(clean_filters)-{'tasks','projects','calendars'} or scope!='accessible'):
        raise ValidationError('Las reuniones se filtran por calendarios accesibles y vínculos de tareas o proyectos, sin asumir asistencia individual.')
    if not isinstance(scope,str) or scope not in {'accessible','self','team'} or type(value.get('include_subtasks',False)) is not bool:
        raise ValidationError('Revisa el alcance y la inclusión de subtareas.')
    return {'metric':metric,'group_by':grouping,'visualization':visualization,'date_basis':basis,
        'from':start.isoformat(),'to':end.isoformat(),'timezone':zone,'filters':clean_filters,
        'scope':scope,'include_subtasks':value.get('include_subtasks',False)}


def report_period(definition):
    zone=ZoneInfo(definition['timezone'])
    return (datetime.combine(date.fromisoformat(definition['from']),time.min,tzinfo=zone),
            datetime.combine(date.fromisoformat(definition['to'])+timedelta(days=1),time.min,tzinfo=zone))
