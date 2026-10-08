# Comentarios, audio, tareas recurrentes y calendario

Los comentarios de tareas y Cronograma permiten editar y eliminar. El servidor conserva la regla existente: el autor puede modificar su comentario; modificar comentarios ajenos requiere `tasks.task.update` y acceso a la tarea. Los nombres de subtareas se editan al pulsar el nombre, con Enter para guardar y Escape para cancelar. Los colaboradores aparecen plegados y el selector tiene búsqueda y una lista compacta.

Las notas de voz se graban desde Crear/Editar tarea o desde los comentarios. Cada registro admite tres notas, de hasta dos minutos y 1 MB cada una, con un máximo conjunto de 1,5 MB. La grabación requiere HTTPS o localhost y permiso de micrófono. El audio se guarda junto al registro y se reproduce mediante una descarga autenticada con los permisos de lectura de la tarea; los listados y eventos en vivo contienen solo metadatos. No se puede guardar o enviar mientras se graba o procesa audio.

La repetición puede ser diaria, semanal o mensual, con intervalo y fecha final inclusiva. La fecha inicial es `start_date`, o `due_date` si no hay inicio. La primera tarea es la plantilla y las siguientes aparecen al llegar cada fecha. Se conservan las diferencias entre inicio y vencimiento, descripción, voz, prioridad, subtareas, proyecto, etiquetas, adjuntos y colaboradores activos; se reinicia la finalización y no se copian conversaciones. Los meses cortos ajustan el día y recuperan el día original en el mes siguiente. Desactivar la repetición o eliminar la plantilla detiene las nuevas ocurrencias. El creador debe conservar una cuenta y asignación activas y permiso de crear en la unidad. Existe deduplicación en base de datos y recuperación de hasta 32 ocurrencias por plantilla por ejecución tras una interrupción.

El calendario usa la zona local del navegador para fechas y horas. Las vistas Día y Semana muestran una línea roja en el día actual, actualizada cada 30 segundos. Las reuniones del calendario principal de la conexión personal generan notificaciones BOLD 30 minutos antes, 5 minutos antes y al iniciar; se excluyen canceladas, rechazadas, libres, de día completo, borradores y tareas reflejadas por Google. Solo reciben avisos las asignaciones activas de la persona participante u organizadora. Cada aviso se deduplica por conexión, evento, inicio y anticipación. La opción Recordatorios de reuniones de Preferencias permite desactivarlos. Los avisos del escritorio requieren la preferencia y permiso de notificaciones ya existentes.

## Activación del servidor

1. Aplicar `python manage.py migrate`, incluyendo `boldApp_tareas.0010_comment_voice_notes_task_recurrence_and_more`.
2. Actualizar backend y trabajador Celery con programador. La configuración Oracle existente usa `worker -B` y Redis compartido. Las tareas `boldApp.tareas.recurrence.generate_recurring_tasks` y `boldApp.calendario.tasks.send_calendar_reminders` se ejecutan cada 60 segundos. Los recordatorios pueden llegar hasta aproximadamente un minuto después de su momento previsto; requieren que Google y el trabajador estén disponibles.
3. Publicar el frontend correspondiente. Estas modificaciones locales no publican la aplicación automáticamente.

En desarrollo, la consulta de notificaciones también revisa recordatorios con un límite de una consulta a Google por cuenta cada 55 segundos. La repetición de tareas requiere ejecutar el programador o invocar `generate_recurring_tasks()` desde Django; el modo síncrono por sí solo no ejecuta trabajos periódicos. Sin Redis el límite de consultas es por proceso. Los avisos atrasados más de 75 segundos se omiten para no enviar recordatorios vencidos después de una interrupción.

## Verificación

`python manage.py test boldApp.tareas.tests.test_task_features boldApp.calendario.tests.test_reminders --settings=config.settings_test` comprueba ocurrencias mensuales, fechas, fin de serie, deduplicación, permisos, audio privado y recordatorios. `npm test` y `npm run build` se ejecutan desde `frontend/modulos/core`.
