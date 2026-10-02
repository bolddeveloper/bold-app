# Siguiente entrega: historial paginado y carga inicial

Fecha: 2 de octubre de 2026. Rama `perf/sincronizacion-trafico`.
Completa una parte pendiente de la fase 3; **no certifica capacidad para 25 usuarios ni cierra el plan**.

## Hallazgos y decisión

1. El cliente descargaba todas las páginas de comentarios al hidratar Tareas y
   en cada reconciliación completa, aunque no hubiera una conversación abierta.
   El costo crecía con el historial. Es una redundancia comprobada en el código,
   no evidencia por sí sola de una fuga de memoria ni la explicación única de las 137k peticiones.
2. Las consultas generales de tareas y otras relaciones siguen siendo completas.
   Inicio, progreso, filtros, workspaces y subtareas dependen de ellas. Recortarlas
   arbitrariamente produciría cifras incompletas. Los adjuntos también participan
   en filtros y en la comparación al guardar: una lista parcial podría eliminar
   relaciones que el formulario no cargó. Se dejan pendientes con contrato por vista.
3. Paginación por número desplaza resultados al insertar. El nuevo historial usa
   cursor firmado de `(created_at, id)` y orden descendente, incluso con fechas
   idénticas. El cursor no concede acceso: total y autorización se recalculan en
   cada solicitud. No constituye una instantánea: ediciones, borrados y cambios
   de permisos pueden cambiar el total mientras se navega.
4. La comprobación de scopes detectó referencias fuera de componente en el
   cambio a Cronograma/columnas. Se corrigieron usando el manejador ya recibido;
   la prueba JSX ahora incluye Tareas y el nuevo componente de comentarios.

## Cambios

- Lectura optativa `GET /api/v2/comments/?recent=1`: máximo 25 resultados,
  `count` autorizado real, `next` firmado y `previous: null` (lectura hacia atrás).
  La ruta sin `recent` conserva paginación/orden anteriores para clientes antiguos.
- Filtros: `tasks` (hasta 50 UUID), `project` (un UUID, también exige poder leer
  el proyecto) y `mine=1` (creador, responsable o seguidor de la asignación activa).
  Ninguno amplía la autorización de las tareas. Valores inválidos se rechazan.
- No se descargan comentarios en el loader general con el flag activo.
  Detalle y Cronograma solicitan el historial solo al montarse; botón explícito
  para cargar más, indicador de carga y error recuperable sin borrar el texto.
- Eventos del websocket invalidan la conversación abierta, no todo el grafo.
  Ráfagas se agrupan en 400 ms; solicitudes no se solapan por controlador.
  Reconciliación completa/reconexión actualiza solo conversaciones montadas.
- Pestañas ocultas/offline no inician estas lecturas. Cambiar ámbito/asignación,
  desmontar o recibir una revisión de permisos cancela/purga la generación previa.
  Una respuesta tardía no repuebla el ámbito anterior. Retry-After impide reintentos
  incluso al pulsar Actualizar antes del plazo; no hay un nuevo intervalo propio.
- Workspace divide sus IDs en grupos disjuntos de 50 y lee como máximo dos
  grupos simultáneamente. **No es una página global de 25:** con N grupos puede
  traer hasta 25×N filas por ronda. Ordena las filas cargadas, pero para ver todos
  los comentarios antiguos debe cargar más; no promete una mezcla global perfecta
  mientras unos grupos tienen páginas pendientes. Es una limitación explícita.
- Feature flag `VITE_TASK_PAGED_COMMENTS=true`, junto con backend real e incremental.
  Debe desplegarse primero el backend compatible, después el build del frontend.
  No se cambia esquema, dependencias, cuentas, contraseñas, MFA ni permisos.

## Pruebas y ahorro reproducible

Todas las cifras siguientes corresponden a pruebas aisladas, no a una hora real en nube.

| Escenario: 5.000 comentarios, 25 por página | Anterior | Nuevo |
| --- | ---: | ---: |
| Arranque sin abrir historial: GET de comentarios | 200 | 0 |
| 12 reconciliaciones sin historial abierto | 2.400 | 0 |
| Primera apertura del detalle de esa tarea | Ya precargados | 1 GET / 25 filas |
| Historial abierto, 12 reconciliaciones completas | 2.400 | 12 GET / hasta 25 filas por ronda |

En el último caso, reducción del **99,5% de lecturas de comentarios**, no del
tráfico total de la aplicación. Cada Cargar más genera otra página por grupo
pendiente. Eventos, aperturas, arranque y otros recursos se contabilizan aparte.
La prueba compara también las tareas completas, proyectos y enlaces antes/después;
no cambia totales ni descarta el árbol para obtener ese ahorro.

- Frontend: 147 pruebas; Worker: 4. Cancelación local/módulo, coalescencia,
  visibilidad, cuota, 403, limpieza, paginación circular, alcance de enlaces y
  concurrencia máxima de dos grupos cubiertos.
- Django: 163 pruebas pasan, incluida la nueva suite de 5 casos: 5.000 comentarios visibles + 50 no autorizados,
  25 resultados y count=5.000; fechas iguales, inserción entre páginas, soft-delete,
  cursor alterado, revocación antes de siguiente página, filtros mine/proyecto,
  compatibilidad y queries vacías. Lectura grande: **9 consultas SQL** en SQLite
  aislado; no es un p95 PostgreSQL ni una garantía de costo independiente del volumen.
- La autorización todavía evalúa las tareas candidatas del alcance y el count
  debe contar sus comentarios. Reducir HTTP/payload no elimina todo el trabajo SQL.
- Verificación completa, despliegue y lectura de cuota: registrar al finalizar.

## Qué validar manualmente

1. Recargar todas las pestañas/PWA sin descartar formularios. Verificar versión
   con `window.boldSyncDiagnostics.snapshot().buildVersion` en la consola.
2. Abrir detalle y Cronograma: contador real, más recientes primero, Cargar más
   cuando exista historial suficiente. Escribir comentario y comprobar otra sesión
   autorizada; reservar estas escrituras para datos demo acordados.
3. Revocar acceso/cambiar cargo: la conversación previa debe desaparecer, y la
   siguiente página no debe conservar el acceso antiguo. Probar dueño y empleado
   limitado con sesiones propias; no compartir contraseña/MFA por chat.
4. Medir 30–60 minutos con la misma versión/dataset, separando arranque, reposo y
   acciones. No sumar `http`, `http-result` y `duration` como solicitudes diferentes.
   El contador del panel de Cloudflare es cuenta/día, no una atribución por función.

## Siguiente prioridad

Consultas por vista con agregados autorizados antes de paginar tareas/adjuntos,
seguido de carga escalonada 5/10/25 cuentas y datos sintéticos en PostgreSQL/Redis
aislados. No sustituir esa prueba por 25 GET de salud pública ni cargar la demo
de empleados artificialmente. Mantener el control de seguridad independiente.

## Reversión

Frontend primero: restaurar la versión de Cloudflare `dfaf90e9-db1f-4db6-a537-99ae373e7428`
o compilar con `VITE_TASK_PAGED_COMMENTS=false` (otros flags quedan activos).
El backend nuevo conserva la lectura anterior, por lo que normalmente no necesita
revertirse. Si hace falta, utilizar la imagen de respaldo registrada del despliegue
con `BOLD_APP_IMAGE_TAG=rollback-before-paged-comments-20261002` y Compose
`up -d --no-build --no-deps backend worker`. No borrar volúmenes ni restaurar DB
para revertir código; comprobar health y versión después.
