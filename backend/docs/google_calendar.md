# Google en BOLD: cliente común y cuentas individuales

## Configuración del dueño

En Administración → Conectores, el dueño sube el JSON original de Google Cloud para un cliente OAuth de **Aplicación web**. El backend admite hasta 64 KB y exige que `web.redirect_uris` incluya exactamente `GOOGLE_WORKSPACE_REDIRECT_URI`. En local: `http://localhost:8000/api/v2/workspace/oauth/callback/`.

El secreto se guarda cifrado con la infraestructura existente de `AUTH_ENCRYPTION_KEY`. Mantén esa clave estable fuera de la base de datos y Git. No se conserva el JSON original ni se devuelve el secreto por API. No hay secretos en Vite. Cambiar la clave de cifrado requiere migrar los datos cifrados.

`GET/PUT/DELETE /api/v2/google/configuration/` exige permisos del dueño. `PUT` recibe multipart, campo `file`. Reemplazar el secreto del mismo cliente conserva conexiones. Cambiar el ID desconecta cuentas anteriores. Eliminar crea una configuración desactivada que impide volver a las variables antiguas; no elimina nada en Google Cloud, Drive o Calendar.

Si nunca se creó una configuración administrada, se conservan `GOOGLE_WORKSPACE_CLIENT_ID` y `GOOGLE_WORKSPACE_CLIENT_SECRET` del servidor. Calendar ya no utiliza `GOOGLE_CALENDAR_*`.

«Verificar conexión» valida configuración y consulta únicamente con la cuenta del dueño conectado. Distingue permisos pendientes, API deshabilitada, reconexión y fallos temporales. Para comprobar Docs, Sheets o Slides necesita un archivo existente accesible del tipo correspondiente; sin archivos muestra estado desconocido, sin crear nada.

## Consentimiento individual

Cada empleado conecta su propia cuenta desde Drive, Calendario o Conectores. El cliente OAuth es común; los tokens cifrados pertenecen a cada usuario BOLD. No se distribuye el token del antiguo calendario compartido.

El botón «Conectar servicios de Google» pide juntos los permisos de Drive/Docs, Calendar, Tasks y Contactos, sin selector. Google puede conceder solo algunos; BOLD valida los realmente concedidos. Se guardan los permisos realmente concedidos. Un token de actualización anterior se conserva solo para el mismo usuario, cuenta Google y cliente. Permisos rechazados permanecen pendientes. En producción, la cuenta Google debe coincidir con el correo empresarial; DEBUG permite `samueloyy@gmail.com`.

Habilitar una API no concede consentimiento ni implementa funciones automáticamente. Los servicios soportados están registrados en `boldApp/workspace/google_config.py`. Consulta la [documentación OAuth oficial](https://developers.google.com/identity/protocols/oauth2/web-server).

Las rutas `/api/v2/calendar/` siguen disponibles. Calendar, Tasks, Contactos, Meet y borradores resuelven exclusivamente `request.user`. Los borradores guardan su conexión y sujeto Google. La limpieza ignora borradores antiguos o desconectados y nunca usa otra cuenta.

## Caché de Drive y Calendario

IndexedDB guarda solo metadatos de vistas visitadas, páginas, sugerencias, cuota, eventos y tareas; nunca documentos, adjuntos, secretos o tokens. La clave incluye usuario BOLD, cargo, cuenta Google, versión y permisos. Primero se confirma la conexión; después se restauran datos persistentes.

Las vistas mantienen contenido con «Actualizando». Se actualizan al entrar, recuperar conexión, volver a la pestaña después de 30 segundos y cada 60 segundos mientras sean visibles. Respuestas de contextos anteriores se ignoran. Modificaciones invalidan consultas relacionadas. Fallos temporales conservan información con «Mostrando datos guardados» y Reintentar.

Caducidad: 24 horas. Límites: 10 MB y 100 consultas; se eliminan las menos usadas recientemente. IndexedDB bloqueado usa memoria. Cierre de sesión, desconexión, cambio de cuenta y pérdida de permisos limpian datos correspondientes. La limpieza de sesión se comunica entre pestañas. No se descarga toda la unidad.

## Migración y pruebas locales

Ejecuta `python manage.py migrate`. Workspace `0004` añade configuración y campos de conexión; `0005` vincula las conexiones personales anteriores al cliente del servidor. Calendar `0003` asocia borradores individuales. La conexión compartida permanece inactiva sin copiar tokens.

Pruebas: `python manage.py test boldApp.workspace boldApp.calendario`; frontend: `npm test` y `npm run build`. Comprueban cifrado, permisos, consentimiento, aislamiento, limpieza, límites y recuperación. Las comprobaciones Google reales serán lecturas o usarán datos de prueba autorizados. Entrega local, sin deploy.
