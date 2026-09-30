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

## Extensión a otros módulos

Los próximos módulos pueden llamar `create_notification` con su propio `module`, `resource_type`, `route` y metadatos. Antes de hacerlo deben definir la regla que determina los destinatarios y validar el permiso de lectura del recurso tanto al crear como al listar la notificación.
