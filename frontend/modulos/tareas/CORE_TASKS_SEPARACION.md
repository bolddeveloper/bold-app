# Separación Core / Tareas

Implementación incremental sobre el paquete Vite existente, sin nuevas dependencias de producción ni cambios de CSS o contratos del backend. Tareas permanece en `frontend/modulos/tareas` y Core vive como módulo hermano en `frontend/modulos/core`, disponible para otros módulos del frontend.

## Responsabilidades

- `src/app.jsx`: composición, registro de navegación e identidad de plantilla. `main.jsx` monta esta aplicación.
- `../core/http_client.js`: transporte V2, token/contexto HTTP, JSON, paginación, 204, errores y cancelación global al cambiar sesión o cargo.
- `../core/core_api.js`: autenticación, cuenta, Employee, assignments, directorio, unidades y autorización.
- `../core/core_store.js`: única instantánea de identidad organizacional. Sus exports de directorio/asignación son referencias a esa instantánea, no un segundo estado de Tareas.
- `../core/core_provider.jsx`: restauración, login/logout, selección de cargo, Context y `useCore()`. Obtiene Employee desde su endpoint; activeUnit se deriva de activeAssignment. El token vive en el transporte Core; el contexto lo expone como proyección. sessionStorage es únicamente persistencia para restaurar.
- `../core/app_shell.jsx`: navegación global, tema, sidebar, cabeceras, selector de cargo y presentación de notificaciones. Recibe submenús, notificaciones y acciones mediante props; no importa Tasks.
- `src/services/tasks_api.js`: endpoints de Tasks y cancelación de solicitudes del módulo, sin métodos de login ni almacenamiento de token.
- `task_app.jsx`, `task_service.js`, normalizadores de tareas y realtime: dominio y vistas de Tareas, Inicio/Informes basados en tareas, filtros, formularios y reconciliación REST.

El antiguo `api_client.js` combinado y `task_session.jsx` se eliminaron. `tests/test_client.js` compone clientes únicamente para conservar escenarios de regresión, sin formar parte de la aplicación.

## Consumo

```jsx
const { account, employee, activeAssignment, activeUnit, directory,
        permissions, setActiveAssignment, logout } = useCore();
const allowed = await permissions.can("tasks.task.read", activeUnit.id);
```

El directorio y las unidades se cargan una sola vez por restauración de sesión en Core. Las comprobaciones de permisos se deduplican por cargo/unidad/recurso y se invalidan al cambiar de cargo o salir. El backend sigue siendo la autoridad en cada operación. Una recarga de página renueva el directorio y los permisos.

Los helpers existentes de presentación leen las proyecciones de Core para conservar la UI sin pasar identidad manualmente por todas las funciones de render. Tasks no escribe esos valores. `presentation_data.js` solo mantiene proyectos de presentación propios del módulo.

## Cambio de contexto

Core actualiza el header, invalida solicitudes del contexto anterior y cambia su instantánea. La instancia de Tasks se desmonta por la clave de asignación: cancela únicamente sus solicitudes, cierra sus sockets, limpia su presentación y vuelve a cargar. Un logout desmonta el módulo y limpia también cuenta, persona, directorio y token. Un 401 activa ese mismo flujo; un 403 muestra el error sin cerrar sesión.

El cliente HTTP combina la señal global con la señal del módulo y rechaza respuestas antiguas aunque el transporte ignore el aborto. Las notificaciones de tareas, su marcado y los eventos task.* permanecen en Tasks. El shell recibe datos de presentación y callbacks.

## Validación

Desde este directorio:

```powershell
npm test
npm run build
node tests/core_dom.mjs
node tests/v2_dom.mjs mock
node tests/v2_dom.mjs
node tests/v2_live.mjs
```

Las pruebas DOM usan la instalación temporal de jsdom descrita en `REWORK_V2_RESULTADO.md`. Las dos últimas requieren el backend local sembrado.

- 25 comprobaciones automatizadas: regresiones existentes, cancelación aislada, identidad única e imports sin ciclos ni dependencias Core → Tasks.
- `core_dom.mjs`: dos cargos, Employee, activeUnit, headers, respuesta tardía, cierre/apertura de sockets, restauración, 403, 401 y logout usando respuestas controladas.
- DOM real y plantilla: creación, vistas, edición, traspaso, subtarea, comentarios, restauración y eliminación.
- Integración real: movimiento de sección mediante TaskProject y sincronización entre dos clientes WebSocket, además de CRUD y reconexión.

La validación DOM comprueba estructura y comportamiento; no equivale a una revisión visual en navegador ni a dos navegadores interactivos. Se conservan los estilos y el markup principal del shell.
