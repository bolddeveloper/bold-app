# Slack, páginas y Chat: mejoras funcionales ordenadas

Solicitud vigente: integrar los siete puntos recomendados, en este orden, con
funciones comprobables. El objetivo completo no se limita a la primera fase.
Base revisada: `feature/chat-directo`, `1df792ff`. Inicio: 27 de octubre de 2026.

## Límites de esta ronda

- Conservar el piloto exclusivamente para IT y la privacidad por participantes
  e invitaciones. No añadir excepciones de lectura para propietarios o soporte.
- Conservar la apariencia actual, salvo controles/avisos necesarios para usar las
  funciones. La revisión visual completa pertenece a una ronda posterior.
- Trabajar y validar localmente. Esta solicitud no autoriza nuevos commits, push,
  migraciones de producción ni despliegues en Oracle/Cloudflare.
- Preparar notas verificadas en `pendingPilotReleaseNotes` por entrega mediana o
  grande. No publicarlas al resto ni anunciar funciones todavía pendientes.
- No reconstruir Graphify: el grafo no existe en este checkout y AGENTS lo difiere.
- Aclaración expresa del usuario del 29 de octubre: continuar la revisión web
  sin exigir Docker/Linux local ni pruebas de dispositivos Apple u otros equipos;
  esas comprobaciones se difieren. No hay una distribución Linux del cliente PWA.
  La topología Redis/Celery/Beat corresponde al servidor: sigue sin acreditarse
  y su validación se conserva como puerta de despliegue, no como función web ausente.

## Orden y aceptación

### 1. Borradores seguros y control de edición — validada localmente

- [x] Recuperar borradores de Chat, canales/hilos y páginas tras recarga/cierre.
- [x] Texto, selección de tarea y archivos pendientes conservan su contexto e
  identificadores de intento; una recuperación nunca envía automáticamente.
- [x] Almacén local cifrado, con caducidad y límites, separado por cuenta,
  asignación y recurso. Clave solo en memoria, entregada después de comprobar
  permisos actuales de ese recurso. No copiar contenido privado a localStorage.
- [x] Logout/revocación impiden recuperar contenido; cambios de credenciales o
  de acceso invalidan la clave. Errores de disco no equivalen a guardado exitoso.
- [x] Páginas recuperan actualizaciones CRDT, no sobrescriben el documento actual.
  Una época restaurada requiere decisión expresa respecto al borrador anterior.
- [x] Deshacer/rehacer solo operaciones propias; conserva las de otro participante,
  admite botones y Ctrl/Cmd+Z, Ctrl+Y/Cmd+Mayús+Z, sin interferir con IME.
- [x] Actualizar la PWA espera protección del borrador o pide confirmación clara.
- [x] Pruebas unitarias, permisos, reconexión, navegador/recarga y dos identidades.

Aceptación local, no liberación: las comprobaciones nativas cubrieron texto e
imagen de Chat y recuperación/coedición de páginas. Canales/hilos, notas de voz,
fallos de disco y actualización PWA cuentan con pruebas automatizadas específicas;
no se presentan como una grabación de micrófono ni una actualización instalada
completadas manualmente. Drive fue un doble local, no el servicio de Google.
La comprobación del 29 de octubre añadió la actualización real del service worker
en navegador local con texto y documento pendientes: recarga sin una segunda
advertencia, recuperación explícita y ningún mensaje o reserva nuevos. No acredita
una PWA instalada en un teléfono físico ni una prueba con Google real.

### 2. Búsqueda real del historial — validada localmente

- [x] Mensajes, páginas y metadatos de archivos; filtros por persona, canal,
  intervalo de fechas y tipo; paginación estable y apertura en contexto exacto.
- [x] Filtrar permisos antes de snippets, recuentos y resultados. No indexar para
  terceros conversaciones privadas. Empezar con PostgreSQL e índices adecuados.

Implementación local: índice transaccional interno, palabras completas sin
distinción de tildes, filtros y cursores firmados. Aceptación local contra backend
aislado y dos identidades ficticias; no se ha aplicado su migración en producción.

### 3. Menciones y seguimiento personal — validada localmente

- [x] Menciones a personas sin conceder acceso implícito, seguimiento de hilos,
  guardados personales, marcar como no leído y reacciones.
- [x] Primer componente: guardados personales persistentes de mensajes/adjuntos
  y páginas, compartidos por el mismo empleado entre dispositivos, nunca con
  terceros; filtro y apertura en contexto mediante el buscador existente.
- [x] Seguimiento personal explícito de hilos y lista completa con filtros,
  sin activar el seguimiento del canal ni duplicar sus avisos. Validación local.
- [x] Menciones en mensajes y respuestas de Slack, con avisos independientes
  del seguimiento y preferencia personal; aceptación automatizada y nativa local.
- [x] Referencias verificadas a los dos participantes de Chat, sin avisos
  duplicados ni incorporación de terceros; aceptación automatizada y nativa local.
- [x] Menciones en páginas de Slack, con referencias y avisos por bloque;
  aceptación automatizada y nativa local.
- [x] Marcas personales de no leído en Chat, canales e hilos, sin retirar recibos;
  aceptación automatizada y nativa local.
- [x] Reacciones en Chat, canales e hilos, con contadores y retirada propia;
  aceptación automatizada, PostgreSQL y dos identidades ficticias en navegador.
- [x] Reutilizar Bandeja/Notificaciones existentes y preferencias de seguimiento;
  no duplicar motores de avisos ni añadir sondeo por conversación.

### 4. De conversación a tareas y acuerdos — validada localmente

- [x] Crear tarea desde mensaje usando permisos y modelos de Tareas; proyecto,
  sección, responsable y fecha, con vínculos de ida y vuelta y reintento idempotente.
  Validada localmente con PostgreSQL, dos cuentas ficticias en navegador y
  recuperación cifrada tras una recarga real. No está desplegada en producción.
- [x] Llevar una selección de mensajes a una página de acuerdos con sus referencias.
  No copiar automáticamente DMs a espacios compartidos ni crear otro gestor de tareas.
  Integrada en Chat, canales e hilos, con revisión y consentimiento explícitos,
  referencias filtradas, reintento y recuperación cifrada. Aceptación local con
  PostgreSQL y dos identidades ficticias, incluida coedición y origen privado.

### 5. Conocimiento estructurado — validada localmente

- [x] Subpáginas del mismo canal, navegación desplegable y ruta de ubicación,
  movimientos explícitos con versión independiente y reintento idempotente.
  Validación local PostgreSQL y dos identidades ficticias; no desplegada.
- [x] Enlaces internos entre páginas, con referencias protegidas y nombres
  opcionales explícitos; backlinks filtrados antes de paginar y apertura del
  bloque de origen. Validación local PostgreSQL y dos identidades ficticias.
- [x] Comentarios por bloque resolubles, respuestas, filtros y autoría estricta;
  borradores cifrados e intentos versionados. Validación local, no liberación.
- [x] Formato básico de texto, alias de enlaces y bloques de código; plantillas
  oficiales de procesos. El autor mantiene control de sus propios comentarios.
- [x] No duplicar Tareas/Hojas con un segundo sistema de bases de datos avanzado.

### 6. Biblioteca de archivos y subidas recuperables — aceptación local con Drive real

- [x] Historial completo de imágenes, audio, documentos y enlaces por canal/chat,
  fechas/remitentes/filtros y descarga autenticada; no solo los mensajes cargados.
  - [x] Primer componente: imágenes, audio y enlaces del historial conservado,
    por chat, canal e hilo; filtros, contexto y descarga autenticada. Validación local.
  - [x] Documentos originales PDF, TXT/CSV UTF-8 y DOCX/XLSX/PPTX, descarga sin
    vista previa y filtros/metadatos. Validación local, no liberación.
- [x] Ampliar formatos explícitamente validados y límites de capacidad.
  - [x] Catálogo y límites por archivo: 10 MB por documento, TXT/CSV 2 MB, un
    documento por mensaje; controles acotados del contenedor Office y sobre PDF.
  - [x] Capacidad agregada configurable: reservas/archivos publicados/legado,
    bytes temporales compartidos con QR y registros por cuenta/globales. Rechazo
    de nuevas reservas sin borrar datos ni impedir resolver las existentes;
    validación local, no medición de cuota libre de Google ni despliegue.
- [x] Subidas asíncronas a Drive con pendiente/fallo/reintento, deduplicación y
  conciliación de huérfanos, sin crear permisos públicos de Google.
  - [x] Base backend privada, reservas cifradas, trabajador, consumo transaccional
    y conciliación acotada. Validación local, no liberación.
  - [x] Conectar los emisores de Chat/canales/hilos/reenvíos al nuevo recorrido y
    a pistas privadas del socket existente. Compositor con estados y pausa.
  - [x] Recuperación del compositor de Chat tras recarga real, con el archivo,
    texto e identificador originales; consulta de reserva lista sin nueva subida.
  - [x] Retirar el contrato síncrono heredado y completar descarte explícito de
    preparaciones en los compositores de Chat, canales e hilos. Detener espera sigue siendo solo una pausa;
    Descartar preparación verifica el resultado y conserva el borrador para revisarlo.
  - [x] Aceptación local de reconexión/hilos/multimedia con Google real: dos
    cuentas sintéticas, diez formatos, descarga privada, reintentos sin duplicados
    y conciliación con Papelera. No acredita Redis/Celery distribuido de Oracle.
  - [ ] Puerta de despliegue: comprobar la topología distribuida Redis/Celery y
    la captura con micrófono físico; la aceptación local no sustituye estas pruebas.
  - [x] Extender recuperación y descarte por intento a los lotes de reenvío;
    revisión cifrada separada del compositor, destino fijo, progreso parcial,
    bytes y nonce originales. Aceptación local PostgreSQL y navegador con
    identidades ficticias; Drive simulado, no Google real.

### 7. Automatizaciones acotadas — aceptada localmente; despliegue distribuido pendiente

- [x] Reglas concretas para cambio de estado, recordatorios y páginas recurrentes;
  filtros de ámbito, registro de ejecución, pausa, idempotencia y prevención de bucles.
  - [x] API privada por cuenta/asignación, registro y tres acciones concretas:
    referencia a tarea al cambiar de estado en un proyecto, recordatorio de canal
    y página periódica desde una plantilla del mismo canal.
  - [x] Creación pausada, confirmación explícita al activar, versiones e intentos
    estables, pausa incluso con presupuesto agotado, permisos actuales y retirada
    de autoridad tras cambios de identidad/credenciales.
  - [x] Trabajador acotado y prueba funcional local de los tres recorridos; no
    modifica tareas, no interpreta acciones/código arbitrarios ni envía a Google.
  - [x] Acreditar concurrencia de trabajadores y cambios simultáneos con PostgreSQL.
  - [x] Integrar controles utilizables en Slack, selectores y registro; comprobar
    los recorridos de navegador con dos cuentas antes de dar la fase por aceptada.
  - [x] Probar la programación real del trabajador en el entorno autorizado de
    aceptación. No confundir la función de drenaje con Celery Beat distribuido.
  - [ ] Puerta de despliegue: comprobar Redis/Celery/Beat en una topología
    distribuida antes de activar la bandera en el servidor.
- [x] Sin constructor universal ni llamadas/IA como sustituto de estos objetivos.

## Registro de validación

Cada fase debe añadir aquí archivos, comandos y resultados observados. Un test de
almacén simulado no acredita IndexedDB real; una prueba local no acredita producción.
La aceptación de fases futuras permanece pendiente hasta contar con evidencia.

### Validación local del 27 de octubre — fase 1

- Implementado el control de deshacer/rehacer por participante en Yjs, con botones,
  atajos, separación de operaciones estructurales, límites de historial y bloqueo
  durante composición IME, conflictos y acceso de solo lectura.
- Implementada recuperación de páginas mediante instantáneas CRDT cifradas,
  referencia a la época y reintentos inmutables de actualizaciones sin confirmar.
  La interfaz exige recuperar/descartar expresamente, combina operaciones y no
  guarda proyecciones de títulos/estados protegidos de Tareas en el borrador.
- `POST /api/v2/messaging/draft-grants/` comprueba permisos actuales por recurso,
  cuenta y asignación. Usa la clave de cifrado ya exigida por autenticación;
  no requiere migración. No existe excepción de lectura para administradores.
- El almacén usa WebCrypto AES-GCM e IndexedDB: claves solo en memoria, retención
  de siete días, hasta 64 MiB por entrada/128 MiB totales/100 entradas. No elimina
  otros borradores vigentes para hacer espacio: comunica el error. Los límites
  de archivos incluyen las colas admitidas de hasta 50 MiB, con archivos individuales
  de hasta 10 MiB. Están conectados a Chat, canales e hilos.
- La actualización de la PWA espera la protección registrada y mantiene la
  confirmación; si falla o excede cinco segundos, advierte del riesgo de pérdida.
- Se detectó y corrigió una carrera real: la sincronización inicial no puede
  borrar la copia local mientras se descifra. También hay cobertura de apertura
  tardía tras logout, errores de lectura y copia pendiente de decisión.
- Backend: regresión conjunta `manage.py test` de `test_draft_grants`, `test_media`,
  `test_channel_media`, `test_channels`, `test_pages` y `test_page_crdt` con
  `--settings=config.settings_test --noinput`: 61 pruebas aprobadas, SQLite aislado.
  Incluye sesiones autenticadas de dos cuentas, CSRF, logout y concesiones por
  recurso. Una primera invocación usó dos nombres de módulos inexistentes; se
  corrigió y se repitió la suite completa, sin ocultar pruebas fallidas.
- Frontend: `npm run test:messaging`: 111 pruebas unitarias aprobadas, incluida la
  carrera de descifrado, suspensión, lectura revocada, reintentos inmutables e
  historial de referencias a tareas. Pasaron además sus pruebas DOM de Chat y
  recuperación de compositores, así como `test:channels-ui` y `test:pages-ui`.
- La pasada conjunta de protección PWA, notas de versión, registro de trabajo
  privado, monitor/caché de permisos y ciclo de borradores completó 36 pruebas
  aprobadas. Es un subconjunto solapado; no se suma como total de pruebas únicas.
- `node tests/page_recovery_ui.mjs`: aprobación de controles React/Yjs/WebCrypto,
  combinación de texto, decisión explícita, atajos, fallo de disco y protección PWA.
  El servidor WebSocket y el adaptador de almacenamiento son ficticios.
- `npm run test:pwa`: 7 aprobadas. Compilación local aprobada; conserva advertencias
  de tamaño de los paquetes grandes de Hojas. No es un resultado de producción.
- `makemigrations --check --dry-run --settings=config.settings_test`: sin cambios
  detectados. El diff no presenta errores de espacios; los avisos LF/CRLF son del
  ajuste de finales de línea de Git en este entorno Windows.
- Chat/canales/hilos integran checkpoints por recurso, archivos binarios y selección
  de tarea sin copiar títulos protegidos. La recuperación es explícita y nunca envía.
  Las ediciones recuperadas deben coincidir con la versión y autorización actuales;
  de lo contrario se conserva el texto para copiar, sin conceder permiso de edición.
- Los reintentos inciertos de Chat conservan el UUID y contenido del primer intento.
  Las respuestas definitivas de validación permiten corregir un envío rechazado.
  La navegación y los cambios de identidad no trasladan borradores a otra cuenta,
  asignación, conversación, canal ni hilo.
- `node tests/composer_recovery_ui.mjs`: aceptación con React/WebCrypto y APIs/
  almacenamiento ficticios de recuperación de imágenes editadas, audio, reintento
  tras respuesta perdida sin duplicados, separación canal/hilo y cambio de cuenta.
- Se cubre la ausencia de bucles: un error de almacenamiento no provoca reintentos
  con cada render. Cambiar el contenido o pulsar Reintentar es lo que los reactiva.
- Navegador integrado real: dos cuentas ficticias autenticadas en dos orígenes
  locales contra el mismo backend aislado. El borrador de Alfa sobrevivió al cierre
  y reapertura de la pestaña, no apareció en Beta y permaneció intacto al recibir
  un mensaje de Beta por WebSocket. La recuperación siempre exigió una decisión.
- IndexedDB nativo: una imagen PNG pendiente y su descripción sobrevivieron a
  cerrar/reabrir la pestaña. Se verificó su decodificación (390 × 844), se envió
  expresamente al doble local de Drive y Beta la recibió en directo. No se usó
  Google ni almacenamiento de producción.
- Páginas con dos cuentas: Deshacer/Rehacer de Alfa conservó el aporte de Beta.
  Un borrador protegido sobrevivió al corte de red y recarga; tras recuperar el
  permiso se ofreció la recuperación. Se combinó con un cambio posterior de Beta,
  y ambas cuentas convergieron al mismo texto guardado (versión 8).
- Se corrigió otra causa de pérdida: la incertidumbre de red y la recuperación de
  una política sin cambios suspenden las claves, pero no borran el cifrado local.
  Una revocación o cambio real de autorización conserva la invalidación. Toda
  reapertura sigue requiriendo una nueva comprobación de permisos del recurso.
- La protección nativa antes de salir mostró el aviso de trabajo pendiente;
  el navegador de automatización canceló esa recarga. La persistencia se comprobó
  cerrando y creando una pestaña nueva, no atribuyendo éxito a la recarga cancelada.
- Compilación final de esta fase aprobada (5.366 módulos). Se conservan los avisos
  previos de tamaño de los paquetes de Hojas. No se añadieron dependencias.
- Notas preparadas solo en `pendingPilotReleaseNotes`. Sin commit/push/despliegue.
  Esta validación no implica entregar el objetivo completo: las fases 2–7 se
  implementan y aceptan por separado, en el orden indicado arriba.

### Avance local del 27 de octubre — fase 2

- `SearchDocument` mantiene una proyección del texto de mensajes, título/bloques
  de páginas y metadatos de los adjuntos. Se excluyen los bloques de Tareas y sus
  proyecciones, los identificadores remotos de Drive, contenido binario y estado
  CRDT. Las proyecciones se actualizan dentro de la transacción de guardado; no
  se añade un servicio externo ni consultas periódicas de indexación.
- `/api/v2/messaging/search/` aplica pertenencia a Chat y ACL estructural/Core
  de canales/páginas antes de formar resultados. No hay excepción de propietario
  para contenido privado, ni recuentos globales de elementos ocultos.
- Filtros de palabras, ámbito, tipo, autor (creador en páginas), canal/conversación,
  intervalo y archivados. Se devuelven veinte resultados por página, ordenados por
  creación y UUID. Los cursores firmados caducan, quedan ligados a todos los
  filtros/cuenta/asignación y preservan el corte temporal al avanzar o volver.
  Cada petición vuelve a validar permisos; el cursor no los concede.
- Las consultas de contexto recuperan el mensaje exacto y hasta quince vecinos
  a cada lado; los hilos no mezclan respuestas ajenas. Son consultas sin efectos
  de lectura. El acceso a archivos mantiene las descargas autenticadas existentes.
- Interfaz compartida para Chat y Slack, con búsqueda explícita, etiquetas,
  retroalimentación accesible, filtros y navegación por páginas. No consulta
  mientras se escribe ni sondea en reposo. Cambios de cuenta, asignación o permisos
  descartan la vista privada e impiden que una respuesta tardía la reponga.
- La migración `0017_history_search` crea los metadatos de nombre de archivo,
  rellena el índice histórico en lotes de 300 y crea el GIN funcional únicamente
  en PostgreSQL. Los nombres históricos que no se almacenaban quedan vacíos;
  no se inventan ni se buscan en Google para reconstruirlos.
- Importante para una futura publicación: el backfill PostgreSQL mantiene bloqueo
  SHARE sobre las tablas fuente para no perder escrituras del backend anterior.
  SHARE por sí mismo permite lecturas; los ALTER TABLE de metadatos también
  pueden bloquearlas hasta el commit. Programarla en una ventana de mantenimiento
  y medir antes el volumen. No se ha ejecutado en
  Oracle ni se ha modificado Google Drive.
- PostgreSQL 18.6 aislado: suite conjunta de mensajería, notificaciones,
  autorización y colaboración de Tareas, 222 aprobadas. Después se repitieron las
  catorce pruebas específicas de búsqueda con el cursor inicial estable y el
  backfill bloqueado: catorce aprobadas. La comprobación GIN usa el plan EXPLAIN
  del mismo SearchVector del ORM, no solo la existencia nominal del índice.
  La instancia temporal se detuvo al terminar; no se reutilizó un servidor ajeno.
- SQLite aislado: trece pruebas aprobadas y una exclusiva de PostgreSQL omitida.
  El primer ensayo del nuevo bloqueo requirió completar el adaptador sintético
  del schema editor; se corrigió y la repetición PostgreSQL pasó completa.
- `test:messaging`: 114 unitarias y sus pruebas DOM aprobadas tras añadir el API
  de búsqueda. `history_search_ui.mjs` verificó filtros, siguiente/anterior,
  contexto exacto, representación como texto y aislamiento de cuenta/permisos.
- Regresión final: `test:channels-ui`, `test:pages-ui` y el buscador DOM aprobados.
  La prueba del buscador incluye una respuesta retrasada después de cambiar la
  cuenta; no repone los resultados anteriores. Se comprobaron también caducidad
  del cursor y cambio de asignación de la misma cuenta en la repetición SQLite.
- Compilación aprobada (5.369 módulos), sin dependencias nuevas y con los avisos
  previos de tamaño de Hojas. Notas de versión/PWA: doce pruebas aprobadas.
  `makemigrations --check --dry-run --settings=config.settings_test`: sin cambios
  pendientes respecto a la migración preparada. `git diff --check`: sin errores
  de espacios, únicamente avisos de conversión LF/CRLF del entorno Windows.
- El índice y la consulta ORM siguen la [documentación oficial de búsqueda de
  Django](https://docs.djangoproject.com/en/5.2/ref/contrib/postgres/search/).
- Navegador nativo contra backend aislado: resultado histórico fuera de los últimos
  cincuenta mensajes; paginación de veinte más cinco; filtros de fecha; archivo
  encontrado por su nombre y decodificado a 800 × 440 desde el doble de Drive.
  La búsqueda privada devolvió un resultado a Alfa y ninguno a Beta, sin ofrecer
  a Beta el canal privado en los filtros. Consultar contexto no confirmó lectura.
- Se corrigieron dos carreras de foco al abrir un bloque desde la búsqueda:
  esperar la colaboración lista y comprobar que el objetivo corresponde a la
  instancia instalada de la página, incluso cuando ya estaba abierta. Navegador
  y prueba DOM confirmaron el foco en el bloque 31 editable, no en el documento
  anterior ni en un campo todavía deshabilitado.
- Aceptación responsive del 28 de octubre: iframe real de Chromium a 375 × 667 y
  812 × 375, con backend y controles reales, sin desbordamiento horizontal del
  buscador a tamaño de texto normal. No es una prueba de teléfono físico. El
  cambio de viewport del navegador no surtió efecto; no se atribuye éxito a él.
- Volver, Cerrar y Abrir página permanecen en la cabecera del diálogo. El aviso
  de actualización PWA se difiere visualmente mientras ese diálogo modal existe,
  sin eliminarlo: antes interceptaba el clic de paginación en pantallas pequeñas.
  Los controles se comprobaron con clic, no únicamente mediante teclado.
- Contraste medido del texto principal del contexto: 11,93:1 oscuro y 12,35:1 claro.
  Limitación preexistente registrada: con fuente raíz al 125 %, el mínimo global
  de 20rem impone 400px en una pantalla de 375px. El diálogo no desborda su propio
  contenedor; la adaptación global de texto ampliado queda para la revisión de
  accesibilidad de toda la aplicación, no se presenta como aprobada.
- `channel_validation --history-fixtures` añade datos históricos únicamente a su
  base temporal nueva; la ejecución sin esa opción conserva el comportamiento
  previo. El doble de Drive no utiliza credenciales ni hace peticiones a Google.
  Compilación final temporal aprobada (5.369 módulos), incluida la corrección de
  foco. Sin commit, push, migración ni despliegue de producción.

### Validación local del 28 de octubre — fase 3, guardados

- `SavedItem` enlaza empleado e índice documental; no copia texto, metadatos de
  permisos ni binarios. Único por empleado/documento, hasta 500 referencias,
  con bloqueo por empleado para serializar el límite entre dispositivos. La
  eliminación de la fuente elimina su referencia. Migración `0018_saved_items`
  preparada y aplicada únicamente a bases temporales de pruebas.
- Guardar exige lectura actual del DM/canal/página, incluidos los permisos de
  página independientes. La búsqueda de guardados aplica los mismos límites
  estructurales y Core antes de formar snippets o cursores. No hay excepción de
  propietario ni nombres/recuentos de fuentes ocultas. Quitar es siempre personal
  e idempotente, sin revelar si existe una referencia ajena.
- El guardado no modifica recibos de entrega/lectura, versiones de actividad ni
  notificaciones; no hace peticiones a Drive. Se reutilizan buscador y contexto,
  con Mis guardados en Chat/Slack y acción en mensajes y páginas. Los estados de
  las fuentes se proyectan por lotes: cincuenta indicadores requieren una sola
  consulta adicional, no una petición HTTP ni una consulta por burbuja.
- Interfaz: decisión explícita, estado confirmado, error/reintento sin optimismo
  engañoso. El cambio de cuenta/asignación/revisión desmonta el control y cancela
  su petición; las respuestas tardías no actualizan la siguiente identidad.
- PostgreSQL 18.6 aislado: 21 pruebas específicas de historial/guardados aprobadas,
  seguidas de la suite conjunta completa de 229 pruebas aprobadas. No se suman:
  la primera es un subconjunto de la segunda. Incluyen privacidad de dos cuentas,
  revocación/invitación, permisos de página, límites/reintentos, borrado de fuente,
  actualización del contenido y proyección personal por lotes.
- Primera pasada: dos fallos de los datos de prueba (denegación del rol compartido
  y uso del UUID ya vaciado por Django tras delete). Corregidos y repetidos. La
  regresión DOM de páginas requirió añadir su contexto de cuenta sintético por
  el nuevo control; pasó después, sin retirar ninguna comprobación de recuperación.
- Frontend: 115 unitarias de mensajería aprobadas; Chat, recuperación de
  compositores, canales, páginas y recuperación CRDT/atajos/foco aprobados.
  Pruebas DOM específicas de historial/guardados cubren reintento, retirada,
  estado restaurado, cuenta reemplazada y ausencia de bucles de consulta.
- La nueva prueba DOM se aisló también del BroadcastChannel nativo de Node,
  igual que las pruebas existentes: sus aserciones pasaban pero ese recurso
  mantenía abierto el proceso. Se detuvieron solo las dos ejecuciones propias
  pendientes y se repitió `test:history-ui`: aprobación y salida normal con código 0.
  Notas de versión/PWA/API de historial: dieciséis pruebas aprobadas en la pasada
  final. La recompilación tras los textos definitivos terminó con código 0.
- Navegador real con HTTP y dos identidades ficticias: Beta guardó un mensaje
  antiguo, cerró el buscador y lo encontró en Mis guardados. Tras recarga real
  de la página el guardado siguió disponible; Alfa mantuvo su colección vacía.
  Los veinticinco mensajes sin leer de Beta no se marcaron leídos por guardarlos.
  Vista de 375px sin desbordamiento horizontal. Drive fue un doble local.
- Se activó la nueva versión de la PWA local mediante su aviso y confirmación;
  esto no prueba una actualización de una PWA instalada en un teléfono físico.
  Observación pendiente para la revisión global: el aviso de actualización cubre
  parte del formulario de acceso móvil; se pudo actualizar y entrar normalmente.
- Compilación temporal aprobada (5.371 módulos), sin dependencias nuevas; conserva
  los avisos de tamaño previos de Hojas. Modelos/migraciones coherentes según
  `makemigrations --check --dry-run --settings=config.settings_test`.
- Fase 3 incompleta: menciones, seguimiento de hilos, marcar como no leído y
  reacciones siguen pendientes. No se anuncia su disponibilidad en las notas.
  Notas solo preparadas en `pendingPilotReleaseNotes`; IT permanece cerrado al
  resto. Sin commit, push ni despliegue Oracle/Cloudflare.

### Validación local del 28 de octubre — fase 3, seguimiento de hilos

- `ChannelThreadSubscription` conserva una decisión por empleado y mensaje
  inicial, con revisión personal y cascada al borrar la fuente. Migración
  `0019_thread_subscriptions` preparada y aplicada solo en bases temporales.
  Índice parcial de seguimientos activos y límite de 500, serializado por
  empleado entre dispositivos. Dejar de seguir un hilo nunca seguido no crea
  una fila vacía. Escribir, abrir o seguir no confirma lectura ni sigue el canal.
- GET/PUT del seguimiento exige lectura actual del canal y un mensaje inicial
  de ese mismo canal. Los lectores invitados pueden seguir sin permiso para
  escribir; ni el propietario ni un cursor eluden invitaciones o requisitos MFA.
  Las proyecciones personales se consultan por lotes, sin una consulta por burbuja.
- Se reutilizan el evento `slack.message_created`, las preferencias existentes,
  el socket y la bandeja de avisos. Reciben aviso quienes siguen el canal o el
  hilo, sin duplicarlo si siguen ambos y excluyendo al autor. Los avisos no
  contienen texto privado; la entrega diferida vuelve a comprobar seguimiento,
  lectura y autorización. Dejar un seguimiento no limpia avisos del otro.
- Hilos que sigo reutiliza el buscador completo: ACL antes del filtro personal,
  paginación firmada, texto/fechas/orden del mensaje inicial y apertura del hilo
  exacto, aunque no esté entre los últimos mensajes del canal. No se presenta
  como una lista ordenada por la actividad de las respuestas. El contexto sigue
  sin marcar lecturas; abrir la conversación usa el lector de visibilidad habitual.
- Seguimiento confirmado y error/reintento conservando el borrador. Revisiones
  de contenido y preferencia se combinan por separado; una respuesta antigua no
  deshace una preferencia más reciente. Cambio de identidad cancela navegación
  y operaciones pendientes. No se añadieron sondeos, servicios ni llamadas a Drive.
- PostgreSQL 18.6 local: 33 pruebas dirigidas de seguimiento, historial y avisos
  aprobadas, incluida la búsqueda GIN. El servidor temporal se detuvo al terminar.
  Repetición SQLite de seguimiento/avisos: 19 aprobadas; modelos y migraciones
  coherentes según `makemigrations --check --dry-run`. No son totales sumables.
- React/DOM: canales, historial y guardados aprobados. La regresión de Chat
  completó 118 unitarias más Chat y recuperación de compositores; páginas y
  recuperación CRDT/atajos/foco también aprobadas. Notas/PWA: doce aprobadas.
- La prueba nativa con dos cuentas ficticias detectó que un aviso del mismo hilo
  no salía de Páginas. La nueva prueba DOM detectó además que volver al mismo
  identificador dejaba vacío el historial. Corregidas la transición, la recarga
  y la confirmación de salida; las pruebas conservan el caso cancelado y el
  confirmado. Se repitió después el recorrido nativo con ambas cuentas.
- La primera captura de 375 × 667 reveló un historial reducido a 20px y un envío
  recortado por la suma de controles. El fallback responsive reserva 160px para
  mensajes y permite desplazar el contenedor, sin ocultar acciones. El lector
  intersecta la pantalla y todos sus ancestros con recorte antes de confirmar una
  lectura; los desplazamientos se agrupan por frame y no crean sondeos en reposo.
  La prueba DOM cubre un ancestro completamente fuera de vista. Una apertura de
  hilo denegada también vacía los resultados privados previos del buscador.
- Navegador con dos identidades ficticias: Beta recibió un mensaje en directo,
  siguió solo ese hilo y recibió su aviso mientras consultaba Páginas. Tras
  actualizar la PWA, el aviso volvió correctamente a Mensajes y cargó ambas
  respuestas, sin dejar vacío el historial. El seguimiento sobrevivió a una
  recarga y apareció en Hilos que sigo; la lista de Alfa permaneció vacía.
- Aceptación responsive final: iframe Chromium real de 375 × 667 y 812 × 375,
  con 160px de historial y sin desbordamiento lateral. El desplazamiento permite
  leer la respuesta y llegar al compositor/Enviar; en horizontal se midió Enviar
  entre y=312 e y=356 dentro de 375px. Beta envió desde esa interfaz y Alfa lo
  recibió en directo. No se presenta como prueba de teclado virtual o teléfono físico.
- Beta dejó de seguir y pasó a Páginas; una nueva respuesta de Alfa se conservó
  en el hilo sin añadir avisos: la lista de cuatro avisos permaneció idéntica.
  Después se restauró el seguimiento para continuar las pruebas. Ninguna cuenta
  seguía el canal. Solo se usaron cuentas y almacenamiento locales ficticios.
- La compilación temporal final terminó con código 0 y se comprobó que el script
  cargado por la PWA coincidía con el index generado, no solo que hubiera un aviso
  de actualización. No hay dependencias nuevas; se mantienen los avisos previos
  de paquetes grandes de Hojas. `git diff --check` no muestra errores de espacios.
- Durante la preparación de pruebas se corrigió una invitación ausente del
  autor en un canal privado sintético. La prueba de foco del buscador espera su
  efecto React real antes de comprobarlo; no se retiró la aserción de foco.
- `channel_validation --attention-fixtures` activa solo avisos internos para las
  dos cuentas ficticias, sin sonido ni permiso de escritorio, con canales sin
  seguimiento por defecto. Usa una base temporal propia y el doble local de Drive.
- Notas ampliadas en la misma tarjeta de `pendingPilotReleaseNotes`, sin tocar
  los identificadores ni el historial publicado. Fase 3 todavía incompleta:
  menciones, marcar como no leído y reacciones permanecen pendientes. El resto
  de las fases conserva su alcance. Sin commit/push/despliegue ni apertura fuera de IT.

### Avance local del 28 de octubre — fase 3, menciones de Slack

- Decisión expresa del usuario: las menciones pueden avisar también en canales
  no seguidos, con preferencia personal para desactivarlas. Se añadió el evento
  `slack.mentioned` a Perfil → Notificaciones; desactivarlo no silencia los avisos
  normales de los canales/hilos que el empleado siga.
- `ResourceMention` enlaza el empleado y el documento fuente ya existente, con
  token y nombre verificados. Migración `0020_resource_mentions` preparada y
  aplicada solo en bases temporales; no rellena menciones históricas ni genera
  avisos retroactivos. La referencia conserva su empleado si cambia el correo.
  La eliminación de la fuente elimina las referencias. No es una autorización.
- Primer contexto implementado: mensajes y respuestas de Slack, incluidos sus
  textos de imagen/audio. El selector busca personas autorizadas en el canal;
  el servidor vuelve a comprobarlas al enviar. No crea invitaciones, seguidores,
  lecturas ni excepciones para propietarios. Las demás superficies siguen pendientes.
- Sintaxis explícita `@correo-completo`, seleccionable desde el compositor o
  escrita a mano. Correos ordinarios, URL y código entre comillas invertidas no
  activan referencias. Un token desconocido o sin acceso queda como texto literal,
  sin confirmar la existencia de una persona ni avisarla. No hay menciones masivas.
- Se admiten veinte personas distintas durante la vida de cada mensaje y hasta
  cuarenta tokens históricos de esas personas. Escribir a más requiere otro
  mensaje. La búsqueda explícita exige 2–80 caracteres, limita las coincidencias
  examinadas a cien y ofrece hasta veinte resultados autorizados con aviso para
  afinar la búsqueda; no consulta con cada tecla ni en reposo.
- Se reutilizan la bandeja y el socket. Al crear un mensaje se prioriza un único
  aviso de mención sobre el aviso del seguimiento. Una mención nueva al editar
  puede avisar; quitarla y reponerla no repite el aviso. Solo el autor puede editar
  durante diez minutos. La entrega diferida comprueba preferencia, mención actual,
  permisos y sesión/MFA; no contiene texto privado en el título/cuerpo del aviso.
  Dejar de seguir no descarta las menciones independientes; leer sí puede hacerlo.
- Los DTO de historial/contexto incluyen las referencias verificadas por lotes:
  cincuenta mensajes con menciones requieren una consulta adicional, ninguno si
  no hay tokens. No hay una petición por persona ni llamadas a Google Drive.
- Interfaz: inserción en el punto de escritura y recuperación de foco, error y
  reintento sin envío automático, límite de 5.000 caracteres, nombres como texto
  seguro y enlaces preservados. El selector cancela al desmontarse o cambiar de
  contexto y la inserción contrasta la identidad/conversación vigentes.
- PostgreSQL 18.6 temporal: 42 pruebas dirigidas aprobadas; después, la regresión
  completa de mensajería/notificaciones/autorización/colaboración de tareas pasó
  248 pruebas. La primera es un subconjunto; no se suman. La instancia se detuvo.
  SQLite: 28 de menciones/seguimiento/avisos aprobadas. Modelos y migración coherentes.
- Frontend: 122 unitarias aprobadas, más Chat y recuperación de compositores.
  Pasaron canales, el selector de menciones y el buscador/guardados. La prueba
  nueva detectó un extremo de selección incorrecto en su propio dato con emoji;
  se corrigió el dato para seleccionar la palabra completa, sin cambiar el código.
- La regresión de recuperación de páginas expuso una carrera real preexistente
  en este trabajo: al reabrir la misma página, React puede agrupar los estados de
  carga y no repetir el efecto después de actualizar solo una referencia. La traza
  conservaba el foco en Título, con el bloque habilitado, sin ningún evento de foco
  hacia él. Diferir el foco por sí solo no resolvió el caso. Se añadió un estado
  explícito de instalación, con cancelación y comprobación del destino vigente.
  Pasó tres repeticiones consecutivas y otra en la suite de páginas; las aserciones
  de campo editable y el timeout original permanecen. Notas/PWA: doce aprobadas.
- Nueva base efímera para la aceptación nativa, con dos cuentas ficticias y Drive
  simulado; la base temporal anterior permanece intacta. Se activó la compilación
  final desde el aviso normal de actualización de la PWA y se contrastó el script
  cargado en ambos orígenes con el index generado. Compilación terminada con código
  cero, sin dependencias nuevas y con las advertencias previas de tamaño de Hojas.
- Dos sesiones nativas: Alfa buscó a Beta mediante el selector del canal público.
  La selección insertó el token en el borrador sin enviarlo; el foco y la selección
  de texto volvieron al extremo correcto del compositor. Tras el envío, ambas
  cuentas mostraron el nombre verificado y Beta recibió un único aviso genérico
  de mención, aunque no seguía el canal ni el hilo. El aviso abrió el mensaje exacto
  como contexto y no activó ningún seguimiento.
- Beta desactivó solo la preferencia de menciones, guardó y recargó la PWA. El
  control seguía desactivado y el de canales/hilos seguidos permanecía activo. Una
  segunda mención se publicó y llegó al historial, pero la lista de cuatro avisos
  conservó exactamente sus textos y fechas, sin un aviso adicional. Se restauró
  después la preferencia. El selector del canal privado no ofreció a Beta por no
  estar invitada; no se crearon permisos para completar la comprobación.
- En iframe Chromium de 375 × 667 y 812 × 375 se pudo alcanzar el compositor y
  Enviar desplazando el contenedor. En horizontal, Enviar quedó entre y=195 e
  y=239 dentro de 375px. Beta envió desde el hilo una mención a Alfa; Alfa recibió
  el aviso y abrió la respuesta correcta con su mensaje inicial. Ambos controles
  de seguimiento permanecieron desactivados. Hay captura responsive de evidencia;
  no se presenta como prueba de teléfono físico ni de teclado virtual.
- La aceptación nativa local de este componente está completada. La extensión a
  los demás contextos, marcar como no leído, reacciones y las fases 4–7 conservan
  su alcance pendiente. Notas solo en `pendingPilotReleaseNotes`, piloto exclusivo
  de IT intacto; sin commit/push/migración de producción/despliegue.

### Avance local del 28 de octubre — fase 3, menciones de Chat

- Chat reutiliza `ResourceMention` y la migración `0020` ya preparada; no se añadió
  otra tabla. La creación y edición sincronizan referencias dentro de su propia
  transacción, antes de subir multimedia. Solo se resuelven los participantes
  activos y elegibles de esa conversación. Un tercero escrito a mano permanece
  literal, sin crear cuenta, conversación ni acceso. Un reenvío resuelve de nuevo
  los tokens según los participantes del destino, sin trasladar referencias ajenas.
- El selector tiene una ruta privada de la conversación, consulta explícita
  acotada y hasta dos personas. Propietarios y ajenos reciben 404; se mantienen los
  límites del piloto, la cuenta activa, la asignación vigente y la validación de
  entradas. El correo único sin distinguir mayúsculas sigue garantizado por la base.
- Se mantiene un aviso `messaging.message_created`, no se añade un aviso de
  mención de Slack. Editar tampoco crea un aviso adicional. Desactivar menciones
  de Slack no silencia Chat; sus preferencias siguen siendo independientes.
- Historial paginado, contexto de búsqueda y eventos de sincronización incluyen
  las referencias verificadas por lotes: una consulta para cincuenta mensajes con
  tokens, ninguna para texto ordinario. Los recibos no consultan menciones. Cambiar
  el correo conserva la identidad enlazada y borrar la fuente elimina sus referencias.
- React usa el selector compartido para escribir, editar y describir imágenes,
  sin enviar al seleccionar. Se conservan el cursor, los enlaces y los nombres
  tratados como texto. La revisión de autorización, cambio de cuenta/conversación
  o incertidumbre cierran el selector; se cancelan las respuestas tardías. La capa
  de fondo queda inerte y no confirma lecturas mientras el selector está abierto.
- El selector tiene estilos propios para no depender de haber abierto Slack antes.
  UI/UX Pro Max guio el foco visible, el retorno al campo y los controles de 44px.
  El resaltado de menciones propias se compone sobre el carmesí con el color del
  texto, para no poner texto claro sobre una superficie casi blanca. No es un rediseño.
- SQLite: 63 pruebas de Chat, multimedia, historial, menciones y eventos terminaron
  correctamente, con una omisión específica de PostgreSQL. Después del ajuste final
  de la consulta de recibos pasaron otras quince pruebas dirigidas; no se suman como
  pruebas únicas. `makemigrations --check --dry-run` no detectó cambios.
- Frontend: 123 unitarias, Chat y recuperación de compositores aprobados; selector
  compartido, canales, buscador/guardados, páginas y recuperación CRDT aprobados.
  La prueba nueva incluye inserción sin envío, foco, ausencia de consultas al teclear,
  resaltado y cancelación de resultados tardíos después de una revisión de permisos.
  Notas/PWA: doce aprobadas. Los fallos iniciales de datos de prueba se corrigieron
  conservando sus aserciones: correo duplicado rechazado por la base, extremo de
  selección antes de un espacio y esperas React que todavía observaban la vista anterior.
- La ampliación final de las pruebas comprueba también el selector al editar un
  mensaje y describir una imagen de la cola, conservando la descripción al reintentar.
  Un control de foco de reenvío dejaba solo una espera fija de 60ms; ahora espera el
  efecto React dentro del límite habitual de cinco segundos y mantiene la aserción
  de foco en la barra de selección. La suite de Chat pasó tres repeticiones seguidas
  con estos casos, sin modificar el comportamiento de producción del reenvío.
- Una compilación se detuvo en `prebuild`: el guard de dependencias lanzó `npm ci`
  al cambiar la huella del manifiesto y Windows bloqueó el binario de Rollup que
  usaba nuestra vista previa. Se detuvo solo ese proceso conocido y se restauraron
  los 516 paquetes del lockfile, sin modificar dependencias ni el lockfile. La
  compilación de aceptación posterior pasó: 5.376 módulos, sin dependencias nuevas,
  con las advertencias previas de tamaño de Hojas. Se usa el proxy local aislado.
- La primera regresión completa PostgreSQL ejecutó 255 pruebas: una agotó el plazo
  de un segundo al conectar el socket de una página grande durante la carga local
  de instalación/compilación. Las tres pruebas de ese módulo pasaron después por
  separado, sin cambiar tiempos ni aserciones. La repetición completa terminó con
  255 pruebas aprobadas en 354,963 segundos y su instancia PostgreSQL se detuvo;
  no se ampliaron plazos ni retiraron verificaciones para obtener ese resultado.
- Aceptación nativa: nueva base efímera y dos identidades ficticias, con Drive
  simulado; las bases anteriores permanecen intactas. Ambas PWA activaron la
  compilación final y se contrastó su script con el index generado. Alfa eligió a
  Beta, insertó una mención sin envío automático y la publicó expresamente. Beta
  recibió un único aviso normal de Chat; lo abrió y vio el nombre verificado.
- Beta respondió con el selector en iframe Chromium oscuro de 375 × 667 y pasó a
  812 × 375. La selección devolvió el foco/cursor y permitió enviar; Enviar quedó
  entre y=326 e y=370 dentro de 375px. Alfa recibió en directo el texto y la mención.
  Alfa editó después su propio mensaje; Beta vio la edición y la lista de cuatro
  avisos mantuvo exactamente sus textos/fechas, sin duplicación. Captura móvil
  guardada con ambas menciones visibles; no se afirma prueba en teléfono físico.
- Notas ampliadas solo en `pendingPilotReleaseNotes`. Siguen pendientes las
  menciones de páginas, marcar como no leído, reacciones y las fases 4–7. Sin
  commit/push/despliegue, migración de producción ni apertura fuera del piloto IT.

### Avance local del 28 de octubre — fase 3, menciones de páginas

- Implementación en revisión: el selector de cada bloque consulta una ruta de la
  página, exige lectura actual del canal y de páginas, y solo ofrece destinatarios
  que satisfacen ambos permisos con alguna asignación elegible. No crea invitaciones,
  seguidores ni lecturas. El piloto permanece cerrado al resto de departamentos.
- Se reutilizan `ResourceMention`, el evento `slack.mentioned`, la bandeja y la
  preferencia personal ya existentes. No hay tablas nuevas ni otro motor de avisos.
  Los textos de avisos no incluyen título, contenido, nombres de archivos ni tokens.
- El primer guardado de una referencia introducida en un bloque puede avisar. La
  deduplicación es por destinatario y bloque, no por toda la vida del documento;
  otro bloque puede generar un aviso nuevo. Un mismo guardado agrupa varias
  referencias de una persona en un solo aviso. Ediciones ordinarias, reintentos,
  quitar/reponer el mismo bloque, copiar plantillas y restaurar versiones no
  repiten ni generan avisos retroactivos. Ganar acceso o activar la preferencia no
  convierte por sí solo un texto anterior en una notificación nueva.
- Las referencias se guardan dentro de la transacción REST o CRDT y antes del
  recibo de actualización. Se conservan la identidad tras cambiar de correo y las
  referencias históricas. La página admite cincuenta personas distintas y cien
  tokens históricos. Se excluyen proyecciones protegidas de Tareas, URL y código.
- La proyección verificada viaja en la carga inicial, confirmación, reconexión y
  eventos pertinentes de coedición; no se incorpora al estado Yjs. Un acuse antiguo
  no deshace metadatos más recientes. Historial y contexto de búsqueda también usan
  las referencias verificadas. Los documentos sin tokens no consultan sus menciones.
- Los avisos `slack_page` comprueban de nuevo ambos permisos, la sesión/MFA y la
  preferencia antes del push. La entrega exige que la referencia siga en el bloque
  de origen; una mención en otro lugar no valida un aviso retirado. La bandeja oculta
  fuentes sin acceso o inexistentes. Archivar conserva historial y referencias, pero
  detiene avisos nuevos/diferidos. Abrir la notificación utiliza página y bloque.
- El selector conserva el punto de inserción mediante una posición relativa Yjs.
  No sobrescribe el texto recibido de otros participantes. Si se elimina el bloque
  o cambia la identidad/permisos/contexto, no inserta en otra parte. Vista previa,
  historial y búsqueda resaltan nombres como texto seguro; el editor conserva el
  token. Se mantienen los límites de 4.000 caracteres y el foco visible del bloque.
- Pruebas actuales: diez casos nuevos de REST/CRDT y avisos aprobados en SQLite;
  modelos/migraciones coherentes. La regresión conjunta anterior de páginas,
  plantillas y menciones pasó cincuenta casos. No son totales sumables. Se corrigió
  el dato de 51 tokens para separarlo del texto anterior y se usa inserción real
  de `Text`, no la reasignación del objeto compartido al mapa de la réplica de prueba.
- Frontend: 125 unitarias aprobadas; selector compartido, Chat, recuperación de
  compositores, canales, búsqueda/guardados, páginas y recuperación CRDT aprobados.
  Incluye error/reintento de búsqueda, inserción en el bloque, retorno del foco,
  nombres seguros en vista previa, API anidada y acuse antiguo. Notas/PWA: doce
  aprobadas. La compilación, aceptación nativa y regresión PostgreSQL se cerraron
  posteriormente, según el registro inferior.
- Notas ampliadas solo en `pendingPilotReleaseNotes`. No se han autorizado commit,
  push, migraciones de producción, despliegues ni la apertura pública. El alcance
  pendiente de marcar como no leído, reacciones y fases 4–7 no se modifica.
- Aceptación nativa local completada con dos identidades ficticias y Drive
  simulado. Ambas PWA activaron el artefacto final `index-Dlk_enU3.js`, contrastado
  con el HTML generado. Mientras Alfa tenía abierto el selector, Beta añadió un
  prefijo al mismo párrafo; la inserción conservó ambos cambios y devolvió el
  cursor a Alfa. La vista previa de ambas cuentas mostró los nombres verificados.
- Beta recibió un único aviso genérico de página; al abrirlo, se enfocó el bloque
  correspondiente. Las ediciones ordinarias y la retirada/reposición del token
  conservaron el mismo aviso y fecha. Una referencia introducida en otro bloque
  generó un aviso nuevo. Beta mencionó a Alfa desde la vista móvil; Alfa recibió
  el aviso recíproco sin necesidad de seguir el canal.
- En iframe Chromium oscuro de 375 × 667 se completaron búsqueda, selección,
  retorno del foco y vista previa. En 812 × 375, Buscar personas ocupó y=264–308
  con altura de 44px; el selector permitió buscar y cerrar para volver al bloque.
  Se guardó captura con las menciones visibles. No se afirma prueba en teléfono
  físico, teclado virtual ni un rediseño visual completo.
- La primera regresión PostgreSQL de esta entrega no se contabiliza como éxito:
  dejó de emitir progreso y se interrumpió tras comprobar que no había consultas
  de prueba activas. Su instancia temporal requiere recuperación automática; no
  se eliminó manualmente su directorio ni se tocaron servicios de producción. El ejecutor ahora
  muestra el nombre de cada prueba para diagnosticar una repetición. No se
  cambiaron tiempos ni aserciones y no se contabiliza aquella ejecución como éxito.
- En la revisión se reprodujo además una exploración cuadrática de esquemas URL
  en el analizador compartido: un texto alfanumérico sintético de 8.000 caracteres
  seguido de una mención tardó 1,09s de pared. Se añadió un límite de inicio de
  esquema para no reintentarlo desde cada carácter. Tras la corrección, 100.000
  caracteres con una referencia se procesaron en 0,03125s de CPU; son métricas
  diferentes y no se presenta una razón de aceleración entre ambas mediciones.
- Se añadieron dos regresiones: texto de 100.000 caracteres bajo presupuesto de
  CPU, y conservación del enmascarado de URI/código. Los 28 casos de menciones de
  canales, Chat y páginas pasaron en SQLite después de esta corrección. La
  regresión PostgreSQL iniciada antes del cambio y una ejecución dirigida posterior
  validaron después el analizador definitivo, con los alcances indicados abajo.
- Cierre PostgreSQL: repetición completa de 265 pruebas aprobada en 500,610s,
  sin cambiar tiempos ni aserciones. Se preservó su informe como
  `full-265-page-mentions-20261028.log` en la raíz temporal de validación. Después
  del ajuste final del analizador, pasaron 53 pruebas dirigidas de menciones,
  páginas, CRDT y plantillas en 43,891s. Son ejecuciones solapadas, no 318 pruebas
  únicas; ambas terminaron con cierre limpio de PostgreSQL. El incidente inicial
  no tiene una causa demostrada y no se atribuye automáticamente al analizador.
- Se abrió también el segundo aviso desde la vista Mensajes: cambió a Páginas,
  cargó el documento correcto y enfocó `Texto 2`, no solo restauró el foco de una
  página ya abierta. La aceptación local de menciones de páginas está completada.
  UI/UX Pro Max guio el selector compartido, foco y controles de 44px; no se
  amplió la revisión visual ni se alteraron los componentes de identidad de BOLD.
- El objetivo completo sigue activo: marcar como no leído, reacciones y fases
  4–7 permanecen pendientes. Notas únicamente preparadas para el piloto IT;
  sin commit/push, migración de producción ni despliegue.

### Avance local del 28 de octubre — fase 3, marcas personales de no leído

- Implementación aceptada localmente: un punto de retorno por Chat,
  canal e hilo, privado por empleado. Persiste entre dispositivos hasta retirarlo
  expresamente; no deshace recibos, cursores reales ni notificaciones ya leídas.
- Migración local `0021_reading_reminders`: referencias a `SearchDocument`, sin
  copiar contenido, y reloj de colección. Versiones optimistas y reintentos
  inmutables impiden que una solicitud antigua reponga una marca retirada.
- Se reutilizan el resumen inicial de no leídos, el socket autenticado y la
  búsqueda con filtro `marked_unread`. No hay sondeo, socket ni motor de avisos
  adicionales. Los eventos se dirigen solo al mismo empleado y filtran permisos
  actuales antes de proyectar la colección; no muestran el contenido del mensaje.
- Hay controles en los mensajes de Chat/Slack y en la búsqueda. El recordatorio
  abre contexto sin darlo por leído. Los indicadores distinguen marcas personales
  de contadores reales; el historial de hilos conserva su ámbito independiente.
- Ocho casos iniciales del servidor aprobados en SQLite: privacidad, permisos,
  idempotencia, versiones, eliminación de fuente y ausencia de cambios en recibos.
  `makemigrations --check --dry-run` sin cambios adicionales. Faltan ampliar
  cobertura, cerrar frontend, PostgreSQL, compilación y aceptación nativa.
- Piloto IT intacto; sin commit/push, migración de producción ni despliegue.
- Cierre automatizado: 46 pruebas SQLite aprobadas con una omisión específica de
  PostgreSQL. La ejecución posterior en PostgreSQL 18.6 aprobó 49 casos en
  50,221s, incluidos tres de concurrencia: mismo intento una sola vez, un único
  ganador ante versiones obsoletas y conservación de ámbitos distintos con reloj
  creciente. La instancia se detuvo limpiamente. Son coberturas solapadas, no
  95 pruebas únicas ni una nueva ejecución de la regresión completa del repositorio.
- Frontend: 129 unitarias aprobadas; Chat/compositores, canales, menciones,
  búsqueda/guardados, páginas y recuperación aprobados. Cuatro pruebas de transporte
  y doce de notas/PWA aprobadas. `node tests/reading_reminder_ui.mjs` cubre estado
  confirmado, error/reintento inmutable, conflicto con otro dispositivo, retiro
  explícito, contexto, respuesta de cuenta antigua y bloqueo por incertidumbre.
  La búsqueda comprueba también colección inicial y apertura directa del ancla.
- El resumen vacío evita calcular ACLs de todos los canales cuando no hay marcas.
  La proyección no carga el texto indexado ni los cuerpos de mensajes; transporta
  referencias autorizadas, no copias de contenido. Cambiar la revisión de permisos
  reinicia también el estado personal del cliente. Los contadores reales no suman
  las marcas como mensajes nuevos. UI/UX Pro Max guio confirmaciones, errores,
  reintentos deliberados, foco visible y controles táctiles del nuevo componente.
- Compilación de aceptación aprobada: 5.380 módulos en 2m 6s, sin dependencias
  nuevas ni cambios de lockfile; advertencias previas de tamaño de Hojas. Ambas
  PWA activaron `index-CFjVGvSK.js`, contrastado con el HTML compilado. Nueva base
  efímera local; anteriores conservadas, cuentas ficticias y Drive simulado.
- Aceptación nativa: Alfa marcó el mensaje antiguo 25. Su segunda pestaña mostró
  la marca en directo, sin recargar, y Beta no recibió esa marca. Recargar Alfa
  conservó el indicador. Beta añadió después su propia marca sobre el mensaje;
  quitar la de Alfa desde su pestaña móvil la retiró de escritorio sin retirar
  la de Beta. El recibo siguió siendo «Leído por el destinatario».
- Alfa pudo marcar deliberadamente otro mensaje después de retirar el anterior.
  Se marcaron también una raíz de canal y una respuesta de hilo; la búsqueda
  reunió los tres ámbitos. Retirar solo la raíz dejó dos resultados: Chat e hilo.
  No se duplicaron los puntos ni se activó seguimiento para completar la prueba.
- En iframe Chromium oscuro de 375 × 667, Beta abrió el mensaje antiguo exacto
  con «Ver mensaje marcado» y volvió al chat conservando la marca. Repitió la
  apertura en 812 × 375. Captura móvil guardada; no se presenta como teléfono
  físico ni teclado virtual. La revisión visual integral permanece pospuesta.
- Notas preparadas solo en `pendingPilotReleaseNotes`. Las reacciones y fases
  4–7 mantienen su alcance pendiente; no se considera completado el objetivo.

### Validación local del 28 de octubre — reacciones y cierre de fase 3

- Migración `0022_message_reactions`: contador independiente en SearchDocument,
  reacciones únicas por persona/mensaje/emoji y estado personal con tombstone.
  El valor predeterminado de BD permite insertar con modelos históricos durante
  la prueba de backfill; no se modificaron migraciones históricas. Solo se aplicó
  a las bases efímeras locales, nunca a producción.
- Dieciséis emojis, hasta ocho distintos por persona y mensaje; texto, imágenes
  y notas de voz comparten la función. Añadir/retirar es una intención explícita,
  con versión personal y UUID de intento, no un toggle que pueda repetirse mal.
  Los cambios de otro empleado no provocan conflictos falsos. Las versiones de
  reacciones, contenido y recibos se fusionan por separado.
- Cada persona cambia solo sus reacciones. Se comprueba pertenencia al Chat,
  invitación privada, asignación, piloto y MFA actuales. El permiso configurable
  `slack.reaction.create` es independiente de escribir; una invitación de solo
  lectura o un canal archivado conserva consulta, no modificación de reacciones.
- Proyecciones agregadas y acotadas: tres consultas para un lote de mensajes,
  sin listas de empleados en cada DTO. No se accede ni se copia Drive para una
  reacción. Borrar la fuente elimina sus reacciones; un mensaje nuevo no las hereda.
- Se reutiliza el socket de sesión: Chat transmite solo metadatos de reacciones,
  sin cuerpos, avisos, actividad ni recibos nuevos. Slack agrupa invalidaciones
  de la vista abierta sin recargar la lista de canales ni el contador de no leídos.
  No se añadieron sockets ni sondeos periódicos.
- PostgreSQL 18.6: 71 pruebas dirigidas aprobadas en 142,038 s, incluidas tres de
  concurrencia y una nueva de socket real con dos participantes y un tercero no
  autorizado. Incluye historial/backfill, guardados, marcas personales, canales,
  socket de Slack y aislamiento de asignaciones de Core. No equivale a ejecutar
  toda la suite del repositorio. Log preservado como `reactions-71-20261028.log`
  en el entorno PostgreSQL temporal de validación; servidor detenido limpiamente.
- SQLite: 42 pruebas dirigidas aprobadas, una exclusiva de PostgreSQL omitida.
  Frontend: 146 pruebas unitarias/contratos aprobadas, más recorridos React de
  Chat, recuperación de adjuntos, Slack, menciones, historial, guardados y el
  nuevo `node tests/reactions_ui.mjs`. El arnés nuevo comprueba teclado/Escape,
  estado confirmado, reintento inmutable, retiro propio, orden de eventos y
  cancelación por cambio de identidad. La comprobación de modelos y Django pasa.
- Hubo fallos intermitentes de reserva de ArrayBuffer al cargar el arnés React;
  las ejecuciones finales aisladas pasaron. No se atribuye su causa al servidor
  ni a la memoria global del equipo, pues no quedó demostrada.
- Compilación final: 5.384 módulos, 2m 1s, sin dependencias nuevas; permanecen las
  advertencias conocidas de tamaño de Hojas. Aceptación sirve artefacto temporal
  separado, con las bases y compilaciones anteriores conservadas.
- Navegador real, dos cuentas ficticias: Alfa añadió un corazón, Beta lo recibió
  en directo y añadió el suyo (contador 2). Retirar el de Alfa dejó el de Beta
  (contador 1); el recibo «Leído por el destinatario» no se retiró. Recargar y
  activar la nueva PWA conservó la reacción de Beta y la ausencia de la de Alfa.
  Se confirmó también una celebración en un mensaje histórico de canal.
- Revisión 375 × 667, claro/oscuro y 812 × 375: se corrigió la fila de reacciones
  que estrechaba el texto del Chat. Ahora ocupa su propia fila sin desplazar la
  hora ni los controles compactos del audio. En horizontal, ancho de documento
  y viewport coinciden (812), sin desbordamiento horizontal. Es Chromium en un
  iframe de dimensiones reales, no un teléfono físico ni teclado virtual.
- UI/UX Pro Max guio selección/contadores accesibles, foco visible y Escape,
  confirmación contextual y objetivos táctiles; no se hizo el rediseño pospuesto.
  Notas preparadas en `pendingPilotReleaseNotes`, IDs publicados conservados.
- Cierre local de fase 3, no del objetivo completo. Siguiente: fase 4, crear
  tareas desde mensajes y páginas de acuerdos con referencias, respetando la
  privacidad y permisos existentes. Fases 4–7 pendientes. Sin commit/push/deploy
  ni apertura del piloto fuera de IT.

### Validación local del 28 de octubre — mensajes a tareas, fase 4A

- Migración `0023_message_task_conversions` aplicada solo a bases efímeras.
  Guarda una referencia y un recibo de intento por empleado/UUID, no otro tipo
  de tarea. La creación reutiliza TaskSerializer y TaskViewSet.perform_create:
  proyecto, sección, responsable, fecha, prioridad, seguimiento y pipeline normales.
- Revisión explícita de título/descripción y consentimiento de la audiencia de
  la tarea antes de crear. No se copian adjuntos, audios, reacciones ni el resto
  del chat. La tarea conserva su ACL; leerla no concede acceso al origen. Solo
  se ofrecen proyectos con los permisos actuales de lectura, creación y gestión.
- Los vínculos se filtran antes de nombres, paginación o recuentos. Propietario
  y administradores no obtienen acceso automático a DMs ni canales privados.
  El endpoint de orígenes usa `private, no-store`; una tarea sin referencias hace
  una consulta indexada, sin recorrer permisos de todos los canales.
- El intento protegido se escribe antes de enviar. Reintentar el mismo UUID
  devuelve la creación aceptada, aunque el mensaje se editara después; cambiar
  el contenido del intento se rechaza. Una revisión nueva de una fuente editada
  exige volver a revisar y confirmar. No se recrean tareas eliminadas al reintentar.
- Se usa el almacén cifrado existente, separado del borrador del compositor y
  ligado a cuenta/asignación/mensaje/conversación. Recuperar no envía. Cambios de
  permisos o identidad cancelan respuestas tardías. No hay sondeos nuevos ni
  lecturas de API por cada botón de mensaje cerrado.
- PostgreSQL 18.6: ejecución final de 57 pruebas dirigidas aprobadas en 37,204 s,
  incluidos tres casos concurrentes: un único resultado para el mismo intento,
  rechazo de UUID reutilizado para otro contenido y dos tareas deliberadamente
  distintas desde un mensaje. Incluye borradores, historial/guardados, colaboración
  de Tareas y aislamiento de asignaciones. Servidor detenido limpiamente; log
  `task-conversions-final-57-20261028.log` preservado en el entorno temporal.
  No equivale a la suite completa del repositorio. SQLite: 12 casos del componente
  aprobados después del arreglo de formato. Django y comprobación de modelos pasan.
- Frontend: 137 pruebas unitarias del grupo de mensajería aprobadas, más los
  recorridos React de Chat/recuperación, historial/guardados y 12 de notas/PWA.
  Las tres nuevas pruebas de modelo/API y `node tests/task_conversion_ui.mjs`
  pasan tras el ajuste final de sección. El arnés comprueba consentimiento,
  protección previa al POST, reintento inmutable, borrado tras confirmar, foco y
  cancelación por incertidumbre de identidad; no sustituye la prueba real de vault.
- Navegador, dos cuentas ficticias: Alfa preparó una revisión, cerró, recargó y
  recuperó proyecto, sección, responsable, prioridad y texto sin crear la tarea.
  Se confirmó expresamente y Beta pudo consultar la tarea asignada de otro equipo.
  Su origen abrió el mensaje histórico 25 exacto desde el detalle normal de Tareas.
- Beta recuperó también su fecha mediante el vault real y creó otra tarea desde
  móvil oscuro, con Alfa como responsable y fecha 30 de octubre. La tarea mostró
  proyecto, responsable, fecha, texto literal y saltos de línea correctamente.
  El recorrido nativo detectó y corrigió etiquetas visibles en la descripción:
  ahora usa el marcador rico existente, con texto escapado y sin cargas implícitas.
  El selector tampoco permite elegir la opción vacía como falsa «primera sección»
  cuando Sin sección está oculta. No se reintroduce esa sección automáticamente.
- Aceptación en Chromium mediante iframe 375 × 667; diálogo y contexto del mensaje
  sin desbordamiento horizontal. No se presenta como teléfono físico ni teclado
  virtual. Captura `validacion-tarea-desde-chat-movil.jpg` guardada en el workspace.
- Compilación final: 5.388 módulos en 1m 8s, sin dependencias nuevas; permanecen
  las advertencias conocidas de tamaño de Hojas. Artefacto temporal separado y
  bases anteriores conservadas. Ambas PWA activaron `index-CHSLRYPC.js`; las dos
  tareas siguieron vinculadas y Alfa preseleccionó «Trabajo en curso», su última
  sección utilizada, sin ofrecer la opción vacía oculta. Drive simulado: no copia archivos
  ni certifica una integración nueva con Google real.
- UI/UX Pro Max guio la confirmación de compartir, recuperación explícita,
  mensajes de resultado, foco/Escape y objetivos táctiles del control necesario.
  Graphify se mantiene sin reconstruir. Notas solo en pendingPilotReleaseNotes;
  IDs publicados intactos. Sin commit/push/deploy ni migración de producción.
- Solo se cierra la primera parte de fase 4. Siguen pendientes las páginas de
  acuerdos desde selección de mensajes y las fases 5–7; no se declara terminado
  el objetivo completo ni se amplía el piloto fuera de IT.

### Validación local del 28 de octubre — páginas de acuerdos y cierre de fase 4

- Migración `0024_message_agreements` aplicada a las bases efímeras PostgreSQL y
  SQLite, incluida la base ficticia de aceptación anterior que se conservó.
  No se aplicó a la base del desarrollador ni a producción. Modelos separados
  para el recibo por empleado/UUID y referencias de origen; el documento sigue
  siendo un ChannelPage normal, con PageRevision y colaboración existentes.
- Selector de hasta veinte mensajes distintos de la misma conversación o canal,
  con mensajes anteriores y respuestas de hilos. La revisión vuelve a consultar
  las fuentes autorizadas; no confirma lecturas ni genera un mensaje al crear los acuerdos.
  Se puede ajustar el texto individual, cambiar el orden, titular y añadir una
  introducción. No se copian adjuntos, audios, reacciones ni permisos del origen.
- El destino se descubre con los permisos actuales de canal, lectura de páginas
  y creación, filtrados antes de nombres y cursores. La creación usa el helper
  compartido de PageListView: validación de bloques, versión inicial, menciones
  verificadas y publicación de la invalidación habitual, no otro sistema de wiki.
- La confirmación explica que el texto aprobado pasa a ser una copia editable
  para los lectores presentes y futuros del canal. No se sincronizan cambios
  posteriores del mensaje ni se amplía su acceso. Las referencias se proyectan
  de nuevo por lector/asignación; propietario y administradores no tienen bypass.
  Borrar la fuente o quitar sus bloques oculta su referencia sin borrar el texto
  aprobado de la página. Las referencias no se serializan al documento CRDT.
- Revisión cifrada propia, separada de los compositores, ligada a la conversación
  y autorizada de nuevo antes de recuperar. Abrir el selector no expone sus textos
  hasta verificar el grant. Recuperar restablece selección, orden, texto y destino,
  pero no el consentimiento. Un intento pendiente se conserva antes del POST y
  se reintenta sin modificar su contenido ni crear otra página.
- Los cambios de versión de origen exigen una nueva revisión. Reintentar una
  operación aceptada devuelve su página sin volver a copiar un mensaje editado.
  El empleado y los canales se bloquean en orden global para evitar duplicados
  y cruces A→B/B→A. El límite de página se mantiene en 200 bloques y 100 KB; un
  texto largo se reparte en bloques de 4.000 caracteres sin truncarlo, y un exceso
  Unicode se rechaza atómicamente. Una página sin fuentes hace una sola consulta
  indexada de referencias, sin recorrer todas las ACLs de Slack.
- PostgreSQL 18.6: 69 pruebas dirigidas aprobadas en 73,046 s; cubren acuerdos,
  borradores, páginas, historial, conversión a tareas, plantillas y concurrencia
  de páginas. Incluye tres carreras de acuerdos y tres de páginas/CRDT. Servidor
  detenido limpiamente. Log preservado como `agreements-final-69-20261028.log` en
  el entorno temporal. No es una ejecución de toda la suite del repositorio.
  SQLite: los doce casos nuevos de acuerdos pasan; Django y modelos sin errores.
- Frontend: 141 unitarias del grupo de mensajería y doce de notas/PWA aprobadas.
  Recorridos React de Chat/multimedia/reenvío, recuperación de Chat/canal,
  Slack/menciones, páginas/recuperación y conversión a tareas pasan. El nuevo
  `node tests/agreements_ui.mjs` prueba selección explícita, revisión por servidor,
  orden, consentimiento, protección anterior al POST, reintento idéntico, limpieza
  tras confirmar, foco, cancelación de respuesta de identidad antigua y orígenes
  filtrados. La recuperación real se comprobó aparte; el mock no la acredita.
- Navegador, Alfa/Beta ficticios: Alfa seleccionó los mensajes históricos 24 y 25,
  revisó ambos textos y su orden, cerró y recargó la PWA. La recuperación conservó
  todo sin crear una página ni aceptar por sí sola compartir. Después de confirmar,
  ambos abrieron la página; Beta editó un bloque y Alfa lo recibió sin recargar.
  El origen 1 abrió exactamente el mensaje 25 en el contexto del historial.
- Segunda comprobación nativa: Alfa revisó un mensaje de «reserva interna» y creó
  deliberadamente otra página pública con un texto diferente aprobado. Beta vio
  la página y su texto, pero cero referencias y ningún texto reservado. Alfa sí
  conservó la referencia. No se añadieron invitaciones ni permisos para lograrlo.
- Selector y contexto probados en Chromium/iframe oscuro 375×667 y 812×375;
  comprobación adicional con el control de texto 125% del arnés. Diálogo sin
  desbordamiento horizontal: 359 px en vertical y 720 px en horizontal. No se
  presenta como teléfono físico, teclado virtual ni Dynamic Type del sistema.
  Captura `validacion-acuerdos-desde-mensajes.jpg` conservada en el workspace.
- Compilación aprobada: 5.392 módulos en 1m 59s, sin dependencias nuevas. Ambas PWA
  ejecutaron `index-D9Kc_eXc.js`; continúan los avisos conocidos de tamaño de Hojas.
  Se sirve un artefacto temporal separado; bases y compilaciones previas intactas.
  Drive simulado y sin copiar archivos: no certifica ninguna operación nueva de
  Google real. No se añadieron sockets ni sondeos por conversación.
- UI/UX Pro Max guio confirmación, orden mediante botones, recuperación deliberada,
  éxito/error, foco, escape y controles táctiles. No se hizo el rediseño pospuesto.
  Notas solo en pendingPilotReleaseNotes; IDs publicados conservados. Sin commit,
  push, migración de producción ni despliegue. Piloto IT intacto.
- Se cierra localmente fase 4, no el objetivo completo. Siguiente: fase 5,
  subpáginas, enlaces/backlinks, comentarios por bloque y formato/plantillas.
  Fases 5–7 mantienen íntegro su alcance pendiente.

### Validación local del 29 de octubre — subpáginas, primera parte de fase 5

- Migración `0025_page_hierarchy`: página superior opcional y versión de estructura
  independiente; recibos de movimiento por persona/intento. Aplicada únicamente
  a las bases efímeras de pruebas PostgreSQL y SQLite. Las páginas existentes
  quedan en la raíz, sin reescribir bloques, revisiones ni permisos.
- Crear subpágina reutiliza la creación normal y su permiso. Mover requiere
  gestión de páginas, dentro del mismo canal y bajo una página superior activa.
  La comprobación y la escritura comparten el bloqueo del canal: no hay ciclos
  bajo movimientos cruzados. Límite de veinte niveles, contando toda la rama.
- El movimiento no participa en Yjs ni cambia la época, versión de contenido,
  autoría o fecha del documento. Una ubicación desactualizada devuelve conflicto
  y exige elegir de nuevo. El reintento desconocido conserva el UUID y el destino;
  un intento ya aceptado devuelve su recibo junto a la ubicación actual.
- Navegación desplegable con hijos y siguientes páginas cargados bajo demanda.
  Catálogo de destinos paginado, excluyendo la propia rama antes del cursor.
  La ruta superior comprueba su ubicación; un error no aparenta estar en la raíz.
  Archivar no es recursivo: las subpáginas activas siguen visibles y la opción
  Incluir archivadas permite recorrer también sus páginas superiores archivadas.
- PostgreSQL 18.6: 46 pruebas dirigidas aprobadas en 75,858 s. Incluyen permisos,
  privacidad sin excepción para propietario, archivo, profundidad, reintentos,
  carreras de movimientos y edición CRDT simultánea al movimiento sin reiniciar
  la época. Regresión de páginas, coedición, plantillas y páginas de acuerdos.
  Servidor PostgreSQL detenido limpiamente; registro final conservado fuera del repo.
- Frontend: 154 pruebas unitarias de mensajería, notas y PWA aprobadas. Aceptación
  React de jerarquía, editor y recuperación aprobada: ramas perezosas, rutas,
  búsqueda con texto literal, confirmación, reintento inmutable, conflicto sin
  reenvío automático, vuelta del foco y descarte de respuestas tras abandonar.
- Navegador, dos cuentas ficticias: Alfa creó Manual del equipo y su subpágina
  Proceso de entrega. Beta editó el texto desde móvil mientras Alfa la movía a
  raíz; ambos conservaron el texto y la coedición, sin recargar. Beta la devolvió
  al manual y Alfa recibió la nueva rama. Archivar el manual mantuvo visible la
  subpágina activa y su ruta indicaba la superior archivada; después se restauró.
- Revisión Chromium de 375 × 667 oscuro y 812 × 375, más texto 125% del arnés:
  anchos de documento y viewport coinciden; el diálogo conserva desplazamiento
  vertical. No equivale a teléfono físico, teclado virtual ni Dynamic Type del
  sistema. No se realizó el rediseño visual pospuesto.
- Compilación final aprobada: 5.393 módulos en 1m 22s, sin dependencias nuevas;
  permanecen las advertencias conocidas de tamaño de Hojas. Artefacto temporal
  separado y bases/compilaciones previas conservadas. Drive simulado: esta fase
  no mueve ni copia archivos, ni certifica operaciones nuevas de Google real.
  Ambas PWA activaron `index-BFa__XDv.js`; tras actualizar se conservaron la rama,
  la ruta y el texto de Beta. Captura `validacion-subpaginas-20261029.jpg` guardada
  en el workspace; ambas sesiones de aceptación quedan abiertas para continuar.
- UI/UX Pro Max guio rutas jerárquicas, controles explícitos, foco/Escape,
  estados de carga/error y carga bajo demanda. Notas preparadas únicamente en
  pendingPilotReleaseNotes, identificadores publicados intactos. Graphify no
  se reconstruyó. Sin commit/push/deploy ni migración de producción; piloto IT intacto.
- Solo se acepta la parte de subpáginas. La fase 5 no está completa: siguen
  enlaces internos/backlinks, comentarios por bloque, formato y plantillas de
  procesos. Las fases 6 y 7 mantienen íntegro su alcance pendiente.

### Validación local del 29 de octubre — enlaces internos y backlinks

- Migración `0026_page_links`, aplicada solo a PostgreSQL/SQLite efímeros. Índice
  transaccional de destino por bloque de origen, sin copiar títulos ni contenidos.
  Las escrituras normales de páginas, CRDT, recuperación de versiones y creación
  desde plantillas reconcilian el índice. Los backlinks corresponden al contenido
  actual, no al conjunto de revisiones históricas.
- Bloque «Enlace a página»: buscar explícitamente entre páginas activas autorizadas
  del mismo canal u otros canales. Insertar no invita, no comparte archivos y no
  concede permisos. El catálogo exige edición del origen y filtra lectura de canal
  y páginas, invitación, asignación y sesión actuales antes del cursor.
- Referencia de destino fuera de Yjs. Título, canal y proyecciones autorizadas
  permanecen fuera del contenido compartido y de la recuperación cifrada; solo
  un identificador conocido puede acompañar la actualización por separado. Cada
  receptor recibe su propia proyección. Un lector sin acceso conserva un bloque
  opaco existente, pero no puede reemplazarlo ni forjar uno nuevo no autorizado.
- Nombre opcional del enlace es texto escrito expresamente por el autor. No se
  rellena con el título seleccionado; sin nombre, el título se consulta en vivo
  únicamente para lectores autorizados. El nombre puede editarse en coedición.
- «Páginas que enlazan aquí» carga referencias al desplegarse, con paginación y
  apertura de la página/bloque de origen. Lectura del origen filtrada antes de
  resultados y cursores; no se entregan totales ni nombres de referencias ocultas.
  Duplicados de una misma página se agrupan, conservando sus bloques de referencia.
- Invalidaciones limitadas en el socket existente, sin nuevo sondeo ni sockets.
  Un aviso entre canales comprueba lectura de ambos para cada sesión; no entrega
  el ID del canal relacionado ni revela un origen privado a lectores del destino.
  Cambios de nombre/archivo actualizan proyecciones sin escribir en el CRDT fuente.
- SQLite: 37 pruebas dirigidas aprobadas (17,368 s), incluidas referencias, CRDT,
  páginas y plantillas. PostgreSQL 18.6: 82 pruebas dirigidas aprobadas (126,034 s),
  incluidas jerarquía, concurrencia, sockets reales autenticados, historial y
  acuerdos. PostgreSQL detenido limpiamente; registro conservado fuera del repo.
- Frontend: 157 pruebas unitarias aprobadas; aceptación React de páginas,
  recuperación, jerarquía y enlaces aprobada mediante `npm run test:pages-ui`.
  También pasa búsqueda de historial. Pruebas nuevas cubren campos protegidos,
  deshacer/rehacer, recuperación sin títulos de destino, filtros/cursor, alias no precargado,
  foco, búsqueda deliberada, errores/reintento y cancelación de respuestas tardías.
- Aceptación nativa con Alfa/Beta ficticios: una página privada enlazó Proceso de
  entrega. Alfa vio su backlink y Beta ninguno, sin revelar el nombre ni el canal
  privado. Al enlazar ese protocolo privado desde la página pública, Beta recibió
  el bloque en directo con «Página no disponible» y pudo seguir editando el texto;
  Alfa recibió esa edición. El buscador de Beta tampoco ofreció el destino privado.
- Alfa enlazó después Proceso de entrega desde Manual del equipo, con el nombre
  «Ver proceso de entrega». El nuevo backlink apareció en Beta sin recargar y sin
  el origen privado. Abrirlo llevó al Manual y enfocó «Nombre del enlace 2», el
  bloque de origen; no abrió un navegador externo ni otra aplicación.
- Revisión Chromium oscuro de 375 × 667 y 812 × 375 con texto 125% del arnés. El
  selector mide 337/680 px respectivamente y conserva desplazamiento vertical en
  horizontal; documento y viewport mantienen el mismo ancho. No equivale a un
  teléfono físico, teclado virtual ni Dynamic Type del sistema.
- La aceptación detectó que el nombre del enlace heredaba el tamaño de título y
  ensanchaba 25 px el documento móvil. Se separó el tipo de campo de su aspecto,
  conservando el espejo de selección de una línea, y se acotó su columna de rejilla.
  Verificado con el artefacto final: documento/viewport 375/375 y 812/812, campo de
  alias de 16 px y nombre conservado. El enlace recién insertado indica validación
  pendiente mientras se confirma, en vez de afirmar anticipadamente que no existe.
- Compilación final: 5.394 módulos en 1m 48s, sin dependencias nuevas; advertencias
  conocidas de tamaño de Hojas. Artefacto temporal separado, bases y compilaciones
  anteriores conservadas. Drive es un doble local y esta fase no copia archivos:
  no certifica una operación nueva con el proveedor real.
  Ambas PWA ejecutaron `index-CzuYiA_T.js`; los enlaces y el nombre personalizado
  persistieron tras actualizar. Captura `validacion-enlaces-paginas-20261029.jpg`
  guardada en el workspace y sesiones abiertas para continuar la aceptación.
- UI/UX Pro Max guio foco visible, diálogo cancelable, selección y confirmación
  explícitas, etiquetas y carga bajo demanda. Graphify sigue sin grafo en este
  checkout; se consultaron fuentes directamente, sin reconstrucción ni hooks.
  Notas solo en pendingPilotReleaseNotes; IDs publicados intactos. Sin commit,
  push, migración de producción, deploy ni apertura fuera de IT.
- Se acepta este componente, no toda la fase 5 ni el objetivo: siguen comentarios
  por bloque resolubles, formato/alias de enlaces externos/código y plantillas de
  procesos. Las fases 6 y 7 conservan íntegro su alcance pendiente.

### Validación local del 29 de octubre — fase 5: conversaciones por bloque

- Modelos `PageDiscussion`, `PageDiscussionComment` y `PageDiscussionReceipt`,
  independientes de `Page.blocks`, Yjs y `PageRevision`. Migración
  `0027_page_discussions` con permisos configurables `slack.page_comment.*`.
  Aplicada solo en bases aisladas locales; no en producción.
- Lectura condicionada al canal, página y permiso actual. La autoría se comprueba
  antes de cualquier privilegio de propietario/administrador al editar o eliminar.
  Resolver/reabrir requiere el permiso de gestión y ser iniciador o editor de la
  página; no permite modificar comentarios ajenos. Invitación de solo lectura y
  página/canal archivado no conceden escritura.
- Comentarios de texto de hasta 4.000 caracteres, enlaces seguros y respuestas
  paginadas. Eliminación del propio texto mediante lápida sin borrar respuestas
  ajenas. Estado abierto/resuelto y bloque se filtran antes de paginar. Hilos de
  bloques retirados siguen accesibles; recuperar una versión con el mismo ID de
  bloque los vuelve a asociar. No se conserva una copia del contenido del bloque.
- UUID/digest por intento, control optimista de versiones y bloqueo del canal:
  reintentar no duplica el comentario; un conflicto muestra la versión guardada
  sin sobrescribir silenciosamente. Un evento genérico sin cuerpos, IDs de página
  o totales privados utiliza la conexión existente; exige permisos actuales de
  página y comentarios para cada receptor. No hay sondeo adicional ni sockets nuevos.
- Panel accesible desde cada bloque o Comentarios de la página, filtros y estados,
  controles de autoría, confirmación de eliminación, resolución/reapertura y carga
  de comentarios anteriores. No se añaden comentarios a vistas de historial o a
  copias de plantillas. Las operaciones de comentarios no recargan el editor ni
  las referencias inversas; el resumen no consulta por cada versión de coedición.
- Borradores cifrados separados por cuenta, asignación, página, bloque/hilo o
  comentario y modo. Una recuperación requiere permiso actual y decisión expresa;
  no envía nada automáticamente. Se protege el intento completo antes de enviar,
  y tras una respuesta se conserva el control del cierre del siguiente borrador.
  La revisión nativa detectó una carrera de cierre rápido: se corrigió el registro
  del cierre y la captura inmediata del texto, con prueba de regresión específica.
- PostgreSQL 18.6 aislado: **50 pruebas dirigidas aprobadas** en 76,762 s, incluidas
  las 12 de comentarios y las 4 de concurrencia reales, además de páginas, enlaces,
  borradores, sesiones/CSRF y coedición. El primer ensayo tuvo una expectativa
  incorrecta sobre checkpoints: Yjs no crea una revisión por pulsación. Corregida
  la expectativa sin alterar ese comportamiento; registro final conservado como
  `page-discussions-50-20261029.log` en el directorio temporal de validación.
- Frontend: **153 pruebas de Node aprobadas**, incluidas las nuevas de rutas,
  cursores, recuperación, versiones y notas. `npm run test:pages-ui` pasa sus cinco
  suites React/JSDOM: páginas, recuperación, jerarquía, enlaces y comentarios.
  El ensayo de comentarios usa WebCrypto real y un adaptador de almacenamiento;
  no se presenta ese ensayo como persistencia nativa de IndexedDB.
- Chromium con dos sesiones ficticias Alfa/Beta: apertura por bloque, envío y
  respuesta sin recarga, controles de edición/eliminación solo propios y resolución
  y reapertura sincronizadas. La página siguió en versión 5, con el mismo contenido
  y fecha de modificación. Se comprobó una copia cifrada después de recarga completa
  de la PWA, recuperación expresa y permanencia de solo dos comentarios: el borrador
  no se envió. Esa comprobación sí usa el IndexedDB del navegador.
- Móvil oscuro del arnés: 375 × 667 (diálogo 337 px) y 812 × 375 con texto 125%
  (diálogo 760 px). Documento y viewport mantienen 375/375 y 812/812 respectivamente;
  hay desplazamiento vertical interno. No acredita teléfono físico o teclado virtual.
- UI/UX Pro Max guio confirmaciones, foco, errores recuperables, controles rotulados
  y tamaños táctiles, sin rehacer el diseño general. Nota preparada exclusivamente
  en `pendingPilotReleaseNotes`; identificadores publicados intactos. Drive sigue
  simulado: este componente no adjunta archivos ni anuncia avisos de menciones en
  comentarios de páginas. Sin commit, push, migración de producción o deploy.
- Se acepta este componente, no toda la fase 5 ni el objetivo global. Sigue formato
  básico/alias externos/código y plantillas oficiales; después biblioteca/subidas
  recuperables (fase 6) y automatizaciones acotadas (fase 7). Piloto solo IT.
- Compilación final aprobada: 5.398 módulos, 1m 2s, sin dependencias nuevas y con
  las advertencias conocidas del tamaño de Hojas. Ambas PWA ejecutaron
  `index-RcSlFq3_.js`; se volvió a ofrecer y recuperar el borrador privado después
  de actualizar, sin crear un tercer comentario. Captura inspeccionada:
  `validacion-comentarios-bloques-20261029.jpg` en el workspace. Las dos sesiones
  y el backend aislado quedan disponibles para continuar; bases y artefactos
  anteriores conservados. `check`, `makemigrations --check --dry-run` y
  `git diff --check` aprobados.

### Validación local del 29 de octubre — fase 5: formato y bases de proceso

- Contrato acotado de formato por tramos UTF-16: negrita, cursiva, tachado,
  código en línea, destino de enlace y supresión explícita del autoenlace. Se
  conserva texto plano más atributos estructurados; no HTML ni marcas Markdown.
  Máximo 200 tramos aceptados por bloque y límites generales de 4.000 caracteres,
  200 bloques y 100 KB de contenido. URLs http/https de hasta 2.048 caracteres,
  sin credenciales, espacios/controles ni protocolos ejecutables.
- Atributos nativos de Y.Text, no un mapa paralelo que sobrescriba la coedición.
  Selecciones relativas sobreviven a inserciones anteriores; una selección de otro
  campo, bloque eliminado o época ajena no puede utilizarse como destino. Se
  separan las operaciones de formato en el deshacer/rehacer propio. Un cambio
  que no modifica nada no deja el editor en un falso estado sin guardar. Borradores
  locales que excedan el límite al combinarse siguen legibles y pueden deshacerse
  o quitar formato antes de reintentar; el servidor mantiene el límite estricto.
- El servidor valida atributos, tramos, Unicode y objetos incrustados tanto en
  REST como en actualizaciones binarias antes de persistir o distribuir el estado.
  La API Python de pycrdt usa offsets UTF-8 al editar: se convierten explícitamente
  desde los offsets UTF-16 del contrato. Pruebas con emoji acreditan esa diferencia.
- En el editor: Formato del bloque, controles rotulados y vista formateada. El
  campo de escritura conserva la edición nativa y la composición IME; Vista previa
  muestra el resultado completo. Ctrl/Cmd+B, I y K actúan sobre una selección de
  texto, sin capturar campos del título, alias de página, código o modales. Si una
  selección cambió mientras se preparaba un alias, se pide seleccionar de nuevo:
  no se reemplaza texto ajeno sin revisión. Los cambios aún sin aplicar en el
  diálogo de enlace advierten antes de actualizar/recargar la PWA.
- Bloque Código con catálogo explícito de lenguajes y visualización literal. No
  ejecuta código/HTML, no autoenlaza y no genera menciones. El código en línea
  tampoco genera menciones; ambos siguen incluidos como texto en el buscador.
  El render utiliza elementos React seguros, sin dangerouslySetInnerHTML.
- Se mantienen versiones, recuperación, plantillas compartidas, proyecciones
  protegidas y comentarios por bloque; las referencias a tareas/páginas siguen
  fuera del CRDT. No se añaden permisos nuevos, modelos ni migraciones en esta
  entrega: los campos JSON y los permisos de páginas existentes cubren el formato.
- Catálogo del sistema ampliado con Guía de proceso, Entrega y revisión y Traspaso
  de trabajo. Son bases inmutables del catálogo que producen copias editables con
  IDs de bloque nuevos y reintento idempotente. No sustituyen políticas aprobadas,
  no crean tareas/asignaciones ni otro sistema de estados, y no copian accesos,
  contraseñas o datos privados. Las tres bases anteriores conservan sus IDs.
- PostgreSQL 18.6 aislado: **72 pruebas dirigidas aprobadas** en 66,265 s, incluidas
  formato, concurrencia real entre una escritura de texto y otra de formato,
  páginas, CRDT, versiones, plantillas, menciones, enlaces protegidos y comentarios.
  Registro conservado: `page-formats-72-20261029.log` en el directorio temporal de
  validación PostgreSQL. Se detuvo limpiamente ese servidor al finalizar.
- Frontend: **159 pruebas Node aprobadas** y las seis suites de `test:pages-ui`:
  páginas, recuperación, jerarquía, enlaces, comentarios y formato. El nuevo ensayo
  React verifica las cuatro marcas básicas, alias seguro, foco/selección, aviso
  de PWA, código literal/lenguaje y cambio a solo lectura. Las pruebas del modelo
  comprueban marcadores relativos, deshacer propio y recuperación con atributos.
- Chromium, dos sesiones ficticias Alfa/Beta: creación desde Guía de proceso;
  texto y negrita recibidos por la otra cuenta sin recargar. Beta modificó la
  selección mientras Alfa preparaba un alias: se rechazó la aplicación sin
  reemplazar el cambio de Beta. Tras seleccionar de nuevo, el alias se aplicó;
  deshacer recuperó exactamente el texto escrito por Beta y rehacer repuso el alias.
  Negrita sobre ese alias mantuvo su dirección en la segunda cuenta. El bloque HTML
  llegó con su contenido literal, lenguaje y cero elementos script, enlaces o
  menciones generados. No se visitó el enlace externo ni se ejecutó el ejemplo.
- Móvil oscuro del arnés: diálogo de alias de 337 px en 375 × 667, y de 620 px en
  812 × 375 con texto 125%; documento/viewport 375/375 y 812/812. El diálogo horizontal
  conserva desplazamiento interno. Código de 325 px dentro del viewport de 375 px.
  No acredita un teléfono físico, teclado virtual ni Dynamic Type del sistema.
- Compilación aprobada: 5.401 módulos en 57,16 s, sin dependencias nuevas; solo las
  advertencias conocidas de tamaño de Hojas. Artefacto `index-CO-YlLkZ.js` comprobado
  en el navegador. Captura inspeccionada: `validacion-formato-procesos-20261029.jpg`
  en el workspace. Comprobaciones Django, migraciones en seco y diff sin errores.
  UI/UX Pro Max guio foco, teclado, etiquetas, selección y controles progresivos,
  manteniendo la identidad actual y aplazando el rediseño visual completo.
- Fase 5 aceptada localmente, no liberada. Nota solo en pendingPilotReleaseNotes;
  pilotos y privacidad actuales intactos. Sin commit, push, migración de producción
  ni deploy. Drive continúa simulado y no es objeto de esta aceptación. El objetivo
  global sigue abierto: faltan biblioteca/subidas recuperables (6) y automatizaciones
  acotadas (7), sin reducir su alcance a lo ya implementado.

### Validación local del 29 de octubre — fase 6: biblioteca de mensajes

- Primer componente de la fase 6: biblioteca de recursos de mensajes conservados,
  por chat privado, canal y raíz/respuestas de un hilo. No depende de los últimos
  mensajes cargados en React, ni incluye el contenido de páginas o proyecciones
  privadas de Tareas. Imágenes y audios son los formatos actuales; documentos
  adicionales, capacidad y subidas asíncronas permanecen pendientes.
- Se reutiliza SearchDocument, con indicador has_links e índice parcial. La
  migración 0028 completa ese indicador sobre el historial en lotes de 300,
  sin consultar Drive. El extractor v1 queda congelado para reproducir el backfill.
  Cambiar o retirar un enlace actualiza la proyección en la transacción del mensaje;
  no es un registro inmutable de todas las versiones anteriores de su texto.
- Consulta de 25 mensajes por página, orden creación/UUID y corte de creación
  firmado por cuenta, asignación, contenedor y filtros. No ofrece totales globales.
  Los permisos actuales se comprueban antes de consultar/paginar y en cada descarga;
  propietario/administrador no reciben lectura automática de DMs o canales privados.
  Una edición posterior puede cambiar los recursos del mensaje, no su posición.
- Filtros por tipo, remitente, fechas locales inclusivas y palabras completas del
  texto/metadatos. Un mensaje puede presentar varios enlaces, deduplicados dentro
  de ese mensaje. Solo destinos http/https sin credenciales ni controles; no se
  descarga la URL, no hay previsualización remota ni ejecución de HTML/código.
- Acceso en Chat desde Información del compañero → Archivos y enlaces; en Slack
  junto a Mensajes/Páginas. Desde un hilo, la consulta abarca su raíz y respuestas.
  Cada recurso permite abrir el contexto exacto, sin navegar al último mensaje.
  Imágenes, reproductor y descarga usan la ruta autenticada existente y Blob local;
  no exponen identificadores de Drive. Los nombres respetan el MIME saneado real.
- No se descargan bytes al listar ni se añaden sondeos, conexiones o consultas por
  cada mensaje: las pistas del socket existente señalan que conviene actualizar.
  Cambio de filtros, identidad o permisos aborta solicitudes pendientes y retira
  vistas/object URLs. Foco, teclado, errores recuperables y controles rotulados
  siguen los patrones existentes, sin una revisión visual general.
- Los lectores de Chat/canal quedan suspendidos bajo biblioteca e historial.
  La sesión puede confirmar entrega normal al recibir un mensaje; consultar los
  recursos no confirma su lectura. Se comprobó en navegador con Alfa/Beta: Beta
  envió un enlace nuevo mientras Alfa tenía el panel abierto, apareció la pista de
  actualización y read_at continuó vacío antes y después de consultar el recurso.
- PostgreSQL 18.6 aislado: **59 pruebas aprobadas** en 21,394 s: biblioteca,
  backfill histórico, permisos/piloto, cursores, búsquedas, canales y medios.
  Log conservado: resource-library-59-20261029.log en el directorio temporal de
  PostgreSQL. El servidor de pruebas se detuvo limpiamente. SQLite aislado: las
  10 pruebas nuevas también aprobadas, y migración 0028 aplicada solo allí.
- Frontend: **164 pruebas Node aprobadas**; suites React de historial, guardados,
  biblioteca, Chat y Slack aprobadas. Incluyen descarga explícita, extensión segura,
  cancelación de bytes/respuestas tardías, object URLs revocadas, filtros, contexto,
  aislamiento de permisos y suspensión/reanudación del lector bajo el panel.
  test:history-ui incorpora la nueva suite. Sin dependencias ni cambios de lockfile.
- Chromium, dos cuentas ficticias: consulta del mismo recurso por ambas cuentas,
  filtros de imagen/texto y fecha nativa; enlace antiguo recuperado fuera de la
  ventana de mensajes cargados. La imagen del almacenamiento simulado se abrió
  en 700 px y su descarga de escritorio coincidió con el SHA-256 de la base.
  La espera de descarga del iframe no notificó el archivo; no se usa como prueba
  de descarga móvil física. El contexto exacto se abrió mediante la API protegida.
- UI/UX Pro Max guio el panel acotado, foco, consulta explícita y contraste. La
  inspección encontró enlaces oscuros insuficientes; el nuevo color se deriva de
  los tokens BOLD, sin alterar la paleta global: contraste de texto 5,48:1 en
  oscuro y 5,23:1 en claro sobre la tarjeta. El arnés comprobó 375 × 667 y
  812 × 375 con texto 125%, scroll interno y sin desbordar horizontalmente. No
  equivale a teléfono físico, teclado virtual o Dynamic Type del sistema.
  La cabecera queda fuera del cuerpo desplazable para evitar que los campos
  asomen sobre ella al llegar a los recursos con el teclado.
- Nota preparada solo en pendingPilotReleaseNotes, sin modificar publicaciones
  anteriores. Validación local y Drive simulado: no acredita Drive de producción.
  Piloto IT intacto, sin commit, push, migración de producción ni deploy.
- Antes de liberar la migración con backfill hay que detener los escritores
  antiguos, migrar y reiniciar con el código nuevo. Una convivencia prolongada
  con trabajadores anteriores no actualiza has_links; no usar despliegue rodante
  ciego para este cambio. Esta precaución no autoriza desplegar en esta ronda.
- Se acepta la biblioteca de formatos actuales, **no toda la fase 6**. Continúan
  documentos validados y subidas recuperables; después, automatizaciones de fase 7.
- Compilación final: 5.404 módulos, 56,86 s; ambas PWA ejecutaron
  index-D1OHYF6C.js. Persisten únicamente las advertencias conocidas de Hojas.
  El panel usa un portal de ventana completa, capa 1000 y cabecera independiente:
  en horizontal con texto 125% quedan 207 px de cuerpo desplazable, no 59 px
  dentro del módulo. Captura inspeccionada: validacion-biblioteca-recursos-20261029.jpg
  en el workspace. Suites de historial/biblioteca y módulos Chat/Slack repetidas
  y aprobadas tras integrar el portal. Check, migraciones en seco y diff aprobados.
- Precisión responsive: con texto normal, la raíz y viewport móvil miden 375 px;
  en horizontal ampliado, 812 px. Al volver a retrato manteniendo texto 125%,
  la raíz preexistente de la app de fondo llega a 400 px. El portal conserva 375 px,
  el panel 359 px exteriores y el cuerpo 325/325 px sin desborde propio. Se registra
  ese desborde de fondo para la revisión visual general; no se acredita que toda
  la app ya esté adaptada a texto ampliado en retrato.

### Validación local del 29 de octubre — fase 6: documentos originales

- Segundo componente de la fase 6. Chat, canales y respuestas de hilos permiten
  adjuntar un documento por mensaje, con texto opcional. Catálogo explícito: PDF,
  TXT/CSV UTF-8 y DOCX/XLSX/PPTX sin macros conocidas. Se mantienen colas de imágenes
  y notas de voz; no se mezclan documentos e imágenes en un mismo envío. Selección,
  pegado y arrastre conservan el archivo como borrador, nunca lo envían solos.
- El límite general sigue siendo 10 MB por archivo y se acota TXT/CSV a 2 MB.
  La capacidad agregada cifrada de las colas existentes no se amplía. No se añaden
  dependencias, convertidores, vistas remotas o escáneres. El original se conserva
  byte a byte y se sirve como attachment, con MIME canónico, nosniff y CSP sandbox.
  No se incrusta el documento en iframe/object/embed ni se carga al mostrar la tarjeta.
- document_uploads.py valida extensión/MIME, UTF-8/controles y estructura CSV;
  límite CSV 50.000 filas, 256 columnas y tamaño acotado por campo. No elimina
  fórmulas CSV: abrirlo en una hoja externa requiere confianza en su procedencia.
  El PDF solo tiene comprobación de cabecera, cierre y posición xref: no se
  descomprimen sus streams, no se comprueba todo su esquema y puede contener
  contenido activo. No es un saneador, un renderizador ni un análisis antivirus.
- Office se inspecciona en memoria sin extraer archivos: preflight del directorio
  ZIP antes de asignar sus entradas; máximo 2.048 partes, 32 MB expandidos, 8 MB
  por parte, 6 MB XML y relación de compresión 200:1. ZIP64, cifrado, volúmenes,
  rutas ambiguas, duplicados normalizados, travesía, enlaces simbólicos, prefijos
  ejecutables, errores de CRC y compresiones ajenas a stored/deflated se rechazan.
  XML UTF-8 sin DTD/entidades y con límites de nodos/profundidad. Parte principal,
  relaciones y content-types deben concordar con DOCX/XLSX/PPTX; se rechazan
  macros/VBA, ActiveX, OLE, embeddings y relaciones activas conocidas. Solo se
  admiten relaciones externas de hipervínculo HTTP/HTTPS sin credenciales; no se
  visitan. No es una validación OOXML completa ni garantiza ausencia de malware;
  los límites conservadores pueden rechazar archivos legítimos poco habituales.
- Referencias técnicas primarias: [formatos Open XML](https://learn.microsoft.com/en-us/office/open-xml/about-the-open-xml-sdk),
  [estructura SpreadsheetML](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document)
  y [ZipFile](https://docs.python.org/3/library/zipfile.html). La comprobación de
  límites/seguridad corresponde a esta implementación, no a una garantía del formato.
- MessageMedia/ChannelMedia añaden kind=document con migración 0029, solo choices,
  sin cambiar datos existentes. Aplicada únicamente en SQLite y PostgreSQL aislados.
  Se reutilizan las carpetas privadas y la ruta de almacenamiento existentes; no
  se crean permisos públicos. Cada descarga vuelve a autenticar y comprobar ACL,
  aunque ese archivo se descargase antes; hash/tamaño se verifican al recuperarlo.
  Los enlaces de descarga no contienen IDs de Google. Object URLs se revocan y
  las descargas pendientes se cancelan al desmontar/cambiar contexto.
- Biblioteca y buscador aceptan Documentos y Todos los archivos; indexan nombre,
  tipo y texto del mensaje, no el contenido del PDF/Office. La biblioteca conserva
  paginación/permisos actuales y no confirma lectura por consultar recursos. No
  se anuncia reenvío de documentos: esta aceptación comprueba su envío original;
  los ensayos previos de reenvío de texto/imágenes se mantienen. Notas de voz y
  documentos no se ofrecen como reenviables.
- El borrador cifrado conserva los bytes originales y el intento de envío inmutable.
  Un rechazo explícito permite corregir/quitar el archivo sin perder su texto.
  Una repetición de la suite encontró el botón de documento habilitado antes de
  terminar de abrir el checkpoint al cambiar de chat; se igualó su estado al guard
  real de recuperación para que no se ignore una selección. La prueba ahora espera
  un control realmente habilitado; no se alargaron timeouts ni se omitió el ensayo.
- PostgreSQL 18.6 aislado: **86 pruebas aprobadas** en 24,201 s, documentos,
  biblioteca, buscador, canales, medios y chats. Log: document-media-86-20261029.log
  en el directorio temporal de validación. Incluye formatos malformados, límites,
  manipulación, integridad, privacidad, reintento idempotente y carpeta/bytes mediante
  el protocolo LocalDrive. El PostgreSQL se detuvo limpiamente. No se usó Google real.
- Frontend: **166 pruebas Node aprobadas** y suites React de historial, guardados,
  biblioteca, documentos, Slack y Chat. Incluyen descarga explícita/ACL nueva,
  cancelación/respuestas tardías, nombre seguro, documento no tratado como audio,
  restauración cifrada e intentos inmutables. Las suites se repitieron tras corregir
  etiquetas de documentos, tamaño pequeño y el guard de selección anterior.
- Chromium con las dos cuentas ficticias Alfa/Beta: PDF seleccionado sin enviarse,
  cambio a Slack, recarga real de la PWA, regreso al chat y recuperación explícita
  desde IndexedDB de nombre, archivo y texto. Un único envío creó un único mensaje.
  Beta lo recibió sin recargar. Su descarga nativa coincidió con el original y el
  digest de DB (55cf578f…9cb295, 346 bytes). Un falso PDF se rechazó con error de
  cabecera manteniendo texto/adjunto, sin crear MessageMedia ni envío al compañero.
- Se enviaron DOCX sintético al canal coordinación y TXT UTF-8 a su hilo. Beta
  consultó Documentos en la biblioteca y encontró ambos recursos; descargó ambos
  desde la biblioteca. Sus SHA-256 coincidieron con origen y DB: 8a67747c…ff008e
  (716 bytes) y ce8628b5…f4cb3 (53 bytes). Los Office de prueba son contenedores
  estructurales mínimos, no acreditan compatibilidad con todas las aplicaciones
  Office. La espera de descarga del iframe no notificó archivo; la prueba nativa
  acreditada se realizó desde el documento superior del destinatario.
- Advertencia explícita en tarjeta y biblioteca: «Archivo original sin análisis
  antivirus. Abre solo archivos de confianza». UI/UX Pro Max guio etiquetas,
  estados inhabilitados, descarga voluntaria, foco, avisos y conservación ante error,
  sin adelantar el rediseño general. Notas solo en pendingPilotReleaseNotes;
  identificadores publicados intactos. Piloto IT sin cambios.
- Esto acepta documentos originales locales, **no toda la fase 6**. Las subidas a
  Drive aún son síncronas y retienen el bloqueo de DB/raíz durante la operación
  Google: siguen pendientes outbox asíncrono recuperable, deduplicación y
  conciliación de huérfanos; después las automatizaciones acotadas de fase 7.
  Drive fue simulado: no se acredita conexión real, producción o antivirus.
  Sin commit, push, migración de producción ni deploy. Objetivo global abierto.
- Compilación final aprobada: 5.406 módulos, 1 minuto, sin dependencias nuevas;
  solo las advertencias conocidas de tamaño de Hojas. Ambas PWA ejecutaron
  index-oXlNaazA.js tras la actualización explícita. Suite Chat repetida dos veces
  y aprobada después del guard de recuperación; 166 pruebas Node repetidas y
  aprobadas. Check Django, migraciones en seco y diff sin errores.
- Arnés móvil oscuro: 375 × 667 con texto normal, raíz/viewport 375 px, tarjeta
  267 px y borrador 311 px, ambos sin desborde propio. Panel 359 px y cuerpo
  325/325 px. Horizontal 812 × 375 con texto 125%: raíz/viewport 812 px, panel
  780 px y cuerpo 730/730 px, con 207 px de alto desplazable. Se verificaron en
  navegador las etiquetas «Texto del documento» y «1 KB» de un archivo pequeño.
  No acredita teléfono físico ni teclado virtual; se conserva la limitación de
  fondo a texto ampliado en retrato registrada en la entrega anterior.
  Capturas inspeccionadas y guardadas en el workspace:
  validacion-documentos-20261029.jpg y validacion-documentos-movil-20261029.jpg.
  Dos sesiones, backend aislado y preview local conservados para continuar.

### Validación local del 29 de octubre — fase 6: base de la cola backend

- Avance de infraestructura, **no aceptación de toda la fase 6**. El compositor
  actual aún usa el POST multipart síncrono anterior; no se ha sustituido ni
  certificado como asíncrono. La nueva API separa preparar el archivo y publicar
  el mensaje. No se crean mensajes, notificaciones ni lecturas del destinatario
  mientras el archivo sigue en preparación, incluso si ya terminó de subir a Drive.
- Nuevos archivos upload_models/outbox/provider/views/tasks/cleanup, comando
  drain_media_uploads y migración 0030_media_upload_outbox. La migración crea tres
  tablas sin modificar los mensajes existentes; aplicada únicamente en las bases
  efímeras de pruebas. models/serializers/views/channel_views/urls integran el
  nuevo upload_id y conservan por ahora el contrato antiguo. No hay dependencias
  nuevas, nuevos servicios, cambios de piloto ni aperturas de permisos.
- POST /api/v2/messaging/conversations/{id}/uploads/ y el equivalente channels/
  reciben únicamente client_id y file. Se exige AuthSession real, cuenta y
  asignación propias, piloto y permisos actuales del destino. Se normaliza/valida
  el archivo antes de la transacción; 202 indica reserva privada, no mensaje enviado.
  El ID determinista queda ligado al recurso, cuenta e intento. Un mismo intento
  con otro archivo/metadatos devuelve conflicto. Un intento publicado por la ruta
  antigua no se vuelve a subir silenciosamente con la nueva.
- GET de lista acotada/detalle muestra solo las reservas de la cuenta y asignación
  actuales dentro de ese ámbito. El destinatario y el propietario de la empresa
  no reciben acceso al borrador. La respuesta excluye contenido, IDs de Google,
  tokens y detalles del proveedor; devuelve estado, caducidad, intentos y acciones
  posibles. POST al detalle admite retry y cancel, no edición de sus metadatos.
  Cancelar la propia reserva sigue permitido en un canal archivado/de solo lectura
  si mantiene lectura del recurso y acceso al piloto; nunca borra un mensaje publicado.
- El mensaje final se crea mediante el POST existente, con body, client_id y
  upload_id, sin file. Solo se consume un archivo ready del mismo autor/asignación,
  recurso e intento. Se comprueban otra vez el destino y las referencias de
  hilo/tarea/página; la creación del medio, mensaje e identificación attached
  comparten transacción. No se llama a Google en ese consumo. El plazo de edición
  empieza al publicar el mensaje, no al reservar sus bytes. Los reintentos de un
  mensaje ya confirmado no crean otra copia ni requieren que su raíz siga activa.
- Los bytes temporales usan Fernet con clave derivada y dominio separado; no se
  usa texto plano como fallback en producción. AUTH_ENCRYPTION_KEY es obligatoria
  fuera de DEBUG. La cola conserva metadatos mínimos y contenido cifrado, no el
  texto del mensaje. Al quedar ready, cancelarse o caducar se vacía ese campo.
  Esto no es borrado físico de WAL/backups ni cifrado extremo a extremo.
- Reservas con mutex global breve: 32 MiB cifrados por cuenta y 128 MiB cifrados
  para la cola completa, configurables con MESSAGING_UPLOAD_ACCOUNT_BYTES y
  MESSAGING_UPLOAD_QUEUE_BYTES. Máximo 20 reservas pendientes/listas/fallidas por
  cuenta y 200 globales. Una carrera no puede exceder esos cupos. No son límites
  del tamaño total de PostgreSQL (WAL/backups) ni un presupuesto/cuota de Drive;
  tampoco garantizan por sí solos ausencia de facturación de infraestructura.
- Caducidad 24 horas. Estados queued/uploading/retry/failed/ready/attached/cancelled/
  expired, hasta tres intentos automáticos por ciclo y seis totales; un reintento
  explícito con sesión vigente puede iniciar el segundo ciclo. Backoff de 30/60 s
  para indisponibilidad temporal. Sesión revocada/caducada, cambio de credenciales,
  salida del piloto, canal archivado, pérdida de permisos o raíz retirada detienen
  el trabajo; no se redirige el archivo a otra raíz. Se revalida después de subir.
- Leases de tres minutos y token de cercado por trabajo, renovados antes de cada
  llamada externa. Trabajadores obsoletos no pueden volver a publicar estados ni
  revivir una cancelación. Cada llamada del nuevo proveedor rechaza ejecutarse
  dentro de una transacción DB. Las pruebas usan TransactionTestCase y conexiones
  PostgreSQL reales, no el rollback envolvente de un TestCase como prueba de locks.
- Se persisten IDs pre-generados de Drive antes de crear archivos y carpetas.
  Un timeout/409 se resuelve consultando ese mismo ID y comprobando marcador,
  padre, MIME, tamaño y checksum, sin generar un segundo archivo. Se conserva la
  organización Chat/empleado/conversación y Slack/departamento/canal/empleado y
  se reutilizan las carpetas registradas. No hay permisos públicos ni conversión
  Office. Esta deduplicación corresponde al nuevo recorrido; no se anuncia una
  reparación automática de todos los huérfanos históricos del mecanismo antiguo.
  Referencias: [IDs reservados de Drive](https://developers.google.com/workspace/drive/api/guides/create-file)
  y [generateIds](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds).
- Reutiliza Celery/Redis existentes: wake después del commit y recuperación cada
  60 segundos, con lotes de hasta cuatro subidas y cuatro conciliaciones. La
  caída del broker no elimina la fila duradera ni convierte 202 en un falso fallo.
  Eager local NO ejecuta Drive dentro de HTTP; se requiere trabajador o el comando
  acotado. No se añaden sondeos frontend. Los solapamientos de Beat se resuelven
  mediante leases, no suponiendo que el planificador ejecuta una sola copia.
  [Documentación de tareas periódicas](https://docs.celeryq.dev/en/main/userguide/periodic-tasks.html).
- Conciliación limitada a IDs reservados de archivos cancelados/caducados, nunca
  un barrido del Drive corporativo. Espera al vencimiento del lease de una subida
  en vuelo, valida propiedad/contexto e integridad y usa únicamente trashed=true
  (papelera recuperable). Un 404 puede ser una creación que aún termina: conserva
  el ID y vuelve a consultar, sin declararlo resuelto. Hasta seis comprobaciones
  separadas por una hora; discrepancias y agotamiento quedan para revisión,
  contabilizados por cleanup_review. No se toca un archivo attached ni ambiguo.
  La papelera no implica liberación inmediata de la cuota de Google; no se
  implementa purga permanente. Metadatos/tombstones se conservan para trazabilidad.
- PostgreSQL aislado: ronda final **104 pruebas aprobadas** en 106,287 s,
  incluidas 12 de outbox, dos de cookies/CSRF, cuatro de concurrencia y 86 de
  mensajes/medios/documentos/biblioteca/búsqueda/canales existentes. Log
  media-outbox-104-20261029.log. Primera ronda de 102 también aprobada y conservada.
  Cuatro carreras reales: reserva duplicada, cupo de bytes, dos trabajadores/
  publicaciones y cancelación frente a publicación. El servidor se detuvo al salir.
- Dos pruebas adicionales con login real, cookies distintas y CSRF, sin
  force_authenticate, aprobadas en SQLite y en la ronda PostgreSQL anterior. El archivo privado no
  apareció en mensajes/biblioteca ni en el listado de subidas de la otra cuenta;
  solo tras subir y publicar pudo descargarlo el destinatario, con bytes idénticos.
  Faltando CSRF se rechazó la reserva; logout impidió cualquier llamada posterior
  del trabajador a Drive. Otra asignación fuera del piloto siguió excluida.
- UI/UX Pro Max guio el contrato de pasos y acciones recuperables (búsqueda
  progress/retry/recovery), no un cambio visual: estados claros en lugar de un
  porcentaje ficticio. La integración de esos estados en el compositor sigue
  pendiente. Nota preparada exclusivamente en pendingPilotReleaseNotes, explicando
  esa limitación; publicaciones anteriores intactas. Cinco pruebas de notas y
  compilación frontend aprobadas: 5.406 módulos en 1m17s, hash index-oXlNaazA.js
  sin cambios de UI porque los borradores de notas no se publican.
- Drive es un protocolo simulado, no Google real ni una prueba de producción.
  No se reinició el backend de aceptación anterior ni se sustituyó su Drive en
  memoria. El siguiente tramo debe adaptar el arnés (clave efímera/IDs reservados/
  trabajador), migrar solo esa base aislada, conectar el compositor y las pistas
  del socket existente, probar recarga/reconexión con dos sesiones y cerrar el
  acceso síncrono heredado. Después siguen las automatizaciones acotadas de fase 7.
  Sin commit, push, migración de producción ni deploy. Objetivo global abierto.
- Repetición final dirigida: **19 pruebas PostgreSQL aprobadas** en 82,612 s,
  incluyendo el comando de recuperación tras caída del broker y la limitación
  de multipart también en endpoints de acciones. Una petición con archivo mayor
  que el límite se rechaza sin cancelar ni modificar la reserva. Log conservado:
  media-outbox-19-final-20261029.log. El servidor de pruebas quedó detenido,
  confirmado con pg_ctl status. Check/migraciones en seco/diff aprobados;
  sin modificaciones al lockfile frontend. No acredita todavía la PWA ni Google real.

### Validación local del 29 de octubre — fase 6: compositor y recuperación

- Nuevo staged_media.js compartido por Chat y Slack, incluidos los emisores de
  imágenes, voz, documentos e imágenes reenviadas. Solo el POST a uploads recibe
  bytes; la publicación posterior usa JSON con upload_id. No hay fallback al POST
  multipart de mensajes. El contrato antiguo sigue disponible en backend y debe
  retirarse antes de aceptar la fase completa. No se añadieron dependencias.
- La consulta privada por client_id permite encontrar una reserva previa o un
  mensaje ya publicado. Ese último caso obtiene la proyección actual mediante
  el GET protegido de mensaje, sin sobrescribir ediciones de otra sesión. Todas
  las lecturas conservan autor, cuenta, asignación, recurso y permisos actuales.
- Pistas sin contenido por el socket existente: solo upload_id/kind/container_id/
  client_id, nunca archivo, texto, estado del proveedor o ID de Google. El consumidor
  revalida sesión, asignación, piloto y lectura del recurso. No se crea una
  notificación al destinatario por preparar un adjunto.
- El emisor consulta después de una pista autorizada, reconexión o vuelta online;
  coalesce ráfagas y limita la frecuencia a 300 ms. Solo mientras espera un envío
  explícito tiene cinco comprobaciones de respaldo y un plazo de dos minutos.
  Al terminar, fallar, salir o detener la espera elimina temporizadores y listeners.
  No hay un sondeo de cola activo con el compositor en reposo.
- UploadStatus muestra pasos, no porcentajes ficticios. Detener espera aborta la
  espera local, no cancela la preparación del servidor ni publica al llegar una
  pista tardía. Reanudar requiere otra pulsación. Los intentos pendientes muestran
  su texto original y bloquean su edición; se conserva cualquier borrador separado.
  UI/UX Pro Max guio estados, errores recuperables, anuncios accesibles y controles
  de pausa; no se abordó el rediseño visual completo.
- Corrección adicional en permission_monitor: la primera revisión con decisiones
  en vuelo debe invalidarlas, pero no se interpreta como un cambio demostrado
  de política. Se suspenden claves, se conserva ciphertext y la recuperación exige
  un grant nuevo. Una revisión posterior real, cambio temporal/contextual o
  revocación mantiene el comportamiento conservador. Prueba dirigida aprobada.
- PostgreSQL aislado: **84 pruebas aprobadas** en 121,916 s, con outbox, cuatro
  carreras reales, recuperación/nonce, eventos, mensajes y medios/documentos.
  Log media-ui-integration-84-20261029.log conservado; el servidor quedó detenido.
  La prueba de socket abre dos conexiones con login/cookies/tickets reales de
  cuentas ficticias, sin force_authenticate: solo el dueño recibe la pista.
- **196 pruebas Node aprobadas**: emisor, API, modelos, caché/monitor de permisos,
  recuperación y notas. Chat DOM y Slack DOM aprobados; nueva aserción de pausa
  verifica texto/archivo/UUID inmutables, controles bloqueados y reintento.
  composer_recovery_ui.mjs aprobado para Chat y canal/hilo, con almacén simulado;
  no se presenta ese test como una recarga real del navegador.
- El arnés local tiene clave efímera propia, IDs reservados y metadatos del
  protocolo Drive, un trabajador separado despertado tras commit y recuperación
  cada 60 s. La opción de demora controlada simula una subida de 12 s fuera de la
  transacción; solo funciona en el arnés aislado. Migración 0030 aplicada a su SQLite
  efímero y a las bases de pruebas, nunca a producción. Drive sigue siendo simulado.
- Navegador real, dos logins ficticios por cookie: se detuvo un envío en Chat;
  la preparación pasó a ready sin mensaje para el destinatario. Tras cambiar de
  módulo y recargar realmente la PWA se ofreció Recuperar borrador. Recuperarlo
  restauró archivo, texto e intento, sin envío. Al pulsar Enviar hubo un GET de la
  reserva lista y un POST JSON, **sin otro POST del archivo**. Se confirmó una fila
  attached, un intento de proveedor y un único mensaje con ese texto. La otra
  cuenta recibió el aviso y descargó el original; SHA-256 idéntico al de la muestra.
- Esa primera comprobación nativa reveló la condición de arranque anterior:
  no se consideró aprobada; se corrigió y se repitió con éxito. La reserva original
  quedó privada, sin publicar y sujeta a caducidad, no se borró el archivo a ciegas.
  Captura local validacion-cola-adjuntos-recarga-20261029.jpg. Canal probado también
  con el nuevo estado de subida y posterior publicación del documento.
- Limitaciones pendientes: retirada del endpoint síncrono antiguo, descarte
  explícito de la preparación desde UI y aceptación ampliada de reconexión/hilos/
  multimedia con Google real. Los lotes de reenvío conservan su caché en memoria;
  no se anuncia su persistencia completa tras recarga. Se observó además que el
  aviso flotante de actualización puede tapar Enviar en Slack a 1280×720 y que
  beforeunload puede impedir aplicar la actualización con el compositor ocupado;
  el atajo Enter sí funcionó. Requiere una corrección acotada posterior, no se
  oculta como una aceptación visual completa de la PWA.
- Nueva nota solo en pendingPilotReleaseNotes; historial público intacto.
  Sin commit, push, migración de producción ni deploy. Piloto IT sin cambios.
  La fase 6 y el objetivo global permanecen abiertos; fase 7 todavía no iniciada.
- Cierre de esta ronda: se detectó recorte de Enviar al acumular avisos de
  recuperación y adjunto en pantalla pequeña. La conversación ahora permite
  desplazamiento vertical en móvil o poca altura; los avisos reducen márgenes,
  conservando su texto y los controles de 44 px. Navegador a 375×667 en oscuro:
  ancho documental 375, sin desborde horizontal; Enviar quedó dentro del contenedor.
  A 812×375 y texto 125% (20 px), ancho documental 812, desplazamiento disponible,
  botón habilitado de 44 px. Se pulsó realmente y confirmó el único mensaje de ese
  intento recuperado. Es validación de viewport, no de un teléfono físico o teclado
  virtual. Captura validacion-cola-movil-oscuro-20261029.jpg; las otras diferencias
  visuales del módulo siguen fuera de esta revisión funcional acotada.
- Compilación final tras notas y ajuste CSS aprobada: 5.408 módulos en 1m14s,
  index-CDEi1-bp.js, con advertencia conocida de tamaño de Hojas. Log local
  bold-outbox-responsive-build-20261029.log. Check Django, migraciones en seco y
  diff sin errores; cinco pruebas de notas y siete de PWA aprobadas además de las
  ocho dirigidas del emisor. No se cambiaron archivos lockfile ni permisos del piloto.

### Validación local del 29 de octubre — fase 6: retirada y descarte explícito

- SendMessageSerializer y SendChannelMessage solo aceptan publicación de archivos
  mediante upload_id. Un campo file, multipart o JSON, produce 409 con una
  indicación de actualizar BOLD y conservar borrador/nonce. Ninguna vista de
  publicación importa ni llama al proveedor síncrono antiguo. Texto, tareas,
  páginas, descargas y consulta de mensajes históricos mantienen su contrato.
  Un reintento viejo de un mensaje confirmado tampoco crea otra copia: el cliente
  actualizado lo encuentra mediante su client_id y obtiene su versión actual.
- Las pruebas de proyección migraron a preparación HTTP real y un resultado ready
  simulado explícitamente en test_staged_fixtures.py. Ese auxiliar no se presenta
  como prueba de Google ni de locks. Documentos Office, imágenes desde teléfono
  y carpetas de canales independientes tienen pruebas TransactionTestCase del
  trabajador real con proveedor simulado fuera de la transacción. El arnés nativo
  también prepara/sube/publica su imagen inicial con la API nueva, no por un atajo.
- Nueva API POST uploads/discard/ con client_id, exclusivamente propia y con
  sesión/CSRF/piloto/lectura actuales. Serializa contenedor → mutex de reserva →
  subida, tanto al preparar como al descartar, evitando el cruce con el key-share
  de la FK. Si la publicación ganó, responde published y message_id, sin eliminar,
  modificar ni despublicar nada. Si ganó el descarte, limpia el ciphertext y cerca
  al trabajador; conserva su lease/ID reservado para la conciliación recuperable.
- También se puede descartar un intento cuya petición aún no confirmó la reserva.
  Se conserva un tombstone mínimo cancelled sin raíz, bytes, archivo ni mensaje.
  Una petición tardía con ese nonce no puede reservar o subir después. Máximo
  200 stops vacíos nuevos por cuenta y 2.000 globales en 24 h; la comprobación
  idempotente y la cancelación de archivos existentes no consumen otro cupo.
  Estos metadatos mínimos se retienen para idempotencia, como los demás registros
  de cola: no representan un límite del tamaño total de PostgreSQL/WAL/backups
  ni una garantía de cuotas de Google o de ausencia de facturación.
- Migración 0031_upload_intent_stop: root puede ser null únicamente en una fila
  cancelled sin bytes, Drive IDs, mensaje, dimensiones ni intentos de proveedor;
  CHECK en la base, no solo convención Python. Las subidas reales conservan su
  raíz obligatoria y su validación. Un guard explícito hace la migración no
  reversible automáticamente: no se deben eliminar los stops o reactivar nonces
  durante un downgrade. Cualquier vuelta atrás requiere un procedimiento de
  datos deliberado. Aplicada solo a bases efímeras de pruebas y del arnés local.
- Nuevo descarte compartido en las API frontend; resultado incierto, respuesta
  inválida o ámbito/nonce distinto nunca autoriza quitar el borrador. Solo un
  resultado cancelled/expired verificado desbloquea el archivo y su texto para
  revisar o retirar; el próximo envío requiere otra pulsación y otro nonce.
  published recupera la proyección actual y retira solo ese pendiente de la cola.
  Guards de identidad, vista y abort impiden aplicar una respuesta a otra cuenta,
  asignación, conversación o hilo. No hay envío ni descarte automático en reposo.
- UploadDiscard pide confirmación y distingue descartar de Detener espera. Los
  botones de quitar imágenes/preparaciones inciertas están bloqueados hasta
  resolverlas; no se descartan silenciosamente adjuntos que podrían haberse enviado.
  Errores conservan archivo/UUID para comprobar de nuevo. Los controles y avisos
  usan la estética existente; UI/UX Pro Max guio confirmación, salida recuperable,
  mensajes accesibles y objetivos táctiles, no un rediseño completo.
- Una revisión adicional detectó el caso de imagen revisada tras un 400 definitivo:
  la preparación anterior podría conservar sus bytes. renewRejectedMedia renueva
  el nonce antes de permitir editar/cambiar el archivo; mantiene caption y archivo
  y elimina el payload congelado antiguo. 413/415/422 y rechazo definitivo de una
  referencia de tarea siguen esa separación. Red/409/429/500 mantienen el nonce
  original y el bloqueo; nunca se consideran confirmaciones negativas por timeout.
- Revisión amplia inicial de PostgreSQL: 390 pruebas, dos expectativas antiguas
  fallidas (contrato multipart e independent-channel). No se declara esa ronda
  completamente verde. Se actualizaron ambas para la API nueva y se añadieron
  controles del proveedor independiente. Ronda posterior dirigida **105 pruebas
  PostgreSQL aprobadas en 293,113 s**, incluidas esas dos clases, medios, documentos,
  teléfono, sesiones, privacidad, rechazo del contrato antiguo y seis carreras
  concurrentes reales. Log upload-discard-retirement-105-20261029.log conservado.
- Repetición dirigida **8 pruebas PostgreSQL aprobadas en 44,767 s**, incluido el
  borde exacto de 200 stops y la cancelación/idempotencia aunque el cupo esté lleno.
  Log upload-discard-quota-8-20261029.log; ambos servidores quedaron detenidos.
  Cuatro pruebas SQLite adicionales aceptan cuerpos JSON inválidos como 400, no
  como errores 500; 47 de proyecciones/medios también aprobadas antes del cierre.
- **201 pruebas Node aprobadas**, más Chat DOM, Slack DOM y recuperación Chat/
  canal/hilo. La UI prueba cancelar el diálogo sin red, fallo sin perder el
  pendiente, descarte confirmado con nonce nuevo y caso published que recupera
  una edición posterior sin otro envío. Las pruebas Node del cliente rechazan
  respuestas ambiguas y respetan abort. La confirmación nativa se comprobó aparte.
- Navegador real con dos cuentas ficticias: en Chat se detuvo una subida,
  Cancelar en el diálogo mantuvo el bloqueo y Aceptar descartó su preparación.
  Archivo y texto quedaron editables, sin mensaje para el destinatario. Tras
  revisar el texto y enviar expresamente, SQL mostró un nonce cancelado sin
  mensaje y otro attached con un único mensaje; la otra cuenta lo recibió y
  descargó, SHA-256 idéntico al original. Captura
  validacion-descartar-preparacion-20261029.jpg. No es Google real.
- Prueba nativa de hilo: preparación descartada, texto y archivo conservados
  exclusivamente en su hilo; al volver al canal principal, el compositor estaba
  vacío, sin el adjunto ni la respuesta publicada. Prueba móvil oscura a 375×667;
  a 812×375 y texto 125%, ancho documental 812 sin desborde horizontal, botón
  habilitado de 44 px y confirmación real. Tras aceptar, el texto/archivo quedaron
  editables. Captura validacion-descartar-movil-20261029.jpg; viewport, no teléfono
  físico ni prueba de micrófono/teclado virtual. El resto de la revisión visual
  y los problemas observados del aviso PWA siguen pendientes.
- Nota añadida solo a pendingPilotReleaseNotes. Sin commit, push ni deploy;
  no se alteró producción, dependencias/lockfile ni el piloto IT. Google real,
  revisión ampliada de reconexión y capacidad total siguen pendientes; fase 7
  todavía no iniciada. El objetivo global permanece activo, no completado.
- Comprobación nativa adicional de revisión de imagen tras un rechazo definitivo:
  se preparó una imagen de prueba de 400×720 y se rechazó su texto inválido antes
  de crear un mensaje. Se recortó desde el editor real y se cambió la salida a
  200 px. Tras corregir el texto, SQL verificó **otro nonce**, digest y bytes
  distintos, medio de 200×400 attached y un único mensaje; la imagen anterior
  permaneció ready, privada y sin mensaje, sujeta a su caducidad/conciliación.
  No se reutilizaron los bytes viejos ni se envió el texto rechazado. Captura
  validacion-imagen-revisada-20261029.jpg; no se usaron cuentas ni archivos reales.
- Compilación final aprobada tras la nota y la corrección de renovación de nonce:
  5.409 módulos, 1m07s, index-BLIlgP9R.js. Log local
  bold-upload-discard-final-v2-build-20261029.log. No se añadió código de producción
  para simular errores: rechazo por límite real de menciones y edición mediante
  los controles normales de la aplicación. Check/migraciones en seco/diff aprobados.

### 29 de octubre: revisión durable de lotes de reenvío — aceptación local

- Se sustituyó la caché exclusivamente de sesión del recorrido de reenvío de
  Chat por una revisión propia cifrada, separada del borrador del compositor.
  Solo conserva la selección aprobada (máximo diez textos/imágenes), orden,
  progreso, destinatario fijo, identificadores y bytes de intentos pendientes;
  no copia el historial, perfiles, tareas, tokens ni identificadores de Drive.
- Nuevo ámbito de clave conversation-forward: misma frontera de participantes,
  cuenta, asignación y piloto, clave distinta de la del compositor. Recuperar
  requiere una autorización fresca. Conserva límites/caducidad del almacén local;
  no sincroniza revisiones entre dispositivos ni envía en segundo plano.
- Cada intento protege su nonce y archivo antes de escribir. El fallo de disco
  impide subir/publicar. Abrir o recuperar no envía; se necesita Reintentar
  pendientes. Se consulta el mensaje de origen con permisos actuales y se detectan
  versiones cambiadas antes del primer envío. Un intento ya iniciado conserva
  su contenido y consulta por nonce la versión actual de un mensaje publicado,
  para no duplicarlo ni sobrescribir una edición posterior.
- Detener espera del reenvío pausa, no cancela. Descartar pendientes pide
  confirmación y resuelve cada intento por el descarte nonce-safe existente.
  Se conserva lo ya publicado; una respuesta ambigua/fallo no autoriza quitar
  el pendiente. Los textos de Chat también respetan el stop, bajo el mismo
  bloqueo de conversación que publicación/descarte. Sin migración nueva.
- Una revisión pendiente de la misma conversación se vuelve a abrir en vez de
  sustituirse por otra selección. Destino no disponible no habilita cambiarlo
  durante un intento. El cierre conserva la revisión; Seleccionar varios solo
  reemplaza una revisión que todavía no ha comenzado.
- PostgreSQL 18.6 local: **24 pruebas aprobadas en 121,934 s**, incluidas siete
  carreras reales, descarte de texto, límites y claves privadas/sesión/CSRF.
  Servidor detenido al finalizar. Evidencia forward-recovery-24-20261029.log.
  **208 pruebas Node aprobadas**, más pruebas DOM de Chat, Slack y recuperación
  con React/WebCrypto. No equivalen a una ejecución completa del repositorio.
- Pruebas de recuperación DOM: lote mixto confirma texto y falla imagen; desmontar
  y recuperar mantiene archivo/nonce/destino, no repite el texto. Respuesta perdida
  de texto seguida de una edición recupera la versión actual sin otra escritura.
  Descarte cancelado por el usuario no hace peticiones; fallo conserva el intento.
- Navegador real: Alfa seleccionó texto e imagen de Beta y los reenvió a Gamma.
  Tras el texto confirmado se detuvo la espera del archivo; se cerró el módulo,
  recargó BOLD y abrió el origen. Apareció Revisar reenvío conservado, sin envío.
  SQL confirmó un único mensaje destino y una reserva ready sin message_id.
  Recuperar mostró 1 de 2 confirmado, una imagen pendiente y destino fijo.
  Reintentar publicó esa misma reserva (mismo nonce y SHA-256), sin otro texto:
  dos mensajes en destino. Gamma los recibió por la sincronización existente.
  Captura validacion-reenvio-recuperado-20261029.png, datos ficticios.
- Móvil oscuro, viewport 375×667: Gamma inició otro reenvío, detuvo la espera
  y aceptó Descartar pendientes. SQL confirmó state=cancelled, message_id nulo
  y cero bytes cifrados; los dos mensajes recibidos antes seguían intactos.
  Es una prueba responsive, no de un teléfono físico ni de Google Drive real.
- El foco del buscador usa su contorno redondeado visible y el pie permite
  envolver sus botones sin desborde. UI/UX Pro Max orientó confirmación, errores,
  recuperación explícita, foco y controles de 44 px; no hubo rediseño general.
- Nota preparada solo en pendingPilotReleaseNotes. Sin commit/push/deploy,
  cambios de dependencias, acceso de administradores ni apertura del piloto.
  Siguen pendientes aceptación ampliada con Google real, capacidad agregada y
  correcciones del aviso PWA (puede cubrir el acceso móvil y su confirmación
  habla de cambios pendientes incluso cuando no hay borradores abiertos).
  Las automatizaciones de fase 7 todavía no están implementadas; objetivo activo.
- Compilación final: **5.410 módulos, 1m38s, index-D6UNRcGm.js**, con el aviso
  conocido de tamaño del módulo Hojas. Log bold-forward-recovery-build-20261029.log.
  Check de Django y migraciones en seco sin novedades. En navegador, el foco
  del buscador quedó redondeado; a 812×375 y texto 125%, ancho documental 812,
  sin desborde horizontal, y el descarte seguía accesible mediante desplazamiento.
  Se restauró 375×667/texto normal. Captura validacion-reenvio-movil-20261029.png.
- Último control adicional: la revisión rechaza audio/documentos antes de
  normalizar su selección como imagen. Pruebas dirigidas y las 208 Node siguen
  aprobadas. Recompilación posterior: 5.410 módulos, 1m08s, index-MTsHXnJl.js;
  log bold-forward-recovery-final-v3-build-20261029.log. Esta compilación quedó
  sirviendo el entorno local aislado, sin sustituir ningún despliegue real.

### 29 de octubre: recarga funcional y capacidad agregada — aceptación local

- Se mantiene la prioridad funcional solicitada: sin rework de burbujas, temas ni
  disposición general. UI/UX Pro Max se aplicó solo al aviso PWA, foco, controles
  accesibles y confirmaciones. No se reconstruyó Graphify ni se añadieron hooks.
- El aviso PWA ocupa flujo antes de #root, no una capa fija encima de los controles.
  Más tarde no instala ni recarga; Actualizar BOLD protege el trabajo registrado y
  exige confirmación. Si falla la protección advierte del riesgo sin afirmar que
  se haya guardado. Los otros editores conservan sus propias advertencias.
- Checkpoints exponen protección síncrona del texto y objetos File actuales, no
  del último render guardado. Errores de disco, archivo sustituido, clave inactiva,
  grabación/editor volátil y escrituras pendientes conservan el bloqueo de salida.
  Chat/canales/hilos, reenvíos y páginas recuperables evitan el segundo aviso nativo
  únicamente cuando su estado actual ya está protegido.
- Solo durante una actualización expresamente aceptada: espera de activación
  acotada a 15 s y restablecimiento de controles si la recarga no abandona el
  documento en 2 s. No se vuelve a recargar automáticamente ni se añade sondeo.
- Navegador real contra backend aislado: Alfa añadió texto y revision-local.txt,
  pulsó Actualizar BOLD y aceptó. No apareció beforeunload adicional; al volver a
  la conversación surgió la decisión de recuperación y, tras aceptarla, reapareció
  el documento y el texto exacto. SQL confirmó cero mensajes con el texto de prueba
  y cero reservas del documento en ese destino. No se pulsó Enviar. Captura
  validacion-recarga-borrador-20261029.png; archivos/cuentas ficticios, no Google.
- Presupuestos internos positivos configurables: bytes temporales por cuenta y
  globales (32/128 MiB por defecto), archivos administrados por cuenta/globales
  (256 MiB/2 GiB), registros por cuenta/globales (20.000/100.000). Se documentan
  en .env.oracle.example; no se cambiaron variables de producción.
- Los bytes temporales suman ciphertext de la cola e imágenes QR realmente
  almacenadas, incluso caducadas hasta su limpieza. Una copia del teléfono y su
  preparación cuentan ambas mientras existen. La capacidad administrada suma
  reservas y medios anteriores, sin volver a cobrar el mismo archivo al publicarlo.
  Los registros incluyen stops e imágenes QR; no se purgan nonces para abrir cupo.
- Cuenta los archivos con ID remoto incluso tras Papelera/conciliación: no presupone
  liberación de cuota en Google. Cancelar antes de reservar un ID remoto libera los
  bytes administrados, pero mantiene el registro de idempotencia. Los límites no
  incluyen archivos ajenos a Mensajería, carpetas, índices, WAL, backups ni equivalen
  a una lectura de espacio libre del proveedor o garantía de recursos/costes.
- Admisión bajo el mutex global existente. QR usa orden contenedor -> cuota ->
  cuenta/transferencia y revalida capability/aprobación/sellado antes de insertar.
  No hace llamadas de Google dentro de la transacción ni expone métricas de terceros.
  Reintentos idénticos y resolución/publicación/cancelación de intentos existentes
  preceden a los límites de nuevas reservas. Errores 429/507 explican cola/capacidad;
  no equivalen a resolver un nonce incierto ni generan otro intento por su cuenta.
- PostgreSQL 18.6 local: primera ronda **37 pruebas aprobadas en 196,613 s**, incluidos
  descarte, teléfono y diez carreras. Tras incluir registros QR, **29 pruebas
  aprobadas en 169,472 s**, solapadas con la ronda anterior, no sumables. Servidores
  detenidos al concluir. Logs bold-capacity-postgres-37-20261029.log y
  bold-capacity-postgres-29-20261029.log. Regresión SQLite final de capacidad:
  **9 pruebas aprobadas en 3,506 s**. No se certifica concurrencia con SQLite.
- **190 pruebas Node aprobadas**, incluyendo checkpoints, errores de capacidad,
  lotes de reenvío, PWA y notas. test:pwa ahora incluye el aviso y registro privado:
  **14 pruebas aprobadas**. DOM de recuperación de compositores y páginas aprobado,
  incluidos beforeunload protegido y almacenamiento fallido. No es toda la suite.
- La primera compilación encontró una instalación parcial: prebuild intentó npm ci
  mientras la vista previa propia retenía un binario de Rollup. Se detuvo solo esa
  vista y se restauró npm ci desde el lockfile. Dependencias directas verificadas;
  sin cambio de versiones ni lockfile. El cambio final de package.json es de pruebas,
  no de dependencias. Django check/migraciones en seco aprobados, sin migración nueva.
- Notas solo en pendingPilotReleaseNotes; sin commit, push ni despliegue. Piloto IT
  y privacidad sin cambios. Capacidad agregada aceptada localmente; fase 6 sigue
  pendiente de aceptación ampliada con Google real y fase 7 no está implementada.
- Compilación final aprobada: **5.411 módulos, 1m10s, index-CsSI_Nvt.js**. Log
  bold-pwa-capacity-final-v2-build-20261029.log; se verificó el tratamiento 429/507
  en los artefactos finales. Conserva el aviso conocido de tamaño de Hojas. La
  vista previa propia se actualizó a este artefacto sin cambiar ningún despliegue.

### 29 de octubre: restablecimiento del entorno de Google — pendiente de consentimiento

- La comprobación actual no encontró PG_VERSION, registro de cuentas, contraseña
  PostgreSQL ni JSON OAuth en la antigua raíz temporal del staging del 21 de
  octubre. El informe de aceptación histórica permanece intacto, pero no acredita
  que esa conexión siga disponible ni certifica la cola de subidas nueva.
- El usuario confirmó que puede volver a autorizar samuel@bold.gt. No se generó
  otro cliente ni se recurrió a conexiones/cuentas de producción. Se verificó el
  JSON original del cliente independiente, proyecto y callback sin imprimir secretos.
- Se habilitó un único padre persistente adicional para staging: el directorio
  BOLDApp/validation del LOCALAPPDATA del usuario actual. Mantiene el sufijo UUID,
  host/base/usuario/puerto locales, servicios aislados y credenciales independientes;
  no admite rutas arbitrarias ni bases remotas. La ubicación Temp anterior conserva
  compatibilidad. Nueve pruebas de configuración aprobadas, incluido rechazo de
  otro padre persistente y de una base distinta bajo un padre permitido.
- Nueva raíz privada con herencia desactivada y dos entradas ACL: usuario Windows
  actual y SYSTEM. Solo se copiaron binarios PostgreSQL ya usados; se inicializó
  una base nueva. No se copiaron cuentas, datos ni tokens de otra base. La migración
  hasta 0031 se aplicó solo al nuevo staging local, no a Oracle.
- Bootstrap explícito bootstrap_messaging_staging: perfil/proyecto/cliente/callback
  fijos, base inicialmente vacía, dos cuentas locales de contraseña aleatoria y sin
  staff/superusuario, cliente cifrado. Registro de cuentas generado exclusivamente
  en el directorio privado; repetir no lo sustituye ni rota claves por su cuenta.
- SQL confirmó bold_validation en 127.0.0.1:55432, dos cuentas sin privilegios,
  configuración del proyecto de pruebas, cero conexiones Google y cero destinos
  activos. El backend y proxy dedicados usan 8160/5193, sin modificar los proxies
  de desarrollo ordinario ni desplegar recursos remotos.
- prepare_staging_drive_consent utiliza el login/CSRF/inicio OAuth reales del
  backend local. Verifica host Google, cliente, callback, cuenta y alcance exacto;
  entrega un HTML privado de diez minutos para consentimiento humano, nunca una
  URL con state/tokens en los logs. No solicita Calendar/Gmail/Contacts/Meet.
- Cuatro pruebas de bootstrap/enlace aprobadas: rechazos de perfil ordinario,
  cliente ajeno, callbacks remotos, scopes adicionales, otra cuenta y JSON inválido.
  UI/UX Pro Max se limitó al enlace accesible y a explicar alcance, caducidad y
  cancelación. No se rediseñó el módulo ni se publicaron novedades de infraestructura.
- La autorización del proveedor y su aceptación ampliada siguen pendientes;
  disponer del cliente cifrado no significa que Google ya esté conectado.

### Aceptación del 29 de octubre — Drive real y staging persistente

Esta entrada sucede al registro de restauración anterior: el usuario completó
el consentimiento y ya existe una conexión de Google verificada. No fue necesario
volver a crear el proyecto, ampliar scopes ni configurar facturación.

- La conexión usa el cliente independiente y la carpeta privada de pruebas
  aprobados, con samuel@bold.gt. OAuth autoriza Drive completo, no una carpeta
  técnicamente aislada por Google; el ensayo verifica y limita sus operaciones a
  la carpeta aprobada. No se enumeraron archivos ajenos ni se usó producción.
- `verify_staged_messaging_drive` sin opciones comprueba conexión, cliente,
  scopes y destino; `--run` ejecuta el ensayo explícito. Solo admite el perfil
  `config.settings_channel_staging`, la base local y el destino fijados. El
  registro privado conserva bytes e identificadores entre ejecuciones.
- Diez formatos sintéticos aprobados mediante HTTP real y Google real: imagen
  PNG convertida a WebP; audios WebM/Opus, Ogg/Opus y M4A/AAC; PDF, TXT, CSV,
  DOCX, XLSX y PPTX. Los documentos Office son contenedores mínimos de prueba,
  no una acreditación de su renderizado por una suite de oficina.
- Dos cuentas autenticadas locales sin staff/superusuario, no dos empleados de
  producción. Chat, canal e hilo: preparación privada, trabajador separado,
  publicación, biblioteca y descarga con los mismos bytes/digest esperados. La
  segunda cuenta no accede a la reserva sin publicar; los anónimos reciben 401 y
  la retirada temporal del permiso de canal devuelve 404 al descargar.
- Repetir la preparación y publicación devuelve los mismos identificadores y
  un único objeto remoto. Se renovaron sesiones HTTP conservando los intentos.
  Una interrupción de trabajador tras subir y una respuesta perdida se inyectaron
  de forma controlada alrededor de peticiones Google reales. No se simularon
  respuestas exitosas del proveedor ni se atribuye el resultado a una caída real.
- La preparación sintética descartada terminó en Papelera recuperable de Google,
  sin mensaje ni bytes cifrados pendientes. `--verify-existing` comprobó después
  los diez archivos publicados: conservados, digest/tamaño/ancestría correctos,
  sin Papelera y con ACL privada. No hubo borrado permanente.
- Navegador nativo sobre staging: visor interno de imagen (180×100), reproducción
  M4A sin error y velocidades 1×/1,5×/2×; descarga TXT con SHA-256 idéntico. Desde
  el compositor se adjuntó y publicó otro TXT sintético una sola vez. El trabajador
  de prueba informó una reserva examinada y lista; no es el servicio de Oracle.
- Recarga real del navegador: un texto sintético protegido apareció como borrador
  recuperable y no se envió automáticamente. Recuperar conservó su contenido;
  después se retiró únicamente ese borrador de prueba.
- `drain_media_uploads --watch --interval 30` sirve solo este staging autorizado:
  lotes acotados, verificación de destino por lote, sin llamadas a Google en reposo.
  No instala servicios ni reemplaza la aceptación distribuida. El perfil utiliza
  broker/cache en memoria; el envío del navegador comprobó el fallback acotado,
  no una pista de socket entre procesos mediante Redis.
- Informe reproducible sin secretos: `docs/acceptance-staged-drive-20261029.json`.
  Nueve pruebas finales de herramientas/cola aprobadas, incluida pérdida del broker.
  No se verificaron micrófono/cámara físicos, Redis/Celery distribuido ni producción.
  Sin commit, push, migración remota, despliegue ni apertura fuera de IT.
- Comprobación final: Django `check` sin incidencias, `makemigrations --check
  --dry-run` sin cambios; nueve pruebas de herramientas/cola aprobadas (1,895 s).
  Cinco pruebas de notas aprobadas; contrato DOM de recuperación de Chat,
  canales/hilos y reenvíos aprobado. Compilación Vite aprobada (1 min 31 s),
  artefacto principal `index-X55Y9i2I.js`; persiste el aviso de chunks grandes,
  no un error de compilación. `git diff --check` sin errores de whitespace.

Para continuar este staging no ejecutar de nuevo el bootstrap, rotar sus secretos
ni volver a autorizar Google si la conexión sigue vigente. Conservar el directorio
privado persistente y arrancar el perfil dedicado mediante
`deploy/test_channels_postgres.ps1 -ValidationRoot <directorio-privado> -Action RunStaging`;
el helper rehúsa reutilizar o detener un servidor desconocido en el puerto ocupado.
La base necesita su mismo secreto para descifrar las credenciales existentes.
El proxy usa `vite.channel-staging.config.js` y el trabajador `--watch` es temporal,
solo para esta aceptación local. Nunca copiar estos secretos a Git ni a informes.

Siguiente fase funcional: automatizaciones acotadas (estado, recordatorios y
páginas recurrentes), con permisos actuales, pausa, auditoría e idempotencia.
No incluye llamadas, IA ni un constructor universal de flujos.

### Desarrollo del 29 de octubre — automatizaciones, primer componente backend

Entrega incompleta de la fase 7: las funciones existen vía API y trabajador, no
hay todavía controles nuevos en la interfaz ni aceptación de navegador de reglas.
No se aplicó esta migración al staging persistente de Google ni a producción.

- Esquema `0032_channel_automations`: reglas, resultados y auditoría separados;
  permisos configurables `slack.automation.read/manage`. Cada cuenta/asignación
  solo gestiona y consulta sus propias reglas. Ser propietario/administrador no
  abre las de otra persona ni un canal privado sin invitación.
- Tres tipos y ningún intérprete general: `task_status` filtra proyecto/estado
  destino y, opcionalmente, estado origen; `reminder` publica texto explícito;
  `recurring_page` crea una copia independiente de una plantilla del mismo canal
  cuya versión queda fijada. Cambiar/archivar esa plantilla exige revisar la regla.
- Toda regla se crea pausada. Crear y activar requieren confirmar el destino y la
  acción; editar exige pausa y versión actual. Cambiar/reanudar la regla invalida
  las ejecuciones pendientes de la versión anterior, no las reproduce al volver.
- Horarios: primera fecha con zona explícita, entre cinco segundos y 365 días
  futuros; repetición opcional cada 1–365 días de 24 horas UTC. No representa
  meses naturales ni promete conservar hora local en cambios DST. Un retraso
  produce una sola ejecución y calcula la siguiente fecha futura, no una ráfaga
  de todos los intervalos omitidos. Una pausa vencida requiere nueva fecha futura.
- Los cambios reales del estado agregado de una tarea se capturan dentro de su
  transacción y generan resultados pendientes durables, sin publicar en el guardado.
  La creación, cambios de otros campos y estados anteriores a activar no generan
  avisos retrospectivos. Los movimientos del tablero personal no cambian el estado
  agregado; un `QuerySet.update` administrativo evita señales y no es un disparador.
- El aviso de estado es genérico y usa la referencia normal de tarea, proyectada
  individualmente con permisos actuales: no copia título, descripción ni nombre
  del proyecto/estado. El historial propio también oculta referencias revocadas.
  Los mensajes automáticos conservan su resultado sin edición manual posterior.
- Cada ejecución comprueba de nuevo cuenta activa, empleado/asignación, piloto,
  credenciales, departamento y permisos del canal y origen. Una sesión MFA humana
  no se convierte en autoridad permanente; si el permiso exige presencia/MFA se
  rechaza la activación desatendida o se pausa al ejecutar. No se mezclan asignaciones.
- La acción y su resultado se guardan en una transacción; un fallo del registro
  revierte el mensaje/página. La misma ocurrencia tiene un único resultado. Los
  fallos inesperados conservan su intento con esperas 60/300 segundos y se pausan
  al tercer fallo. Un fallo tardío no invalida el éxito de otro trabajador/editor.
- Sin escritura de tareas, encadenamiento de reglas, fanout de menciones ni
  descargas/subidas Drive. Las notificaciones de mensajes reutilizan el seguimiento
  existente y sus límites de acceso, sin suscribir automáticamente a nadie.
- Presupuestos configurables: 20 reglas/10.000 registros por cuenta y 200 reglas/
  100.000 registros globales, incluidas las pausadas. No borrar historial para hacer
  espacio. Los intentos ya reservados pueden terminar con el presupuesto lleno;
  detener manualmente sigue disponible mediante un recibo fijo en la propia regla,
  incluso si no cabe una nueva fila de auditoría. No es garantía de coste del proveedor.
- API: `channels/<id>/automations/`, detalle `/<regla>/`, `runs/` y `audit/`.
  GET lista únicamente reglas propias; POST crea; PUT reemplaza una regla pausada;
  PATCH activa/pausa con versión y `client_id`. No hay DELETE. Selector de proyectos
  en `channels/<id>/automation-projects/` y detalle con estados, solo con lectura
  actual, sin exigir ni conceder gestión del proyecto.
- `run_channel_automations` ejecuta un lote de hasta 25. Celery Beat tiene un
  recorrido equivalente cada 60 s, sin sondeo nuevo del navegador. La bandera
  `MESSAGING_AUTOMATIONS_ENABLED` es falsa por defecto y en el ejemplo Oracle;
  los ensayos la activan únicamente en bases aisladas de prueba.
- Evidencia inicial: 46 pruebas SQLite de reglas/canales/plantillas aprobadas
  (23,007 s). Tras añadir cercas para fallos tardíos y pausa con capacidad agotada,
  23 pruebas de reglas aprobadas (11,325 s). Django check sin incidencias y esquema
  sin cambios adicionales sin migración. La ejecución PostgreSQL se registra por
  separado; no presentar estos resultados SQLite como acreditación de row locks.

### Cierre del componente backend — PostgreSQL, 29 de octubre

- Ejecución final en PostgreSQL 18.6 aislado, puerto local 55433: **30 pruebas
  aprobadas, 47,969 s**, sin saltos. Incluye 25 contratos funcionales y cinco
  pruebas concurrentes: dos trabajadores para un recordatorio, dos para un cambio
  de estado, pausa/publicación, dos creaciones contra la cuota y dos guardados
  simultáneos del mismo estado. No se simuló el resolvedor de permisos.
- La primera tanda PostgreSQL encontró tres fallos de preparación después del
  `flush` de TransactionTestCase: habían desaparecido las filas del catálogo de
  permisos creadas por migración. Se repusieron sus definiciones por prueba, igual
  que en las suites concurrentes existentes, sin conceder acceso adicional ni
  sustituir las decisiones Core. La tanda final anterior valida la corrección.
- Además de las cercas de versión/fecha para fallos tardíos, la conciliación de
  error reutiliza una reserva que otro trabajador ya creó, incluso con la cuota
  llena. Completar un intento existente no vuelve a reservar espacio ni pausa una
  recurrencia que ya se resolvió con éxito.
- Catorce regresiones Core/autorización y colaboración de tareas aprobadas
  (2,567 s). Cinco pruebas de notas aprobadas. Compilación Vite aprobada en 1 min
  29 s, con el aviso conocido de chunks grandes. Django check y dry-run de nuevas
  migraciones sin incidencias; `git diff --check` sin errores de whitespace.
- La migración 0032 solo se aplicó a las bases de pruebas destruidas por el runner.
  El servidor temporal terminó detenido. No se rotaron credenciales ni se migró
  el staging persistente de Google, y sus procesos se conservaron. **Antes de
  reiniciar ese backend con el código nuevo, aplicar 0032 en su perfil local**;
  el modelo de mensajes incluye un campo nuevo aunque la bandera esté desactivada.
- El lanzador de PostgreSQL necesitó salida interactiva y `PGCLIENTENCODING=UTF8`
  para este runtime Windows; no se cambiaron auth/TLS ni archivos del servidor.
  No confundir esa adaptación del ensayo con una reparación de la aplicación.
- Evidencia resumida: `docs/acceptance-channel-automations-20261029.json`.
  La fase 7 **no está completa**: faltan los controles de interfaz, revisión con
  dos cuentas en navegador y el recorrido de reloj/trabajador real. Los tiempos
  vencidos de estas pruebas se inyectan en la función de drenaje; no acreditan Beat.
- Para varias reglas del mismo cambio de tarea, el presupuesto se calcula por
  lote bajo el mutex: dos consultas de conteo sobre el historial de ejecuciones,
  independientemente de cuántas reglas coincidan, más sus equivalentes de auditoría.
  Las inserciones pendientes se agrupan. La prueba final comprueba cinco reglas
  contra dos plazas restantes: dos reservas y tres pausas, sin cinco recorridos
  completos de la cuota ni eliminación de historial.

### Cierre local de controles y reloj real — 29 de octubre

- Integrados los tres formularios en la pestaña Automatizaciones del canal,
  con selectores autorizados, revisión de plantilla y versión, creación pausada,
  confirmación al activar, pausa y registros propios de ejecuciones y cambios.
  No hay constructor universal ni solicitudes periódicas de la interfaz.
- La revisión cifrada conserva el intento y su versión original antes de enviar.
  Recuperar tras recarga requiere una decisión expresa y permisos vigentes;
  nunca envía ni activa automáticamente. Una lectura reciente no eleva la versión
  guardada de un formulario antiguo ni sobrescribe cambios de otra pestaña.
- UI/UX Pro Max se aplicó a errores vinculados a campos, resumen enfocable,
  revisión explícita y controles accesibles, sin rework visual. Anchura móvil
  de 390 px comprobada: documento y cuerpo de 390 px, sin desbordamiento global.
- Aplicada 0032 únicamente al PostgreSQL persistente local ya autorizado para
  Drive. Se conservaron secretos, dos cuentas y conexión independiente de Google.
  Bandera habilitada solo en esos procesos; los valores por defecto y el ejemplo
  Oracle siguen deshabilitados. No se migró producción ni se hizo commit/deploy.
- En navegador se crearon y activaron tres reglas de Beta; un borrador se recuperó
  tras recarga real sin producir una regla. Samuel inició después su propia sesión:
  la lista de reglas de Beta no apareció. Dos sesiones HTTP reales comprobaron
  asimismo listas propias y 404 de los detalles ajenos, sin resolvedores simulados.
- Trabajador interactivo con reloj real e intervalo de 30 s: un recordatorio a las
  19:54 UTC, una referencia al cambiar la tarea sintética por PATCH HTTP y una
  página periódica a las 20:00 UTC. Un resultado publicado durable por regla; la
  recurrencia avanzó siete días. Después se pausaron las dos reglas aún activas;
  el recordatorio único había finalizado. No se borraron mensajes/páginas/historial.
- Al volver a Mensajes se recarga el historial reciente. Fuera de esa pestaña no
  se descarga el historial por cada pista del socket. Una regresión DOM prueba
  una llegada sin socket durante la vista de páginas y su recuperación al volver.
- Pruebas: 44 backend aprobadas (20,414 s); nueve del preparador y sus cercas
  repetidas tras añadir el verificador; 192 pruebas Node; DOM de Slack, menciones
  y automatizaciones aprobados. Incluyen respuesta perdida, mismo nonce,
  conflicto de versión, revisión cifrada, retirada de acceso y solo lectura.
  El primer ensayo detectó una transacción abierta antes de la cerca de perfil:
  se movió dentro del preparador, después de validar el entorno, y se repitió.
- Compilación frontend aprobada, con el aviso conocido de chunks grandes;
  Django check y dry-run sin nuevas migraciones. La evidencia backend anterior
  conserva su alcance histórico; los controles y reloj real se documentan en
  `docs/acceptance-automation-ui-20261029.json`.
- No acredita Redis/Celery/Beat distribuido, micrófono/cámara físicos ni una PWA
  instalada en teléfono. Esas puertas siguen pendientes antes de desplegar;
  no se convierten en fallos locales ficticios ni en garantías de producción.

### Revisión del contrato de ejecución y alcance web — 29 de octubre

- Detectada y corregida una omisión en `compose.oracle.yaml`: la bandera de
  automatizaciones y diez presupuestos de mensajería no llegaban a los
  contenedores aunque estuvieran escritos en `.env`. Ahora se transmiten por el
  ancla compartida de HTTP y worker, con los mismos valores predeterminados del
  código. La bandera sigue en `false`; la lista del piloto sigue cerrada sin IDs.
- El ejemplo incluye ahora los cuatro límites de reglas y auditoría. Cinco
  pruebas de contrato verifican cobertura de límites, entorno compartido,
  planificación registrada, rechazo de discrepancias y errores sin eco de secretos.
- `deploy/check_messaging_environment.py --render` está preparado como lectura
  de dos configuraciones de Compose: usa solo el ejemplo y valores sintéticos,
  no hereda URLs/credenciales del servidor y no ejecuta `up`, `build` ni `down`.
  Sus pruebas usan respuestas controladas; la ejecución real rechazó correctamente
  la ausencia de Docker. No se presenta como YAML renderizado ni trabajador probado.
- No se instalaron Docker/WSL, no se creó una distribución Linux de la PWA y no
  se utilizó Oracle. El usuario difirió este ensayo local y las revisiones de
  dispositivos; el desarrollo funcional web continúa sin esa infraestructura.
- El lanzador de PostgreSQL establece `PGCLIENTENCODING=UTF8` solo durante el
  ensayo y restaura el valor al salir. La primera comprobación del servidor falló
  por una conversión de consola ausente en los binarios portables; tras este
  ajuste pudo iniciarse la regresión completa. No se alteraron autenticación,
  archivos del servidor ni la base persistente de Drive.
- Nueva evidencia transversal de los siete puntos y límites de esta aceptación:
  `docs/acceptance-functional-web-20261029.json`. Se esperó el resultado final
  de PostgreSQL antes de declarar la aceptación; no bastaba con tener los tests.

### Cierre de la ronda funcional web — 29 de octubre

- Los siete puntos solicitados están implementados y aceptados para revisión web
  local. El informe transversal relaciona cada requisito con código y pruebas;
  todos sus archivos referenciados se comprobaron presentes. No es una declaración
  de preparación de producción ni de aceptación en todos los dispositivos.
- Regresión final PostgreSQL 18.6 aislada en 55433: **494 aprobadas, cero fallos y
  cero omisiones, 882,927 s**. Incluye Mensajería completa, Notificaciones,
  autorización Core y colaboración de Tareas, con sus pruebas concurrentes y
  de sockets. La base persistente de Google permaneció separada en 55432.
- Frontend: 187 contratos de Chat/Slack; 14 de PWA; 21 de sincronización de
  notificaciones. Suite general: 395 aprobadas y una omitida porque Node no tiene
  DOMParser. Se repitió ese archivo con JSDOM: tres aprobadas, sin omisiones;
  el primer lanzador ad hoc cerraba la ventana antes de ejecutar el test, y se
  corrigió el lanzador sin cambiar la aplicación.
- Todas las suites DOM de Chat/recuperación/reenvíos, páginas, jerarquía, enlaces,
  comentarios, formato, buscador, guardados, biblioteca, documentos, Slack,
  menciones, automatizaciones, conversión a tarea y acuerdos aprobaron. Los avisos
  de puerto HMR ocupado de Vite en pruebas simultáneas no hicieron fallar las
  suites; no se detuvo ningún proceso ajeno para eliminarlos.
- Compilación final aprobada en 66 s con el aviso conocido de bundles grandes.
  Notas preparadas: cinco pruebas aprobadas; Django check, dry-run de modelos y
  diff whitespace sin errores. No se publicó ninguna nota ni se cambió el historial.
- Verificación de lectura con Google real: diez archivos publicados conservados
  y privados, sin reservar ni subir archivos nuevos. Los ensayos nativos de dos
  cuentas, recarga y reloj real se conservan en los informes de aceptación previos.
- Quedaron disponibles frontend 5193, backend local 8160 y los trabajadores locales
  de archivos y automatizaciones. Las reglas del ensayo están pausadas/completadas;
  el trabajador de automatizaciones permite probar reglas nuevas solo en el canal
  sintético «Automatizaciones · Pruebas locales», no en otras instancias o canales.
- Mantener las puertas de despliegue pendientes: el usuario difirió el ensayo
  distribuido local y las pruebas específicas de dispositivos. No se instalaron
  runtimes Linux ni se tocaron Oracle/Cloudflare; no hubo commit, push o migración
  de producción. El piloto sigue cerrado a IT por la configuración existente.
