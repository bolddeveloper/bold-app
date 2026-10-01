# Módulo de notificaciones

Este módulo concentra las notificaciones internas de la aplicación. La entrega inicial cubre eventos de tareas, comentarios y proyectos sin acoplar el buzón al módulo de tareas.

## Eventos iniciales

- Asignación y cambios relevantes de tareas.
- Comentarios y menciones mediante correos `@nombre@bold.gt`.
- Creación y cambios relevantes de proyectos.
- Incorporación de una persona a un proyecto.

Las notificaciones se generan al confirmar la transacción de origen, se deduplican por destinatario y evento, y solo se entregan si el destinatario conserva permiso de lectura sobre el recurso.

## API

La API se publica bajo `/api/v2/notifications/` y exige una sesión válida junto con `X-Assignment-ID` perteneciente a la cuenta autenticada.

- `GET /api/v2/notifications/`
- `GET /api/v2/notifications/unread-count/`
- `POST /api/v2/notifications/{id}/mark-read/`
- `POST /api/v2/notifications/{id}/mark-unread/`
- `POST /api/v2/notifications/mark-all-read/`

El listado vuelve a validar los permisos actuales. Una notificación histórica no permite recuperar ni abrir un recurso cuyo acceso haya sido revocado.

## Tiempo real

El canal `/ws/notifications/` usa un ticket de un solo uso emitido para el canal `notifications`. Cada conexión queda aislada por asignación y se cierra si la sesión o la asignación dejan de ser válidas.

### Control de seguridad (sin acceso administrativo)

El mismo canal entrega sobres v2 `control.ready`, `permissions.revision` y
`assignment.changed`. Contienen solo la asignación propia, revisión decimal como
cadena, huellas opacas de estado/contexto, secuencia del canal, capacidad
`permissions_revision`, vigencia de control de 45 segundos y tiempo restante
para el próximo límite de seguridad. No contienen políticas, auditoría ni datos
de otros empleados. No se suscribe al grupo de eventos administrativos de Core.

Se comprueba el estado cada 30 segundos o antes al vencer sesión, inactividad,
concesión, autoridad ancestral o MFA reciente. El cierre 4401 invalida la sesión;
4403 indica plaza/ticket inválido. Las tareas asíncronas se cancelan al desconectar.
Los avisos posteriores al commit consultan el estado vigente; señales repetidas
sin cambio efectivo no fuerzan nuevas cargas del frontend. Las huellas permiten
recuperar cambios temporales y cambios de modelos sin revisión global incluso
si se perdió una señal. La autorización HTTP por operación no se modifica.

El cliente verifica la capacidad antes de pasar al respaldo HTTP de 60 segundos
en pestañas visibles. Si el servidor es antiguo, la conexión falla o la vigencia
vence, mantiene/vuelve a verificaciones cada cinco segundos. Ante incertidumbre
oculta datos del alcance anterior y pausa capacidades hasta verificarlas.

## Extensión a otros módulos

Los próximos módulos pueden llamar `create_notification` con su propio `module`, `resource_type`, `route` y metadatos. Antes de hacerlo deben definir la regla que determina los destinatarios y validar el permiso de lectura del recurso tanto al crear como al listar la notificación.
