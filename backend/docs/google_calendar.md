# Google Calendar en Bold: configuración y seguridad

## Qué se implementó

Bold tiene un módulo **Calendario** y una tarjeta **Administración → Conectores → Google Calendar**. El dueño vincula una cuenta; todos los usuarios activos pueden ver y gestionar su calendario principal. Google atribuye las operaciones a esa cuenta y la auditoría de Bold registra qué usuario actuó. El frontend tiene vistas de día, semana, mes y agenda, búsqueda, navegación, eventos de día completo, recurrencias, colores, invitados, recordatorios y Meet. También gestiona **Google Tasks** por fecha en «Todo el día» y busca contactos de la cuenta conectada para sugerir invitados. No sincroniza las tareas propias de Bold ni copia los eventos/contactos a tablas locales.

Django expone estado/OAuth, eventos, borradores Meet, Google Tasks y contactos bajo `/api/v2/calendar/`. Solo el dueño conecta y desconecta. Los demás endpoints exigen sesión activa. El token de actualización se cifra en la base de datos con `AUTH_ENCRYPTION_KEY`; ni ese token ni el secreto OAuth llegan al navegador. Un borrador Meet se elimina al cerrar el formulario; si se abandona, Celery lo revisa cada minuto y lo elimina tras cuatro minutos sin señal (reintenta si Google falla).

## 1. Configuración de Google Cloud

1. Crea o selecciona un proyecto. En **APIs y servicios → Biblioteca**, habilita **Google Calendar API**, **Google Tasks API** y **People API**.
2. En **Google Auth Platform**, configura **Branding** (nombre de Bold, soporte y contacto), **Audience** y **Data Access**. Si la audiencia externa está en modo de prueba, agrega la cuenta que conectará el dueño como usuario de prueba. Fuera de esa lista pueden aplicarse requisitos de publicación/verificación. En modo de prueba, Google puede hacer caducar a los siete días el token de actualización de estos permisos.
3. En **Clients → Create client**, crea un cliente OAuth de tipo **Web application**. Registra la URI de retorno del backend exactamente, incluida la barra final:

   - Local: `http://localhost:8000/api/v2/calendar/oauth/callback/`
   - Oracle: `https://TU-DOMINIO-BACKEND/api/v2/calendar/oauth/callback/`

   Puedes registrar ambas, aunque clientes separados para desarrollo y producción reducen el riesgo. Un `redirect_uri_mismatch` indica que esquema, host, puerto, mayúsculas o barra final no coinciden con `GOOGLE_CALENDAR_REDIRECT_URI`.
4. Copia el **Client ID** y **Client secret** solo al entorno privado del backend. No uses un cliente de escritorio ni una clave de API. El proyecto Cloud no se conecta por sí solo: el dueño aún debe aceptar los permisos en Conectores.

El backend solicita `calendar.events`, `calendar.calendars.readonly`, `tasks`, `contacts.readonly`, `contacts.other.readonly` y `userinfo.email` (véase `backend/boldApp/calendario/views.py`). Si cambian esos permisos, actualiza el consentimiento y reconecta la cuenta.

## 2. Credenciales y rotación obligatoria

El secreto OAuth compartido anteriormente en mensajes debe considerarse **expuesto** aunque se haya borrado del `.env` local. Crea un secreto nuevo (o un cliente web nuevo) en Google Auth Platform, instala solo el nuevo, verifica la conexión y deshabilita/elimina el anterior. Si el código estuvo público, revisa historial remoto, forks, artefactos y despliegues. Borrar una línea no borra las copias ni el historial de Git. No compartas el valor nuevo para pedir ayuda.

`backend/.env` y `deploy/oracle/.env.oracle` están ignorados por Git; sus archivos `.example` son plantillas sin credenciales reales. Mantén también fuera de Git el JSON descargado del cliente y cualquier token. No pongas secretos en `VITE_*`, JavaScript, capturas ni logs. Comprueba `git status --short` y `git diff --cached` antes de publicar; no fuerces `git add -f` sobre un `.env`.

No cambies `AUTH_ENCRYPTION_KEY` de una instalación con datos sin plan de migración: cifra tanto secretos MFA como el token de Google. Perderla obliga a reconectar Google y puede invalidar la verificación MFA existente. `SECRET_KEY` de Django es distinta y también debe permanecer privada.

## 3. Desarrollo local en Windows/PowerShell

1. Copia `backend/.env.example` a `backend/.env`. Rellena `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` **nuevo**, `GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:8000/api/v2/calendar/oauth/callback/`, `FRONTEND_URL` y una `AUTH_ENCRYPTION_KEY` estable. Si ya usas MFA, conserva su clave actual. El archivo `.env` no se carga automáticamente por Django.
2. En `frontend/modulos/core/.env.local`, usa `VITE_USE_REAL_BACKEND=true`; nunca coloques allí el secreto.
3. Desde la raíz del repositorio, carga las variables en la misma terminal y arranca el backend desde `backend`:

   ```powershell
   Get-Content backend/.env | ForEach-Object { if ($_ -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') } }
   Set-Location backend
   ..\.venv\Scripts\python.exe manage.py migrate
   ..\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
   ```

   Ajusta la ruta si tu entorno virtual está en otro lugar. Inicia el frontend con `npm run dev` dentro de `frontend/modulos/core`. Para limpiar borradores Meet en desarrollo, ejecuta `python manage.py cleanup_calendar_drafts` desde `backend` en otra terminal.
4. Entra como dueño y usa **Administración → Conectores → Conectar con Google**. Acepta los permisos con la cuenta elegida. **Verificar estado** actualiza la tarjeta.

## 4. Oracle VM con Docker Compose (implementación actual)

Sigue primero [ORACLE_CLOUD_DEPLOYMENT.md](../../ORACLE_CLOUD_DEPLOYMENT.md) para dominio, HTTPS y servicios. El Compose de `deploy/oracle/compose.oracle.yaml` pasa las variables de Google únicamente a backend/worker, no al frontend. Esta configuración usa un archivo privado en la VM; **no** obtiene secretos automáticamente de OCI Vault.

1. Registra en el cliente OAuth web la URI HTTPS exacta del backend. Configura `FRONTEND_URL` con el origen HTTPS del frontend y agrégalo a `CORS_ALLOWED_ORIGINS`. No uses `localhost` en producción.
2. En la VM, con un usuario autorizado, crea el archivo privado y limita permisos **antes** de introducir valores:

   ```sh
   cd /opt/bold-app/deploy/oracle
   umask 077
   cp .env.oracle.example .env.oracle
   chmod 600 .env.oracle
   nano .env.oracle
   ```

   Rellena `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` nuevo y `GOOGLE_CALENDAR_REDIRECT_URI=https://TU-DOMINIO-BACKEND/api/v2/calendar/oauth/callback/`. Mantén `AUTH_ENCRYPTION_KEY` estable y privada y completa las otras variables requeridas por la plantilla. Solo el usuario que ejecuta Compose debe leer el archivo. No pegues secretos en comandos que queden en el historial, ni copies el `.env.oracle` al repositorio.
3. Verifica permisos y sintaxis sin imprimir valores, y arranca los servicios:

   ```sh
   stat -c '%a %n' .env.oracle
   docker compose --env-file .env.oracle -f compose.oracle.yaml config --quiet
   docker compose --env-file .env.oracle -f compose.oracle.yaml up -d --build
   docker compose --env-file .env.oracle -f compose.oracle.yaml ps
   ```

   El backend aplica migraciones al arrancar. El servicio `worker` ejecuta Celery y la limpieza periódica. Tras cambiar credenciales, recrea backend y worker para que lean las variables nuevas. No compartas `docker compose config` sin `--quiet`, `docker inspect`, volcados de entorno ni logs con tokens.
4. En la web de Oracle, el dueño conecta la cuenta. Verifica la cuenta mostrada, eventos, tareas y contactos. Al desconectar, Bold borra la conexión local e intenta revocar el token; si Google no responde, revoca el acceso también desde la cuenta de Google.

OCI Vault ofrece mejor gestión y rotación de secretos, pero requiere integrar una entrega controlada por IAM; el Compose actual **no** lo hace. Un administrador del host o alguien con acceso a Docker puede inspeccionar las variables de los contenedores.

## Diagnóstico breve

- **«Falta configurar…»**: Django no recibió las tres variables `GOOGLE_CALENDAR_*`; reinicia el proceso tras corregirlas.
- **`redirect_uri_mismatch`**: compara ambas URI carácter por carácter.
- **Cliente OAuth rechazado**: comprueba ID y secreto del mismo cliente web; rota el secreto expuesto.
- **Conecta y luego pide reconectar**: revisa publicación, usuarios de prueba, revocación y `AUTH_ENCRYPTION_KEY`.
- **Calendar funciona pero Tasks/contactos no**: habilita las otras APIs, revisa permisos y reconecta.
- **Meet abandonado no desaparece**: comprueba que el worker esté activo y Google disponible; el borrador caduca tras cuatro minutos sin señal.

Referencias: [OAuth web y URI exacta](https://developers.google.com/identity/protocols/oauth2/web-server), [seguridad OAuth](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), [Calendar API](https://developers.google.com/workspace/calendar/api/quickstart/python), [Tasks API](https://developers.google.com/workspace/tasks/quickstart/python), [People API](https://developers.google.com/people/api/rest), [OCI Secrets](https://docs.oracle.com/en-us/iaas/Content/secret-management/Concepts/manage-secrets.htm).
