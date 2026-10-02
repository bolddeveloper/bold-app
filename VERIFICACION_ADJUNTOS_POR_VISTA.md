# Optimización de adjuntos y salida a demo de 4–6 usuarios

Fecha: 2 de octubre de 2026. Rama `perf/sincronizacion-trafico`.
Código publicado: `2b8c0711`. Develop permanece en `4c38c852`.

## Resultado y alcance

Se completa otro tramo de la carga por vista pendiente de fase 3. No se declara
terminado todo el plan ni certificada la capacidad de producción.

- Los listados de tareas incluyen `attachment_count` calculado por SQL para
  adjuntos no eliminados de tareas autorizadas. No se cuenta con una consulta
  independiente por tarea ni se serializan todos sus archivos para obtenerlo.
- Con `VITE_TASK_PAGED_ATTACHMENTS=true`, arranque/reconciliación general no
  descargan adjuntos. El detalle consulta una página de hasta 25 al abrirse;
  Cargar más es explícito. Contador real, carga y error recuperable visibles.
- Filtros con/sin adjuntos utilizan ese conteo incluso antes de cargar archivos.
  El cliente distingue `attachmentsLoaded=false` de una lista vacía confirmada.
- Editar carga todos los adjuntos de **una sola tarea** antes de abrir el modal.
  El indicador explica esa espera. Esta operación sigue costando todas sus
  páginas: es intencional para comparar los archivos del formulario sin borrar
  otros que todavía no se cargaron. Un editor paginado exige otro contrato de
  escrituras por operaciones, no comparar una página contra el conjunto completo.
- El guardado falla antes de escribir si falta la referencia completa de adjuntos.
  Solo retira archivos de esa referencia que el usuario quitó. No busca ni borra
  nuevos archivos concurrentes que no formaban parte del formulario.
  Creaciones y eliminaciones confirmadas actualizan la referencia conservada en
  un error parcial, evitando repetir esas operaciones al reintentar. No resuelve
  la ambigüedad de un POST cuya respuesta se pierda; no hay retries de escritura
  automáticos ni se afirma idempotencia de todo el formulario.
- Eventos de adjuntos invalidan únicamente el detalle abierto y los conteos de
  sus tareas. Ráfagas se agrupan; no hay intervalo nuevo de polling. Recuperación
  completa refresca solo detalles montados. Al refrescar se vuelve a la ventana
  reciente, no se conserva la expansión histórica de páginas anteriores.
- Comentarios y adjuntos comparten el ciclo de vida de vistas paginadas:
  oculto/offline no inicia nuevas lecturas; desmontar/cambiar contexto cancela;
  incertidumbre/revisión de permisos purga; datos tardíos no repueblan la vista;
  se conserva Retry-After. El editor también cancela al cambiar vista/asignación.
- Backend `attachments?recent=1` usa cursor firmado `(created_at, id)` con una
  clave de firma distinta a comentarios. Cada página recalcula autorización y
  total. El cursor no concede acceso. La ruta sin recent conserva compatibilidad.
- No se modifican permisos, cuentas, contraseñas, MFA, estilos, dependencias ni
  esquema. CSS publicado sigue siendo `index-77eQkRtb.css`.

### Lo que se conserva deliberadamente

Las tareas generales siguen completas: Inicio, progreso, filtros, árbol de
subtareas y workspaces necesitan sus conjuntos autorizados. La búsqueda y
Bandeja de entrada también leen descripciones; no se eliminan ni se sustituyen
por una página parcial. Enlaces, seguidores, miembros y otras relaciones siguen
en la arquitectura actual. Esta entrega **no es paginación general de tareas**.

## Evidencia aislada y límites

Fixture HTTP con el cliente real y fetch simulado, 5.000 adjuntos / 25 por página:

| Acción | Anterior | Nuevo |
| --- | ---: | ---: |
| Arranque sin detalle abierto, GET de adjuntos | 200 | 0 |
| Doce reconciliaciones con detalles cerrados | 2.400 | 0 |
| Abrir detalle de una tarea | Precargados | 1 / 25 filas |
| Doce actualizaciones de detalle abierto | 2.400 | 12 / 25 filas por ronda |
| Editar la tarea con 5.000 archivos | Precargados | 200, solo para esa tarea |

El 99,5% es reducción de esas lecturas de adjuntos con detalle abierto, **no del
tráfico total**. Las peticiones adicionales de apertura, acciones, recuperación
y otros módulos se suman aparte. Con cero o pocos adjuntos, el ahorro absoluto
será mucho menor; no se atribuyen las antiguas 137k solicitudes solo a archivos.

- Frontend: **158 pruebas** pasan. Incluye recorrido HTTP real del fixture,
  deferral en 12 rondas, conteos/filtros/búsqueda/subárbol, baseline de edición,
  abort local/módulo, apertura duplicada, respuesta ajena/eliminada/duplicada,
  guardado parcial y scopes JSX. Worker: **4 pruebas** pasan.
- Django: **167 pruebas** pasan. Se leen 25 de 5.000 archivos autorizados con
  50 extranjeros excluidos; soft-delete, cursor con fechas iguales/inserción,
  cursor alterado/ajeno, revocación antes de otra página, compatibilidad y conteos.
- Página de adjuntos: **9 consultas SQL en SQLite aislado**. El número de
  consultas de lectura de tareas permanece igual al pasar de 1 a 21 tareas;
  se comprueba que el instrumento registró SQL, no que dos capturas vacías sean
  iguales. El middleware asíncrono puede usar otra conexión: la prueba registra
  la ejecución del cursor en vez de depender del log del hilo principal.
  Esto no garantiza latencia constante ni acredita Postgres con datos reales.
- La suite encontró un fallo previo dependiente del reloj: simular +11 minutos
  podía cruzar el cierre diario de las 07:00 Guatemala y devolver sesión cerrada.
  Solo se aisló la duración de la sesión en esa prueba de vencimiento de grants;
  la política real y su prueba independiente de cierre diario siguen intactas.
- Build real pasa; sigue el aviso existente del bundle >500 kB. `makemigrations
  --check --dry-run` local/Oracle no detecta cambios. `check --deploy` sin errores;
  persisten avisos HSTS W005/W021, no se amplía alcance de dominios aquí.

## Publicación y verificaciones

- Commit de código `2b8c0711`, subido a la rama de optimización. No hay merge a
  Develop ni modificaciones del plan de Cloudflare.
- Oracle primero: backend healthy, worker running. Imagen real de ambos:
  `4630ade1562aef8e9b159567f85d960c3b217fb0b761feed6ad0e3f0f545e8ee`.
  PostgreSQL, Redis y cloudflared mantienen sus contenedores del 28 de septiembre;
  no se recrearon volúmenes ni se borraron respaldos.
- Backup conservado: `/opt/bold-app/deploy/oracle/backups/boldapp-20261002T125830Z.dump`.
  Reversión `bold-app-backend:rollback-before-paged-attachments-2b8c0711`
  conserva la imagen anterior `a8671bd9a6ec06f62ec131aee5eaad51eab591189cbf6f70e86b32e584eefedb`.
- Cloudflare: `a6d110cb-53a1-414c-b18f-4222e6b91b51`, JS `index-D0U3PpTV.js`,
  `buildVersion=2b8c0711`. Backend real, incremental, control, diagnóstico,
  comentarios y adjuntos paginados activos; mismo origen, reconciliación 300000 ms.
  Raíz/bundle HTTP 200 y SHA256 remoto idéntico al build local; `/health/` HTTP 200
  con database/redis true. Es comprobación de despliegue, no prueba autenticada
  del editor ni ventana de consumo/hora.
- Computer-use: panel diario marcó **1.252/100.000**, **98.748 restantes** alrededor
  de 13:00 UTC. Contador de cuenta, no tasa por versión ni porcentaje de ahorro.
  El bloque de 138,59k del rango Oct 1–Oct 2 no es el contador de solicitudes de hoy.
  Evidencia local: `C:/Users/j_sam/.codex/visualizations/2026/10/01/01a0f90e-01ac-7dd3-9f70-c614af594c5c/cuota-adjuntos-20261002.png`.
- Las dos pestañas de Bold muestran inicio de sesión al coincidir con 07:00 en
  Guatemala. La pestaña inspeccionada conserva bundle anterior y tiene un campo
  de contraseña con entrada: no se recarga ni se extraen credenciales. Se requiere
  que el usuario recargue e inicie sesión para probar visualmente la entrega nueva.
  No se crean sesiones desde la DB ni se introduce MFA. Revisión manual autenticada
  y carga de 4–6 personas **pendientes**, no se da por aprobada la demo.

## Reversión

Actualización de aceptación del mismo 2 de octubre: el usuario abrió las sesiones
de Luis y Samuel y autorizó datos ficticios en Dirección. Recorridos y límites
documentados en `VERIFICACION_ACEPTACION_DEMO.md`; la limitación de login descrita
arriba ya no impide esos recorridos. La prueba de 4–6 usuarios sigue pendiente.

Recompilar/publicar con `VITE_TASK_PAGED_ATTACHMENTS=false` mantiene los demás
flags y vuelve a la carga anterior de archivos. Si se revierte también backend,
primero restaurar frontend Cloudflare `dcb5cfe8-e347-4292-880a-3d10e4f69562`, luego
`BOLD_APP_IMAGE_TAG=rollback-before-paged-attachments-2b8c0711 docker compose
--env-file .env.oracle -f compose.oracle.yaml up -d --no-build --no-deps backend worker`
desde `/opt/bold-app/deploy/oracle`. Confirmar versión y salud; no restaurar DB
ni borrar volúmenes para revertir código. Instrucciones de build en sección 11
de `ORACLE_CLOUD_DEPLOYMENT.md`; no omitir flags en builds futuros.

## Estimación para integrar en Develop y presentar la demo

Quedan **tres pasos de aceptación**, estimados como 2–3 sesiones de validación,
no como fecha garantizada. Un fallo funcional o un presupuesto incumplido añade
otra iteración. No hace falta completar todas las reestructuraciones de escala
para 25 personas antes de permitir una demo pequeña con evidencia suficiente.

1. **Aceptación funcional por rol, escritorio y móvil/PWA.** Sesión de propietario
   o Dirección y empleado limitado; comprobar listas/Inicio/progreso/búsqueda,
   subtareas/multiproyecto, comentarios/adjuntos, borradores, CRUD, pérdida de red,
   cambio de asignación, revocación y reconexión. Para escrituras en nube acordar
   previamente las cuentas y datos de prueba; no usar contenido real desechable
   por iniciativa del agente. Es bloqueo real para merge, no mejora cosmética.
2. **Ventana medida de 30–60 minutos con 4–6 usuarios.** Separar arranque, reposo
   visible, pestaña oculta y actividad; todas las pestañas con el mismo build y
   tamaño de datos. Registrar snapshots de diagnóstico y panel/backend; no sumar
   http + http-result + duration como si fueran peticiones distintas. Registrar
   errores, demora de acciones y ráfagas de reconexión, no solo salud pública.
   Criterio propuesto: ausencia de bucles/1027, consumo proyectado de cuenta
   <50.000/día bajo horario/uso acordado (margen frente a 100k), sin denegaciones
   indebidas ni pérdida de cambios. Ese umbral es una reserva elegida, no medición.
   Si no pasa, corregir el recurso dominante; tareas/relaciones por vista dejan
   de ser opcionales si el dataset demuestra que siguen agotando cuota/latencia.
   En la consola del navegador, verificar primero
   `window.boldSyncDiagnostics.snapshot().buildVersion === "2b8c0711"`, ejecutar
   `window.boldSyncDiagnostics.reset()` y recoger `snapshot()` al terminar cada
   escenario. Estas llamadas solo consultan/reinician métricas agregadas locales;
   no ejecutan escrituras ni consultan contenido privado. Anotar duración,
   visibilidad y acciones para no convertir recargas en una tasa de reposo.
3. **Integración y publicación desde Develop.** Revisar Develop remoto actualizado
   y el diff acumulado, resolver posibles solapamientos conservando commits,
   fusionar tras aprobación de los dos pasos anteriores, reconstruir con flags
   y versión del commit resultante. Publicar backend primero, luego cliente;
   smoke test por roles y conservar rollback. Después comenzar uso supervisado
   de la demo; no se declara integración realizada en esta entrega.

Recomendación: hacer ahora la aceptación y la medición pequeña, no seguir
encadenando optimizaciones sin medir el comportamiento real. La paginación
general de tareas con agregados/búsqueda del servidor y el rediseño del editor
de archivos quedan como trabajo de escala, condicionado a resultados.

Para 25 usuarios, después de contratar: prueba representativa en Postgres/Redis
aislados, carga concurrente autenticada y presupuesto CPU/HTTP/capacidad Oracle.
Workers Paid incluye **10 millones de solicitudes al mes**, no al día ni un
límite duro; mínimo USD 5/mes, CPU y excedentes tienen su propia facturación.
La cuota mayor no elimina bucles ni garantiza la capacidad de Oracle.
[Fuente oficial de Cloudflare](https://developers.cloudflare.com/workers/platform/pricing/).
