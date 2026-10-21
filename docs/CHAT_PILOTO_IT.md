# Chat: piloto interno de IT

Esta entrega habilita pruebas exclusivamente entre personas con una plaza activa
en las unidades autorizadas de IT. No constituye el lanzamiento público del chat.
Las notas de lanzamiento general se prepararán después de la aceptación del equipo.

## Acceso y configuración

`MESSAGING_PILOT_ENABLED=true` es el valor predeterminado, también en local.
`MESSAGING_PILOT_UNIT_IDS` contiene los UUID de las unidades IT autorizadas,
separados por comas. Se configura en el entorno del backend; Compose transmite
ambas variables a backend y worker. Una lista vacía no permite acceso.

La decisión procede del servidor (`chat_enabled` en el directorio de asignaciones).
La plaza activa debe pertenecer al piloto; tener otra plaza de IT no abre Chat
desde un cargo de otro departamento. El propietario no tiene excepción.
El destinatario también debe conservar una plaza activa en IT. Retirarlo del
piloto oculta el historial pero no elimina sus mensajes.

Se aplica la misma restricción a API, preferencias y eventos del WebSocket
compartido. No se crea otro socket ni un sondeo HTTP para cada conversación.

Para desarrollo se pueden consultar los UUID de las unidades locales y añadir
solo las de IT al entorno. El sandbox sintético aislado tiene configuración
independiente; nunca debe utilizarse como configuración de producción.

## Pruebas de aceptación con el equipo

1. Dos personas de IT abren **Chat** o seleccionan el cuerpo de una tarjeta en
   Equipo. El avatar muestra información del perfil, sin abrir la conversación.
2. Enviar, recibir y editar mensajes propios antes de diez minutos. Confirmar que
   otra persona no puede editar el mensaje ni acceder a una conversación ajena.
3. Verificar un anillo para guardado, dos grises para entrega al dispositivo y dos
   rojos para lectura real en la conversación visible y enfocada.
4. Desconectar y reconectar la red; comprobar recuperación y ausencia de duplicados.
5. Probar en otro departamento, con una URL guardada y llamadas directas: Chat debe
   permanecer oculto y el backend debe rechazar el acceso, incluso al propietario.
6. Probar teclado, móvil y ambos temas. En Perfil → Chat, comprobar la preferencia
   de Enter, Mayús+Enter y Ctrl/⌘+Enter.

## Notificaciones

Los eventos siguen siendo el mecanismo principal. La comprobación de recuperación
usa cinco minutos con conexión sana y un minuto sin ella, con jitter para evitar
ráfagas simultáneas. Hay espera progresiva y respeto a Retry-After ante errores.
Las pestañas ocultas no consultan periódicamente; un evento pendiente se recupera
al volver. Los avisos de escritorio expresamente habilitados pueden consultar
ante un evento real en segundo plano.

## Revisión del piloto: avisos y presentación

Cambios publicados el 19 de octubre en `e8b8d590`, pendientes de aceptación del equipo:

- Los mensajes entrantes crean avisos en la campana, con preferencia independiente
  en Perfil → Notificaciones. No incluyen el texto privado del mensaje.
- Los puntos de Chat, Equipo y remitente reflejan mensajes realmente sin leer.
  Confirmar entrega u abrir el panel de personas no los limpia. Se recuperan desde
  el servidor al entrar y reconectar, sin sondeo periódico adicional.
- La versión de actividad por conversación evita que una respuesta antigua restaure
  puntos ya eliminados al leer desde otra sesión. Requiere migración `0003`.
- Lista plegable a avatares en escritorio, foco redondeado y fondo geométrico
  discreto, manteniendo modos claro y oscuro y navegación de teclado.

Estas son notas internas del piloto, no notas de lanzamiento para toda BOLD.

## Segunda revisión local: móvil, oscuro y multimedia

Preparada localmente; aún no publicada ni probada con el Drive real. La migración
`0004` se aplicó en la SQLite de desarrollo después de un respaldo consistente;
no se modificó Oracle. La base local no tiene un destino de Drive activo: antes
del ensayo de envíos debe configurarse desde Administración → Conectores, sin
copiar secretos ni credenciales de producción a la base de desarrollo.
La lista local de unidades IT también está vacía: se conserva el cierre de acceso
en vez de abrirlo a toda la organización o asumir que otro equipo equivale a IT.
El servidor visual sintético `node tests/messaging_ui.mjs --serve`, desde Core,
permite revisar la interfaz en `http://127.0.0.1:5186/` (`?dark` para oscuro)
sin cuentas empresariales, base de datos ni conexión a Drive. Los archivos elegidos
allí permanecen solo en la memoria de esa pestaña, no se envían al servidor.

- Sombras neutras oscuras, sin resplandor blanco al activar modo oscuro.
- Transición corta de la lista plegable y entrada de mensajes nuevos; no se anima
  todo el historial al cargar. Se respeta la preferencia de movimiento reducido.
- Espacio móvil adaptado al teclado, controles táctiles y acciones que envuelven
  en lugar de salirse de la pantalla.
- Una imagen o nota de voz por mensaje, hasta 10 MB. Imágenes PNG/JPEG/WebP,
  recorte, cambio de tamaño y trazos antes del envío; pegar y arrastrar admitidos.
- Las imágenes se validan y normalizan en el servidor, eliminando metadatos de
  cámara; máximo 24 megapíxeles y salida de hasta 2560 px por lado.
- Grabación de voz de hasta cinco minutos en el navegador, escucha previa,
  cancelación y reproducción a 1×, 1,5× o 2×. El límite servidor es de bytes;
  no se afirma verificación de duración o transcodificación de audio en servidor.
- El Drive seleccionado en Administración → Conectores aloja `Chat / Empleado /
  Conversación`; no se crean permisos públicos de Google. Los IDs de Drive no se
  exponen y las descargas pasan por pertenencia privada y filtro IT en backend.
- Quienes tengan acceso externo a la carpeta corporativa de Google sí podrán leer
  estos archivos fuera de BOLD. No es cifrado de extremo a extremo.
- Las imágenes se descargan al acercarse al área visible; el audio, al solicitarlo.
  Los blobs se liberan al cerrar la vista; no se guardan en cachés persistentes.
- Reintentos con el mismo identificador recuperan el mismo archivo remoto y no
  crean otra notificación ni otro mensaje. Si el envío falla se conserva el borrador.
- Requiere Pillow y migración `0004_messagemedia`. La validación local usa Drive
  simulado y base de pruebas; no sustituye ensayo con cámara/micrófono y Drive real.

Limitaciones del piloto: la escritura multimedia se serializa mientras se coordina
con Drive para evitar duplicados de carpetas y archivos. Antes de escalar, trasladar
las subidas a un flujo asíncrono con estados pendientes y limpieza de huérfanos.
Un archivo subido antes de un fallo de commit queda recuperable por marcador en un
reintento; si se abandona ese borrador requiere conciliación, no borrado automático.
No se incorporó QR, lotes de imágenes ni edición del binario después de enviar.

### Lista de revisión manual del equipo IT

1. Probar modo claro/oscuro, móvil de 320–414 px y horizontal. Comprobar que no
   haya halo blanco en burbujas ni controles fuera de la pantalla, incluido teclado abierto.
2. Plegar/desplegar la lista y enviar/recibir mensajes: transición breve, sin animar
   el historial completo. Activar movimiento reducido para comprobar que se desactive.
3. Pegar, arrastrar o elegir una imagen; recortar, ajustar ancho, dibujar y deshacer;
   cancelar no debe enviar nada. Enviar, abrir y descargar desde la otra cuenta.
4. Grabar voz, escuchar antes de enviar, descartar y volver a grabar. Verificar
   1×/1,5×/2× y que el indicador del micrófono se apague al detener o salir de Chat.
5. Denegar el micrófono y cortar la conexión al enviar: aviso comprensible,
   conservación del borrador y ausencia de duplicados al reintentar.
6. Confirmar acceso denegado desde una tercera cuenta y fuera de IT; comprobar
   además entrega/lectura y puntos de mensajes pendientes entre dispositivos.

La revisión visual se delega al usuario por problemas de sesión de la extensión.
Las pruebas automáticas de DOM, controles y permisos no equivalen a esa aceptación
visual ni a una subida de prueba con el Drive corporativo real.

## Revisión visual local del 20 de octubre de 2026

Preparada localmente; no implica publicación ni apertura a otros departamentos.
Se conserva el piloto IT y no se modifica el contrato de archivos privados en Drive.

- Burbujas más contenidas y editor centrado de una línea que crece con el texto,
  hasta un límite con desplazamiento; conserva Enter configurable y borradores.
- Voz con controles compactos inspirados en WhatsApp: reproducir/pausar, progreso
  accesible con teclado, tiempo, avatar y 1×/1,5×/2×. Solo una nota suena a la vez.
  No descarga el historial de audios: la primera pulsación carga y reproduce; las
  siguientes reutilizan el blob privado. La duración se muestra al obtenerla, no
  se inventa antes de descargar. Si el códec permite decodificación local, se genera
  su onda real; si no, queda un indicador neutro y la reproducción nativa continúa.
- Imágenes sin descarga inline ni enlaces que abran otra pestaña. Se conservan
  autor, imagen, texto opcional, hora y confirmaciones de envío/entrega/lectura.
- Visor interno con ajuste a pantalla, zoom hasta 3×, desplazamiento, descarga y
  cierre explícito o con Escape; restaura el foco a la miniatura. Abrir o ampliar
  reutiliza el archivo descargado, sin solicitudes adicionales a Drive.
- Controles táctiles y foco visible; colores de audio específicos para ambos temas,
  sombras neutras y sin librerías nuevas ni cambios de backend/migración.

Antes de aceptar visualmente: revisar 320/375/414 px, escritorio y ambos temas;
abrir imágenes verticales y horizontales, hacer zoom y desplazarse, cerrar con
Escape y confirmar retorno a la miniatura; reproducir dos notas consecutivas,
buscar un punto del audio y alternar velocidades. Probar también teclado móvil
abierto, letra ampliada y un códec grabado por cada navegador utilizado por IT.
Las pruebas DOM no sustituyen reproducción física ni revisión visual en dispositivos.

## Cola de imágenes: revisión local posterior

Preparada localmente, pendiente de aceptación visual y publicación. Mantiene la
restricción IT y reutiliza el endpoint privado de Drive sin migración ni permisos nuevos.

- Elegir, pegar o arrastrar varias imágenes abre una cola de revisión, no el editor.
  Hasta diez imágenes y 50 MB totales por conversación; diez MB por archivo, PNG,
  JPEG o WebP. Una selección inválida se rechaza completa y no altera lo ya preparado.
- Miniaturas para navegar, vista previa grande, quitar una imagen, añadir más,
  descripción individual opcional y botón explícito para editar/recortar/dibujar.
  Cancelar el editor conserva el archivo anterior y su texto. Editar una imagen
  no modifica las demás. El texto escrito antes de adjuntar pasa a la primera imagen.
- El envío es secuencial: cada imagen es un mensaje independiente, con su UUID,
  autor, texto y confirmaciones de entrega/lectura. No hay álbum agrupado todavía.
  No se suben archivos ni se consulta Drive al preparar o revisar la cola.
- Solo se retiran de la cola los envíos confirmados. Si se pierde la respuesta,
  el reintento conserva UUID, archivo y descripción: recupera el mensaje confirmado
  por el servidor en vez de duplicarlo. Mientras no pueda confirmarse, ese contenido
  no es editable. Una respuesta definitiva de validación sí permite corregirlo.
- Quitar una imagen pendiente de confirmar solo la retira del borrador local:
  no elimina un mensaje que ya hubiese llegado al servidor. La interfaz lo advierte.
  Quitar toda la cola conserva las descripciones como texto, sin truncarlas en silencio.
- Las colas son temporales y separadas por conversación mientras Chat está abierto;
  no se almacenan en disco ni se conservan al salir del módulo, cambiar identidad o
  recargar. Las URL de previsualización se liberan al sustituir, quitar o cerrar.
- Una nota de voz y una cola de imágenes no se mezclan en el mismo borrador.

Pruebas DOM añadidas: selección múltiple sin abrir editor, descripciones por imagen,
editar/cancelar, añadir/quitar, pegado/arrastre, progreso, doble clic, envío parcial,
respuesta perdida después de commit, reintento con el mismo UUID y liberación de blobs.
Esto usa API/Drive simulados; no constituye una nueva prueba contra Drive real.
Revisar manualmente la cola y su desplazamiento con teclado móvil abierto y ambos temas.

## Reenvío privado: preparado localmente

- Acción «Reenviar» en mensajes de texto propios o recibidos y en imágenes con
  su descripción. Selector con búsqueda de otro empleado habilitado para Chat;
  excluye al propio usuario y al interlocutor del chat de origen. Un destinatario
  por operación, con confirmación explícita antes de descargar o enviar contenido.
- Es una copia enviada por quien reenvía, no una suplantación del autor original.
  No transporta participantes, identidad del autor original, enlaces al chat ni
  identificadores de Drive. La conversación original no se comparte ni se modifica.
- Las imágenes se obtienen mediante la descarga autenticada del origen y se suben
  como un mensaje nuevo por el endpoint existente del destino. El servidor vuelve
  a comprobar acceso y pertenencia al piloto. Se conserva el almacenamiento Drive
  configurado; cada copia consume almacenamiento adicional. No crea enlaces públicos.
- El destino conserva el envío/entrega/lectura y el plazo de edición de un mensaje
  nuevo. No hay indicador persistente «reenviado» ni referencia al mensaje original.
  Las notas de voz no se incluyen en esta primera opción de reenvío.
- Doble clic y reintentos comparten UUID y archivo para recuperar respuestas
  perdidas sin duplicar el envío. Los reintentos pendientes se conservan en memoria
  mientras siga abierto este módulo bajo la misma identidad; no sobreviven una
  recarga. Cerrar el selector no revierte un envío que ya haya llegado al servidor.
- Selector nativo modal, búsqueda etiquetada, selección con teclado, retorno de
  foco y estados de carga/error. Reutiliza tokens claro/oscuro y no añade sondeos.
  La skill UI/UX Pro Max guio foco visible, confirmación explícita y controles táctiles.
- Sin cambios de backend, migraciones ni permisos nuevos. Preparado y probado en
  local; no implica commit, despliegue ni una nueva validación contra Drive real.

Verificación automática: texto/imagen, autor del nuevo envío, destinatarios IT,
escape/cancelación, doble clic, respuesta perdida y reintento idempotente,
denegación de acceso, aborto al desmontar y rechazo de archivos inesperados.
Pendiente aceptación visual manual: selector en móvil y ambos temas.

### Validación real previa a publicación — 20 de octubre de 2026

- Tres cuentas existentes de IT: chat A/B como origen y B/C como destino. API real
  del servidor con autenticación forzada de prueba en proceso; sin sesiones de
  navegador, contraseñas nuevas ni lectura de conversaciones existentes.
- Texto e imagen sintéticos: envío 201, descarga del destinatario 200 y reintento
  200 sin duplicar mensajes ni crear archivos adicionales en Drive. Autoría nueva
  de B, descripción conservada, copia privada independiente y digest verificado.
- Drive configurado accesible, unidad compartida `BOLD APP`, mismo destino de
  almacenamiento. No se crearon permisos públicos ni se movió la raíz configurada.
- Terceros de IT: 404 al intentar acceder al otro chat. Cuenta externa a IT: 403.
  Entrega y lectura: 200. Edición propia dentro del plazo: 200; edición ajena: 403.
- Toda la base de prueba se revirtió; ninguna notificación/evento se publicó.
  Seis elementos nuevos de Drive se enviaron a papelera recuperable, verificando
  sus identificadores, padres y marcadores para no tocar archivos preexistentes.
- Chat: 34 pruebas más React/DOM; sincronización: 21; proxy: siete; PWA: siete.
  La publicación y sus versiones se registran aparte tras verificar los proveedores.
  Esta prueba API no sustituye aceptación visual ni login con dos navegadores.

## Reenvío múltiple — preparación local posterior

- Entrada desde «Seleccionar mensajes para reenviar» en la cabecera del chat, o
  desde «Seleccionar varios mensajes» en el selector de un reenvío individual.
  Casillas nativas, selección resaltada, contador contextual y cancelación con
  botón o Escape. UI/UX Pro Max orientó los estados, el foco y el contador accesible.
- Hasta diez mensajes de texto o imágenes, propios o recibidos, de la misma
  conversación. Las notas de voz siguen fuera del alcance del reenvío. El envío
  respeta fecha e identificador originales, no el orden en que se marcaron.
- Cada elemento es un mensaje nuevo e independiente del empleado que reenvía;
  no es un álbum ni una operación atómica. No se obtiene contenido de Drive al
  seleccionar o revisar. Las imágenes conservan la descarga/subida privada existente.
- El lote se envía en serie, con progreso y un destinatario fijo durante sus
  reintentos. Se reutiliza la conversación canónica en esta sesión para evitar
  una petición de apertura por mensaje. Cada envío mantiene la autorización real
  del servidor; la caché se descarta ante denegación o recurso no disponible.
- Solo los envíos confirmados salen de la selección. Ante un fallo, la vista
  previa y las casillas conservan los restantes. Cerrar y reabrir permite continuar
  con esos pendientes; el UUID/archivo se reutiliza si se perdió una respuesta.
  Cambiar deliberadamente de destinatario al abrir otra operación no revierte un
  envío anterior. Cerrar o cancelar nunca elimina un mensaje ya recibido.
- La selección usa copias temporales del contenido y se limpia al salir de ese
  chat o completar el lote. El borrador de texto y la edición en curso no se borran.
  No sobrevive una recarga o cambio de identidad; el plazo de edición sigue corriendo.
- Sin backend, migraciones, permisos nuevos, sondeos ni cambios en el piloto IT.
  Preparado y probado localmente; no implica commit, despliegue ni nueva prueba
  con cuentas reales o el Drive corporativo.

Pruebas: límites/alternancia, copias estables, orden cronológico, envío mixto en
serie, destino bloqueado durante reintentos, doble clic, fallo parcial después de
commit, recuperación sin duplicados aun cerrando/reabriendo, aborto, preservación
de borradores, foco/cancelación y limpieza al cambiar de conversación. Pendiente
aceptación visual del selector, casillas y barra de acciones en móvil y ambos temas.

## Slack — primera base local de canales

Estado: implementación local en curso. No constituye lanzamiento, migración de
la base del desarrollador ni despliegue. Conservar separado el reenvío múltiple
anterior (solo frontend) de este módulo nuevo (frontend y backend con esquema).

Reglas confirmadas:

- Nombre visible «Slack», organizado por departamentos y canales. Todos los
  empleados pueden leer/escribir y gestionar canales salvo restricción explícita;
  el piloto sigue limitando el acceso a IT, también para el propietario.
- Las capacidades `slack.channel.read/create/manage` y
  `slack.message.create/update` están en el catálogo central de Permisos.
  Se aplican denegaciones por cargo, unidad y asignación; no se combinan las
  plazas del empleado. El propietario conserva la herencia definida por Core,
  sin omitir la frontera IT ni las restricciones estructurales de edición propia.
- El permiso activo sin reglas admite colaboración de empleados **solo para esas
  cinco capacidades conocidas**. Esta excepción de producto vive en Core, después
  de las denegaciones; otros permisos mantienen su comportamiento previo.
- El departamento mostrado en cada tarjeta es una copia del nombre y color de
  la asignación activa al enviar. No se infiere del cargo ni se aceptan identidad,
  departamento o secuencia proporcionados por el navegador. Se usan los colores
  organizacionales configurados o una paleta estable de respaldo.
- Crear, renombrar, describir, archivar y restaurar canales. Archivar conserva el
  historial y detiene envíos/ediciones; no existe eliminación definitiva por API.
  Un nombre no se repite dentro del departamento, incluidos canales archivados.
- Mensajes de texto y enlaces seguros, hilos de un nivel, fecha/hora, edición
  propia durante diez minutos y control de versión. Los reintentos conservan
  identificador y contenido original incluso si el mensaje ya fue editado.
- La interfaz enlaza con el Chat privado desde el avatar del autor. Esto abre
  una conversación independiente; nunca convierte un DM en un canal público.
- `slack.changed` usa el socket autenticado existente. Son pistas acotadas sin
  cuerpo de mensaje y con autorización revalidada por destinatario. No hay otro
  socket ni sondeo periódico de canales; la vista reconcilia al recibir eventos,
  reconectar o solicitar actualización. El módulo inactivo no consulta por evento.
- Historial de 50 mensajes por página, canales de 50 en 50, directorio inicial de
  hasta 200 unidades y máximo inicial de 200 canales por unidad. No son cifras
  de capacidad de Oracle/Cloudflare. Deben revisarse si crece el organigrama.

Migraciones preparadas: `0005_department_channels` (canales, mensajes y cursores
de lectura) y `0006_slack_permissions` (catálogo, sin concesiones masivas por
cargo). Las pruebas crean y destruyen su propia base temporal SQLite; no se
usan sesiones, mensajes ni credenciales de producción. Los cursores de lectura
son base técnica: la interfaz aún no anuncia confirmaciones ni badges globales.

Validación local inicial: 22 casos nuevos de API/WebSocket incluidos en 68 pruebas
de mensajería/autorización; 46 pruebas unitarias frontend de Chat/canales y los
contratos DOM de ambos módulos. Compilación frontend correcta; advertencia de
chunks grandes preexistente. Regresión ampliada: 74 pruebas de Notificaciones y
Permisos aprobadas; regresión frontend general: 393 casos, 392 aprobados y uno
omitido. La prueba genérica de herencia del propietario desactiva expresamente
el piloto, mientras los casos de canales exigen 403 al propietario fuera de IT.
UI/UX Pro Max se utilizó para controles con etiqueta, foco, cancelación, estados
de envío, identificación departamental por texto además de color y adaptación
móvil. La compilación y los contratos DOM no sustituyen una revisión visual real.

### Avance local del 21 de octubre: referencias a tareas y sesiones

- Dos cuentas sintéticas de departamentos distintos verifican el login real del
  backend, cookies independientes, CSRF, mensajes y respuestas, edición propia,
  tickets WebSocket y cierre de sesión que revoca solamente su conexión. No se
  usa `force_authenticate` en ese flujo; tampoco cuentas ni credenciales reales.
  Son clientes HTTP/ASGI integrados de prueba, no dos navegadores ni producción.
  El MFA desactivado se limita expresamente a esa clase de prueba sintética.
- Nuevo selector «Compartir tarea», con búsqueda por título al pulsar Buscar,
  paginación y resultados de la misma autorización que el módulo Tareas. No hay
  búsqueda por cada tecla ni sondeo nuevo. Se puede enviar una referencia sola
  o con texto, tanto en el canal como en un hilo.
- La migración `0007_channel_task_reference` guarda solo el UUID de la tarea.
  No se copian títulos/estados confidenciales ni se añaden colaboradores,
  miembros, concesiones o permisos al publicar el mensaje. Quien no puede leerla
  recibe solo una tarjeta no disponible, sin título, estado ni UUID de la tarea.
- La tarjeta obtiene los datos actuales al cargar el historial. Se revalidan
  permisos, pertenencia explícita, asignación activa y MFA; una tarea borrada o
  revocada conserva el mensaje sin exponer su referencia. Antes de abrirla se
  vuelve a consultar el endpoint autorizado de Tareas y se navega por su flujo
  existente, sin introducir datos confiables desde el mensaje.
- Se conserva la idempotencia del mensaje incluso después de editarlo o perder
  el acceso a la referencia. Si la tarea deja de estar disponible entre selección
  y envío, se retira del borrador, se conserva el texto y no se cierra el canal.
- Slack queda fuera de `requiresTaskData`: entrar en sus canales no activa la
  carga, suscripciones ni recuperación periódica del grafo de Tareas. Abrir una
  tarjeta de tarea sí inicia el ciclo normal de ese módulo.
- Pruebas nuevas de permisos/revocación y contratos React/DOM para buscar,
  seleccionar, enviar sin texto, abrir y denegar una tarjeta revocada. El fixture
  del Chat usa días locales claramente distintos para no fallar por medianoche.

Pendiente antes de declarar terminado el objetivo de canales: aceptación real de
adjuntos con el Drive configurado y aceptación visual en
móvil, escritorio y ambos temas. Páginas/plantillas, coedición, automatizaciones
y llamadas no se anuncian como funciones implementadas en esta etapa.
La validación de concurrencia con PostgreSQL y la aceptación en dos navegadores
sobre una instancia aislada siguen pendientes; no se sustituyen por los clientes
HTTP/ASGI sintéticos ya verificados ni implican despliegue autorizado.

### Adjuntos de canales — implementación local del 21 de octubre

- Imágenes y notas de voz comparten la validación del Chat: un archivo por
  mensaje, máximo 10 MB; PNG/JPEG/WebP se normalizan a WebP, sin EXIF y con tamaño
  acotado. Audio WebM, Ogg/Opus y M4A con comprobación de contenedor. La subida se
  limita durante el análisis multipart, no solo después de recibir el archivo.
- `0008_channel_media` prepara los metadatos privados en una tabla independiente
  del Chat. No se ha migrado ninguna base persistente. El destino es la raíz
  corporativa activa configurada: `Slack / departamento / canal / empleado`, con
  identificadores estables; no se crea otra unidad ni se cambia la raíz actual.
- BOLD no crea permisos públicos de Drive ni devuelve sus IDs o enlaces remotos.
  Cada descarga pasa por la sesión y el permiso vigente de lectura del canal,
  también bajo el piloto IT. Conservar historia archivada no habilita envíos.
  SHA-256 y tamaño detectan un archivo alterado fuera de BOLD. Quienes ya tengan
  acceso directo a la carpeta corporativa conservan ese acceso externo a BOLD.
- Marcadores deterministas permiten recuperar una subida remota ya completada
  si la transacción local se revierte. No es una transacción distribuida: una
  subida abandonada puede quedar huérfana; la limpieza automática sigue fuera
  de esta entrega. Reintentar el mismo contenido no crea otra copia.
- Cola de hasta diez imágenes/50 MB, selección múltiple, pegado y arrastre;
  miniaturas y texto por imagen, recorte/dibujo opcional y visor interno con
  descarga. Preparar imágenes no abre el editor automáticamente. Los borradores
  se mantienen separados por canal/hilo y se descartan al cambiar la identidad.
- Envío secuencial: se retiran solo los confirmados. Un resultado incierto conserva
  exactamente UUID, archivo, texto, hilo y tarea para el reintento; los errores de
  validación confirmados permiten corregirlo. Una referencia a tarea acompaña solo
  al primer adjunto, sin repetirla en toda la cola. Quitar un pendiente del borrador
  no elimina un mensaje que pudiera haber llegado al servidor.
- Grabación con escucha previa, cancelar/detener, liberación del micrófono y
  reproducción a 1×/1,5×/2×. Se reutilizan los componentes del Chat; el acceso al
  archivo sigue siendo propio del canal, no el de una conversación privada.
- UI/UX Pro Max guio etiquetas, foco, revisión opcional, progreso y recuperación
  de errores, con los mismos tokens visuales de BOLD y controles accesibles.

Validado: 100 pruebas backend de Mensajería/autorización/colaboración, 49 unitarias
frontend de Chat/canales y los contratos React/DOM de ambos módulos; 21 de
sincronización y ciclo de sesión; compilación correcta (advertencia previa de
chunks grandes). Las pruebas de medios usan almacenamiento/OAuth/Drive simulados,
no el Drive real. Incluyen contenido alterado, acceso revocado, idempotencia tras
edición, recuperación de subida huérfana y reintento parcial de la cola. La base
temporal aplicó las migraciones y `makemigrations --check` no detectó diferencias.

Pendiente en esa etapa: revisión visual real en móvil/escritorio y ambos temas,
audio/cámara con hardware real y aceptación integrada contra el Drive de pruebas.
Todavía no había PostgreSQL aislado configurado (sin Docker/psql disponibles ni
`BOLD_TEST_DATABASE_URL`); la preparación posterior se registra más abajo.
Sin commit, push ni despliegue; acceso IT sin cambios.

Decisión confirmada para el siguiente componente de avisos: notificar únicamente
los canales que cada empleado siga voluntariamente, conservando indicadores de
no leídos en los demás. Seguir/dejar de seguir será una preferencia personal,
persistente entre dispositivos y nunca una concesión o revocación de acceso.
La implementación local de esta política se detalla a continuación; no implica
disponibilidad en producción.

### Seguimiento, campana y no leídos — preparación local posterior

- `0009_channel_following_and_thread_reads` prepara seguimiento personal por
  empleado y cursores de lectura por hilo. Se comparte entre las asignaciones y
  dispositivos del mismo empleado; no añade miembros, concesiones ni permisos.
  Nadie sigue canales automáticamente, tampoco su creador o quien escribe en él.
- «Seguir canal» activa avisos nuevos; «Dejar de seguir canal» detiene los futuros
  y marca como atendidos los avisos antiguos de ese canal en la campana. Conserva
  mensajes, archivos, permisos y no leídos del canal. Se pueden silenciar además
  los avisos nuevos desde Perfil → Notificaciones, sin modificar el seguimiento.
- Solo los seguidores autorizados reciben avisos, excluyendo al propio autor en
  todas sus asignaciones. El aviso es genérico: no contiene cuerpo del mensaje,
  nombre del canal ni títulos de tareas. Las ediciones y reintentos confirmados
  no generan avisos duplicados. La lectura REST y la entrega por socket vuelven a
  comprobar permisos, piloto y MFA; una revocación oculta también sus contadores.
- Los contadores del canal incluyen mensajes y respuestas nuevos de otros
  empleados, se siga o no el canal. Los hilos muestran cuántas respuestas están
  pendientes. Hay indicador en la navegación principal de Slack y anuncios de
  estado contextuales, no una región viva diferente para cada insignia.
- Cargar un historial por GET no marca lectura. El lector automático exige foco,
  pestaña visible e intersección con el área de mensajes. Cada vista avanza su
  propio cursor hasta el mensaje observado: principal e hilos son independientes;
  ver el canal no reconoce respuestas no abiertas. No se publican confirmaciones
  individuales de lectura a otros empleados. Hay alternativa explícita «Marcar
  vista como leída», también para navegadores sin IntersectionObserver.
- Se actualizan los avisos correspondientes al cursor de esa vista, sin limpiar
  los de hilos ajenos. Los cursores son monotónicos y la preferencia/lectura tiene
  una revisión personal; respuestas atrasadas no revierten un seguimiento nuevo,
  una lectura confirmada ni un nombre de canal más reciente.
- Un aviso abre su canal o hilo mediante Shell y endpoints autorizados. No inyecta
  el texto del aviso como contenido confiable. Un destino consumido no vuelve a
  abrirse cada vez que se envía un mensaje. Slack continúa sin arrancar el grafo
  ni la recuperación periódica de Tareas.
- Se usa el mismo socket de sesión. Los cambios personales van solo al grupo
  privado de ese empleado; no se emiten sus lecturas a todos los participantes.
  La proyección de no leídos se consulta al entrar, recuperar foco/reconexión o
  recibir invalidaciones agrupadas. No hay intervalo nuevo ni reintento programado
  en reposo; se respeta Retry-After. Las pestañas ocultas recuperan al volver.
- El resumen transmite hasta 200 contadores de canales, con total autorizado y
  señal de truncamiento; las listas paginadas obtienen sus contadores propios.
  Este límite no acredita capacidad de producción. Con carga real se debe medir
  el coste de agregación/fanout antes de abrir a toda la empresa.

Validación: 127 pruebas backend integradas de Mensajería, Notificaciones,
autorización y colaboración; incluyen seguimiento/privacidad, permiso revocado, piloto,
MFA, preferencias, idempotencia y separación de cursores. Dos sesiones ASGI
sintéticas comprueban aviso genérico y cambio personal en el socket existente.
56 unitarias frontend de Chat/canales, contratos DOM de ambos módulos y 21 de
sincronización aprobados; el DOM incluye seguimiento, navegación a hilo y
visibilidad/foco simulados. Compilación correcta, con los chunks grandes ya
conocidos. El chequeo de modelos no detecta migraciones faltantes.
Regresión frontend general: 393 casos, 392 aprobados y uno omitido, sin fallos.
No equivalen a aceptación visual ni a concurrencia probada en PostgreSQL.

### Aceptación local en navegador y entorno aislado — 21 de octubre de 2026

Se revisó el módulo mediante HTTP, cookies/CSRF y WebSocket reales con dos cuentas
sintéticas y sesiones independientes (`127.0.0.1` y `localhost`). No se importaron
sesiones, usuarios, archivos ni credenciales de producción.

- Se verificaron envío y edición propia, llegada sin recargar, avisos genéricos
  únicamente a seguidores, apertura del canal/hilo desde la campana y cursores
  independientes. Ver el canal no reconoce respuestas de hilos no abiertos.
  La imagen de prueba se abrió en el visualizador interno sin salir al navegador.
- Se corrigió la reselección del mismo canal o aviso para que no vacíe el historial.
  El lector no reconoce mensajes mientras carga ni detrás de un diálogo modal.
  Los contadores visibles usan el resumen actualizado, no la copia antigua de la
  lista de canales. Se conserva la posición al leer mensajes anteriores y se
  ofrece «Ir al último»; un envío propio confirmado sí baja al mensaje nuevo.
- La revisión con `ui-ux-pro-max` compactó herramientas móviles conservando áreas
  táctiles de 44 px. Se comprobaron 320×700, 375×812 y 812×375, además de escritorio
  en ambos temas. Se eliminó el recorte del editor horizontal y se mantuvieron
  los controles en una fila incluso en 320 px. Otros módulos no cambian su layout.
- Los contratos DOM de canales y la compilación frontend pasan. Continúa la
  advertencia conocida sobre chunks grandes; no es una comprobación de capacidad
  de producción ni sustituye la aceptación final del equipo.

Sandbox reproducible del navegador:

```powershell
# Desde backend, con .venv activa: siempre crea una base SQLite temporal nueva.
python -m boldApp.mensajeria.channel_validation
# Desde frontend/modulos/core, en otra terminal:
npx vite --config vite.channel-validation.config.js --configLoader runner
```

Frontend en el puerto 5192; backend en 8159. `settings_channel_validation` solo
acepta una carpeta temporal con prefijo validado, emplea cookies distintas y deja
deshabilitadas las credenciales Google. Su Drive es un doble estricto en memoria:
prueba el protocolo de carpetas/subidas y la integración de la aplicación, pero
**no transmite archivos a Google ni acredita el Drive real**. No se debe usar este
sandbox para autorizar Google. La base antigua `db.messaging-sandbox.sqlite3` se
preservó sin migrarla ni sustituirla.

PostgreSQL local:

- El despliegue usa PostgreSQL 18; se obtuvo la distribución portable 18.6 x64 de
  [EDB](https://www.enterprisedb.com/download-postgresql-binaries), proveedor
  enlazado por [PostgreSQL](https://www.postgresql.org/download/windows/).
  SHA-256 del ZIP probado: `E2246BA91D22345BC3D017586C09EDE52D9DF180B1EEB480F050445F1CAD84E2`.
  Es una huella del archivo recibido por HTTPS, no un checksum publicado por EDB.
- Binarios/datos en una carpeta exclusiva `bold-channel-postgres-<uuid>` debajo de
  Temp, sin instalador, servicio Windows, arranque automático ni recurso cloud.
  Solo escucha en `127.0.0.1:55432`; SCRAM y contraseña aleatoria local con ACL
  restringida. No se almacena la contraseña en Git ni se imprime su URL.
- `deploy/test_channels_postgres.ps1 -ValidationRoot <carpeta-temporal>` inicia la
  instancia, crea `bold_validation`, ejecuta la suite en `test_bold_validation`
  mediante `settings_test_postgres` y apaga PostgreSQL incluso si falla una prueba.
  No reutiliza un puerto ocupado ni acepta otro nombre/host de base de datos.
  Conserva datos, binarios y log para repetición; la carpeta temporal no se borra.
- `test_channel_concurrency.py` comprueba UUID idempotente simultáneo, secuencias
  únicas de respuestas de dos autores y seguimiento/lectura concurrentes sin
  pérdida de revisión. SQLite omite expresamente estos tres casos.
- La primera ejecución PostgreSQL detectó una incompatibilidad del propio test:
  invocar `database_sync_to_async` desde el `TestCase` transaccional cerraba su
  conexión. La prueba unitaria ahora llama la política síncrona; las pruebas ASGI
  con `TransactionTestCase` siguen cubriendo el adaptador real. No se desactivaron
  comprobaciones ni se cambió la política de autorización para hacerlas pasar.
- Resultado final en PostgreSQL 18.6: **130 pruebas aprobadas en 166,746 s**, sin
  omitir las tres comprobaciones de concurrencia. Se aplicaron las migraciones a
  la base de test, se eliminó esa base al terminar mediante el runner de Django y
  se confirmó el apagado de la instancia local. `makemigrations --check` no detecta
  diferencias de modelos. Oracle y Cloudflare no se modificaron.

Preparación posterior para el proveedor real, todavía sin autorizar Google:

- `settings_channel_staging` utiliza ese PostgreSQL local persistente, claves
  aleatorias propias con ACL y hash PBKDF2, sin los usuarios ni contraseñas del
  sandbox visual. Ignora el cliente OAuth heredado de `.env`, separa sus cookies
  y conserva el paso MFA administrativo del conector. No copia cuentas, tokens,
  destinos Drive ni clientes OAuth de otra base de datos.
- `-Action PrepareStaging` aplica el esquema y comprueba la configuración;
  `-Action RunStaging` mantiene un único backend en `127.0.0.1:8160` y apaga
  PostgreSQL al terminar. No instala servicios ni permite escuchar en una IP
  pública. El frontend dedicado usa `vite.channel-staging.config.js`, puerto
  5193 y proxy exclusivamente hacia ese backend local.
- URI de callback del entorno: `http://127.0.0.1:5193/api/v2/workspace/oauth/callback/`.
  Todavía no se ha registrado ni consentido un cliente Google de pruebas.
  Los logs de acceso de este modo omiten/redactan la query del callback OAuth.
- Se comprobó el arranque real de ambos procesos y el proxy: sesión anónima 200
  con CSRF/cookie propios; acceso anónimo a canales 401. Conteos SQL posteriores
  a la migración: cero cuentas, conexiones Google, clientes OAuth y raíces Drive.
  Ocho pruebas aisladas verifican rechazos de host/base/usuario/puerto/opciones
  externos, secretos ausentes, no herencia de credenciales y redacción del log.
  Se verificó el cierre de los puertos 5193, 8160 y 55432 al terminar.
- Es un entorno preparado, **no una aplicación de pruebas ya provisionada**:
  faltan las identidades locales que correspondan a la cuenta de prueba aprobada,
  el cliente OAuth independiente, su consentimiento y el destino Drive. No usar
  la cuenta sintética de contraseña pública del sandbox para conectar Google.

```powershell
# Desde la raíz del repositorio. Reutiliza solo la carpeta PostgreSQL de pruebas.
.\deploy\test_channels_postgres.ps1 -ValidationRoot "<carpeta-temporal-aislada>" -Action PrepareStaging
# Para el posterior ensayo autorizado (tras provisionar las cuentas locales):
.\deploy\test_channels_postgres.ps1 -ValidationRoot "<carpeta-temporal-aislada>" -Action RunStaging
# En otra terminal, desde frontend/modulos/core:
npx vite --config vite.channel-staging.config.js --configLoader runner
```

Decisión posterior del usuario, 21 de octubre: usar `samuel@bold.gt` por la
limitación de cuentas corporativas y crear una carpeta exclusiva para las pruebas.
Se creó en «Mi unidad» **BOLD APP — Pruebas Slack — 2026-10-21**, ID
`1r7DLaKq97Tjo0KsTtkR7ANevO9dy9mbb`. Se comprobó en la interfaz Google Drive que
el acceso general es «Restringido» y Samuel es la única persona con acceso y su
propietario. No se modificó el destino corporativo de producción «BOLD APP»,
no se añadieron invitados ni se cambiaron archivos existentes.

La cuenta contiene archivos reales: una carpeta distinta **no aísla** el alcance
OAuth `drive` del conector actual. Las pruebas deberán usar exclusivamente datos
sintéticos dentro de esa carpeta, con un cliente OAuth independiente. No copiar
el JSON OAuth, tokens, clave de cifrado ni base de datos de producción al entorno
local. Todavía no se importó ni autorizó ningún cliente o conexión Google allí.

El usuario completó la verificación manual de identidad y autorizó crear un
proyecto y cliente independientes, sin facturación. Se creó el proyecto
`bold-app-slack-pruebas` («BOLD APP Slack Pruebas»); la consola confirmó que no
tiene una cuenta de facturación vinculada. El usuario aceptó personalmente la
política de datos de Google y creó la configuración de marca OAuth.

Se habilitó Google Drive API y se creó un único cliente «Aplicación web» llamado
«BOLD APP Slack Pruebas local», con el callback local indicado arriba. La app
permanece en estado «Prueba», externa, con `samuel@bold.gt` como único usuario
de prueba. No se publicó la app, no se inició la prueba gratuita y no se
modificaron clientes ni destinos de producción.

El perfil local limita OAuth a Drive mediante
`GOOGLE_WORKSPACE_OAUTH_ALLOWED_SERVICES = ("drive",)` y evita incorporar
consentimientos anteriores con `include_granted_scopes=false`. La ausencia de
esta opción conserva el comportamiento previo de producción. Una configuración
vacía o inválida falla cerrada. Pasaron 40 pruebas del conector/configuración
Google y las 8 comprobaciones aisladas del entorno local.

La descarga automática se interrumpió; el usuario indicó su carpeta personalizada
de descargas y se recuperó allí el JSON correcto, verificando proyecto, cliente
y callback sin imprimir el secreto. Se guardó una copia fuera del repositorio,
con ACL exclusiva para el usuario Windows y SYSTEM. No se creó un cliente
duplicado. Se aprovisionaron dos identidades nuevas en PostgreSQL local con
contraseñas aleatorias propias, sin privilegios administrativos, y se cargó el
cliente cifrado mediante el bootstrap aislado. No se alteró ni desactivó el MFA
administrativo de la aplicación; este aprovisionamiento no usó la interfaz de
Administración ni copió usuarios, sesiones o credenciales de producción.

Se verificaron por HTTP real contra el proxy 5193: inicio de sesión de las dos
cuentas, creación y lectura del canal entre departamentos sintéticos, seguimiento
voluntario, respuesta en hilo 201 y rechazo 403 de edición ajena. El inicio OAuth
real del backend emite exclusivamente `openid email drive` y no incorpora
consentimientos anteriores. Cookies y contraseñas del ensayo se conservan solo
en archivos temporales con ACL restringida, nunca en Git ni en esta documentación.

Registro anterior al consentimiento (superado por la aceptación final indicada abajo):

El backend 8160, PostgreSQL 55432 y frontend 5193 permanecen ligados a localhost
durante el handoff del consentimiento. Una página temporal local permite que
el usuario revise y apruebe Google; el navegador automatizado bloquea abrir su
protocolo local, por lo que ese archivo debe abrirlo manualmente el usuario.
El enlace caduca en diez minutos y no debe publicarse ni subirse a un servidor.
No se ha consentido Google ni configurado aún una raíz Drive activa en esta base.
La aceptación con multimedia del proveedor real y micrófono/cámara físicos
permanece pendiente; las pruebas HTTP de texto no certifican esa integración.

Comprobación posterior mientras se espera el consentimiento:

- Los procesos de PostgreSQL/backend y frontend de staging seguían vivos; no
  se reiniciaron ni se invalidó la sesión OAuth por un timeout de observación.
  SQL confirmó `127.0.0.1:55432`, base `bold_validation`, cero conexiones Google
  autorizadas y cero raíces Drive activas. Por tanto, todavía no existe evidencia
  de una autorización del proveedor ni procede intentar subidas reales.
- Se añadió un caso de regresión para el intento de adjuntar sin destino Drive:
  respuesta 400 explicativa, cero mensajes/adjuntos persistidos, actividad sin
  incrementar y ningún evento publicado. El mismo UUID del borrador permite un
  envío correcto tras preparar el almacenamiento, sin perderlo ni duplicarlo.
- La suite de adjuntos de canales aprobó **8 casos en SQLite (1,505 s)** y los
  mismos **8 en PostgreSQL 18.6 (2,306 s)**. Son ocho escenarios comprobados en
  dos motores, no dieciséis escenarios diferentes. Ambas bases de test se
  eliminaron al terminar; la base persistente de staging se conservó intacta.
- El siguiente paso continúa siendo el consentimiento manual de Google. No
  sustituirlo por tokens de otro conector, clientes de producción ni una raíz
  ficticia para dar por aceptado el ensayo con Drive real.

### Cierre de aceptación local y Drive real — 21 de octubre de 2026

El usuario completó personalmente el consentimiento de Google. Se verificó la
conexión de `samuel@bold.gt` con el cliente independiente del proyecto
`bold-app-slack-pruebas`: únicamente identidad, correo y Drive; sin Calendar,
Gmail, Contacts ni Meet. La carpeta privada de pruebas es ahora la raíz activa
**solo de staging**. Los estados anteriores de consentimiento pendiente son
históricos y no describen el resultado actual.

La aceptación real queda registrada en
[`acceptance-slack-drive-20261021.json`](acceptance-slack-drive-20261021.json):

- Dos cuentas locales nuevas y una sola conexión Google. Ambas publicaron o
  descargaron adjuntos a través de la API real de BOLD; la segunda no necesitó
  un token de Google propio. Los mensajes se enviaron al canal y sus hilos.
- Imagen normalizada y audio válido WebM/Opus, Ogg/Opus y M4A/AAC. Los audios son
  muestras sintéticas de 0,8 segundos, no grabaciones de un micrófono físico.
  Se compararon bytes, digest SHA-256 y MIME de las descargas con cada envío.
- Reintentar con el mismo UUID y los mismos bytes recuperó el mensaje existente
  con 200, sin crear otro archivo para ese marcador. Imagen y WebM se recuperaron
  de los envíos ya confirmados; Ogg y M4A se crearon con 201.
- Descarga de la otra cuenta: 200; sin sesión: 401. Una denegación temporal local
  de `slack.channel.read` produjo 404 para la misma descarga; se retiró esa regla
  de prueba y se comprobó de nuevo el acceso autorizado.
- Metadatos y permisos del proveedor confirmaron acceso privado, sin permisos
  públicos o de dominio, y cinco carpetas bajo la raíz aprobada. No se cambiaron
  permisos remotos ni se usó la unidad de producción «BOLD APP».
- Una interrupción TLS dejó inicialmente un envío sin completar. Se conservó el
  borrador y se reanudó con los mismos bytes y UUID, manteniendo la validación TLS.
  No se desactivaron certificados ni se modificó la política de seguridad para
  conseguir el resultado. El informe final terminó con `accepted: true`.

Regresión final de esta revisión:

- **171 pruebas backend aprobadas en PostgreSQL 18.6 (217,484 s)**, incluidas tres
  pruebas de concurrencia, canales, adjuntos, permisos, tareas, avisos y OAuth.
  El runner eliminó únicamente su base de test; conservó staging.
- **56 pruebas unitarias de Chat/Slack aprobadas**, más los contratos DOM de
  ambos módulos: hilos, permisos, seguimiento/no leídos, tareas, cola multimedia,
  reintentos, entrada a Chat privado y ausencia de sondeo adicional en reposo.
- Suite general frontend: **392 aprobadas, una omitida y cero fallos**. También
  pasaron 21 comprobaciones de sincronización/avisos y siete de actualización PWA.
- Compilación frontend correcta. Las advertencias conocidas de tamaño de chunks
  no equivalen a un fallo ni acreditan rendimiento de producción.
- Navegador con cuentas sintéticas: escritorio claro/oscuro, móvil de 390 y
  320 px y horizontal 844×390, sin desbordamiento horizontal. Se corrigió la
  duplicación de ayuda/novedades/equipo del encabezado móvil de Slack, conservando
  búsqueda y tema. En escritorio siguen disponibles todos los accesos.
- Se corrigió en el arranque del sandbox la importación de `SimpleUploadedFile`;
  el arranque, el proxy local y el inicio de sesión se verificaron nuevamente.
  Este sandbox sigue usando Drive simulado y no las credenciales de staging.

La revisión visual aplicó las pautas pertinentes de UI/UX Pro Max, sin sustituir
el sistema de diseño de BOLD. Capturas finales conservadas fuera de Git en la
carpeta local de evidencias `output/channel-review` de esta conversación.

**Alcance aceptado:** implementación local de canales por departamento, hilos,
tareas con su autorización original, permisos configurables, seguimiento
voluntario, no leídos, eventos del socket existente y adjuntos en Drive real.
La integración con Chat abre una conversación privada independiente.

**Puertas de salida todavía manuales:** grabación con micrófono/cámara físicos,
reproducción en los dispositivos objetivo, teclado móvil real, PWA instalada y
aceptación del equipo. La concurrencia local no certifica escala distribuida en
Redis ni recursos de Oracle/Cloudflare. No se hizo commit, push o despliegue y
no se abrió el piloto fuera de IT. La carpeta de pruebas y sus archivos se
conservan; no se afirma una limpieza de posibles huérfanos remotos.

Nota de parche preparada para la futura apertura, todavía **no publicada**:
«Slack: canales por departamento, conversaciones en hilos, tareas compartidas sin
alterar permisos, imágenes y notas de voz, seguimiento voluntario y no leídos».
Publicar con las tarjetas existentes solo al autorizar la entrega y tras cerrar
la validación del piloto. No hay commit, push ni despliegue de este componente.

### Entrega autorizada del piloto — 21 de octubre de 2026

El usuario autorizó crear el commit en `feature/chat-directo` y desplegar en
Oracle y Cloudflare para que **solo IT** revise el componente. Esta autorización
no abre Chat/Slack a otros departamentos ni publica las notas generales.

La entrega agrupa canales por departamento, hilos, tareas compartidas sin ampliar
sus permisos, seguimiento y avisos voluntarios, no leídos, imágenes/notas de voz,
entrada al Chat privado y reenvío múltiple del Chat ya revisado localmente.
Incluye las migraciones `0005` a `0009` de Mensajería; antes de aplicarlas se
debe crear y validar un dump de PostgreSQL y conservar la configuración anterior.

La referencia de partida comprobada es `3106c44d`, tanto en GitHub como en
Oracle. Se conserva el trabajo de `Develop`, ya incluido en la rama, sin hacer
un merge de lanzamiento allí. Se mantienen los flags de sincronización y la
misma unidad autorizada de IT; no se importan cuentas, contraseñas, tokens,
cliente OAuth ni carpeta Drive del staging a producción.

Las pruebas finales de Worker (7), frontend general (392 aprobadas y una omitida),
sincronización (21) y PWA (7) pasaron antes del commit. Los resultados efectivos
de publicación, versiones, respaldo y aceptación de producción se registrarán
por separado al verificarlos, no se presuponen en esta nota.

## Apertura posterior al piloto

No cambiar `MESSAGING_PILOT_ENABLED` a `false` sin autorización de lanzamiento.
Ese cambio abre el módulo a otras unidades, no concede lectura a administradores:
cada conversación sigue siendo privada para sus dos participantes.
Antes de abrir, publicar notas verificadas con las tarjetas actuales y completar
la aceptación del equipo. Las funciones multimedia preparadas localmente no deben
anunciarse como disponibles en producción antes de desplegarlas y comprobarlas.
