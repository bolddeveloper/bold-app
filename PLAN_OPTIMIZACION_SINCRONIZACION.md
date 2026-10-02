# Plan de optimización de peticiones y sincronización

Fecha: 1 de octubre de 2026. Estado: en ejecución; primera entrega de medición local y contención implementada. Ver avance al final.

Base: `ANALISIS_PETICIONES_CLOUDFLARE.md`, revisión de `Develop` en `4c38c852` y comprobación adicional de los consumidores, emisión de revisiones, caché y pruebas existentes.

## 1. Objetivo y límites

Reducir drásticamente las peticiones redundantes, mantener la colaboración en vivo y evitar que la demo agote la cuota por mantener unas pocas pestañas abiertas. Después, comprobar capacidad real para 25 usuarios con actividad y datos crecientes.

No se propone cambiar de proveedor, reescribir toda la aplicación, rediseñar su interfaz ni sustituir el sistema de autenticación. La primera intervención se concentra en sincronización, peticiones, cachés y pruebas. La separación de Core/Tareas se realizará después y de forma gradual.

Las cifras son objetivos verificables, no promesas de resultados ya obtenidos:

| Entrega | Objetivo de tráfico periódico estable por cliente visible |
| --- | --- |
| Referencia actual del propietario | Aproximadamente 5.160 solicitudes/hora, escenario calculado |
| Contención inicial | Hasta 1.250 solicitudes/hora con los mismos datos: reducción de al menos 75 % |
| Contención + canal de control + carga selectiva | Hasta 250 solicitudes/hora: reducción de aproximadamente 95 % frente a esa referencia |
| Ampliación | Mantener el presupuesto con datos y actividad representativos de 25 usuarios |

Medir HTTP y upgrades WebSocket; excluir de la comparación estable el arranque, pero contabilizarlo por separado en el presupuesto diario. Las llamadas de usuarios y los recursos de otros módulos también deben medirse, no desaparecer del cómputo.

Para una operación de tarea ordinaria, el objetivo adicional es evitar recargas de recursos no relacionados y reconciliar como máximo una vez cada recurso afectado en una ráfaga. No se fija un límite universal de solicitudes para operaciones que guardan varias entidades.

## 2. Principios no negociables

- El backend conserva la decisión de acceso en toda lectura y escritura protegida. Una caché del frontend facilita la interfaz; no otorga permisos.
- Mantener tickets de un solo uso, cookies seguras, MFA reciente para operaciones sensibles, revocación y cierre diario a las 07:00 de Guatemala.
- Aislar datos por cuenta, asignación, contexto de acceso y revisión. Limpiar cachés, solicitudes y conexiones al salir o cambiar cargo.
- Una respuesta iniciada en un contexto anterior no puede repoblar datos ni habilitar controles del contexto nuevo.
- No cachear públicamente datos de empleados, tareas o permisos; no registrar credenciales ni tickets.
- No detener ni silenciar indiscriminadamente la auditoría de seguridad para hacer que el sistema parezca más rápido.
- Las mejoras de fondo no deben requerir que el usuario recargue la página después de cada cambio.

## 3. Fase 0 — Medición reproducible y protección operativa

### Trabajo

1. Capturar una referencia antes de cambios: propietario y empleado, 30 minutos visibles e inactivos, foco, navegación y una secuencia breve de tareas/políticas. Si la cuota pública está agotada, reproducir localmente y confirmar en nube cuando se restablezca; no fabricar una medición histórica inexistente.
2. Añadir contadores de diagnóstico para motivo de actualización, recurso, solicitudes activas, duración, socket abierto/cerrado y ticket emitido. Activarlos por configuración y sin datos sensibles.
3. Preparar registros estructurados del proxy/backend con ruta normalizada, estado, latencia y contexto anonimizado. Habilitar observabilidad con muestreo/retención acotados en el despliegue aprobado.
4. Conservar logs fuera del contenedor, con rotación y límite de disco. Definir un único punto de medición por capa para no duplicar artificialmente cifras.
5. Registrar versión de cliente y despliegue: una PWA o pestaña antigua puede seguir ejecutando el patrón anterior después de publicar la corrección.
6. Crear pruebas deterministas con reloj, fetch y WebSocket simulados para las nuevas reglas de sincronización. Evitar pruebas de carga sobre la cuota pública durante esta fase.

### Entregable y aceptación

Informe antes/después por ruta y motivo, pruebas que reproducen la amplificación, y presupuesto de peticiones que incluye todas las capas. La medición no debe añadir una solicitud remota por cada solicitud observada.

Si la demo es inminente, decidir por separado cómo garantizar disponibilidad mientras se corrige: esperar renovación de cuota o aprobar capacidad de Workers. No cambiar suscripciones ni recurrir a bypass de seguridad automáticamente.

## 4. Fase 1 — Contención de bajo riesgo

Esta fase puede avanzar sin espaciar todavía la revisión de permisos cada cinco segundos.

### 1A. Un único coordinador de actualizaciones

- Sustituir el disparo directo de `refresh.current()` por un coordinador con motivo, recursos afectados, contexto y prioridad.
- Compartir la promesa de solicitudes iguales; mantener una única operación por contexto/recurso en vuelo.
- Agrupar eventos durante una ventana inicial de unos 300–500 ms. Durante la descarga, reunir los cambios nuevos en una sola ronda pendiente, no una ronda por socket.
- Separar invalidaciones de seguridad de las de contenido. La revocación no espera el debounce ni el temporizador de contenido.
- Pasar el respaldo general de 30 segundos a un valor inicial de cinco minutos, configurable. Los eventos siguen actualizando los cambios; los recursos sin eventos tendrán recuperación al foco y actualización manual mientras se completa la fase siguiente.

El intervalo de cinco minutos es una decisión provisional de contención. Si un recurso relevante puede quedar obsoleto demasiado tiempo, añadirle invalidación/evento específico, no restaurar la descarga universal cada 30 segundos.

### 1B. Visibilidad, conectividad y recuperación

- Detener las consultas periódicas de contenido cuando la página esté oculta o sin conexión; reducir también procesamiento/refetch de eventos de contenido ocultos.
- Conservar la invalidación de seguridad y el control de sesión separados de ese ahorro.
- Al volver al foco o recuperar conexión, reunir todos los motivos en una sola recuperación de los recursos vencidos.
- No cerrar y reabrir todos los sockets por cada cambio de pestaña. Si más adelante se cierran canales de contenido ocultos, debe existir una política explícita de recuperación y conservarse el canal de control.
- Mostrar discretamente «Sin conexión», «Reconectando» o «Última actualización…», sin avisos repetidos por canal.

### 1C. Caché de catálogos

- Cachear estados y etiquetas por unidad y contexto; reutilizar incluso respuestas vacías.
- Invalidar al editar catálogos, cambiar asignación/acceso y cerrar sesión. Añadir TTL de respaldo configurable; no depender indefinidamente de recibir todos los eventos.
- No repetir dos consultas por cada unidad en cada cambio de tarea.
- En esta fase se puede conservar la carga inicial compatible de todas las unidades necesarias. La carga por vista llega después, para no romper selectores y vistas existentes de golpe.

### 1D. Conexiones diferenciales y reconexión agrupada

- Ampliar el adaptador para conservar canales válidos y cerrar una unidad concreta. Comparar conjuntos autorizados al cambiar revisión.
- Distinguir primera apertura de recuperación de una conexión perdida. Al terminar el bootstrap, no descargar nuevamente todo por cada apertura inicial; cubrir la ventana de conexión mediante una reconciliación agrupada del estado potencialmente desactualizado.
- Agrupar la recuperación de varias conexiones en una sola actualización por recursos/unidades afectados.
- Mantener la deduplicación por evento y agregar agrupación por entidad. No eliminar eventos distintos solamente por compartir tarea: pueden invalidar relaciones diferentes.

### 1E. Reintentos y errores

- 401: detener actividad autenticada y ejecutar el flujo de sesión vencida.
- 403: detener reintentos de esa operación o suscripción hasta un cambio explícito de autorización/contexto. No confundir perder acceso a una unidad con perder toda la sesión.
- 429: respetar `Retry-After` si existe y activar una pausa coordinada. Distinguir throttling de un endpoint del agotamiento general de cuota; no pausar todos los servicios por una restricción aislada.
- Error 1027: presentar indisponibilidad por cuota y suspender reintentos automáticos frecuentes; no hacer que 14 canales consulten el mismo servicio bloqueado.
- Desconexión y 5xx: espera exponencial con variación aleatoria y máximo configurado; una apertura muy breve no debe reiniciar inmediatamente la penalización.
- No reintentar automáticamente escrituras no idempotentes. Una respuesta perdida puede significar que el servidor sí guardó: reconciliar antes de ofrecer repetir.
- Limitar por contexto la emisión simultánea de tickets y garantizar cancelación en logout/desmontaje.

### Aceptación de fase 1

Reducción de al menos 75 % del tráfico periódico de referencia; ningún ticket repetido por denegación terminal; ninguna descarga completa por cada apertura inicial; canales válidos preservados al editar políticas; creación, edición, borradores y cambios optimistas funcionando.

## 5. Fase 2 — Control de seguridad por eventos y menos polling

### Trabajo backend

1. Reutilizar el socket autenticado de notificaciones como canal de avisos de control. Mantener compatibilidad con sus eventos actuales; no abrir el canal administrativo global a empleados normales.
2. Suscribirlo a revisiones de permisos y cambios de asignación que correspondan. Hoy existe emisión `permission.changed` después del commit, pero el consumidor de notificaciones no entrega ese aviso al navegador.
3. Enviar solamente metadatos de control —tipo, revisión y contexto mínimo—, no políticas, auditoría ni datos de otros usuarios.
4. Revisar pertenencia a grupos de asignación/sesión: definir un handler no sirve si la conexión no pertenece al grupo que recibe el evento.
5. En conexión y recuperación, comunicar la revisión vigente. Validar identidad antes de entregar datos; conservar validación por evento y cierre de sesiones revocadas.
6. Manejar vencimientos que ocurren por el paso del tiempo: concesiones temporales, MFA y sesión diaria. No asumir que todos incrementan la revisión global al vencer. Programar invalidación/cierre según su vencimiento y revalidar al recuperar conexión; el backend sigue rechazando acceso vencido.

### Trabajo frontend

- Aplicar la revisión de manera monotónica: eventos atrasados no retroceden el contexto ni reinician repetidamente las mismas comprobaciones.
- Al revocar acceso, invalidar primero cachés y datos afectados, cancelar solicitudes antiguas y cerrar canales no autorizados; después revalidar las vistas que aún correspondan.
- Revisar la caché de permisos: una promesa antigua no puede devolver una autorización utilizable tras cambiar generación. Extender su vigencia solamente cuando la invalidación y los límites temporales sean fiables.
- Tratar MFA reciente por separado: confirmar cambios críticos en el servidor, sin confiar en un `allowed` cacheado de larga duración.
- Con el canal operativo, pasar el polling de revisión a respaldo visible de 60 segundos como punto inicial. Una petición en vuelo por vez, pausa/backoff ante fallos, comprobación al volver al foco y al reconectar.
- Ante incertidumbre de seguridad, suspender controles sensibles y revalidar antes de mostrarlos. No presentar datos cacheados de otro alcance como autorizados.

### Aceptación de fase 2

Un cambio explícito de política llega a una pestaña visible conectada y actualiza su acceso en un objetivo de hasta dos segundos bajo condiciones normales. Ese objetivo de interfaz no sustituye el rechazo inmediato de operaciones posteriores por el backend.

Probar también evento perdido, socket caído, asignación retirada, sesión revocada, MFA vencido y concesión temporal que expira sin nuevas ediciones. Solo después aprobar el nuevo intervalo de revisión.

## 6. Fase 3 — Actualizaciones incrementales y consultas por necesidad

### 3A. Estado por recurso y carga parcial

- Dividir `loadTaskData` en cargadores de proyectos, tareas, catálogos, relaciones y notificaciones. Mantener un adaptador temporal para la UI actual.
- Crear almacenamiento normalizado por identificador. Una tarea puede actualizarse sin reemplazar todos los datos ni regenerar referencias ajenas.
- Cargar listas paginadas realmente y limitar comentarios, adjuntos, seguidores y etiquetas al proyecto/vista/tarea que los necesita.
- Añadir filtros o endpoints agregados acotados cuando los existentes no permitan una carga parcial eficiente. Medir primero; no crear una consulta sin límites que replique todo el grafo.
- Separar catálogos globales/organizativos de catálogos por unidad. Conservar el acceso universal del propietario y la agrupación por departamentos.

### 3B. Matriz de invalidación

| Cambio | Actualización esperada |
| --- | --- |
| Tarea creada/modificada | Tarea y listas/resúmenes afectados |
| Tarea trasladada | Unidades/proyectos de origen y destino; retirar donde ya no es visible |
| Tarea eliminada | Retirar entidad, relaciones y selecciones afectadas |
| Comentario nuevo | Comentarios de esa tarea y contadores afectados |
| Miembro/seguidor/adjunto | Relación correspondiente, sin recarga general |
| Notificación nueva o leída | Bandeja y contador del destinatario |
| Catálogo editado | Catálogo de la unidad y controles dependientes |
| Política/asignación | Invalidación inmediata de seguridad y recuperación del alcance autorizado |

La matriz definitiva exige revisar todos los eventos existentes. Un identificador de operación puede ayudar a reunir respuesta local y eventos propios, pero no debe ocultar modificaciones concurrentes de otra persona.

### 3C. Consistencia y UX

- Preferir respuestas autorizadas y suficientemente completas después de guardar; pedir detalle solo si la respuesta no cubre la vista.
- Mantener actualización optimista con rollback y versión de mutación. Respuestas o eventos atrasados no deben revertir un cambio más reciente.
- En una reconexión, eventos perdidos no se recuperan por magia: reconciliar vistas relevantes. Añadir cursor/versiones o entrega durable solo si las mediciones justifican su complejidad.
- Conservar respaldo para recursos todavía sin eventos y una actualización manual clara.
- No perder borradores al recuperar conexión, cambiar vista ni aplicar una versión nueva del cliente.

### Dependencias que no pueden romperse

Inicio, bandeja de entrada, búsqueda global, calendario y progreso de proyectos actualmente pueden depender del conjunto completo de tareas. Al introducir paginación, usar consultas/resúmenes autorizados para mantener totales y búsqueda global: no calcular «todas las tareas» a partir de la página cargada.

Revisar jerarquía de subtareas, responsables, filtros, selección masiva y tareas vinculadas a varios proyectos. No retirar la carga antigua hasta cubrir estas dependencias con pruebas.

### Aceptación de fase 3

Hasta 250 solicitudes de fondo por cliente visible y hora con datos de referencia; nada de consultas periódicas de contenido en pestañas ocultas; cambios visibles para otro usuario en el objetivo normal de dos segundos; ninguna descarga de catálogos no afectados al editar una tarea.

Al crecer comentarios o historial, una tarea visible no debe provocar descarga de todas las páginas de la empresa. La carga inicial queda medida y limitada por vista, no oculta fuera del presupuesto.

## 7. Fase 4 — Core independiente y backend medido

- Extraer a Core la coordinación de ciclo de vida, sesión, control de permisos y notificaciones compartidas. Tareas mantiene su estado y lógica de dominio.
- Administración, Permisos y Sugerencias deben abrirse sin inicializar todo Tareas. Los módulos que necesitan información de tareas solicitarán consultas explícitas.
- Estabilizar referencias de funciones/proveedores para no repetir comprobaciones por un render ajeno. Limitar permisos de selección a la selección/contexto/revisión realmente cambiados.
- Medir SQL de endpoints más solicitados: evitar repetir evaluación de unidades por catálogo cuando pueda resolverse una vez por solicitud. Corregir N+1, usar relaciones precargadas y filtros eficientes.
- Agregar índices solo cuando el patrón de consulta/plan de ejecución los justifique. No cachear decisiones de autorización entre usuarios sin aislamiento y vencimientos fiables.
- Agrupar escrituras de última actividad solamente si se conservan correctamente expiración, auditoría necesaria y cierre diario. No optimizar esto antes de eliminar el tráfico innecesario.
- Acotar espera de Meet, heartbeat de borradores y demás temporizadores secundarios; detenerlos al abandonar el contexto y presentar un estado recuperable al agotar el plazo.

No se propone imponer ahora una nueva biblioteca de estado o una migración general: primero establecer contratos pequeños y testeables con la infraestructura existente.

## 8. Fase 5 — Varias pestañas y capacidad de 25 usuarios

La coordinación entre pestañas es una mejora posterior, no un requisito para arreglar la causa principal. Implementarla solo si las mediciones muestran que sigue aportando una reducción importante.

- Evaluar una pestaña líder para avisos compartidos, con recuperación si se cierra o se suspende. Mantener independencia entre cuentas/asignaciones y no compartir credenciales.
- Preferir compartir invalidaciones, no replicar datos sensibles indiscriminadamente. Tener respaldo cuando el mecanismo no esté disponible.
- Ejecutar pruebas escalonadas de 5, 10 y 25 clientes en un entorno controlado con datos sintéticos y presupuesto aprobado.
- Separar escenario inactivo de actividad representativa: tareas, comentarios, notificaciones, búsquedas, políticas y varias pestañas.
- Medir p50/p95, errores, solicitudes por acción/hora, tickets, conexiones, CPU, memoria, SQL y carga inicial. Usar un volumen futuro representativo; 12 tareas no acreditan capacidad para meses de operación.

Como objetivos iniciales para calibrar tras la referencia: p95 de lectura normal hasta un segundo, guardado hasta dos segundos sin contar cargas de archivos/servicios externos, y cero errores inesperados de consistencia/autorización en las pruebas deterministas. No son SLA prometidos ni resultados medidos.

## 9. Pruebas obligatorias y puntos del repositorio

Extender las pruebas existentes, no limitarse a que el build compile:

- `frontend/modulos/tareas/src/services/realtime_adapter.test.js`: aperturas iniciales, reconexión, comparación de unidades, errores terminales, jitter/cancelación y límites de tickets.
- `frontend/modulos/notificaciones/notification_realtime.test.js`: eventos de control, recuperación y aislamiento por asignación.
- `frontend/modulos/tareas/src/permission_cache.test.js`: generaciones antiguas, revisiones atrasadas, vencimientos e invalidación de respuestas en vuelo.
- `frontend/modulos/tareas/src/services/task_service.test.js`: conteo de fetch, catálogos vacíos cacheados, cargas parciales y paginación.
- Nuevas pruebas del coordinador con reloj inyectado: visibilidad, foco, red caída, ráfagas y una sola ronda pendiente.
- `backend/boldApp/permisos/tests/test_permissions_security.py` y pruebas de autorización: revocación, scopes, propiedad de tareas, dueño y MFA.
- `backend/boldApp/notificaciones/tests/test_notifications.py` y consumidores de tareas: grupos de control, identidad, eventos después del commit y cierre por revocación/vencimiento.
- Worker y arquitectura Core: mantener rutas/proxy seguros y módulos hermanos independientes.

Ejecutar `npm test`, `npm run test:worker` y `npm run build` desde `frontend/modulos/core`, además de las suites Django afectadas en una base de pruebas. Añadir pruebas de consumidor asíncrono cuando las suites actuales no cubran el contrato WebSocket.

La validación manual debe incluir móvil/PWA, propietario, colaborador limitado a sus tareas, líder de unidad/subárbol y concesión temporal. No probar solo con el propietario, porque su acceso universal oculta errores de aislamiento.

## 10. Orden de entregas, despliegue y reversión

Propuesta: una rama de optimización desde el estado actualizado de Develop, conservando cambios locales ajenos. No crearla ni hacer merge sin pasar a implementación.

Commits sugeridos, pequeños y verificables:

1. Diagnóstico y pruebas de presupuesto de peticiones.
2. Coordinador, visibilidad y respaldo de contenido.
3. Catálogos cacheados y conexiones diferenciales.
4. Clasificación de errores y recuperación controlada.
5. Contrato de control backend compatible con clientes anteriores.
6. Consumo del control frontend y polling de respaldo.
7. Cargadores/actualizaciones parciales por grupos de recursos.
8. Separación de Core, optimizaciones backend y validación de capacidad.

Los bloques son un orden técnico, no ocho despliegues obligatorios. Para la demo, priorizar fases 0–2 y la parte de fase 3 necesaria para alcanzar el presupuesto; no esperar a coordinación entre pestañas ni a una refactorización completa.

### Publicación segura

1. Mantener los contratos actuales durante la transición; introducir funciones nuevas detrás de configuración explícita, con sus combinaciones documentadas.
2. Publicar primero el backend compatible; después el frontend que usa el aviso de control. No espaciar revisión si el backend todavía no anuncia esa capacidad.
3. Verificar migraciones, si alguna fase las requiere; la contención inicial no necesita alterar el esquema de la base de datos.
4. Medir en nube los mismos escenarios y comparar tasas normalizadas, no solo el total de un día.
5. Detectar clientes antiguos y ofrecer actualización segura, preservando borradores. Confirmar que la PWA usa los assets nuevos y los clientes de pruebas antiguos ya no siguen generando tráfico.
6. Mantener rollback de versión. Si falla la actualización incremental, volver temporalmente a una reconciliación acotada, no a la recarga universal cada 30 segundos.
7. Si falla la invalidación de seguridad, bloquear capacidades inciertas y recuperar verificación conservadora. El ahorro nunca justifica mostrar acceso revocado.

### Condición para declarar finalizado

Solo cerrar la optimización cuando exista evidencia de reducción y de consistencia, pruebas de seguridad aprobadas, recuperación sin tormentas, métricas conservadas tras redeploy y prueba de capacidad representativa. Una cifra menor de Cloudflare con usuarios desconectados no demuestra una aplicación optimizada.

## 11. Recomendación concreta

Empezar por fases 0 y 1 con pruebas y cambios mínimos, añadir inmediatamente fase 2 para poder reducir polling sin debilitar revocación, y continuar con sincronización parcial. Detener nuevas ampliaciones de módulos si siguen usando la recarga general como mecanismo de actualización.

No resolverlo comprando un plan y dejando la arquitectura igual, pero tampoco descartar capacidad pagada si hace falta asegurar una demo con fecha próxima. La disponibilidad operativa y la corrección estructural son decisiones complementarias.

Al redactar inicialmente este plan no se había modificado el comportamiento de la app ni cambiado un servicio. El avance posterior se documenta a continuación.

## 12. Avance de la primera entrega — 1 de octubre de 2026

Rama: `perf/sincronizacion-trafico`, separada de Develop. Primer commit: `9fe29b29`, diagnóstico y referencia reproducible.

Implementado:

- Diagnóstico agregado opcional en memoria, sin telemetría remota, URLs privadas, tickets o datos personales. Con `VITE_SYNC_DIAGNOSTICS=true`, consultar `window.boldSyncDiagnostics.snapshot()`; incluye la versión de build. `reset()` inicia una ventana nueva de medición.
- Coordinador con debounce de 400 ms, una carga en vuelo y una ronda pendiente; seguridad no bloqueada por pestaña oculta.
- Respaldo de Tareas cada cinco minutos (`VITE_TASK_RECONCILE_MS`), sin polling de contenido oculto/offline y recuperación agrupada al regresar.
- Caché de catálogos vacíos/no vacíos por contexto, TTL de 15 minutos, invalidación al cambiar permisos y cancelación de respuestas antiguas.
- Conexiones por diferencia de unidades; apertura inicial diferenciada de reconexión y una recuperación agrupada al terminar el handshake.
- Máximo de dos peticiones de ticket en vuelo; backoff con jitter y sin reinicio inmediato por conexiones inestables; sin reintentos automáticos para 401/403.
- Respeto a `Retry-After`; bloqueo local acotado de un endpoint ante throttling y de la API ante cuota 1027. No se reintentan escrituras automáticamente.
- Caché de permisos monotónica y conservadora ante respuestas de generaciones anteriores; invalidación de datos y cambios optimistas del alcance antiguo.

Prueba controlada con el cargador real y HTTP simulado: el arranque sigue costando 37 solicitudes para los datos de referencia. Una hora posterior con respaldo cada cinco minutos y catálogos cacheados genera 236 consultas de contenido; añadiendo los 720 checks de seguridad que se conservan, son **956 solicitudes periódicas/hora**, frente a 5.160 del escenario original: **81,47 % menos**. No incluye acciones, tickets, verificaciones adicionales ni pretende ser una captura de producción.

Verificación inicial: 85 pruebas de frontend, 4 de Worker y build correcto. Queda el aviso preexistente de tamaño del bundle, no un error de compilación. La reducción no se debe declarar medida en nube hasta recoger una ventana real con clientes actualizados.

Pendiente de la fase 0: registros estructurados/retención en el servidor y medición real por cargo. Pendiente de fases siguientes: canal de control backend, vencimientos por tiempo, reducción segura del polling de permisos, actualizaciones parciales, separación completa Core/Tareas y prueba de capacidad de 25 clientes.

La comprobación pública de las 21:06 UTC seguía devolviendo cuota 1027. Publicar el frontend no renueva una cuota agotada. No se modificó el backend ni la base de datos en esta entrega; Oracle no necesita reinicio para estos cambios.

### Publicación de la contención

- Commit de código: `52582d93`; rama publicada en GitHub: `perf/sincronizacion-trafico`. Develop no se ha fusionado ni modificado.
- Versión desplegada en Cloudflare: `d49e55c5-3fc3-462e-8f94-20add9a73a9a`.
- Versión anterior registrada para reversión: `1291900c-b56b-4885-b093-67429ed534ba`.
- Frontend compilado en modo real, API del mismo origen y diagnóstico agregado local habilitado, con `buildVersion=52582d93`.
- Verificación posterior: raíz HTTP 200, bundle `index-C_JAK1qX.js` HTTP 200 y versión correcta presente. API de salud: HTTP 429 y error 1027; la prueba autenticada en nube sigue pendiente de recuperación de cuota.
- Oracle continúa ejecutando el backend anterior de Develop, compatible con esta entrega. No se alteraron infraestructura, usuarios, secretos ni esquema.

Para probar cuando vuelva la API, guardar primero cualquier borrador y actualizar cada pestaña/PWA de la demo. Comprobar `window.boldSyncDiagnostics.snapshot().buildVersion`, ejecutar `reset()` y recoger una ventana de 30 minutos del propietario y otra de un colaborador sin actividad. Medir por separado las acciones; no confundir los contadores del arranque con tráfico estable. No se hicieron creaciones de tareas ni cambios de permisos en producción para fabricar una prueba.

La siguiente entrega será el canal de control y sus vencimientos, con pruebas de consumidores y revocación antes de reducir el polling de permisos. Los cambios incrementales por recurso siguen pendientes; esta publicación no significa que todo el plan esté finalizado.

## 13. Segunda entrega — control de seguridad y vencimientos

Implementación de fase 2 en la misma rama `perf/sincronizacion-trafico`:

- Notificaciones recibe grupos de sesión, asignación propia y revisión de permisos. No se abre el canal administrativo global a empleados normales.
- Sobres de control mínimos v2 con revisión, huellas opacas de estado/contexto y secuencia por conexión. Se anuncia la capacidad explícita antes de espaciar el respaldo.
- Heartbeat autenticado cada 30 segundos, adelantado al siguiente límite de seguridad; cierre automático por expiración diaria/inactividad, revocación de sesión o plaza y rotación de credenciales.
- Invalidación por inicio/vencimiento de concesiones, autoridades propias/ancestrales y MFA reciente, aunque no cambie la revisión global. Las huellas también recuperan señales perdidas y cambios de modelos sin incremento de revisión.
- Avisos duplicados o atrasados no provocan nuevas invalidaciones ni restauran autorizaciones anteriores. Suspensión local al perder la conexión, vencer el control de 45 segundos o alcanzar un límite temporal anunciado.
- Core conserva una sola verificación REST en vuelo. Con control confirmado: respaldo visible de un minuto y pausa en pestañas ocultas. Sin control confirmado: cinco segundos; offline no hace HTTP y `Retry-After`/cuota no se ignoran.
- Las decisiones individuales de autorización conservan TTL de cinco segundos; MFA/escrituras siguen verificándose en el servidor. No se alarga una autorización porque el WebSocket esté conectado.
- Tareas cancela respuestas antiguas y oculta datos del alcance anterior; Administración/Permisos limpian vistas sensibles y protegen respuestas en vuelo. Cambios organizativos del propio contexto reconstruyen Core antes de remontar los módulos.
- La apertura del canal de control ya no depende de completar la descarga de Tareas. La propiedad final de sockets se moverá a Core en fase 4.
- Diagnóstico local agrega `permission-control:verified-event`, `permission-control:fallback-healthy`, `permission-control:fallback-degraded` y `permission-control:uncertain`, sin tickets, URLs ni datos personales.

### Configuración y compatibilidad

`VITE_PERMISSION_CONTROL_ENABLED=true` habilita el consumo del nuevo contrato.
Si se compila con `false`, el cliente mantiene el respaldo conservador de cinco
segundos; el backend nuevo continúa siendo compatible con ese cliente. Un
backend anterior tampoco activa el respaldo lento porque no anuncia capacidad.
El endpoint existente `/api/v2/permissions/revision/` conserva `revision` y, con
sesión propia/plaza seleccionada, añade huellas y próximo límite temporal. Sin
cabecera de plaza mantiene el contrato original. No hay migraciones nuevas.

### Referencia reproducible, no medición en producción

Una hora visible sin acciones, con heartbeat sano, produce **60 verificaciones
periódicas de revisión** (arranque aparte), frente a 720. El cargador de referencia
de fase 1 sigue produciendo 236 consultas de contenido: **296 peticiones
periódicas/hora/pestaña**, frente a las 5.160 iniciales (**94,26 % menos**).
No incluye bootstrap, autorización por recurso, tickets, reconexiones ni acciones.
La meta de 250 todavía requiere la carga parcial de fase 3. No prometer capacidad
para 25 usuarios sin pruebas representativas ni presentar estos números como
estadísticas reales de Cloudflare.

### Pruebas y comprobación manual

Ejecutar desde el repositorio con la base aislada, sin heredar PostgreSQL, Redis o
correo del desarrollador:

```powershell
.\.venv\Scripts\python.exe backend/manage.py test boldApp.notificaciones.tests boldApp.permisos.tests boldApp.core.tests boldApp.autenticacion.tests boldApp.administrativo.tests boldApp.tareas.tests boldApp.sugerencias.tests boldApp.calendario.tests --settings=config.settings_test --noinput
```

Desde `frontend/modulos/core`: `npm test`, `npm run test:worker`, `npm run build`.
Resultado antes de publicar: **145 pruebas Django, 98 de frontend y 4 de Worker
correctas**, build correcto y `makemigrations --check --dry-run` sin cambios.
Persisten los avisos preexistentes de directorio staticfiles local ausente y
tamaño del bundle; no se confundieron con fallos de las pruebas.
Se cubren ticket de un uso, aislamiento, revocación, rotación de credenciales,
plaza retirada, cierre diario/inactividad sin eventos, MFA/concesiones/ancestros
vencidos, señales después del commit y no después de rollback, señal perdida,
contexto cambiado, secuencias/revisiones antiguas, pérdida de control, quota,
offline/foco, pestaña oculta y presupuesto horario. No se usan cuentas de demo
para escribir datos en producción durante estas pruebas.

Cuando vuelva la API pública: guardar borradores, actualizar pestañas/PWA,
comprobar versión de build y ejecutar `window.boldSyncDiagnostics.reset()`.
Con una pestaña visible y sin acciones, contar `fallback-healthy` (aproximadamente
una por minuto) y `verified-event` (aproximadamente dos por minuto). Una pestaña
oculta con control sano no debe generar consultas de respaldo. Usar una cuenta
limitada y una concesión temporal de prueba en entorno controlado para validar
retirada/vencimiento y recuperación; comprobar que un cambio de política no
reabre todos los canales válidos. No atribuir un fallo de cuota 1027 al backend
ni suponer que publicar código renueva la cuota.

La medición de nube, retención/observabilidad de fase 0, actualizaciones parciales
de fase 3 y prueba de capacidad siguen pendientes. El objetivo de interfaz de
dos segundos queda sujeto a validación pública; las pruebas deterministas no
son una medición de latencia de extremo a extremo.

### Publicación y verificación de la fase 2 — 1 de octubre de 2026

- Backend/contrato: `8a6aaa5a`; frontend/control: `e2ba4b85`, ambos publicados en GitHub.
- Oracle ejecuta temporalmente `perf/sincronizacion-trafico` en `e2ba4b85`. Develop permanece en `4c38c852`, sin merge. El clon remoto solo traía Develop; se recuperó explícitamente la rama nueva y se verificó el checkout limpio. La rama de prueba no tiene upstream; actualizarla con fetch explícito y merge `--ff-only`, no un `git pull` sin destino.
- Respaldo previo: `/opt/bold-app/deploy/oracle/backups/boldapp-20261001T215252Z.dump`. No se borraron respaldos anteriores.
- Imagen anterior conservada como `bold-app-backend:rollback-before-control-20261001` (ID corto `26fdd9140a1f`). Nueva imagen: `776d7a608196`. Solo se recrearon backend/worker; PostgreSQL, Redis y el túnel se conservaron. No se modificaron secretos, cuentas, permisos ni esquema.
- Backend saludable y `/health/` interno HTTP 200. Sonda ASGI interna con sesión activa existente de un empleado normal y ticket efímero: conexión/capacidad correctas, heartbeat recibido sin forzar recarga y rechazo del ticket reutilizado con 4403, usando PostgreSQL/Redis reales. No se crearon sesiones nuevas ni registros de demo en producción. Esta sonda no atraviesa Cloudflare ni sustituye la prueba pública.
- Cinco lecturas internas del estado de seguridad del mismo empleado: ocho consultas SQL por lectura; tiempos totales 19,36 / 9,42 / 9,23 / 9,12 / 9,16 ms. Es una comprobación puntual con datos actuales, no p95 ni prueba de carga. El heartbeat reduce HTTP, pero hace trabajo en Oracle: medir SQL/CPU y autoridad ancestral compleja en fases posteriores; no describirlo como coste cero.
- Cloudflare: versión `d7200883-ea63-49f6-ad0c-f3b5fbe0fb8a`, build `e2ba4b85`, control habilitado y diagnóstico agregado local habilitado. Bundle `index-D4ELxJ-e.js`.
- Comprobación pública de las **21:58:48 UTC**: raíz y bundle HTTP 200, hash/versiones correctos; `/health/` HTTP 429 y cuota 1027. El recorrido autenticado y la ventana de tráfico siguen pendientes de recuperación de cuota y actualización de las pestañas/PWA.

Reversión de frontend: versión anterior `d49e55c5-3fc3-462e-8f94-20add9a73a9a`
mediante el mecanismo de rollback de Wrangler. Antes de una reversión del backend,
preferir volver el frontend al respaldo conservador. Si fuese necesario recuperar
la imagen anterior, desde `/opt/bold-app/deploy/oracle`:

```bash
BOLD_APP_IMAGE_TAG=rollback-before-control-20261001 docker compose --env-file .env.oracle -f compose.oracle.yaml up -d --no-build backend worker
```

Esa orden no restaura ni borra PostgreSQL; no ejecutar `down -v`, `git reset --hard`
ni restaurar el dump sobre la base activa para revertir este cambio sin migraciones.
El checkout puede seguir en la rama de prueba aunque el runtime use la imagen de
rollback: comprobar ambas versiones. Tras aceptar/integrar el cambio en Develop,
retomar la rama normal del servidor; no fusionarla automáticamente antes de la
validación de los clientes limitados y los vencimientos en la web.
## 14. Fase 3 — primera entrega de sincronización parcial

Esta entrega implementa el almacenamiento por recurso y la matriz de invalidación;
**no declara terminada toda la fase 3**. El arranque y el respaldo general todavía
leen las listas completas autorizadas. La paginación visible y la carga inicial
por vista requieren otra entrega con resúmenes/búsqueda equivalentes; no se deben
falsear los totales de Inicio, calendario ni progreso tomando solo una página.

### Cambios

- Nuevo cargador con mapas por ID para tareas, proyectos, relaciones, catálogos
  y notificaciones. Una ronda fallida no publica un estado parcial; la generación
  de autorización descarta lecturas antiguas. Se conserva el adaptador de la UI.
- Los avisos son invalidaciones, no datos confiables: se consulta el endpoint
  autorizado actual. Comentario: solo comentarios de su tarea; tarea: tarea y
  vínculos; notificación: solo bandeja; relación: solo esa relación. Una creación
  recupera la tarea y sus relaciones; movimientos/borrados retiran relaciones
  que quedaron fuera de visibilidad. Se conserva el orden de las filas.
- Backend compatible con clientes anteriores: `tasks?ids=…`, relaciones
  `?tasks=…` y catálogos `?units=…`, con UUID válidos y máximo 50 IDs por lote.
  Los filtros reducen resultados, nunca reemplazan autorización. Los catálogos
  mantienen la excepción de estados requeridos por quien puede crear tareas.
- Estados/etiquetas por lotes, manteniendo TTL de 15 minutos y paginación HTTP;
  un evento de catálogo consulta solo las unidades indicadas. Cambios de
  proyectos, secciones, miembros, seguidores, etiquetas, comentarios y adjuntos
  emiten invalidaciones mínimas después del commit, también al eliminarlos.
  Estos avisos nuevos no se envían como nuevos webhooks salientes.
- Guardados locales invalidan su grupo en lugar de todo el grafo. El estado de
  una tarea se confirma con su lectura individual. Las actualizaciones
  optimistas confirmadas siguen protegidas si falla la lectura posterior;
  una consulta iniciada antes del guardado no puede retirarlas.
- Se mantienen respaldo de cinco minutos, recuperación al foco/reconexión,
  ausencia de polling de contenido oculto/offline e invalidación inmediata
  de seguridad. No se cambia sesión, MFA, permisos ni datos de empleados.

### Pruebas y límites

Referencia determinista con 13 unidades, 65 estados (5 por unidad), 29 miembros
de proyectos, páginas de 25 y otros recursos vacíos: **15 solicitudes de
arranque y 148 de contenido periódico/hora**. Con 60 lecturas de permisos en
control saludable: **208/hora**, debajo del objetivo de 250. La referencia
anterior costaba 296/hora con igual cantidad de páginas por catálogo individual.
El arranque, acciones, comprobaciones adicionales, tickets y reconexiones quedan
fuera del presupuesto periódico y deben medirse aparte. No es tráfico medido
en Cloudflare ni prueba de capacidad de 25 usuarios.

Pruebas: 110 frontend, 4 Worker, 150 Django; sin migraciones pendientes. Build
correcto; persiste el aviso previo de tamaño del bundle. Se prueban filtros
sin ampliar visibilidad, creación sin permiso de catálogo, borrado de
relaciones, dos receptores, rollback sin emitir eventos, IDs acotados,
respuestas de otro contexto, rondas atómicas y consistencia de subtareas.

### Activación y reversión

Primero desplegar el backend compatible; después compilar el frontend con
`VITE_TASK_INCREMENTAL_SYNC=true`. Con `false`, el cliente conserva el cargador
de fase 2 sin los filtros nuevos ni la reducción de catálogos por lotes. El
backend nuevo admite ambas versiones. No mezclar el cliente incremental con
el backend anterior, que ignoraría filtros y daría resultados incorrectos.

### Siguiente tramo obligatorio

1. Medir una ventana autenticada real (propietario y cargo limitado), dos
   clientes editando/comentando y recuperación de foco/red/alcance. Verificar
   versión del cliente antes de comparar tasas.
2. Acotar el arranque y la paginación de comentarios, adjuntos, historial y
   listas por vista, manteniendo resúmenes y búsqueda autorizados.
3. Medir CPU/SQL y costo del adaptador, que aún recompone el conjunto en
   memoria aunque reutiliza objetos iguales. Las lecturas acotadas todavía
   usan la evaluación de visibilidad general existente; optimizarla con
   evidencia, no añadir índices ni cachés de permisos indiscriminadamente.

No avanzar a declarar completa la optimización ni fusionar Develop únicamente
por el resultado simulado de 208/hora.
