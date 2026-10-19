# Calendarios de BOLD

Los calendarios internos se guardan en PostgreSQL y reutilizan las vistas de Calendario. La pestaña «BOLD» conserva la agenda conectada a Google, independiente de los calendarios internos. Solo el propietario y las personas añadidas pueden consultar un calendario interno; no hay acceso implícito para superusuarios ajenos. Los permisos disponibles son lectura, edición y administración. Únicamente el propietario puede borrar un calendario personalizado. El calendario de producción no se puede borrar desde la API.

## Preparación de producción

Antes de cualquier despliegue, crear un respaldo nuevo de PostgreSQL, verificarlo con `pg_restore --list`, copiarlo fuera de Oracle y comprobar la suma SHA-256. No borrar ni reemplazar volúmenes ni bases de datos. Las migraciones `calendario.0004` y `0005` añaden tablas; no modifican datos anteriores.

Después de aplicar las migraciones, importar una sola agenda protegida con las cuentas reales confirmadas de Dirección:

```sh
python manage.py import_production_calendar --owner <correo-de-luis> --manager <correo-de-soporte-bold> --dry-run
python manage.py import_production_calendar --owner <correo-de-luis> --manager <correo-de-soporte-bold> --schedule-hours
```

Los argumentos son obligatorios para conceder acceso de forma explícita. Una cuenta inexistente o inactiva aborta la operación. No crear cuentas ficticias ni conceder acceso a toda Dirección automáticamente. La importación es transaccional y repetible: conserva eventos existentes, sus modificaciones y sus identificadores. Cambiar el propietario exige una operación independiente; este comando no lo cambia.

Los datos incluidos proceden de las dos hojas del Excel proporcionado: 380 entradas de José y 196 de Axel. Cada celda conserva su texto original, agenda, referencia de celda y notas. Con `--schedule-hours` se aplican los horarios del texto: los rangos sin AM/PM se interpretan como jornada diurna y una hora sin fin recibe una hora provisional, según lo confirmado por el usuario. Las actividades separadas producen bloques separados sin borrar el registro original. Los horarios contradictorios quedan señalados para revisión y los eventos ya programados conservan sus horas.

Para una agenda ya importada, revisar `python manage.py schedule_production_calendar --daytime --default-minutes 60 --dry-run --report <archivo.json>` y ejecutar después sin `--dry-run`. No se necesita volver a importar ni sustituir la base de datos. Los números de día originales se conservan aunque no coincidan con la columna semanal; 36 celdas de fechas inconsistentes constan en el registro de importación. Los eventos sin número de día propio usan la posición de su semana. No se cambian fechas antiguas para hacerlas aparecer en el período actual.

`--source <archivo.xlsx>` permite releer el original con el mismo formato. El Excel no se modifica. No importar otro archivo sobre esta agenda sin revisar las referencias: la clave estable es hoja y celda.

## Google Meet sin eventos de Google Calendar

Se usa exclusivamente `POST https://meet.googleapis.com/v2/spaces`, no la API de eventos. El administrador del cliente OAuth debe habilitar **Google Meet REST API**. La persona que crea la sala debe autorizar el alcance `https://www.googleapis.com/auth/meetings.space.created` desde el botón del editor. La autorización normal de los otros servicios conserva sus alcances anteriores y no solicita Meet hasta esa acción explícita.

Sin esa habilitación o autorización, el calendario interno sigue funcionando y permite pegar un enlace válido existente. Crear una sala de Meet no envía invitaciones de Google ni crea eventos de Google Calendar. Las personas del evento deben tener previamente acceso al calendario dentro de BOLD.

Documentación oficial: https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/create

## Comprobación del despliegue

Verificar con Luis y Soporte BOLD que ven producción, que una cuenta no añadida no lo ve y recibe 404 por API, y que compartir lectura no permite editar. Probar un evento nuevo, editarlo y recargar. Revisar eventos antiguos mediante el mini calendario; al abrir una agenda se utiliza el día, semana o mes actual, conservando únicamente la vista preferida. Confirmar también Google, el desplazamiento de pestañas y el botón fijo de compartir. La compilación y las pruebas locales no confirman el funcionamiento de OAuth ni de Meet en producción.

## Tareas con horario

El formulario compacto distingue eventos y tareas. En calendarios internos, las tareas guardan inicio, fin y finalización en el evento privado de BOLD; completar y reabrir no llama a Google. Los eventos existentes importados mantienen su tipo anterior.

En la agenda conectada a Google, una tarea con horario se crea como un evento de Google Calendar, identificado con propiedades privadas `bold_kind=task` y `bold_completed`. El horario se refleja en Google Calendar. No se crea una tarea nativa de Google Tasks: esa API descarta la hora de vencimiento. La opción sin horario sigue utilizando Google Tasks. Completar o reabrir un bloque actualiza sus propiedades privadas sin borrar el evento.

Referencia: https://developers.google.com/workspace/tasks/reference/rest/v1/tasks

## Color de las tarjetas

Los eventos internos guardan el color HEX validado en su contenido. En Google Calendar se guarda el color exacto en `extendedProperties.private.bold_color` para conservarlo al recargar BOLD, junto al `colorId` más cercano de la paleta actual de la aplicación. Cambiar el color conserva el tipo y la finalización de la tarea. La selección usa el mezclador compartido de BOLD, también dentro de diálogos nativos.

## Compartir agenda con Equipo

En el despliegue autorizado, revisar `python manage.py enable_global_task_comments --dry-run` y ejecutar después sin `--dry-run`. Este comando habilita alcance global para comentarios en los cargos existentes, conserva las denegaciones explícitas y no cambia permisos de lectura. La API exige poder consultar la tarea antes de aceptar un comentario. Es repetible y conserva los identificadores de las reglas que amplía.

El interruptor de un calendario interno publica solo títulos y horarios bajo el perfil de la persona que lo activa. Empieza apagado y solo el propietario o un administrador puede activarlo. No concede acceso al calendario ni muestra descripciones, asistentes o enlaces de Meet. Los eventos privados o confidenciales se muestran como «Ocupado». El botón contiguo administra las personas con acceso al calendario, de forma independiente.

La publicación funciona sin conexión con Google y se puede desactivar en cualquier momento. Al quitar o reducir el permiso de administración se elimina la publicación de esa persona. La consulta de Equipo también verifica su acceso actual, incluso ante una revocación fuera de la API.

La vista mensual y el calendario pequeño muestran solo los números del mes seleccionado. Las casillas de otros meses quedan vacías, sin eventos ni acciones. Se dibujan únicamente las semanas necesarias para ese mes.
