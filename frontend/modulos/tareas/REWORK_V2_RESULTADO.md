# Integración del frontend de Tareas con V2

> Arquitectura actual: ver [separación Core / Tareas](CORE_TASKS_SEPARACION.md). Las referencias a `api_client.js` y `task_session.jsx` de este documento describen la etapa anterior.

Implementada sobre los componentes existentes. Se conservan navegación, vistas de lista/tablero, calendario, cronograma, detalle, modales y modo plantilla. No se añadieron dependencias de producción ni se desplegó la aplicación.

Corrección posterior del login: el entorno ejecutaba Django con `DEBUG=false` y sin `CORS_ALLOWED_ORIGINS`, por lo que aceptaba las credenciales pero el navegador bloqueaba la respuesta. Los valores predeterminados ahora permiten explícitamente `http://localhost:5173` y `http://127.0.0.1:5173`, sin depender de DEBUG; `backend/.env.example` refleja ambos. Se reinició el backend y se verificaron preflight, login y lecturas autenticadas con Origin. La prueba Node inicial no detectaba esta restricción del navegador: el recorrido de integración ahora comprueba CORS y envía Origin en sus sockets. Los fallos de red se presentan en español y las pruebas frontend suman 22.

## Auditoría inicial

| Área | Hallazgo antes de modificar |
| --- | --- |
| API V1 | `api_client.js` utilizaba `/api/workspaces/`, `/api/users/`, `/api/projects/`, `/api/tasks/`, `/api/sections/`, `/api/task-statuses/` y `/api/task-projects/`. |
| Datos locales | Tareas iniciales, proyectos, personas y notificaciones procedían de `task_data.js`. Proyectos y comentarios también se conservaban en localStorage. |
| Workspace | El adaptador resolvía un workspace demo y lo usaba para REST y WebSocket. |
| Usuarios | Buscaba usuarios por correo y convertía UUID a identificadores de plantilla. |
| Tareas antiguas | Lectura y escritura usaban `/api/tasks/`; la creación del vínculo de proyecto era una segunda petición. |
| Login | No había formulario de login, token ni contexto de asignación. La identidad visible era una persona fija de la demo. |
| Responsables | La interfaz mezclaba colaboradores y responsable; no utilizaba PositionAssignment. |
| Crear/editar | Actualizaciones optimistas sin reversión fiable; algunas peticiones estaban dentro de actualizadores de estado React. |
| Columnas | Secciones estáticas. Arrastrar cambiaba simultáneamente sección, estado y finalización de Task. |
| Proyectos/secciones | Proyectos persistidos localmente; alta, renombrado y eliminación de columnas eran locales. |
| Comentarios/subtareas | Comentarios en memoria/localStorage y subtareas embebidas en el padre. |
| WebSocket | Conexión única por workspace sin token, asignación, backoff, deduplicación ni recuperación de eventos perdidos. |
| Dependencia de task_data | Tanto la UI como el adaptador real asumían proyectos/personas de la plantilla. Fechas fijas de septiembre de 2026. |
| Pruebas | Dos archivos con comprobaciones de Inicio e Informes. No existían pruebas de los servicios. |

Se contrastó el contrato con `backend/docs/tasks_v2_api.md`, la colección Postman y su README, las rutas, modelos, serializers, permisos, vistas y consumidores V2. La implementación siguió este orden: cliente/normalización, sesión, carga, mutaciones, relaciones, tiempo real y pruebas.

## Funcionalidad implementada

- Cliente central exclusivamente V2: JSON, paginación completa, token, X-Assignment-ID, cancelación de peticiones y errores con campos. Acepta 200/201/202/204; 204 no lee cuerpo. Solo 401 cierra sesión; 403 conserva la sesión y presenta el error; 404 limpia selecciones obsoletas.
- Login, restauración mediante sessionStorage, descubrimiento de la cuenta por correo autenticado, selección automática de una asignación y selector para varias. Cambiar asignación desmonta el contexto, aborta peticiones, cierra sockets y elimina los datos autorizados anteriores.
- Directorio de PositionAssignment para responsables y seguidores, con responsable compatible con la unidad. Miembros de proyecto, seguidores y responsable se mantienen separados.
- Proyectos, miembros, secciones, estados por unidad, tareas, vínculos, comentarios, seguidores, adjuntos, etiquetas y notificaciones reales. Las colecciones vacías reemplazan correctamente el estado anterior.
- Task conserva todos sus TaskProject. `project_id`, sección y posición se proyectan para la vista actual; Inicio e Informes cuentan cada relación sin duplicar el total de tareas.
- Creación atómica Task + TaskProject; edición por PATCH; arrastre por PATCH de TaskProject con posición; traspaso por `move/` con estado y responsable destino; eliminación lógica con 204.
- Comentarios persistentes por tarea y subtareas mediante `parent_task`. Los borradores de comentarios se mantienen si falla el guardado.
- Creación/edición/eliminación de proyectos, gestión de miembros y secciones, seguidores, enlaces de adjuntos y marcado de notificaciones como leídas. Compartir muestra miembros reales y un enlace que conserva el proyecto; no concede acceso público.
- Mutaciones confirmadas por REST antes de cerrar los formularios. Si falla una operación secundaria después de crear la tarea, el borrador conserva los IDs confirmados y pasa a edición para reintentar sin duplicar padre/subtareas.
- WebSocket autenticado por cada unidad con permiso de lectura; deduplicación limitada a 1000 event_id; versiones distintas de 2 y mensajes inválidos se ignoran. Backoff de 1 a 30 segundos y refetch REST en cada conexión/reconexión. Foco y polling de 30 segundos actualizan también recursos secundarios sin eventos propios.
- Fechas ISO sin conversiones UTC para días civiles. Calendario navegable y cronograma basado en fechas reales. El service worker excluye la API del caché y renueva el caché estático anterior.
- En modo real no hay rutas V1 ni fallback a datos de plantilla. Los nombres CSS que contienen `workspace` se conservan únicamente como estructura visual, no como modelo organizacional.

## Cambios mínimos necesarios en backend

1. `backend/config/settings.py`: permitir `x-assignment-id` en CORS. Sin ello el navegador rechaza las peticiones autenticadas con contexto.
2. `backend/boldApp/tareas/signals.py`: emitir `task.updated` al modificar TaskProject, después del commit, sin modificar el estado de Task. Sin este evento otro cliente no recibe el cambio de columna inmediatamente.
3. `backend/boldApp/tareas/tests/test_v2_api.py`: regresiones para CORS y movimiento de columna observado por dos clientes.

## Archivos

Modificados en este módulo:

- `src/task_app.jsx`, `src/styles.css`.
- `src/services/api_client.js`, `src/services/realtime_adapter.js`.
- `src/home_data.js`, `src/home_data.test.js`, `src/report_data.js`, `src/report_data.test.js`.
- `public/sw.js`, `package.json`, `.env.example`, `.gitignore`, `FRONTEND_REWORK_V2.md`.

Nuevos:

- `src/task_session.jsx`.
- `src/services/task_models.js`, `task_service.js`, `presentation_data.js`, `template_api.js`.
- `src/services/api_client.test.js`, `task_models.test.js`, `task_service.test.js`, `realtime_adapter.test.js`.
- `tests/v2_live.mjs`, `tests/v2_dom.mjs`, este reporte.

También se creó `.env.local` (ignorado por Git) con modo real y URL local; `.env.example` mantiene modo plantilla como valor por defecto. Se preparó `.venv` y se migró/sembró una base local nueva porque no existían en este entorno.

## Endpoints utilizados

Todos bajo `/api/v2/`, salvo el socket:

| Recurso | Uso |
| --- | --- |
| `core/auth/token/` | POST login con username/password |
| `core/user-accounts/` | GET cuenta autenticada |
| `core/position-assignments/?employee=…` | GET asignaciones propias |
| `core/position-assignments/directory/` | GET directorio |
| `core/organizational-units/`, `core/authorize/` | GET unidades y POST comprobación de lectura para sockets |
| `projects/`, `project-members/`, `sections/` | GET/POST/PATCH/DELETE según acción y permisos |
| `task-statuses/?unit=…` | GET estados compatibles |
| `tasks/`, `tasks/<id>/`, `tasks/<id>/move/` | GET/POST, PATCH/DELETE y POST traspaso |
| `task-projects/`, `task-projects/<id>/` | GET vínculos, POST vínculo adicional de una tarea existente, PATCH sección/posición |
| `comments/` | GET/POST |
| `task-followers/`, `attachments/` | GET/POST/DELETE |
| `tags/?unit=…`, `task-tags/` | GET etiquetas visibles |
| `notifications/`, `notifications/<id>/mark-read/` | GET y POST lectura |
| `/ws/unit/<id>/?token=…&assignment=…` | Eventos V2; WSS bajo HTTPS |

## Validación realizada

- `npm run build`: correcto en modo real; también se verificó el build durante la integración con modo plantilla.
- `npm test` / `node --test src/*.test.js src/services/*.test.js`: 21 pruebas/comprobaciones aprobadas, incluyendo normalizadores, fechas, headers, paginación, 204, 400/401/403/404, cancelación, selección de asignaciones, WebSocket y recuperación de guardados parciales.
- `.venv/Scripts/python.exe backend/manage.py test boldApp.tareas.tests boldApp.core.tests --noinput`: 11 pruebas aprobadas. La advertencia de `staticfiles` inexistente es propia del entorno local sin collectstatic.
- `node tests/v2_live.mjs`: dos clientes REST/WebSocket reales; login incorrecto/correcto, creación atómica, edición, cambio de columna, traspaso, comentario, subtarea, borrado, desconexión/reconexión y refetch. Un cliente nuevo recupera el estado persistido.
- Pruebas DOM con jsdom y React StrictMode en modo real y plantilla: login/lista, crear, calendario, cronograma, detalle/editar, traspaso, subtarea, comentario, recarga completa de sesión/datos, eliminación e Inicio/Informes. Sin errores de React registrados en esos recorridos.

Para repetir las pruebas locales, inicia primero el backend sembrado según la guía. Desde `frontend/modulos/tareas`:

```powershell
npm test
npm run build
node tests/v2_live.mjs

# Solo para la prueba DOM opcional, fuera de las dependencias del proyecto:
npm install --prefix (Join-Path $env:TEMP 'bold-v2-dom') jsdom --no-audit --no-fund
node tests/v2_dom.mjs
node tests/v2_dom.mjs mock
```

Los scripts de integración usan exclusivamente la cuenta demo del backend local y crean/eliminan sus registros de prueba. No deben apuntarse a producción.

## Límites y pendientes explícitos

- No hubo navegador conectado a la herramienta de control. Las pruebas DOM no sustituyen la revisión visual ni la prueba manual en dos perfiles de navegador. Esa validación visual sigue pendiente; la sincronización de dos clientes reales REST/WebSocket sí fue comprobada.
- Una y varias asignaciones están cubiertas por pruebas de selección; el login y la restauración real se comprobaron con la cuenta demo de una asignación. Conviene repetir el recorrido visual con una cuenta de varias asignaciones cuando haya navegador disponible.
- El backend registra URL/metadatos de adjuntos; no almacena binarios ni imágenes dentro de comentarios. La UI permite enlaces de archivo y avisa cuando se intenta enviar imágenes en comentarios. Tamaño/MIME desconocidos de enlaces se registran como 0/application/octet-stream.
- Fechas y prioridad de proyecto no existen en su modelo V2: sus controles se conservan deshabilitados con explicación. No se simula su persistencia.
- V2 solo ofrece marcar notificaciones como leídas. Marcar como no leídas presenta un aviso; guardado/archivo de avisos siguen siendo preferencias de la UI.
- Los comentarios de cronograma se asocian a la tarea seleccionada; no se inventó un endpoint de comentarios de proyecto.
- Recursos secundarios sin eventos propios se reconcilian por foco/polling. No se comprobó despliegue Render ni concurrencia multiinstancia con Redis.

La implementación y las comprobaciones automatizadas están listas; la aceptación visual en navegador queda expresamente abierta.
