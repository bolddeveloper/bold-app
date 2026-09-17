# Módulo de autenticación

`boldApp.autenticacion` gestiona credenciales, sesiones, MFA, recuperación y tickets WebSocket. `UserAccount` permanece en Core para conservar el `AUTH_USER_MODEL` y su vínculo estable con `Employee`.

## Seguridad y sesiones

- La PWA usa una cookie opaca `HttpOnly`; el valor real nunca se guarda en la base, solo SHA-256.
- Toda sesión vence en la siguiente ocurrencia de las 07:00 en `America/Guatemala`.
- `AUTH_SESSION_IDLE_SECONDS=0` mantiene deshabilitada la expiración por inactividad. Un valor positivo la activa sin superar el corte diario.
- El frontend obtiene un token CSRF no secreto desde `GET /api/v2/auth/session/`; la credencial de sesión permanece inaccesible a JavaScript.
- Cambiar o recuperar la contraseña incrementa `credentials_version` y revoca todas las sesiones.
- Los tickets WebSocket viven en Redis, duran 45 segundos por defecto y se consumen con `GETDEL`.

## Tablas

- `auth_sessions`: sesiones por dispositivo, expiración y revocación.
- `auth_events`: auditoría append-only de seguridad.
- `auth_challenges`: invitación, recuperación y verificación de correo.
- `auth_mfa_methods`: TOTP hoy y estructura para WebAuthn posteriormente.
- `auth_recovery_codes`: códigos protegidos con HMAC, agrupados y de un solo uso.

`user_accounts` agrega `email_verified_at`, `password_changed_at`, `must_change_password`, `credentials_version` y `deactivated_at`, además de restricciones para correo corporativo `@bold.gt` y unicidad sin distinguir mayúsculas.

## Endpoints implementados

```text
GET  /api/v2/auth/session/
POST /api/v2/auth/login/
POST /api/v2/auth/mfa/verify/
POST /api/v2/auth/logout/
GET  /api/v2/auth/sessions/
POST /api/v2/auth/password/change/
POST /api/v2/auth/password/reset/request/
POST /api/v2/auth/password/reset/confirm/
POST /api/v2/auth/mfa/totp/setup/
POST /api/v2/auth/mfa/totp/confirm/
POST /api/v2/auth/mfa/disable/
POST /api/v2/auth/websocket-ticket/
```

El login requiere CSRF incluso antes de autenticar. Recuperación responde igual exista o no la cuenta. TOTP impide reutilizar incluso el contador usado durante el enrolamiento y los códigos de recuperación se muestran una sola vez. Cuando `AUTH_MFA_REQUIRED=true`, la API y el frontend bloquean el resto de la aplicación hasta completar el enrolamiento. Desde el menú del perfil se puede configurar, probar o desactivar MFA; desactivarlo exige contraseña y un segundo factor, elimina los códigos pendientes y revoca todas las sesiones.

## Variables

Consulta `.env.example`. En producción son imprescindibles HTTPS, `SECRET_KEY`, `AUTH_ENCRYPTION_KEY`, Redis y orígenes CORS/CSRF exactos. `AUTH_NUM_PROXIES=1` corresponde al proxy de Render y evita confiar ciegamente en `X-Forwarded-For` para el throttling.

Mientras frontend y backend de Render sean sitios distintos se usa `AUTH_SESSION_COOKIE_SAMESITE=None`. Algunos navegadores bloquean cookies de terceros aun con esa opción, por lo que el despliegue final fiable debe usar dominios propios del mismo sitio (por ejemplo `app.bold.gt` y `api.bold.gt`) y volver a `Lax`.

Para introducir MFA en cuentas existentes, primero se despliega con `AUTH_MFA_REQUIRED=false`, se valida el flujo y después se activa la variable. Las cuentas sin método configurado recibirán el asistente de enrolamiento antes de acceder a los módulos.

## Operaciones pendientes del módulo Administrativo

La API ya permite que un administrador con una sesión verificada por MFA asigne una contraseña temporal sin verla posteriormente; obliga al empleado a reemplazarla y revoca sus sesiones. La interfaz administrativa, creación de cuentas, invitaciones, restablecimiento de MFA, baja de empleados y transferencia de responsabilidades se implementarán en Administrativo usando estos servicios. Una cuenta nunca debe reasignarse a otra persona.

## Desarrollo

La seed incluye `samuel@bold.gt` con contraseña inicial `bolddemo123` y una asignación activa en Marketing. La contraseña solo se establece al crear la cuenta: volver a ejecutar la seed no sobrescribe cambios posteriores ni elimina su MFA.

```powershell
cd backend
..\.venv\Scripts\python.exe manage.py migrate
..\.venv\Scripts\python.exe manage.py seed_demo_data
..\.venv\Scripts\python.exe manage.py test boldApp.autenticacion
```
