# Plan de optimización de peticiones y sincronización

Fecha: 1 de octubre de 2026. Estado: propuesta de ejecución, todavía no implementada.

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

Este archivo es un plan: no se ha modificado el comportamiento de la app, desplegado, creado una rama, hecho commit ni cambiado un servicio durante su elaboración.
