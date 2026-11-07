# Conexión MCP de BOLD

Implementación preparada para conectar asistentes a la API de BOLD mediante Streamable HTTP y OAuth con PKCE. La activación requiere publicar el backend y el Worker de la misma entrega. Las pruebas locales no acreditan una conexión en producción.

## Preparación

Instalar las dependencias de `backend/requirements.txt` y ejecutar `python manage.py migrate`. Para un despliegue sobre una base existente, guardar y comprobar el respaldo antes de aplicar migraciones.

Configurar el backend con `MCP_ENABLED=true` y `MCP_PUBLIC_ORIGIN` igual al origen público de BOLD, sin barra final. En Oracle las variables se pasan desde `deploy/oracle/.env.oracle` a backend y worker. El Worker debe publicar la ruta adicional de descubrimiento OAuth incluida en esta entrega.

En producción se requiere HTTPS y la caché Redis compartida de MCP; la caché de autenticación conserva su configuración. OAuth limita el cuerpo de solicitudes a 32 KB. Seguir [el procedimiento de producción](../deploy/oracle/MCP_SUPPORT.md) para activar y comprobar MCP y el bot sin mezclar sus identidades ni permisos.

En desarrollo, usar `http://localhost:5174` como origen y mantener Vite y Django activos. Vite reenvía la API y los metadatos OAuth a Django.

El servidor MCP se encuentra en `/api/v2/mcp`. El documento de descubrimiento se encuentra en `/.well-known/oauth-protected-resource/api/v2/mcp`.

## Conectar un cliente

Agregar un servidor MCP remoto con la URL pública completa seguida de `/api/v2/mcp` y autenticación OAuth. El cliente necesita registro dinámico, código de autorización, PKCE S256 y el indicador de recurso de esa misma URL.

Los alcances son `bold.read` y `bold.write`. Solicitar ambos para poder ofrecer escrituras. En la autorización de BOLD se elige una asignación propia y se marca expresamente Permitir cambios. Dejar la casilla sin marcar concede lectura.

Si falta la sesión, la pantalla de autorización permite abrir BOLD en otra pestaña. Después de iniciar sesión, volver y actualizar la pantalla de autorización.

La conexión dura como máximo una hora y vence antes si termina la sesión de BOLD. El cierre de sesión, la revocación, el cambio de credenciales, una cuenta inactiva o una asignación retirada invalidan el acceso. Al vencer, se vuelve a autorizar. Esta versión no emite tokens de renovación.

## Herramientas

- `bold_context` muestra la cuenta y asignación autorizadas.
- `bold_catalog` enumera las operaciones de cada módulo. Con una operación y los identificadores del recurso consulta sus campos mediante OPTIONS.
- `bold_read` ejecuta las consultas GET del catálogo con sus filtros y paginación.
- `bold_write` utiliza las operaciones POST, PUT, PATCH y DELETE del catálogo. El cliente identifica esta herramienta como escritura potencialmente destructiva.

El catálogo se obtiene de las rutas registradas de BOLD. Incluye tareas, proyectos, bandeja, calendario, Docs/Drive, Sheets, Chat, Slack, marcas, perfil, organización, permisos, administración y sugerencias. Inicio reúne consultas de tareas, calendario y bandeja. Informes utiliza las consultas existentes de tareas y administración.

Cada operación recorre las vistas y validaciones normales de la aplicación. Que una operación aparezca en el catálogo no concede acceso. La API comprueba los permisos actuales de la cuenta, su asignación, el recurso y cualquier verificación MFA adicional.

La autenticación, la vinculación de Google, las claves, los tickets de WebSocket y las sesiones de transferencia del teléfono continúan como flujos interactivos. Los archivos de escritura se reciben en memoria mediante multipart y las vistas existentes los suben a Drive. El límite adicional del conector es de 20 MB por conjunto de archivos y 32 MB por petición. Los archivos descargados se devuelven como recursos MCP incorporados a la respuesta.

Conservar los campos de versión y los identificadores de operación requeridos por cada API. Las escrituras se envían una sola vez. Si una respuesta se interrumpe, consultar el estado antes de reintentar.

## Revocación y comprobación

Con una sesión de BOLD, `GET /api/v2/mcp/connections/` lista las conexiones propias. `DELETE /api/v2/mcp/connections/{id}/` revoca una conexión propia. También se puede cerrar la sesión de BOLD que la autorizó.

Pruebas del backend con una base de pruebas aislada

```powershell
$env:DATABASE_URL='sqlite:///:memory:'
python manage.py test boldApp.mcp boldApp.autenticacion.tests --noinput
```

Las comprobaciones incluyen OAuth, PKCE incorrecto, reutilización de códigos, CSRF, consentimiento, revocación, límites de lectura/escritura, permisos y llamadas MCP reales a la API. Las pruebas del Worker comprueban el reenvío del descubrimiento OAuth. Para publicar una nota de Novedades, revisar la nota MCP preparada y ejecutar sus pruebas y la compilación frontend.
