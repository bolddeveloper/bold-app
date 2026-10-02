# Análisis del exceso de peticiones de Bold

Fecha: 1 de octubre de 2026. Rama examinada: `Develop`, commit `4c38c852`. Versión de Cloudflare comprobada: `1291900c-b56b-4885-b093-67429ed534ba`.

## 1. Conclusión ejecutiva

Existe un problema comprobado de amplificación de tráfico en el frontend. No hace falta un ataque ni muchos usuarios para generar el volumen observado: se descarga reiteradamente casi todo el módulo de tareas y sus relaciones, mientras otros mecanismos vuelven a solicitar la misma descarga.

Los cuatro factores principales son:

1. Recarga completa cada 30 segundos, aunque no haya cambios y aunque se esté viendo otro módulo.
2. Dos consultas de catálogos por cada unidad organizativa en cada recarga.
3. Comprobación de revisión de permisos cada 5 segundos; cuando cambia, se cierran y reconstruyen todos los WebSockets de tareas. Cada apertura vuelve a solicitar una recarga completa.
4. Eventos de tareas, notificaciones, operaciones locales y reconexiones comparten la misma recarga general, sin una política de invalidación por recurso.

Para el contexto actual del propietario, una recarga completa requiere **37 peticiones HTTP**. Con temporizadores activos y respuestas suficientemente rápidas, el tráfico periódico modelado es **5.160 peticiones por hora y pestaña**, antes de sumar actividad, verificaciones adicionales y reconexiones. Tres pestañas durante ocho horas producen aproximadamente **123.840 peticiones** solamente por esta sincronización periódica. Eso explica la magnitud del problema, pero no atribuye exactamente cada una de las peticiones históricas.

No se ha demostrado una fuga de memoria ni una acumulación indefinida de temporizadores. Sí se ha demostrado una sincronización demasiado costosa y mecanismos que la amplifican. Tampoco se puede descartar todo tráfico externo sin registros por ruta.

## 2. Qué se revisó y qué límites tiene la investigación

Se contrastaron el código de sincronización y autorización, las métricas de Cloudflare, el estado de Oracle, los registros persistentes de autenticación/permisos y los tamaños actuales de las tablas. Se ejecutó además el cargador real de tareas en una prueba local con HTTP simulado: esa prueba no consumió peticiones de producción.

### Evidencia observada

- Cloudflare mostró inicialmente aproximadamente 148.430 invocaciones en las últimas 24 horas; al actualizar la ventana móvil, unas 147.460. No son necesariamente un único día de cuota UTC.
- Las subpeticiones estaban prácticamente a la par de las invocaciones, coherente con un Worker que reenvía solicitudes al backend. No deben sumarse como si fueran dos grupos independientes de solicitudes facturables.
- Los assets eran unos 849 en la primera lectura: no tienen una magnitud que explique el problema.
- La URL pública devolvió HTTP 429 con página de error **1027**.
- El endpoint interno de salud de Oracle respondió **200**, usando los encabezados correspondientes al proxy HTTPS.
- En una instantánea sin carga, backend, worker, PostgreSQL y túnel consumían poca CPU; esto no constituye una prueba de capacidad para 25 usuarios.
- Workers Observability estaba deshabilitado. El despliegue previo había recreado los contenedores del backend, por lo que sus antiguos access logs ya no estaban disponibles.

El contador de excepciones del Worker en cero no demuestra que la API esté sana: respuestas HTTP de error y bloqueos de cuota pueden no reflejarse como excepciones del código del Worker.

### Auditoría persistente: últimas 24 horas consultadas

- **1.358 tickets WebSocket emitidos**: 1.257 de tareas y 101 de notificaciones.
- Una sesión del propietario concentraba **1.075 tickets**; otra, 73.
- **97 eventos de políticas**: 78 reemplazos individuales exitosos, 16 masivos exitosos y 3 denegados.
- En la hora del **1 de octubre, 02:00–03:00 UTC** —30 de septiembre, 22:00–23:00 en Caracas— hubo 96 eventos de políticas y 974 tickets: 961 de tareas y 13 de notificaciones.
- La auditoría de permisos tenía 2.885 registros; 2.700 correspondían a `tasks.task.read`: 1.408 denegaciones y 1.292 autorizaciones.
- Aparecían nueve cuentas actoras y 24 sesiones con tickets. Eso no demuestra nueve personas concurrentes: las pruebas pueden usar distintas cuentas.

La coincidencia temporal entre edición de políticas y emisión de tickets respalda la amplificación por reconstrucción de conexiones. No permite distinguir retrospectivamente todas las desconexiones de red de las reconexiones deliberadas del frontend. Los tickets exitosos tampoco cuentan todos los intentos fallidos.

## 3. Coste de una recarga: reproducción controlada

Referencia: `frontend/modulos/tareas/src/services/task_service.js`, función `loadTaskData`, desde línea 6.

El contexto examinado tiene 13 unidades. Para el propietario, la lista visible de miembros de proyecto tiene 29 registros y necesita dos páginas de tamaño 25. Sus notificaciones actuales necesitan una página; no debe confundirse este dato con las 69 notificaciones totales de todos los destinatarios.

| Recurso | Peticiones por recarga |
| --- | ---: |
| Proyectos | 1 |
| Secciones | 1 |
| Estados, una consulta por unidad | 13 |
| Tareas | 1 |
| Relaciones tarea/proyecto | 1 |
| Comentarios | 1 |
| Seguidores | 1 |
| Miembros de proyectos, dos páginas | 2 |
| Adjuntos | 1 |
| Notificaciones del propietario | 1 |
| Relaciones tarea/etiqueta | 1 |
| Etiquetas, una consulta por unidad | 13 |
| **Total** | **37** |

Las consultas vacías también cuentan: actualmente no hay etiquetas ni adjuntos, pero se solicitan igualmente. Estados y etiquetas suman 26 de las 37 solicitudes de esta recarga.

Se importó el `loadTaskData` real en Node y se sustituyó `fetch` por respuestas simuladas con paginación de miembros de proyecto equivalente a la observada. El resultado fue 37 solicitudes. Es una comprobación del cargador, no una captura completa de una sesión de navegador ni una prueba de carga sobre producción.

La fórmula general, si cada recurso cabe en una página, es:

```text
Solicitudes por recarga = 10 + 2 × unidades + páginas adicionales
Solicitudes periódicas/hora = 120 × solicitudes por recarga + 720
```

Los 720 adicionales proceden de consultar la revisión de permisos cada cinco segundos. Con 13 unidades, el mínimo sin páginas adicionales es 36 solicitudes por recarga; en el contexto del propietario son 37.

Los cálculos suponen una pestaña autenticada funcionando continuamente y recargas que terminan antes del siguiente intervalo. Los navegadores pueden ralentizar pestañas ocultas y el cargador agrupa algunas solicitudes coincidentes. Por ello son escenarios de planificación, no mediciones exactas de tráfico por hora.

## 4. Causas, por prioridad

### P0: recarga general cada 30 segundos

Referencias: `frontend/modulos/tareas/src/task_app.jsx:4964`, `:4973`, `:5039`; `frontend/modulos/core/app.jsx`.

El componente de tareas permanece montado como contenedor de la navegación de los módulos hermanos. Entrar en Administración o Permisos no detiene su recarga de tareas. Recuperar el foco de la ventana también dispara una recarga.

Hay serialización mediante `running` y `dirty`: no se generan siempre tantas recargas simultáneas como eventos. Sin embargo, un evento recibido durante una descarga marca otra ronda pendiente. No existe una ventana mínima entre recargas ni una actualización limitada al recurso afectado.

**Consecuencia:** una pestaña puede consumir miles de solicitudes por hora sin que el usuario haga nada. Además, al crecer tareas, comentarios o miembros, el cliente recorre todas las páginas y el coste aumenta.

### P1: revisiones de permisos reconstruyen todas las conexiones

Referencias: `frontend/modulos/core/core_provider.jsx:149`; `frontend/modulos/tareas/src/task_app.jsx:5013`, `:5020`, `:5034`; `frontend/modulos/tareas/src/services/realtime_adapter.js:38`.

La revisión se consulta cada cinco segundos, sin pausa explícita por pestaña oculta, desconexión o solicitud anterior todavía pendiente. Una revisión estable no invalida por sí sola toda la caché; la amplificación importante ocurre cuando cambia.

Cuando cambia la revisión, `syncRealtime` desconecta todos los canales de tareas, comprueba acceso por unidad y vuelve a conectarlos. El propietario puede abrir 13 canales de tareas más uno de notificaciones. El callback denominado `onReconnect` se ejecuta incluso en la primera apertura, y cada apertura solicita otra recarga general.

**Consecuencia:** modificar varias reglas consecutivamente puede disparar cadenas de comprobaciones, tickets, aperturas y descargas. Los datos de auditoría muestran que este patrón ocurrió durante la edición de políticas.

No se debe resolver suprimiendo sin más la revisión de permisos: el consumidor actual revalida autorizaciones en el servidor, pero no entrega a la interfaz un evento general de revisión que sustituya este polling. Una solución basada en eventos debe incluir esa invalidación explícita para todos los usuarios pertinentes; el canal Core restringido no sirve como canal general para todos.

### P1: cualquier cambio dispara casi todo el cargador

Referencias: `frontend/modulos/tareas/src/task_app.jsx:5020`, `:5026`, `:5043`; `frontend/modulos/notificaciones/notification_realtime.js:37`; `backend/boldApp/tareas/signals.py:67`.

Una operación local exitosa recarga; su evento de tarea puede recargar; una notificación relacionada puede recargar también. En cambios de estado se publican eventos distintos, como actualización y cambio de estado. La deduplicación por identificador de evento evita repetir el mismo sobre, no agrupa eventos diferentes sobre una misma operación.

Incluso marcar una notificación o fallar una operación puede acabar reconciliando todo el módulo. El problema no es el mensaje WebSocket por sí mismo: es convertirlo en muchas consultas HTTP.

### P1: reintentos persistentes sin distinguir errores terminales

Referencias: `frontend/modulos/tareas/src/services/realtime_adapter.js`; `frontend/modulos/notificaciones/notification_realtime.js`.

Los fallos al obtener tickets se reintentan con esperas de 1, 2, 4, 8, 16 y hasta 30 segundos, indefinidamente. No se distingue aquí entre indisponibilidad temporal y errores como 401, 403 o cuota 429. Tampoco hay variación aleatoria de tiempos ni pausa explícita al perder Internet.

Si los 14 canales del propietario permanecen en ese estado, pueden intentar obtener aproximadamente **1.680 tickets HTTP por hora** al alcanzar el intervalo de 30 segundos. Es un escenario posible por el código, no el número medido de fallos históricos. Las aperturas exitosas agregan las solicitudes de upgrade y pueden disparar recargas.

El contador de intentos se reinicia al abrir el socket; conexiones que abren y se cierran rápidamente vuelven a los intervalos cortos. Algunos rechazos antes de aceptar la conexión pueden llegar al navegador como cierre 1006, no como el 4403 que detiene el reintento.

### P2: factores adicionales y coste en Oracle

- `frontend/modulos/core/http_client.js`, función `list`, descarga todas las páginas. Aumentar su tamaño puede reducir solicitudes, pero no elimina la descarga periódica innecesaria.
- `frontend/modulos/tareas/src/workspace_operations.jsx:82`: las comprobaciones de permisos de operaciones seleccionadas pueden repetirse al cambiar los datos. Con 100 tareas seleccionadas, el patrón puede consultar dos capacidades por tarea y otra de creación: hasta 201 comprobaciones adicionales en una reevaluación sin caché vigente.
- `frontend/modulos/calendario/calendar_module.jsx:173`: un borrador activo tiene mantenimiento periódico, y la espera de enlace Meet puede consultar cada 2,5 segundos sin un plazo máximo. Si el enlace nunca llega, ese estado puede añadir 1.440 solicitudes por hora. No se ha demostrado que explique el pico histórico.
- `backend/boldApp/tareas/views.py`: la lectura de estados y etiquetas evalúa acceso sobre unidades. Con 13 unidades, el patrón actual puede hacer aproximadamente 507 evaluaciones de autorización solamente para esos catálogos en una recarga completa. Son evaluaciones lógicas, no 507 consultas SQL medidas.
- `backend/boldApp/autenticacion/authentication.py:54`: las solicitudes autenticadas actualizan datos de uso de sesión en la base de datos. El exceso de lecturas HTTP también provoca escrituras. Cualquier reducción de estas escrituras debe conservar revocación y vencimientos.

El service worker excluye la API de su caché y no presenta un temporizador que explique este volumen. React StrictMode tampoco explica por sí solo el tráfico de producción. El efecto principal limpia sus temporizadores y conexiones al desmontarse: no se encontró aquí una acumulación clásica de intervalos.

## 5. Proyección: demo y 25 usuarios

Escenarios calculados con el contexto de 37 solicitudes por recarga del propietario, una pestaña por usuario y ocho horas de actividad. No son una predicción del promedio de todos los cargos: cambia con unidades disponibles, volumen visible, paginación y acciones.

| Escenario | Solicitudes periódicas calculadas |
| --- | ---: |
| Una pestaña, una hora | 5.160 |
| Dos pestañas, ocho horas | 82.560 |
| Tres pestañas, ocho horas | 123.840 |
| 25 pestañas, ocho horas | 1.032.000 |
| 25 pestañas, ocho horas, 22 días | 22.704.000 |

Se excluyen logins, acciones, tickets, upgrades, verificaciones adicionales y reconexiones. También se excluye el crecimiento futuro de los datos. Dos o tres personas no equivalen necesariamente a dos o tres pestañas: otra ventana, la PWA o un teléfono añaden clientes de sincronización.

El supuesto que debe corregirse es que el consumo depende principalmente de cuántas personas hacen cambios. Actualmente depende mucho de cuántas pestañas autenticadas permanecen abiertas y cuántos recursos descarga cada una.

### Aclaración de planes y contadores

Workers Free permite 100.000 solicitudes diarias por cuenta y reinicia la cuota a medianoche UTC —20:00 en Caracas—. El error 1027 indica haber excedido ese límite. Una ventana móvil de 24 horas puede abarcar partes de dos días de cuota. [Límites de Workers](https://developers.cloudflare.com/workers/platform/limits/).

El producto relevante es **Workers Paid**, no asumir que el plan Pro de un dominio cambia automáticamente la cuota de Workers. Workers Paid parte de USD 5/mes, incluye 10 millones de solicitudes mensuales y cobra USD 0,30 por millón adicional. Superar lo incluido no equivale al bloqueo diario gratuito. Las subpeticiones no se cobran adicionalmente; el upgrade WebSocket cuenta, sus mensajes no. Los assets estáticos son gratuitos; una respuesta servida por Workers Cache sigue contando. [Precios de Workers](https://developers.cloudflare.com/workers/platform/pricing/), [facturación por producto](https://developers.cloudflare.com/billing/understand/how-charges-accrue/).

Con el escenario de 22,704 millones, el componente de suscripción y solicitudes sería aproximadamente USD 8,81/mes, antes de CPU, impuestos y otros productos. Es una estimación aritmética del escenario, no un presupuesto completo. Comprar capacidad puede proteger la demo, pero no arregla el trabajo redundante que sigue llegando a Oracle.

## 6. Plan recomendado de corrección

### Primera entrega: contención antes de la demo

1. Pausar reconciliación de contenido en pestañas ocultas y sin conexión. Al regresar, hacer una única actualización controlada. Separar este comportamiento de las comprobaciones necesarias de sesión y seguridad.
2. Sustituir la recarga completa cada 30 segundos por reconciliación de respaldo menos frecuente y adaptativa; evitar recargas sucesivas durante una ráfaga mediante agrupación y un intervalo mínimo.
3. Conservar los canales autorizados al cambiar políticas: comparar unidades anteriores y nuevas, cerrar los accesos revocados y abrir solamente los nuevos. Una barrera de generación/contexto debe impedir aplicar respuestas obsoletas.
4. Agrupar la reconciliación inicial de conexiones; no lanzar una descarga general por cada apertura de unidad.
5. Implementar clasificación de errores, pausa ante cuota o falta de conexión, espera aleatoria y tratamiento explícito de sesión vencida. No reintentar indefinidamente denegaciones terminales.
6. Cachear catálogos por contexto autorizado y unidad, e invalidarlos cuando corresponda. No hay que solicitar 13 listas vacías de etiquetas cada 30 segundos.

Como ilustración, pasar el respaldo general a cinco minutos y la revisión a un minuto, sin ninguna otra mejora, reduciría el componente periódico de 5.160 a **504 solicitudes/hora**, aproximadamente un **90,2 %**. No se ha implementado ni medido esa reducción. Para 25 usuarios durante ocho horas aún serían 100.800 solicitudes diarias antes de actividad: no garantiza el plan gratuito. Tampoco debe aceptarse un retraso de revocación de un minuto sin resolver el aviso de seguridad por eventos.

### Segunda entrega: sincronización incremental y separación de módulos

- Mantener suscripciones y estado compartido en Core, sin obligar a cargar el grafo de tareas al visitar módulos hermanos.
- Usar el evento para invalidar o actualizar la tarea/proyecto afectado; reconciliar solamente sus relaciones necesarias.
- Las notificaciones deben actualizar su bandeja y contador, no descargar todos los proyectos, comentarios y catálogos.
- Paginación real y carga por vista/proyecto, en vez de descargar todas las páginas detrás de una interfaz visualmente paginada.
- Si hace falta un bootstrap agregado, diseñarlo con filtros de autorización y límites de tamaño. Reduce el número de llamadas, pero no debe convertirse en una descarga enorme periódica.
- Incluir una señal de revisión de permisos en un canal autenticado apto para los usuarios normales. Mantener respaldo razonable para desconexiones y expiración de concesiones temporales.
- Evaluar coordinación entre pestañas después de corregir lo anterior. Una pestaña líder puede compartir invalidaciones, pero requiere recuperación si se cierra y aislamiento por cuenta/asignación.

No basta con quitar el parámetro de unidad de estados o etiquetas para obtener todos los catálogos: el backend usa la unidad de la asignación como valor por defecto. Se necesita caché/carga selectiva o una operación agregada autorizada explícitamente.

### Lo que no conviene hacer

- No eliminar validaciones del backend ni conceder acceso global para evitar llamadas de permisos.
- No poner respuestas privadas en una caché pública compartida. Las claves deben aislar cuenta, asignación, alcance y revisión; limpiar datos al salir o cambiar contexto.
- No asumir que HTTP 304 o Workers Cache elimina el contador de invocaciones.
- No sustituir el problema por una recarga completa enorme en cada evento.
- No reiniciar Oracle para intentar reparar un límite de Cloudflare.
- No usar un Worker de seguridad en modo de bypass para saltarse un agotamiento de cuota.

## 7. Cómo comprobar que realmente quedó resuelto

Primero habilitar medición controlada y retener logs fuera del ciclo de vida del contenedor. Registrar ruta normalizada, método, estado HTTP, duración y contexto anonimizado; no cookies, tokens, tickets, contraseñas ni cuerpos de mensajes. Distinguir el motivo de cada actualización: temporizador, foco, evento, apertura o mutación.

Después comparar estos escenarios antes/después con la misma versión y datos:

1. Propietario inactivo durante 30 minutos, ventana visible.
2. Empleado normal en las mismas condiciones.
3. Pestaña oculta, pérdida de Internet y vuelta al foco: sin tormenta de reintentos ni varias recargas de recuperación.
4. Dos pestañas de una misma cuenta y una PWA adicional.
5. Cambiar varias políticas: mantener canales válidos, retirar datos revocados y bloquear tanto UI como HTTP y WebSocket.
6. Crear/modificar una tarea y generar una notificación: medir llamadas extra y comprobar que otro usuario ve el cambio sin recargar manualmente.
7. Simular 401, 403, 429, 5xx y un socket que abre/cierra repetidamente.
8. Revisar acceso temporal vencido, cambio de cargo y cierre diario de sesiones a las 07:00 de Guatemala.
9. Prueba escalonada con 5, 10 y 25 clientes; medir latencia p95, errores, consultas SQL, conexiones y consumo de base de datos. No deducir capacidad solamente de CPU en reposo.

Un objetivo inicial razonable de aceptación es **menos de 250 solicitudes de fondo por hora y cliente visible**, sin crecimiento con cada evento ajeno ni actividad de contenido en pestañas ocultas. Es un objetivo propuesto, no un resultado actual. A ese ritmo, 25 clientes × 8 horas × 22 días generan 1,1 millones de solicitudes periódicas mensuales, dejando margen para interacciones; la capacidad total todavía debe validarse.

## 8. Decisión inmediata

Para una demo cercana, no depender de dejar pestañas abiertas en el patrón actual. Cerrar clientes de prueba innecesarios ayuda, pero no es una solución. Mientras la cuota esté agotada, esperar su reinicio o habilitar Workers Paid mediante una decisión explícita del titular; no se ha comprado ni cambiado ningún plan durante este análisis.

El siguiente paso más importante es implementar la primera entrega de contención con medición y pruebas de revocación, y después desplegar y comparar consumo. Mantener la sincronización actual y simplemente ampliar usuarios no es una estrategia fiable.

Este trabajo fue de diagnóstico: no se modificó el comportamiento de la aplicación, no se ejecutaron migraciones, no se desplegó, no se hizo commit y no se alteraron usuarios. El único archivo añadido es este informe.
