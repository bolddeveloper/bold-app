# Contrato backend V2: Core + Tareas

La V2 es un monolito modular: `core` es propietario de identidad, estructura organizacional y permisos; `tareas` es propietario de proyectos, tareas, colaboración, notificaciones y webhooks. Ambos módulos usan una sola base de datos física y se relacionan mediante claves foráneas Django.

La base activa de desarrollo es `backend/db.sqlite3`. La base anterior se conserva como `backend/db_v1.sqlite3` únicamente como respaldo; no debe usarse para ejecutar la V2.

## Arranque local

Desde la raíz del repositorio:

```powershell
.\.venv\Scripts\python.exe .\backend\manage.py migrate
.\.venv\Scripts\python.exe .\backend\manage.py seed_demo_data
.\.venv\Scripts\python.exe .\backend\manage.py runserver 127.0.0.1:8000
```

La siembra crea la cuenta `ana@bold.gt` con contraseña `bolddemo123`, las unidades Marketing y Operaciones, tres asignaciones activas y cuatro proyectos.

## Autenticación y contexto organizacional

Obtén un token con:

```http
POST /api/v2/core/auth/token/
Content-Type: application/json

{"username":"ana@bold.gt","password":"bolddemo123"}
```

En todas las peticiones protegidas envía:

```http
Authorization: Token <token>
X-Assignment-ID: <uuid-de-la-asignación-activa>
```

El token identifica la cuenta y `X-Assignment-ID` identifica el cargo desde el cual actúa. El backend comprueba que la asignación pertenece a la persona autenticada, sigue activa y posee el permiso solicitado. Los permisos de dos asignaciones diferentes nunca se combinan.

El selector de personas/asignaciones del frontend puede cargarse con:

```http
GET /api/v2/core/position-assignments/directory/
```

Devuelve solamente asignaciones activas con `id`, empleado, unidad y rol. Los CRUD administrativos completos de Core permanecen restringidos.

## Recursos principales

Todos terminan con `/`:

- `/api/v2/projects/`
- `/api/v2/project-members/`
- `/api/v2/sections/`
- `/api/v2/task-statuses/?unit=<uuid>`
- `/api/v2/tasks/?unit=<uuid>`
- `/api/v2/task-projects/`
- `/api/v2/task-dependencies/`
- `/api/v2/comments/`
- `/api/v2/attachments/`
- `/api/v2/task-followers/`
- `/api/v2/activity-logs/` (solo lectura)
- `/api/v2/tags/?unit=<uuid>` y `/api/v2/task-tags/`
- `/api/v2/notifications/` y `POST /api/v2/notifications/<id>/mark-read/`
- `/api/v2/webhook-endpoints/` y `/api/v2/webhook-deliveries/`

Las listas están paginadas en la forma `{count, next, previous, results}`.

## Crear una tarea

```http
POST /api/v2/tasks/

{
  "unit": "<unidad-responsable>",
  "assignee_assignment": "<asignación-activa-de-esa-unidad>",
  "status": "<estado-de-esa-unidad>",
  "title": "Preparar lanzamiento",
  "description": "Prueba V2",
  "priority": "high",
  "project": "<proyecto-opcional>",
  "section": "<sección-opcional-del-proyecto>",
  "project_position": "1000.0000000000"
}
```

La tarea y su vínculo opcional al proyecto se crean en una sola transacción. Una tarea puede pertenecer a proyectos de otras unidades; `unit` indica quién responde actualmente por ella. El estado, la persona asignada y las etiquetas sí deben pertenecer a esa unidad responsable.

## Traspasar una tarea entre unidades

```http
POST /api/v2/tasks/<task-id>/move/

{
  "unit": "<nueva-unidad>",
  "assignee_assignment": "<asignación-de-la-nueva-unidad-o-null>",
  "status": "<estado-de-la-nueva-unidad>",
  "project": "<proyecto-opcional>",
  "section": "<sección-opcional>",
  "position": "2000.0000000000"
}
```

La operación exige permiso de actualización en la unidad de origen y de asignación en la de destino. Es atómica. Los equipos conservan la colaboración a través de `TaskProject` y `ProjectMember`; mover la responsabilidad no borra esos vínculos.

## Tiempo real

Conecta una sesión por cada unidad que la interfaz necesite observar:

```text
ws://127.0.0.1:8000/ws/unit/<unit-id>/?token=<token>&assignment=<assignment-id>
```

El servidor autentica el token, la pertenencia y vigencia de la asignación, y el permiso `tasks.task.read` sobre la unidad. Los eventos usan `event_version: 2` e incluyen `event_id`, `event_type`, `entity_type`, `entity_id`, `occurred_at`, `payload` y `source`.

Eventos actuales: `task.created`, `task.updated`, `task.status_changed`, `task.deleted`, `comment.created` y `webhook.test`. Un traspaso se publica tanto en la unidad anterior como en la nueva. El frontend debe deduplicar por `event_id`, volver a consultar REST al reconectar y tratar REST como fuente de verdad.

En producción usa exclusivamente HTTPS/WSS. El token viaja como parámetro del WebSocket, por lo que debe evitarse que las URLs completas aparezcan en logs; una mejora posterior recomendable es canjearlo por un ticket efímero de conexión.

## Webhooks

Al crear un endpoint, el backend genera y devuelve una sola vez su `secret`:

```http
POST /api/v2/webhook-endpoints/

{
  "unit": "<uuid>",
  "target_url": "https://cliente.example/webhook",
  "event_types": ["task.created", "task.updated", "task.status_changed", "task.deleted", "comment.created"],
  "is_active": true
}
```

Cada entrega lleva `X-BoldApp-Event` y `X-BoldApp-Signature`. La firma es el HMAC-SHA256 hexadecimal del cuerpo JSON exacto usando `secret`. `POST /api/v2/webhook-endpoints/<id>/test/` encola una prueba. Las entregas se consultan con `/api/v2/webhook-deliveries/?endpoint=<id>`.

En local, sin `REDIS_URL`, Channels usa memoria y Celery ejecuta las tareas inmediatamente. En Render, API, WebSocket y worker deben compartir Redis; además deben configurarse HTTPS, secretos, hosts/orígenes permitidos y una URL pública de webhook (el receptor `127.0.0.1` solo sirve localmente).

## Orden recomendado para el frontend

1. Implementar `api_client.js`: URL V2, token, `X-Assignment-ID`, paginación y tratamiento uniforme de 401/403/400.
2. Implementar sesión y selector de asignación con el directorio de Core.
3. Adaptar lecturas de proyectos, secciones, estados y tareas.
4. Adaptar escrituras, especialmente creación atómica y `move/`.
5. Añadir el cliente WebSocket por unidad, deduplicación y resincronización REST.
6. Integrar comentarios, adjuntos, seguidores, etiquetas y notificaciones.
7. Probar webhooks y finalmente concurrencia multiinstancia en Render con Redis.
