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

## Apertura posterior al piloto

No cambiar `MESSAGING_PILOT_ENABLED` a `false` sin autorización de lanzamiento.
Ese cambio abre el módulo a otras unidades, no concede lectura a administradores:
cada conversación sigue siendo privada para sus dos participantes.
Antes de abrir, publicar notas verificadas con las tarjetas actuales y completar
la aceptación del equipo. Las funciones multimedia preparadas localmente no deben
anunciarse como disponibles en producción antes de desplegarlas y comprobarlas.
