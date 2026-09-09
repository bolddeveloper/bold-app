# Guía de integración y rework del frontend con el backend V2

> Actualización de implementación: la integración local V2 ya está en el código. Consulta [REWORK_V2_RESULTADO.md](REWORK_V2_RESULTADO.md) para la auditoría inicial, los cambios, las pruebas ejecutadas y los límites de validación. El resto de esta guía conserva el plan y el contexto de partida.

## 1. Objetivo y estado de partida

Esta guía describe cómo conectar el módulo React/Vite de tareas con el backend V2 de boldApp. El orden acordado es:

1. Integrar frontend y backend en local.
2. Validar el flujo funcional con uno y luego dos navegadores.
3. Desplegar un ambiente de prueba nuevo en Render.
4. Validar concurrencia entre clientes con PostgreSQL, Redis, Daphne y Celery.

El backend V2 ya fue validado con pruebas automatizadas y con la colección Postman. Están operativos la autenticación, los permisos por asignación, los proyectos, las tareas, los traspasos entre unidades, los comentarios, los WebSockets por unidad y los webhooks firmados.

El frontend actual todavía conserva un modo plantilla en memoria y un adaptador de backend escrito para V1. Por eso **no basta con establecer `VITE_USE_REAL_BACKEND=true`**: primero deben actualizarse `src/services/api_client.js`, `src/services/realtime_adapter.js` y las transformaciones utilizadas por `src/task_app.jsx`.

Documentos relacionados:

- Contrato de backend: `backend/docs/tasks_v2_api.md`.
- Prueba de referencia: `postman/Bold App - V2 local.postman_collection.json`.
- Instrucciones del receptor: `postman/README.md`.

## 2. Contexto de los cambios del backend

### 2.1 De módulos aislados a un monolito modular

La versión anterior de Tareas duplicaba conceptos como usuarios y workspaces. La V2 utiliza una sola base física, pero mantiene límites claros entre aplicaciones Django:

- `core` es propietario de cuentas, empleados, unidades organizacionales, roles, plazas/asignaciones y permisos.
- `tareas` es propietario de proyectos, secciones, estados, tareas, relaciones con proyectos, comentarios, adjuntos, seguidores, etiquetas, notificaciones, actividad y webhooks.
- Tareas referencia entidades de Core mediante claves foráneas; no mantiene copias locales de usuarios o unidades.

Esto permite desplegar todo como una sola aplicación y conservar responsabilidades de dominio separadas.

### 2.2 La identidad tiene dos niveles

La cuenta autenticada ya no es el actor organizacional completo:

- `UserAccount`: credenciales y sesión.
- `Employee`: persona.
- `PositionAssignment`: asignación activa de esa persona a una plaza, unidad y rol.

Cada operación de Tareas debe indicar desde qué asignación actúa la persona. El token identifica la cuenta y la cabecera `X-Assignment-ID` identifica la asignación activa. El backend comprueba que ambas pertenezcan a la misma persona y nunca mezcla permisos de cargos distintos.

### 2.3 La unidad responsable reemplaza al workspace

El concepto `workspace` fue eliminado de Tareas. Ahora:

- Un proyecto pertenece a una `OrganizationalUnit`.
- Una tarea tiene una unidad responsable actual.
- Los estados pertenecen a una unidad.
- La asignación responsable de una tarea debe pertenecer a su unidad responsable.
- Una tarea puede estar vinculada a uno o varios proyectos, incluso de otras unidades.
- Un traspaso cambia la unidad, asignación responsable y estado, pero conserva los vínculos de colaboración con proyectos.

### 2.4 El historial guarda asignaciones, no usuarios genéricos

Los campos de autoría y responsabilidad utilizan `PositionAssignment`: `created_by_assignment`, `assignee_assignment`, `author_assignment`, `uploaded_by_assignment`, etc. Así se conserva el cargo desde el cual se realizó una acción aunque la persona cambie de puesto después.

## 3. Equivalencias V1/frontend actual → V2

| Concepto actual | Contrato V2 | Acción en frontend |
| --- | --- | --- |
| `workspace` / `workspace_id` | `unit` | Eliminar la resolución del workspace y conservar una unidad activa. |
| Usuario plano de `/api/users/` | `UserAccount` + `Employee` + `PositionAssignment` | Autenticar la cuenta y usar el directorio de asignaciones para selectores. |
| `created_by` | `created_by_assignment` | No enviarlo; el backend lo deriva de `X-Assignment-ID`. |
| `assignee` / `assignee_id` | `assignee_assignment` | Guardar UUID de asignación, no UUID de cuenta o empleado. |
| `project.label` | `project.name` | Normalizar al modelo de presentación si se conserva `label` en la UI. |
| `project.color` | `project.color_hex` | Normalizar `color_hex → color`. |
| Estado asociado al proyecto | `TaskStatus.unit` | Cargar estados por unidad responsable. |
| Columna visual | `Section.project` | Cargar secciones por proyecto. |
| `Task.position` | `TaskProject.position` | La posición en tablero pertenece al vínculo tarea-proyecto. |
| Creación Task y luego TaskProject | Creación atómica en `/tasks/` | Enviar `project`, `section` y `project_position` en el POST de la tarea. |
| Mover una columna actualizando TaskProject | PATCH de TaskProject | Mantenerlo para movimientos dentro del mismo proyecto. |
| Cambiar equipo/unidad con PATCH genérico | `/tasks/<id>/move/` | Usar la acción de traspaso con unidad, asignación y estado destino. |
| Subtareas embebidas | `Task.parent_task` | Cargar y guardar subtareas como tareas normales. |
| Comentarios dentro de la tarea local | `/comments/` | Mantener un almacén por `task` y crear comentarios mediante API. |
| `collaborator_ids` | `ProjectMember` y/o `TaskFollower` | No tratarlos como equivalentes: miembros colaboran en proyecto; seguidores reciben seguimiento de tarea. |
| WebSocket por workspace | WebSocket por unidad | Abrir una conexión por cada unidad visible necesaria. |

## 4. Orden recomendado de implementación

### Fase 0 — Proteger el modo plantilla

Mantener temporalmente `VITE_USE_REAL_BACKEND=false` para poder comparar la interfaz mientras avanza el rework. No se deben mezclar registros plantilla y UUID reales en el mismo estado.

Antes de modificar la lógica, añadir scripts de prueba al `package.json` para las pruebas existentes y para las nuevas transformaciones. El mínimo esperado al terminar cada fase es:

```powershell
npm run build
node --test src/*.test.js src/services/*.test.js
```

Se recomienda incorporar ese segundo comando como `npm test`.

### Fase 1 — Reescribir `api_client.js`

Este es el primer archivo que debe modificarse. Debe dejar de resolver `workspaces` y `/api/users/` y convertirse en una capa V2 con estas responsabilidades:

1. Construir rutas bajo `/api/v2/` y `/api/v2/core/`.
2. Gestionar `Authorization: Token <token>`.
3. Gestionar `X-Assignment-ID: <assignment-id>` para Tareas.
4. Desempaquetar respuestas paginadas `{count, next, previous, results}`.
5. Serializar cuerpos JSON y aceptar respuestas 200, 201, 202 y 204.
6. Convertir errores 400/401/403 en errores tipados que la UI pueda presentar.
7. Separar DTO de backend y modelos de presentación; no dispersar renombres por `task_app.jsx`.

Interfaz base sugerida:

```js
api.setToken(token);
api.setAssignment(assignmentId);
api.login(email, password);
api.getCurrentAccount();
api.listOwnAssignments();
api.listAssignmentDirectory();
api.listProjects(params);
api.listSections(projectId);
api.listStatuses(unitId);
api.listTasks(params);
api.createTask(payload);
api.updateTask(taskId, patch);
api.moveTask(taskId, handoff);
api.deleteTask(taskId);
api.listTaskProjectLinks(projectId);
api.updateTaskProjectLink(linkId, patch);
api.listComments();
api.createComment(taskId, body);
```

El helper central de red debería producir, como mínimo:

```js
const headers = {
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Token ${token}` } : {}),
  ...(assignmentId ? { "X-Assignment-ID": assignmentId } : {}),
};
```

No se debe conservar en el nuevo cliente ninguna ruta `/api/workspaces/`, `/api/users/`, `/api/tasks/` o `/ws/workspace/`.

### Fase 2 — Sesión y contexto de asignación

Flujo de inicio:

1. `POST /api/v2/core/auth/token/` con `username` y `password`.
2. Guardar el token de la sesión.
3. `GET /api/v2/core/user-accounts/` para obtener la cuenta propia y su `employee`.
4. `GET /api/v2/core/position-assignments/` para obtener las asignaciones propias, o usar el directorio y filtrar por `employee`.
5. Si existe una sola asignación activa, seleccionarla automáticamente.
6. Si existen varias, mostrar un selector de cargo/unidad.
7. Guardar el UUID elegido como contexto y enviarlo en `X-Assignment-ID`.
8. Al cambiar de asignación, cancelar peticiones, cerrar WebSockets, vaciar cachés de datos autorizados y volver a cargar.

Para los selectores de responsables se usa:

```http
GET /api/v2/core/position-assignments/directory/
```

La respuesta incluye `id`, `employee`, `employee_name`, `unit`, `unit_name`, `job_role` y `job_role_title`.

Para el test local puede usarse `ana@bold.gt` / `bolddemo123`. La contraseña no debe incluirse en el bundle ni en variables públicas de un despliegue real. Para esta primera integración es aceptable conservar token y asignación en memoria o `sessionStorage`; no colocar el token en código fuente.

### Fase 3 — Catálogos y modelo de presentación

Cargar datos en este orden:

1. Cuenta y asignación activa.
2. Directorio de asignaciones.
3. Proyectos visibles: `GET /api/v2/projects/`.
4. Secciones de cada proyecto: `GET /api/v2/sections/?project=<id>`.
5. Estados por unidad: `GET /api/v2/task-statuses/?unit=<id>`.
6. Tareas visibles: `GET /api/v2/tasks/` o filtradas por unidad.
7. Vínculos del proyecto: `GET /api/v2/task-projects/?project=<id>`.

El frontend actual supone una sola propiedad `project_id`, mientras que el backend permite varios proyectos. Para la primera entrega se puede mantener una vista de “proyecto actual”: se selecciona el `TaskProject` correspondiente al tablero abierto. No debe guardarse ese proyecto como si fuera propiedad exclusiva de `Task`; el estado normalizado debería conservar `taskProjectsByTaskId`.

Transformaciones mínimas recomendadas:

```text
Project DTO        → { id, label: name, color: color_hex, unitId: unit, ... }
Assignment DTO     → { id, personId: employee, name: employee_name, unitId: unit, ... }
TaskStatus DTO     → { id, label: name, category, isFinal: is_final, unitId: unit }
Task DTO           → { id, unitId: unit, assigneeId: assignee_assignment, ... }
TaskProject DTO    → { taskId: task, projectId: project, sectionId: section, position }
```

Evitar fechas fijadas a septiembre de 2026. `due_date` y `start_date` deben tratarse como fechas ISO `YYYY-MM-DD`, con presentación localizada únicamente en componentes o helpers de UI.

### Fase 4 — Escrituras de tareas

#### Crear

La creación debe ser una sola petición:

```http
POST /api/v2/tasks/

{
  "unit": "<unit-id>",
  "assignee_assignment": "<assignment-id-o-null>",
  "status": "<status-id>",
  "title": "Nueva tarea",
  "description": "...",
  "priority": "high",
  "due_date": "2026-09-30",
  "project": "<project-id>",
  "section": "<section-id>",
  "project_position": "1000.0000000000"
}
```

No crear después otro `TaskProject`: el backend ya lo hace dentro de la misma transacción.

#### Editar campos normales

Usar `PATCH /api/v2/tasks/<id>/` para título, descripción, prioridad y fechas. Si el cambio modifica la unidad responsable, debe enviarse también un estado y una asignación compatibles; para un traspaso explícito se debe preferir siempre `move/`.

#### Mover dentro del tablero

Para cambiar de columna sin cambiar la unidad responsable:

```http
PATCH /api/v2/task-projects/<link-id>/

{"section":"<section-id>","position":"2000.0000000000"}
```

#### Traspasar a otra unidad

```http
POST /api/v2/tasks/<id>/move/

{
  "unit": "<destination-unit-id>",
  "assignee_assignment": "<destination-assignment-id-o-null>",
  "status": "<destination-status-id>",
  "project": "<optional-project-id>",
  "section": "<optional-section-id>",
  "position": "2000.0000000000"
}
```

No reutilizar el estado ni el responsable de la unidad anterior. El backend rechazará las combinaciones incompatibles con HTTP 400.

#### Eliminar

`DELETE /api/v2/tasks/<id>/` responde 204 y realiza borrado lógico. Retirar el registro de la UI, pero tolerar también la recepción posterior de `task.deleted` por WebSocket.

### Fase 5 — Comentarios, subtareas y funciones secundarias

- Crear comentarios con `POST /api/v2/comments/` y `{task, body}`; el autor lo asigna el backend.
- Representar subtareas mediante `parent_task` en Task, no como un arreglo persistido dentro de la tarea padre.
- Usar `ProjectMember` para pertenencia y colaboración en proyectos.
- Usar `TaskFollower` para seguimiento/notificaciones de una tarea.
- Usar `/attachments/`, `/tags/`, `/task-tags/` y `/notifications/` cuando la funcionalidad visual correspondiente esté conectada.
- Marcar una notificación mediante `POST /api/v2/notifications/<id>/mark-read/`.

En la API actual, algunos recursos secundarios devuelven el conjunto visible paginado y no todos poseen filtro `?task=`. En la primera versión el cliente puede agruparlos por `task` localmente. Si el volumen crece, se debe añadir filtrado backend antes de cargar historiales completos.

### Fase 6 — Reescribir `realtime_adapter.js`

La URL V2 es:

```text
ws://127.0.0.1:8000/ws/unit/<unit-id>/?token=<token>&assignment=<assignment-id>
```

Con HTTPS debe derivarse `wss://`. El adaptador debe:

1. Recibir `unitId`, `token` y `assignmentId` explícitamente.
2. Abrir una conexión por unidad que la pantalla necesite observar.
3. Cerrar conexiones al cerrar sesión o cambiar de asignación.
4. Reconectar con backoff y límite razonable.
5. Al reconectar, volver a consultar REST porque el WebSocket no reproduce eventos perdidos.
6. Deduplicar eventos por `event_id` con una caché limitada.
7. Ignorar versiones desconocidas distintas de `event_version: 2` y registrar el problema.

Sobre recibido:

```json
{
  "event_version": 2,
  "event_id": "uuid",
  "event_type": "task.updated",
  "entity_type": "task",
  "entity_id": "uuid",
  "occurred_at": "fecha ISO",
  "payload": {},
  "source": "bold_backend"
}
```

Tipos actuales: `task.created`, `task.updated`, `task.status_changed`, `task.deleted` y `comment.created`.

Durante un traspaso, `task.status_changed` y `task.updated` llegan tanto a la unidad anterior como a la nueva con el mismo `event_id`. Por eso la deduplicación es obligatoria. REST debe seguir siendo la fuente de verdad.

En modo backend real no deben publicarse eventos locales que imiten eventos del servidor mediante `create_task_event`; eso produciría duplicados con la respuesta REST y el WebSocket. Se permite actualización optimista, pero debe reconciliarse con la respuesta del servidor y revertirse si la petición falla.

## 5. Configuración y ejecución local

### Backend

Terminal 1, desde la raíz:

```powershell
.\.venv\Scripts\python.exe .\backend\manage.py migrate
.\.venv\Scripts\python.exe .\backend\manage.py seed_demo_data
.\.venv\Scripts\python.exe .\backend\manage.py runserver 127.0.0.1:8000
```

Sin `REDIS_URL`, el entorno local utiliza Channels en memoria y Celery eager. Solo hace falta este proceso para REST y WebSocket.

### Frontend

Crear `frontend/modulos/tareas/.env.local`:

```dotenv
VITE_USE_REAL_BACKEND=true
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Después:

```powershell
Set-Location .\frontend\modulos\tareas
npm install
npm run dev
```

Abrir la URL indicada por Vite, iniciar sesión y seleccionar una asignación. Durante el rework conviene borrar el almacenamiento y desregistrar el service worker si aparece una versión antigua de los assets.

### Prueba local con dos clientes

Usar dos perfiles de navegador o una ventana normal y otra privada:

1. Iniciar sesión en ambos.
2. Abrir el mismo proyecto o unidades relacionadas.
3. Crear una tarea en el cliente A y verificarla en B sin recargar.
4. Editarla en B y verificarla en A.
5. Traspasarla entre Marketing y Operaciones.
6. Verificar que desaparezca o cambie de agrupación en origen y aparezca en destino.
7. Comentar y eliminar.
8. Desconectar temporalmente un cliente, efectuar cambios, reconectarlo y comprobar que la resincronización REST recupera el estado.

## 6. Manejo esperado de estados HTTP

- 200: lectura, actualización o acción completada.
- 201: recurso creado.
- 202: operación encolada, como prueba de webhook.
- 204: eliminación sin cuerpo.
- 400: datos incompatibles o validación de dominio; mostrar mensajes por campo.
- 401: token ausente o inválido; cerrar sesión y volver al login.
- 403: asignación ausente, ajena, inactiva o sin permiso; no confundir con sesión vencida.
- 404: recurso no visible o inexistente; retirar una selección obsoleta y recargar.

No considerar “solo 200” como criterio de éxito. Las creaciones y eliminaciones correctas usan 201 y 204.

## 7. Pruebas mínimas del frontend

### Unitarias

- Mapeo de Project, Assignment, TaskStatus, Task y TaskProject.
- Conversión de fechas sin desfase de zona horaria.
- Desempaquetado de paginación.
- Construcción de cabeceras con y sin sesión.
- Manejo de 204 sin intentar parsear JSON.
- Conversión de errores 400/401/403.
- Deduplicación de eventos y rechazo de versiones desconocidas.

### Integración local

- Login correcto e incorrecto.
- Selector con una y varias asignaciones.
- Recarga completa al cambiar de asignación.
- CRUD de proyecto y tarea según permisos.
- Creación atómica de tarea en proyecto.
- Movimiento de columna.
- Traspaso entre unidades.
- Comentario, subtarea y borrado lógico.
- Sincronización entre dos pestañas/navegadores.
- Reconexión de WebSocket seguida de refetch.

### Criterio de terminado local

- No quedan llamadas a rutas V1.
- No se usan datos de `task_data.js` cuando el modo real está activo.
- La UI funciona tras refrescar la página, no solo después de crear estado local.
- Todas las mutaciones manejan loading, éxito, error y rollback/reconciliación.
- La consola no muestra errores de promesas, CORS ni WebSocket.
- `npm run build` y las pruebas pasan.
- Dos clientes locales observan el mismo estado consistente.

## 8. Preparación del ambiente de prueba en Render

Solo avanzar cuando el criterio local esté completo. La V2 posee migraciones iniciales nuevas, por lo que debe desplegarse sobre una base PostgreSQL nueva; no apuntar a una base V1 poblada.

El `render.yaml` del repositorio ya describe backend ASGI, PostgreSQL, Redis, worker Celery y frontend estático, pero antes del despliegue debe actualizarse:

1. Añadir al frontend `VITE_USE_REAL_BACKEND=true`.
2. Eliminar `VITE_DEMO_WORKSPACE_NAME`, porque workspace ya no existe.
3. Confirmar `VITE_API_BASE_URL=https://<backend-real>.onrender.com`; las variables Vite se fijan durante el build.
4. Confirmar `ALLOWED_HOSTS` con el host real del backend.
5. Confirmar `CORS_ALLOWED_ORIGINS=https://<frontend-real>.onrender.com` sin barra final.
6. Mantener la misma `DATABASE_URL` para web y worker.
7. Mantener la misma `REDIS_URL` para Daphne/Channels y Celery.
8. Ejecutar `migrate` antes de arrancar.
9. Usar `seed_demo_data` solamente en el ambiente de prueba. Retirarlo del predeploy antes de un ambiente real con usuarios.
10. Confirmar que el servidor se inicia con Daphne, no con el servidor de desarrollo.

Para validar varios clientes en Render:

1. Abrir el frontend desplegado en dos dispositivos o navegadores.
2. Confirmar que la pestaña Network usa HTTPS y WSS.
3. Repetir creación, edición, comentario, traspaso y borrado.
4. Confirmar en logs que Daphne acepta ambos sockets y Redis distribuye eventos.
5. Confirmar que el worker Celery procesa webhooks y que los reintentos no bloquean la API.
6. Reiniciar una instancia y verificar que REST restaura el estado desde PostgreSQL.

`127.0.0.1:9000` no es alcanzable desde Render. Para webhooks desplegados se necesita un receptor HTTPS público de prueba.

## 9. Consideraciones antes de producción

El entorno anterior sirve para integración y pruebas con clientes, pero antes de abrirlo como producción deben resolverse al menos estos puntos:

- Sustituir o complementar el token persistente de DRF con expiración/rotación.
- Evitar registrar la URL completa del WebSocket, porque actualmente contiene el token; a futuro es preferible un ticket efímero para conectar.
- Añadir protección SSRF/allowlist para URLs de webhook antes de delegar su administración a usuarios no confiables.
- Definir política de archivos para adjuntos; actualmente el backend registra URL y metadatos, no implementa almacenamiento de binarios.
- Añadir observabilidad de errores, métricas de WebSocket y alertas del worker.
- Revisar secretos, `DEBUG=false`, HTTPS/WSS, CORS, hosts y política de respaldo de PostgreSQL.
- Diseñar la migración de datos si algún dato V1 debe conservarse; `db_v1.sqlite3` es respaldo, no una migración automática.

## 10. División sugerida del trabajo

- Integración base: sesión, estado de token/asignación y `api_client.js`.
- Datos de dominio: normalizadores, catálogos, proyectos, tareas y TaskProject.
- Mutaciones: formularios, movimiento, traspaso, rollback y errores.
- Tiempo real: conexiones por unidad, deduplicación, reconexión y refetch.
- Funciones secundarias: comentarios, subtareas, seguidores, adjuntos, etiquetas y notificaciones.
- Calidad/despliegue: pruebas, build, variables de entorno y validación multiusuario en Render.

La integración base y los normalizadores deben acordarse primero; el resto puede desarrollarse en paralelo una vez que sus contratos estén cubiertos por pruebas.
