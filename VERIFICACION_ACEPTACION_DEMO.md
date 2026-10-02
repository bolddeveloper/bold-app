# Aceptación autenticada de la optimización

Fecha: 2 de octubre de 2026. Rama `perf/sincronizacion-trafico`.
Runtime comprobado en ambas sesiones: JS `index-D0U3PpTV.js`, correspondiente
al código `2b8c0711`. Esta revisión no cambia el código publicado ni fusiona Develop.

## Entorno y datos de prueba

El usuario inició las sesiones: Luis / Propietario / Dirección en el navegador
integrado, y Samuel Rivero / Desarrollador Full Stack Junior / Equipo de IT en Edge.
No se extrajeron credenciales, introdujo MFA, crearon sesiones desde la DB ni
modificaron políticas, cuentas o proyectos existentes.

Con autorización explícita se creó desde la interfaz:

- Proyecto **Validación optimización 2026-10-02**, ID
  `eb14beed-ee07-49bd-b271-99fad793f136`, departamento Dirección,
  responsable y único miembro Luis. Descripción explícitamente ficticia.
- Una tarea raíz, inicialmente `[PRUEBA] Persistencia y edición de tarea`,
  editada a `[PRUEBA] Persistencia y edición verificada`, responsable Luis,
  único seguidor Luis; descripción ficticia.
- Una subtarea `[PRUEBA] Subtarea aislada` y un comentario ficticio.
- La tarea raíz quedó completada; la subtarea permanece pendiente. No se
  borró contenido. Los registros se conservan para revisión del usuario.

## Verificaciones realizadas

| Escenario | Evidencia observada | Límite |
| --- | --- | --- |
| Navegación por rol | Luis ve Administración y Permisos; Samuel no | Dos cuentas, no todos los cargos |
| Búsqueda de módulos restringidos | Samuel busca Administración/Permisos: no ofrece esos módulos | No sustituye pruebas de API |
| Aislamiento del proyecto | No aparece el proyecto de Dirección en proyectos/búsqueda de Samuel | No se concedieron accesos temporales |
| Creación | Proyecto y tarea confirmados, miembro Luis; indicador de guardado visible | Un guardado por acción, no prueba de fallos de transporte |
| Borrador | Cerrar y reabrir Nueva tarea conserva título/descripción | No se probó reinicio del equipo ni modo offline |
| Comentarios | El comentario se guarda y reaparece al abrir/editar; campo vacío al reabrir | Un comentario, no más de 25 en producción |
| Edición y subtareas | Título nuevo y subtarea confirmados; descripción conservada | Sin archivos reales |
| Estado optimista | Progreso cambia a 1/1 y 100%; persiste tras recargar | No se provocó rollback por pérdida de red |
| Sesión tras recarga | Recupera sesión de Luis sin volver a introducir credenciales | No se alteró el vencimiento diario |
| Edición ajena | Samuel intenta abrir editor de tarea de Pablo: aviso «No puedes modificar esta tarea» y editor no abierto | No se intentó guardar ni eliminar contenido ajeno |
| Workspace | Ambos cargos llegan a Carpetas, no se redirigen a Inicio | Workspaces vacíos, sin fixture de múltiples carpetas |
| Administración | Resumen carga métricas y navegación administrativa de Luis | No se ejecutaron acciones sensibles ni edición de empleados |
| Políticas | Vista por módulos carga; edición protegida con MFA; webhooks fuera de lote | No se desbloqueó ni cambió una regla |
| Bandeja | Samuel ve actividades y detalle de tarea | No se marcaron ni archivaron notificaciones |
| Sugerencias | Formulario y vista de sugerencias accesibles | Sin envío ni CRUD nuevo en esta revisión |
| Calendario | Aviso explícito de Google Calendar aún no conectado | Integración pendiente, no calendario funcional certificado |
| Responsive | Proyecto/detalle inspeccionados a 1280×900 y 390×844; ancho global móvil 390 | Emulación de viewport, no teléfono ni PWA instalada |

La interfaz real de adjuntos continúa mostrando **Próximamente** para agregar
archivos. La vista vacía y el editor sin archivos se comprobaron; no se presenta
como verificado el flujo con archivos ni la navegación de varias páginas en nube.
La paginación con 5.000 archivos/comentarios sigue cubierta por pruebas aisladas.
Este límite previo no se transforma en una implementación de archivos dentro de
la optimización de tráfico.

En escritorio, pulsar el título inicia edición en línea y pulsar al centro de
una fila puede abrir el selector de responsable: esos dos clics no prueban apertura
del detalle. Se salió de edición sin alterar el texto y se mantuvo Luis; el detalle
se abrió desde la tarjeta móvil y se inspeccionó también al cambiar a escritorio.
El botón de completar mantiene el nombre accesible «Completar tarea» aun estando
completada: el progreso y el estado tras recarga fueron la evidencia del guardado.

## Pruebas automatizadas repetidas

- `npm test`: **158/158**, sin fallos.
- Django, ocho módulos con `config.settings_test`: **167/167**, 48,642 s.
  SQLite/canales/cache/correo aislados; no escriben en Oracle.
- `npm run test:worker`: **4/4**.
- No se recompiló ni volvió a desplegar: no hay cambio de runtime que publicar.

## Consumo y límites de interpretación

Panel de cuenta Cloudflare, lectura alrededor de **15:58 UTC / 11:58 Caracas**:
**2.071 / 100.000 solicitudes hoy**, **97.929 restantes**. El bloque
October 1–October 2 de 139,41k no es el contador diario. La lectura tiene el
retardo propio del panel y abarca toda la cuenta, no solo nuestras dos sesiones.

Los logs de Oracle se consultaron de forma agregada: se eliminaron queries e
identificadores de rutas; no se exportaron cuerpos, credenciales ni IP de clientes.
Las sondas internas `/health/` se separan de lecturas de aplicación. El contador
de backend no incluye todos los assets, upgrades WS ni solicitudes que no llegan
a Oracle, por lo que no es equivalente a consumo del Worker.

| Ventana UTC | Duración | HTTP backend | Salud interna | Aplicación |
| --- | ---: | ---: | ---: | ---: |
| Navegación/acciones, 15:44:00–15:56:20 | 12 min 20 s | 301 | 25 | 276 |
| Sin acciones del agente, 15:56:20–16:00:05 aprox. | 3 min 45 s | 25 | 8 | 17 |

La extracción de reposo finalizó unos segundos después de la hora indicada;
no se presenta el intervalo como instrumento de latencia preciso. Ambas ventanas
incluyen todo el tráfico observado por ese backend, no una atribución por cuenta.
La visibilidad de pestañas y las acciones externas del usuario no se controlaron.

- Ventana activa: 296 HTTP 200 y 5 HTTP 201; incluye creaciones, autorizaciones,
  navegación entre módulos, recarga y detalles. 28 tickets/28 conexiones WS,
  30 desconexiones registradas. No debe etiquetarse ese total como reposo ni
  atribuirse cada desconexión a una caída: se desmontaron módulos durante pruebas.
- Sin acciones: 25 HTTP 200. Aplicación: 8 revisiones de permisos, 8 lecturas de
  recursos de Tareas (una ronda: miembros del proyecto requiere dos lecturas),
  y 1 de notificaciones. **Cero GET de comentarios/adjuntos, cero tickets y cero
  eventos de conexión/desconexión WS** en esa muestra.
- Ese resultado es compatible con las reconciliaciones previstas y el fallback
  de permisos, no con un bucle continuo observado en ese intervalo. No demuestra
  ausencia de fugas fuera de la muestra ni debe extrapolarse a tráfico diario.
- Los logs consultados no aportaron duraciones de request verificables: no se
  inventa un p95 de guardado ni se convierte duración de la sesión en latencia.

Snapshot puntual de `docker stats`, alrededor de 16:01 UTC: backend 0,09% CPU /
97,79 MiB; worker 0,04% CPU / 212,3 MiB, sobre 11,65 GiB disponibles para el
contenedor. Es reposo puntual, no pico ni prueba de capacidad concurrente.
La consulta de hasta 20 errores de consola capturados por cada pestaña devolvió
cero en ambas; no sustituye historial completo, respuestas HTTP ni monitoreo.

La primera expresión del parser esperaba otro formato de acceso y devolvió
cero coincidencias. Se corrigió antes de usar resultados y se comprobó que
registra HTTP, estados y sondas reales; aquel cero **no** fue usado como evidencia
de que el servidor no recibe solicitudes.

## Evidencia visual

Directorio local:
`C:/Users/j_sam/.codex/visualizations/2026/10/01/01a0f90e-01ac-7dd3-9f70-c614af594c5c/`.

- `aceptacion-detalle-movil-20261002.png`: detalle ficticio en móvil.
- `aceptacion-proyecto-escritorio-20261002.png`: proyecto/detalle en escritorio.
- `aceptacion-permiso-it-20261002.png`: rechazo visible de edición ajena.
- `cuota-aceptacion-20261002.png`: contador diario de Cloudflare.

Las capturas son locales, no se incorporan al repositorio. El viewport temporal
se restableció; se conservan las sesiones abiertas del usuario.

## Dictamen y siguiente paso

La aceptación funcional **avanzó, pero es parcial**. No se observó una regresión
en los recorridos anteriores. No se certifica ausencia de fugas, capacidad para
25 usuarios, velocidad de escrituras concurrentes ni todos los escenarios de
revocación/red/PWA con esta revisión.

Antes del merge faltan:

1. Completar aceptación de recuperación/offline/contexto con datos desechables y
   cuentas adecuadas. No cambiar permisos reales para fabricar una demostración.
2. Medir **30–60 minutos con 4–6 personas**, mismo build: arranque, reposo visible,
   pestaña oculta y actividad separados. Recoger diagnóstico local por escenario,
   errores/latencia percibida, cuota de cuenta y CPU/memoria de Oracle.
3. Revisar Develop actualizado e integrar solo después de aprobar los resultados;
   mantener orden de publicación backend → cliente y rollback documentado.

Para la medición, cada participante puede ejecutar manualmente en la consola:

```js
window.boldSyncDiagnostics.snapshot().buildVersion // debe ser "2b8c0711"
window.boldSyncDiagnostics.reset()
// Tras el escenario acordado:
window.boldSyncDiagnostics.snapshot()
```

Son métricas locales agregadas, no escrituras de aplicación. Contar únicamente
las claves `http:` como peticiones; `http-result:` y `duration:` describen las
mismas solicitudes y no deben sumarse como tráfico adicional. Anotar duración,
rol, número de pestañas, estado visible/oculto y acciones. La muestra de navegación
del agente no debe extrapolarse directamente a un día de uso ni a 25 empleados.
