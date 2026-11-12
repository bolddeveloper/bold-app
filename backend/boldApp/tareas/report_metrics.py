"""Reviewed metric catalog and interval arithmetic, never productivity scores."""
from statistics import mean, median

METRICS = {
    'tasks.total': ('Tareas del período','count','Número de tareas distintas del conjunto seleccionado.'),
    'tasks.completed': ('Tareas finalizadas','count','Tareas distintas con una finalización registrada en el período; una reapertura no borra la entrega.'),
    'tasks.active': ('Tareas en curso','count','Tareas del conjunto que actualmente están en curso.'),
    'tasks.overdue': ('Tareas vencidas','count','Tareas abiertas cuyo vencimiento es anterior a la fecha de consulta.'),
    'tasks.progress': ('Progreso de tareas','percent','Tareas actualmente completadas / tareas del conjunto × 100; no estima horas de esfuerzo.'),
    'tasks.lead_hours': ('Tiempo de resolución','hours','Horas naturales desde creación hasta finalización, para tareas con ambas fechas conocidas.'),
    'tasks.reopened': ('Tareas reabiertas','count','Tareas distintas con una reapertura registrada en el período.'),
    'tasks.aging_hours': ('Antigüedad del trabajo abierto','hours','Horas naturales desde creación hasta la consulta, solo para tareas abiertas.'),
    'tasks.on_time': ('Entregas dentro de plazo','percent','Entregas con fecha objetivo cumplida / entregas con fecha objetivo conocida × 100.'),
    'phases.total': ('Etapas del período','count','Etapas distintas del conjunto, sin convertirlas en tareas adicionales.'),
    'phases.completed': ('Etapas finalizadas','count','Etapas distintas finalizadas en el período. Las omisiones autorizadas se muestran aparte.'),
    'phases.progress': ('Progreso de etapas','percent','Etapas obligatorias completadas o exceptuadas / etapas obligatorias × 100; se distinguen las excepciones.'),
    'phases.cycle_hours': ('Tiempo de ciclo de etapa','hours','Horas naturales entre el primer inicio registrado y la finalización seleccionada, incluidas esperas.'),
    'phases.active_hours': ('Tiempo en estado En curso','hours','Suma de intervalos registrados En curso. No acredita trabajo efectivo ni dedicación exclusiva.'),
    'phases.wait_hours': ('Espera antes de comenzar','hours','Suma de intervalos en Disponible, esperando el inicio o la reanudación del paso.'),
    'phases.dependency_hours': ('Espera de dependencias','hours','Suma de intervalos Pendiente de dependencia.'),
    'phases.blocked_hours': ('Tiempo bloqueado','hours','Suma de intervalos con bloqueo declarado. No se atribuye automáticamente al empleado.'),
    'phases.reopened': ('Etapas reabiertas','count','Etapas distintas con una reapertura registrada en el período.'),
    'phases.on_time': ('Etapas dentro de plazo','percent','Etapas terminadas a tiempo / etapas terminadas con fecha objetivo conocida × 100.'),
    'projects.total': ('Proyectos del período','count','Proyectos distintos accesibles que cumplen los filtros.'),
    'projects.progress': ('Avance por proyecto','percent','Tareas completadas / tareas accesibles del proyecto × 100; los totales generales deduplican tareas compartidas.'),
    'meetings.total': ('Reuniones programadas','count','Eventos con horario de los calendarios accesibles, excluidas cancelaciones y bloques de tareas.'),
    'meetings.scheduled_hours': ('Duración programada de reuniones','hours','Suma del tiempo programado dentro del intervalo seleccionado; no acredita asistencia. Las reuniones simultáneas pueden superponerse.'),
}


def distribution(values):
    known=[value for value in values if value is not None]
    return {'mean':round(mean(known),4) if known else None,
            'median':round(median(known),4) if known else None,'sample_size':len(known),'unknown':len(values)-len(known)}


def phase_intervals(events, now, window_start=None):
    """Replay sequenced events; no timer writes, inferred attendance or lost pauses."""
    buckets={'pending':0.0,'available':0.0,'in_progress':0.0,'blocked':0.0}
    previous_at=None;state=None;first_start=None;last_completion=None;reopenings=0;clock_anomaly=False
    for row in sorted(events,key=lambda item:item.sequence):
        at=min(row.occurred_at,now)
        if row.occurred_at>now:
            continue
        if previous_at is not None:
            seconds=(at-previous_at).total_seconds()
            if seconds<0:clock_anomaly=True
            if state in buckets:buckets[state]+=max(0,(at-max(previous_at,window_start or previous_at)).total_seconds())
        after=row.after or {}
        if row.kind=='phase.archived':
            state=None
        elif 'status' in after:
            state=after['status']
        if state=='in_progress' and first_start is None:
            first_start=at
        if row.kind=='phase.transition' and state=='completed' and row.before.get('status')!='completed':
            last_completion=at
        if row.kind=='phase.reopened':reopenings+=1
        previous_at=at
    if previous_at is not None and state in buckets:
        buckets[state]+=max(0,(now-max(previous_at,window_start or previous_at)).total_seconds())
    return {'active_hours':buckets['in_progress']/3600,'wait_hours':buckets['available']/3600,
        'blocked_hours':buckets['blocked']/3600,'dependency_hours':buckets['pending']/3600,
        'cycle_hours':max(0,(last_completion-first_start).total_seconds())/3600 if first_start and last_completion else None,
        'observed':previous_at is not None,'clock_anomaly':clock_anomaly,'reopenings':reopenings}
