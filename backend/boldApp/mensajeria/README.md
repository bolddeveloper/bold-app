# Mensajería directa de BOLD

Mensajería permite conversaciones persistentes de texto en tiempo real entre dos empleados. Cada empleado puede abrirlas desde el avatar de un compañero en Equipo o desde Mensajería. Cambiar de cargo no cambia la identidad de los participantes ni crea otro chat.

## Privacidad y requisitos

Cada petición necesita una sesión válida y una asignación activa propia. Solo los dos participantes pueden listar, consultar y enviar mensajes en su conversación. No existe una excepción de lectura para el propietario, soporte, administradores o jefaturas. Un tercero obtiene 404 al consultar una conversación ajena. Los modelos no se registran en el administrador de Django.

Esta protección es de acceso en BOLD, no cifrado de extremo a extremo. Quien administra directamente el servidor o la base de datos conserva capacidad técnica de acceder a los datos. El contenido no se copia a notificaciones generales ni al registro de auditoría de permisos. Las respuestas llevan `Cache-Control: private, no-store`; el service worker existente excluye las rutas API y no se añaden mensajes al almacenamiento persistente del navegador.

Una cuenta desactivada, un empleado inactivo o una plaza retirada no permiten usar el chat. Si el interlocutor deja de tener cuenta y plaza activas, el participante restante puede consultar el historial, pero no enviar mensajes nuevos.

## Envío y edición

- Texto Unicode, saltos de línea y emojis, con un máximo de 5.000 caracteres por mensaje.
- Autor derivado de la sesión y la asignación, nunca del cuerpo enviado por el cliente.
- Edición exclusivamente por el autor antes de cumplirse diez minutos desde la creación en el servidor. Editar no amplía ese plazo.
- Versiones para rechazar con 409 una edición basada en contenido obsoleto.
- Identificador de intento generado por el cliente y restricción única para que un reintento del mismo envío no cree otro mensaje. Un contenido distinto con ese identificador produce 409.
- Conversación única por pareja canónica de empleados, respaldada por restricciones de base de datos.
- Páginas de 25 conversaciones y 50 mensajes, con índices y consultas agrupadas de participantes y departamentos.
- Límites aproximados por cuenta mediante el sistema de throttling de Django REST Framework: 120 lecturas, 60 escrituras y 20 aperturas por minuto. No sustituyen el control de abuso distribuido de infraestructura.

El texto se presenta como texto de React, no como HTML. Se resaltan únicamente enlaces HTTP, HTTPS y www.; abrirlos utiliza `noopener noreferrer`. No se descargan previsualizaciones externas en esta entrega.

## Interfaz y tráfico

El panel identifica al interlocutor y muestra su disponibilidad usando el directorio de presencia ya existente. Los mensajes incluyen avatar, nombre, hora, separadores de fecha y marca de edición. Las burbujas no tienen borde exterior gris y utilizan superficies redondeadas y colores de BOLD adaptados al tema claro u oscuro.

El módulo reutiliza el socket autenticado de Core y Notificaciones; no añade polling ni un socket por conversación. Los eventos se publican después de confirmar la transacción y se dirigen exclusivamente a los grupos de los dos empleados. Antes de enviar su contenido, el consumidor vuelve a comprobar sesión, asignación y pertenencia a la conversación. Los errores al publicar no convierten un envío ya guardado en un fallo de la API.

Al conectar se recuperan como máximo cien mensajes entrantes pendientes de confirmación. Tras reconectar, la conversación abierta recarga una página reciente y renueva su cursor; el resto se consulta con Ver mensajes anteriores. El temporizador de quince segundos solo actualiza el plazo visual de edición y no realiza peticiones. Las listas se cargan por páginas y la búsqueda filtra los elementos cargados; no es todavía búsqueda global del historial.

Los estados de un mensaje propio son un anillo gris para guardado en el servidor, dos anillos grises para recibido por la aplicación del destinatario y dos anillos rojos para leído. Solo el destinatario puede confirmar entrega o lectura y el servidor fija las horas. Estar conectado no significa haber leído: la interfaz confirma lectura cuando el pie del mensaje está visible al menos un 80 %, la ventana tiene foco, no está oculta y no hay un panel superpuesto en ese punto. Esto es una confirmación de exposición en pantalla, no una garantía de atención humana.

Las confirmaciones se agrupan durante 180 ms en lotes de hasta cien identificadores, con colas de tamaño limitado, deduplicación y tres intentos automáticos como máximo. Se respeta Retry-After. Una reconexión o un evento de vuelta a Internet permite recuperar los pendientes, sin un bucle permanente de reintentos. Los campos confirmados no retroceden si llegan eventos fuera de orden.

El sondeo preexistente de Notificaciones en Core conserva un intervalo de dos segundos cuando la página está visible y conectada. Es independiente de Mensajería y requiere una revisión de rendimiento separada; no se debe interpretar la ausencia de polling en el chat como ausencia de consultas periódicas en toda la aplicación.

Perfil → Mensajería guarda por cuenta si Enter envía o añade una línea. En el primer modo, Mayús+Enter añade una línea; en el segundo, Ctrl+Enter o ⌘+Enter envía. El botón Enviar permanece disponible. Hasta cargar la preferencia, Enter no envía. Las composiciones de teclados IME tampoco provocan envíos accidentales.

Los borradores permanecen en memoria mientras el módulo siga abierto, incluidos los cambios de conversación. Se conservan ante un fallo de envío, pero se pierden al abandonar el módulo, recargar o cambiar de cuenta/cargo. No se implementa una caché privada persistente ni envío sin conexión.

## Rutas

Todas comienzan en `/api/v2/messaging/`:

| Método y ruta | Función |
| --- | --- |
| GET `conversations/` | Listar chats propios con cursor |
| POST `conversations/` | Abrir o recuperar un chat con `employee_id` |
| GET `conversations/{id}/` | Consultar participantes de un chat propio |
| GET `conversations/{id}/messages/` | Historial paginado; devuelve también `server_now` |
| POST `conversations/{id}/messages/` | Enviar `body` y `client_id` |
| PATCH `conversations/{id}/messages/{message_id}/` | Editar `body` indicando `version` |
| POST `conversations/{id}/receipts/` | Confirmar `delivered` o `read` para hasta cien `message_ids` recibidos |
| GET y PUT `preferences/` | Consultar o guardar `enter_behavior`: `send` o `newline`, exclusivamente de la cuenta actual |

No existen endpoints para borrar mensajes, leer conversaciones de terceros, adjuntar archivos o añadir participantes. Los campos de escritura desconocidos se rechazan.

## Migración y pruebas

`0001_initial` añade las tablas de conversaciones y mensajes y sus restricciones; depende de `boldApp_core.0017_account_connector_delegation`. `0002_messagingpreferences_directmessage_delivered_at_and_more` añade las horas de entrega y lectura, sus restricciones y las preferencias de Enter por cuenta. No modifican cuentas, cargos, políticas ni permisos existentes. Aplicarlas en pruebas no equivale a migrar producción.

Desde `backend`, ejecutar las pruebas con el Python del entorno virtual del repositorio:

```powershell
../.venv/Scripts/python.exe manage.py test boldApp.mensajeria boldApp.notificaciones.tests.test_control --settings=config.settings_test --noinput
../.venv/Scripts/python.exe manage.py makemigrations --check --dry-run --settings=config.settings_test
```

Desde `frontend/modulos/core`:

```powershell
npm run test:messaging
node --test ../perfil/release_notes.test.js
node node_modules/vite/bin/vite.js build --configLoader runner
```

`node tests/messaging_ui.mjs --serve` abre una maqueta funcional local en el puerto 5186, con identidades y mensajes ficticios. `?dark` permite revisar el modo oscuro. Esa maqueta no usa cuentas reales ni envía peticiones a las API de BOLD.

### Prueba con dos sesiones reales aisladas

El sandbox usa únicamente `backend/db.messaging-sandbox.sqlite3`, ignorada por Git, con correo en memoria y sin Redis, Google Drive ni servicios productivos. El lanzador comprueba esa ubicación antes de migrar o crear datos. Sus cuentas y contraseña son fixtures públicas de prueba, nunca credenciales para producción. La desactivación de MFA solo pertenece a esta configuración de pruebas; no se modifica la configuración normal.

Desde backend, preparar la base y comprobar envío, respuesta, historial y propiedad con dos sesiones independientes:

```powershell
../.venv/Scripts/python.exe -m boldApp.mensajeria.sandbox --check
$env:DJANGO_SETTINGS_MODULE='config.settings_messaging_sandbox'
../.venv/Scripts/daphne.exe -b 127.0.0.1 -p 8156 config.asgi:application
```

En otra terminal, desde frontend/modulos/core, iniciar la interfaz real contra ese servidor:

```powershell
$env:VITE_USE_REAL_BACKEND='true'
$env:VITE_API_BASE_URL=''
node node_modules/vite/bin/vite.js --config vite.messaging-test.config.js --configLoader runner
```

Abrir `http://127.0.0.1:5186/` y `http://localhost:5186/` permite dos sesiones por separado gracias a los dominios de cookies distintos. El lanzador muestra los identificadores de Alfa y Beta; la contraseña de fixture está en `sandbox.py`. Comprobar recepción en Inicio como entregado, lectura al abrir y enfocar el chat, respuesta sin recargar, edición propia y preferencia de Enter tras recargar. Cerrar los procesos de prueba al terminar. No utilizar estas instrucciones para un servidor público.

## Próximas entregas

La siguiente entrega puede incorporar reacciones, imágenes y archivos. Mantener la sincronización compartida y no añadir un bucle de consultas por usuario o conversación. Antes de habilitarlo en producción se requiere aplicar sus dos migraciones y verificar el transporte con Redis y las distintas instancias del servidor; el sandbox local utiliza una sola instancia y un canal en memoria.

Después se incorporarán imágenes y archivos. El usuario confirmó como destino la unidad o carpeta corporativa «BOLD APP»: se debe verificar su identificador real y el acceso del conector antes de crear la estructura de Mensajería. Las carpetas y los archivos no se crean en esta entrega. La integración deberá comprobar permisos de conversación también al descargar; una URL o un identificador de Drive nunca serán autorización suficiente. Las personas con acceso directo al destino en Google podrán conservar acceso fuera de BOLD, de acuerdo con sus permisos en Drive.

Audio, carga móvil con QR de corta duración, edición de imágenes, historial multimedia, personalización y previsualización de enlaces corresponden a entregas posteriores. Canales, páginas, plantillas y coedición son componentes separados. Las llamadas quedan fuera de la prioridad actual.
