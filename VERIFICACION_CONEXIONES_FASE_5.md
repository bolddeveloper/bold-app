# Fase 5: conexiones, varias pestañas y presupuesto

Fecha: 2 de octubre de 2026. **Primera entrega, no certificación de capacidad para 25 usuarios.**
Rama: `perf/sincronizacion-trafico`. Develop no se fusiona en esta entrega.

## Qué se corrige

- Handshake WebSocket limitado a 15 segundos. Si queda conectando en silencio,
  se descarta ese socket, termina la espera inicial y se programa recuperación
  con ticket nuevo y backoff. Eventos tardíos no duplican la recuperación.
- Volver a Internet no adelanta Retry-After, pausa de cuota ni backoff.
- Se conserva la cola de dos tickets simultáneos **por pestaña**, tickets de
  un solo uso, rechazo terminal 401/403 y limpieza al cambiar contexto/salir.
- Pruebas reproducibles y sondas acotadas, sin nuevas dependencias ni cambios
  de credenciales, permisos, datos de empleados o esquema.

No se añadió una pestaña líder: una pestaña oculta saludable ya pausa su
respaldo REST. Compartir una autorización o sustituir su canal autenticado por
mensajes de otra pestaña sería un cambio de seguridad, no una optimización inocua.
Sí sigue existiendo costo de sockets y comprobaciones del servidor por pestaña.

## 1. Control real del consumo en Cloudflare

Panel de cuenta → Workers & Pages → Usage → View limits:

- A las aproximadamente 11:16 UTC: **Requests today 581 / 100,000**.
- Disponibles entonces: **99,419**. Es una lectura puntual, no una reserva.
- El contador 137.92k mostrado para October 1–October 2 es mensual; las métricas
  de las últimas 24 horas tampoco equivalen al día de cuota. No restarlas de 100k.
- Consultar nuevamente al terminar; puede haber retraso de agregación y tráfico
  de usuarios/otros Workers. No calcular la cuota restante a partir de logs Oracle.

## 2. Simulación determinista del frontend

```powershell
cd frontend/modulos/core
npm run check:sync-capacity
```

Ejecuta los adaptadores/monitor reales con transporte y tiempo simulados.
No hace fetch/WebSockets reales ni consume cuota. Una hora simulada:

| Pestañas visibles | Revisiones REST periódicas | Sockets con 1 unidad | Sockets con 13 unidades |
| --- | --- | --- | --- |
| 5 | 300 | 10 | 70 |
| 10 | 600 | 20 | 140 |
| 25 | 1,500 | 50 | 350 |

Se contabilizan aparte una revisión de arranque por pestaña y un ticket por
socket. Dos pestañas, una oculta: 60 revisiones periódicas, no 120; las dos
reciben la revocación. En todos los escenarios: dos tickets concurrentes como
máximo por pestaña, cero invalidaciones de contenido por heartbeats sin cambios,
cero sockets/temporizadores/listeners restantes al cerrar.

Estas cifras cubren **control y conexiones**, no todas las peticiones de tareas,
notificaciones, catálogos, arranque, acciones o búsquedas. No sumarlas como si
fueran el presupuesto total. Veinticinco propietarios tampoco es el escenario
normal de empleados: se usa para mostrar el costo extremo del fanout.

## 3. Concurrencia ASGI con cuentas sintéticas aisladas

Desde la raíz, usando exclusivamente los settings aislados:

```powershell
$env:BOLD_REPORT_CAPACITY='1'
.\.venv\Scripts\python.exe backend/manage.py test boldApp.notificaciones.tests.test_concurrent_control --settings=config.settings_test --noinput
```

Se crean usuarios sin contraseña utilizable únicamente en la base de tests;
SQLite/cache/canales en memoria. La suite se omite si detecta servicios externos.
Se conectan simultáneamente un canal Core y uno de unidad por cliente, se entrega
una revisión, se revoca una sesión y se comprueba que las demás siguen activas.
También se revocan las dos pestañas de una sesión y se verifica limpieza de grupos.

Una ejecución local Windows/Python 3.12:

| Clientes | Sockets | Apertura p50/p95 (ms) | Broadcast y revocación (ms) |
| --- | --- | --- | --- |
| 5 | 10 | 15.08 / 55.63 | 102.96 |
| 10 | 20 | 29.86 / 111.52 | 205.35 |
| 25 | 50 | 78.53 / 262.39 | 559.61 |

Muestra corta, ASGI dentro del proceso, sin TLS/Cloudflare, PostgreSQL ni Redis
reales. Los tiempos no son p95 de producción ni SLA. No se impone una aserción
de tiempo dependiente de la velocidad del equipo; sí de aislamiento y cierre.

## 4. Sonda pública Cloudflare → túnel → Oracle

```powershell
cd frontend/modulos/core
npm run probe:public-health                 # Solo muestra el plan, cero red
npm run probe:public-health -- --execute     # Máximo 40 GET: 5, 10 y 25
```

Host/ruta fijos; sin cookies, credenciales, escrituras, redirects ni retries.
Plazo total de 10 segundos por lectura. Una etapa fallida impide abrir la
siguiente. El reporte solo contiene estados, códigos de error normalizados,
conteos y latencias; no headers, contenido de respuestas ni direcciones privadas.

### Resultado e incidente del instrumento

Las dos primeras sondas: 5/5 y 10/10 correctas; la etapa de 25 devolvió 20/25
lecturas correctas y cinco fallos de transporte, no errores HTTP. El diagnóstico
posterior registró `ETIMEDOUT` al intentar TCP IPv4 y `EACCES` en IPv6; el Node
local v24.13.1 tenía un plazo de selección de familia de 250 ms. No hubo errores
del backend/túnel en el resumen consultado. No atribuirlo automáticamente a Django.

Se amplió **solo en el proceso de la sonda** el plazo TCP por familia a 2,000 ms,
manteniendo TLS, selección de familias y límite total de 10 s. Las 40 lecturas
pasaron a las 11:28:29 UTC:

| Simultáneas | Salud correcta | p50 | p95 |
| --- | --- | --- | --- |
| 5 | 5/5 | 290 ms | 373 ms |
| 10 | 10/10 | 268 ms | 284 ms |
| 25 | 25/25 | 292 ms | 2,284 ms |

Es evidencia de sensibilidad del instrumento/ruta TCP local, no prueba de que
la red no tenga problemas. El p95 alto debe quedar visible. El CLI deja este
ajuste explícito en su reporte. [API oficial de Node](https://nodejs.org/api/net.html#netsetdefaultautoselectfamilyattempttimeoutvalue).

Antes de publicar: tres sondas de 40 intentos, diagnósticos acotados de 5 y 25
y una lectura de salud: **151 intentos públicos como máximo**; algunos fallaron
antes de HTTP y no equivalen necesariamente a invocaciones facturadas. No son
151 por hora ni hay una tarea automática ejecutando estas sondas.

**Health comprueba proxy/DB/Redis, no carga de usuarios.** No simula listados,
guardados, colaboración, notificaciones o autorización de una jornada completa.

## 5. Observación del runtime existente

- Oracle: backend, PostgreSQL y Redis healthy; túnel y worker activos.
- Lectura puntual previa a sondas: backend CPU 0.02%, memoria 92.8 MiB;
  PostgreSQL 146.2 MiB; Redis 6.25 MiB; worker 172.9 MiB. No extrapolar una
  instantánea inactiva a capacidad bajo carga.
- Ventana agregada desde 11:15 UTC hasta aproximadamente 11:29 UTC: 72 líneas
  de solicitudes API; 13 revisiones y dos tickets; dos conexiones y dos cierres
  WebSocket. Hubo foco/navegación y posible tráfico ajeno; no es una hora
  controlada ni una tasa por usuario. Sin evidencia de una tormenta de tickets.
- Contar `WSCONNECT` y `WSCONNECTING` por separado: sumar ambos como conexiones
  duplicaría el resultado. Logs agregados, sin tickets, IP de clientes ni IDs.

## Lo que falta antes de afirmar capacidad y cerrar el plan

1. Completar carga inicial/paginación por vista de fase 3, sin falsear totales,
   progreso, subtareas, búsquedas o calendario.
2. Recoger 30–60 minutos de diagnóstico por versión, rol y módulo; separar
   arranque, foco, reconexión y acciones. Una sesión de Dirección sigue pendiente
   para el recorrido manual: iniciar sesión personalmente, sin compartir MFA.
3. Probar 5/10/25 usuarios autenticados con datos y acciones sintéticas en un
   entorno aislado con PostgreSQL/Redis, presupuesto y retención acordados.
   Medir p95 de lecturas/guardados, SQL/CPU/memoria, entrega de eventos y cuota.
   Los tests de este documento no reemplazan esa prueba.
4. Evaluar liderazgo entre pestañas solo si el costo medido lo justifica y
   conservando revocación/aislamiento; no compartir permisos cacheados.
5. No fusionar Develop ni aprobar 25 usuarios basándose únicamente en health
   o en la simulación de 208 peticiones/hora de fase 3.

Recomendación: seguir primero con paginación/arranque y una medición autenticada
reproducible. No aumentar polling ni desactivar el control para ahorrar cuota.
