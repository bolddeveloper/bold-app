# Runbook de Oracle Cloud y Cloudflare para Bold

Documento operativo del entorno de prueba publicado el 28 de septiembre de
2026. Complementa `ORACLE_CLOUD_DEPLOYMENT.md`: además de explicar cómo repetir
el despliegue, registra qué quedó instalado, cómo operarlo y cómo crear datos
iniciales de forma segura.

## 1. Resultado actual

- Aplicación pública: <https://boldapp.boldapp-93b.workers.dev>
- Instancia de Oracle: `bold-test`, Ubuntu 24.04 ARM64, 2 OCPU y 12 GB RAM.
- Rama desplegada y operativa: `Develop`.
- Worker de Cloudflare: `boldapp`.
- Versión publicada durante el corte: `49d92140-95a0-4a41-9e69-c1c377a6ce59`.
- VPC Service: `boldapp-backend`.
- Tunnel: `bold-oracle`.
- Base de datos: PostgreSQL 18, migrada desde Render.
- Redis 7 para caché, canales y tareas asíncronas.
- Daphne sirve Django/ASGI y Celery ejecuta trabajos en segundo plano.

No se abrió públicamente ningún puerto de aplicación o base de datos. Oracle
solo mantiene SSH para administración; el tráfico de la aplicación entra por
Cloudflare mediante un túnel saliente.

```text
Navegador
   |
   | HTTPS, mismo origen
   v
Cloudflare Worker (PWA + proxy de /api, /ws y /health)
   |
   v
Cloudflare VPC Service
   |
   v
Cloudflare Tunnel (conexión iniciada desde Oracle)
   |
   v
Red privada de Docker en Oracle
   +-- backend:8000  Django + Daphne
   +-- worker        Celery
   +-- postgres:5432 PostgreSQL 18
   +-- redis:6379    Redis 7
```

La arquitectura de mismo origen evita depender de CORS para el uso normal del
navegador y permite que la cookie de sesión `HttpOnly` funcione también para la
PWA. Los WebSockets atraviesan el mismo Worker y usan un ticket de un solo uso.

## 2. Qué se hizo

1. Se creó la VM ARM64 Always Free en Oracle Cloud.
2. Se configuró una VCN y una subred pública. No se expusieron 80, 443, 8000,
   5432 ni 6379.
3. Se instaló Docker Engine y Docker Compose desde el repositorio oficial.
4. Se clonó el repositorio en `/opt/bold-app` y se seleccionó la rama de
   despliegue.
5. Se creó `/opt/bold-app/deploy/oracle/.env.oracle`, con permisos `600` y
   secretos independientes para Django, MFA, PostgreSQL, Redis y el túnel.
6. Se levantaron `postgres`, `redis`, `backend`, `worker` y `cloudflared` con
   `deploy/oracle/compose.oracle.yaml`.
7. Se exportó PostgreSQL desde Render con `pg_dump` 18 y se restauró en Oracle.
   Después se aplicaron todas las migraciones Django.
8. En Cloudflare se creó el túnel `bold-oracle` y el VPC Service
   `boldapp-backend`, apuntando a `http://backend:8000`.
9. Se añadió el Worker de `frontend/modulos/core/worker/index.js`. Sirve los
   archivos compilados y reenvía `/api/*`, `/ws/*` y `/health*` al VPC Service.
10. Se autorizó Wrangler y se publicó el Worker con
    `npm run deploy:cloudflare`.
11. Se configuró Django para aceptar exclusivamente el origen público de la
    aplicación y se recreó el backend.

No se copiaron contraseñas, tokens ni llaves a Git. Render se mantiene por el
momento como respaldo de reversión, no como dependencia del entorno nuevo.

## 3. Configuración esencial

Los valores reales viven únicamente en `.env.oracle`. El archivo no debe
copiarse a tickets, documentación, capturas ni commits. Las variables clave son:

```text
POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
REDIS_PASSWORD
SECRET_KEY
AUTH_ENCRYPTION_KEY
ALLOWED_HOSTS
CORS_ALLOWED_ORIGINS
FRONTEND_URL
CLOUDFLARE_TUNNEL_TOKEN
EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, DEFAULT_FROM_EMAIL
```

Para este entorno, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` y `FRONTEND_URL`
incluyen `boldapp.boldapp-93b.workers.dev`. Durante la transición también puede
mantenerse temporalmente el origen anterior en la lista de CORS. La seed de demostración permanece
deshabilitada:

```text
SEED_DEMO_ACCOUNTS=false
SEED_PRIVILEGED_DEMO_ACCOUNTS=false
```

`AUTH_ENCRYPTION_KEY` no se debe rotar sin un procedimiento de re-cifrado o
reinicio controlado de MFA. Cambiarla directamente inutiliza los secretos TOTP
ya enrolados. `SECRET_KEY` tampoco debe cambiarse durante una migración sin
planificar la revocación de sesiones y tokens firmados.

### Correo de invitaciones y recuperación

En desarrollo local el valor predeterminado es:

```text
EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend
```

Esto no envía mensajes: imprime el asunto y el enlace en la terminal donde se
ejecuta Django. Es apropiado para desarrollo porque evita entregar tokens de
prueba a buzones reales.

Oracle usa Postmark durante el periodo de prueba. Se verificó solamente la
firma individual `samuel@bold.gt`; no se modificó el DNS, SPF, DKIM ni MX de
`bold.gt`. Postmark debe aprobar la cuenta y retirar `Test mode` antes de poder
entregar mensajes reales a los empleados.

```text
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.postmarkapp.com
EMAIL_PORT=587
EMAIL_USE_TLS=true
EMAIL_USE_SSL=false
EMAIL_HOST_USER=SERVER_API_TOKEN_DE_POSTMARK
EMAIL_HOST_PASSWORD=EL_MISMO_SERVER_API_TOKEN
DEFAULT_FROM_EMAIL=Bold App <samuel@bold.gt>
EMAIL_TIMEOUT=10
```

Postmark permite usar el Server API Token del servidor transaccional como
usuario y contraseña SMTP. Debe guardarse solamente en `.env.oracle` con
permisos `600`, nunca en Git, documentación, capturas o logs. Después de editar
el archivo hay que recrear `backend` y `worker`, ya que Docker Compose carga las
variables al crear el contenedor:

Mientras Postmark mantenga la cuenta en `Test mode`, se puede habilitar de
forma excepcional la creación de empleados con contraseña inicial:

```env
ADMIN_TEMPORARY_PASSWORD_ENABLED=true
```

La opción solo aparece al propietario y la operación exige MFA reciente. La
contraseña queda hasheada, no se incluye en respuestas ni auditoría, y debe
cambiarse en el primer inicio. Una vez aprobado Postmark, cambia el valor a
`false` y recrea `backend` y `worker` para retirar esta vía de contingencia.

```bash
docker compose --env-file .env.oracle -f compose.oracle.yaml up -d \
  --force-recreate backend worker
```

La conexión puede validarse abriendo el backend SMTP sin enviar un mensaje. Una
vez que Postmark apruebe la cuenta, prueba primero contra `samuel@bold.gt` y
confirma recepción, remitente y que el enlace use
`https://boldapp.boldapp-93b.workers.dev`. No copies credenciales SMTP ni tokens
de invitación o recuperación a logs compartidos.

## 4. Operación cotidiana en Oracle

Conectarse desde PowerShell:

```powershell
ssh -i C:\ruta\oracle_bold_test_ed25519 ubuntu@IP_DE_LA_VM
```

Ir al despliegue y definir el comando base:

```bash
cd /opt/bold-app/deploy/oracle
```

Ver estado:

```bash
docker compose --env-file .env.oracle -f compose.oracle.yaml ps
docker compose --env-file .env.oracle -f compose.oracle.yaml logs --tail=100 backend
docker compose --env-file .env.oracle -f compose.oracle.yaml logs --tail=100 cloudflared
```

Actualizar código y recrear servicios:

```bash
cd /opt/bold-app
git fetch origin
git switch Develop
git pull --ff-only
cd deploy/oracle
docker compose --env-file .env.oracle -f compose.oracle.yaml build --pull
docker compose --env-file .env.oracle -f compose.oracle.yaml up -d
docker compose --env-file .env.oracle -f compose.oracle.yaml ps
```

El comando de `backend` ejecuta `python manage.py migrate --noinput` antes de
arrancar Daphne. Aun así, antes de cambios de esquema importantes conviene
hacer un respaldo y revisar el plan de migraciones.

Detener y volver a iniciar sin eliminar volúmenes:

```bash
docker compose --env-file .env.oracle -f compose.oracle.yaml stop
docker compose --env-file .env.oracle -f compose.oracle.yaml start
```

Nunca uses `docker compose down -v`: `-v` elimina los volúmenes persistentes de
PostgreSQL y Redis.

## 5. Publicar una nueva versión del frontend

Desde el equipo de desarrollo:

```powershell
cd C:\Users\TU_USUARIO\Documents\GitHub\bold-app\frontend\modulos\core
npm ci
npm test
npm run test:worker
npm run build
npm run deploy:cloudflare
```

`wrangler.jsonc` enlaza el Worker con el VPC Service. El despliegue imprime una
URL y un Version ID; guárdalos en las notas de la entrega. No pongas secretos en
variables `VITE_*`: Vite las incorpora al JavaScript público.

## 6. Verificación posterior al despliegue

Comprobaciones sin iniciar sesión:

```powershell
curl.exe -I https://boldapp.boldapp-93b.workers.dev/
curl.exe https://boldapp.boldapp-93b.workers.dev/health/
curl.exe https://boldapp.boldapp-93b.workers.dev/api/v2/auth/session/
```

Resultados esperados:

- `/` responde `200` con HTML.
- los archivos JS y CSS indicados en el HTML responden `200`.
- `/health/` responde `status: ok`, `database: true` y `redis: true`.
- una sesión anónima responde `authenticated: false` y entrega un token CSRF.
- una ruta de la SPA, por ejemplo `/administracion`, responde con el HTML de la
  aplicación.
- la pantalla de acceso termina de habilitar sus campos y no muestra errores en
  la consola del navegador.

La prueba autenticada debe incluir: login, enrolamiento/validación MFA, carga de
administración y permisos, creación de una tarea y recepción del evento por
WebSocket. No automatices esa prueba con contraseñas reales almacenadas en un
script o en el historial del shell.

## 7. Crear el primer propietario de forma segura

No insertes una cuenta directamente con SQL. La contraseña de Django requiere
un hash con algoritmo, salt y parámetros; escribir texto en `password_hash`
dejaría una cuenta insegura o inutilizable. Además, un propietario necesita un
empleado, unidad, cargo, plaza y asignación coherentes.

El proyecto incluye `bootstrap_owner`, que crea todo lo anterior dentro de una
transacción, valida el dominio `@bold.gt`, aplica la política de contraseña y se
niega a crear un segundo propietario.

En Oracle:

```bash
cd /opt/bold-app/deploy/oracle
docker compose --env-file .env.oracle -f compose.oracle.yaml exec backend \
  python manage.py bootstrap_owner --email luis@bold.gt --name "Luis"
```

El comando solicita la contraseña dos veces sin mostrarla. No uses la variable
`BOLD_BOOTSTRAP_OWNER_PASSWORD` en operación normal: una entrada interactiva no
queda en el historial del shell. Después:

1. Inicia sesión en la URL pública.
2. Cambia la contraseña si era temporal.
3. Enrola MFA TOTP y guarda los códigos de recuperación fuera del servidor.
4. Comprueba la vista administrativa y el catálogo de permisos.

Estado al redactar este documento: la migración contiene tres cuentas activas
ordinarias (`ana@bold.gt`, `carla@bold.gt` y `david@bold.gt`). El 28 de
septiembre de 2026 se ejecutó `bootstrap_owner` una sola vez para crear a
`luis@bold.gt`, enlazado con el empleado Luis, el cargo Propietario y la plaza
protegida de Dirección. La contraseña aleatoria se entregó únicamente mediante
el portapapeles local y no se guardó en este documento, Git ni el servidor.

## 8. Crear empleados después del propietario

El camino recomendado es el módulo **Administración > Empleados**. Así se
aplican validaciones, auditoría, creación de relaciones organizativas e
invitación/recuperación de contraseña. Flujo sugerido:

1. El propietario crea o selecciona la unidad, cargo y plaza.
2. Crea el empleado y su cuenta `nombre@bold.gt`.
3. El sistema genera una invitación temporal o el usuario usa recuperación de
   contraseña para fijar su secreto.
4. El empleado valida el correo, establece una contraseña propia y enrola MFA.
5. El propietario o una autoridad delegada asigna las políticas necesarias.

Un administrador puede restablecer el acceso o reemplazar una contraseña, pero
nunca consultar la contraseña existente. Para una baja se revocan sesiones y
accesos, se desactiva la cuenta y se reasignan tareas/responsabilidades; no se
hereda la cuenta personal.

## 9. Consultar o corregir datos manualmente

Usa primero la UI o un comando de administración versionado y probado. Para
inspecciones puntuales se puede abrir el shell de Django:

```bash
docker compose --env-file .env.oracle -f compose.oracle.yaml exec backend \
  python manage.py shell
```

Ejemplo de consulta de solo lectura:

```python
from boldApp.core.models import UserAccount

UserAccount.objects.values(
    "email", "is_active", "is_superuser"
).order_by("email")
```

También se puede abrir `psql` para diagnósticos:

```bash
docker compose --env-file .env.oracle -f compose.oracle.yaml exec postgres \
  psql -U boldapp -d boldapp
```

Antes de cualquier escritura manual:

1. crea un respaldo;
2. documenta el motivo y las filas objetivo;
3. usa una transacción;
4. valida las relaciones y restricciones;
5. conserva o genera el evento de auditoría correspondiente.

No actualices mediante SQL contraseñas, MFA, permisos, sesiones, autoridades,
asignaciones activas ni la plaza del propietario. Esos cambios deben pasar por
los servicios Django porque implican hashing, cifrado, revocación, reglas de
negocio y auditoría.

## 10. Respaldo y restauración

Crear un respaldo antes de una actualización:

```bash
cd /opt/bold-app/deploy/oracle
./backup_postgres.sh
```

Guarda una copia cifrada fuera de la VM y prueba periódicamente su restauración
en una base temporal. Un backup que nunca se restauró no es un respaldo
verificado.

Para una exportación manual:

```bash
docker compose --env-file .env.oracle -f compose.oracle.yaml exec -T postgres \
  pg_dump -U boldapp -d boldapp --format=custom --no-owner --no-acl \
  > boldapp-AAAA-MM-DD.dump
```

Nunca subas dumps a Git: contienen información y hashes de credenciales.

## 11. Reversión

Si falla una versión del frontend, Cloudflare permite volver a desplegar una
versión anterior del Worker. Si falla el backend:

1. conserva el último backup de Oracle;
2. vuelve al commit anterior en `/opt/bold-app`;
3. reconstruye y ejecuta `up -d`;
4. valida `/health/` y una sesión anónima;
5. si hubo una migración irreversible, restaura el backup compatible.

Render debe considerarse solo un respaldo temporal. No permitas escrituras en
Oracle y Render simultáneamente: se producirían dos fuentes de verdad
divergentes.

## 12. Pendientes antes de producción

- Restringir SSH de `0.0.0.0/0` a una IP administrativa, VPN o bastion.
- Rotar la credencial de la base de Render, que ya no debe seguir en uso.
- Configurar SMTP/relay de producción y probar recuperación e invitaciones.
- Automatizar backups cifrados, retención, restauración y alertas.
- Añadir monitoreo de disponibilidad, CPU, RAM, disco y expiración de túnel.
- Probar carga y concurrencia con datos no sensibles.
- Definir dominio propio de la aplicación cuando corresponda.
- Confirmar MFA obligatorio para acciones administrativas críticas.
- Revisar logs y auditoría sin almacenar secretos ni datos personales de más.
- Retirar Render solo después de aceptar formalmente Oracle como origen.

No se habilita `SECURE_HSTS_INCLUDE_SUBDOMAINS` ni `preload` sobre
`workers.dev`, porque es un dominio compartido que no controla Bold.
