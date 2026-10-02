# Despliegue de Bold en Oracle Cloud Always Free

Esta guia despliega el backend completo en una VM ARM64 de Oracle y publica el
frontend junto con un proxy de mismo origen en Cloudflare Workers.

## Arquitectura

```text
Usuarios
   |
   +-- https://boldapp.<cuenta>.workers.dev
              |  PWA + proxy /api, /ws y /health
       Cloudflare Worker + VPC Service
              |
       Cloudflare Tunnel (saliente)
              |
       VM ARM64 de Oracle
         +-- Django + Daphne
         +-- Celery
         +-- PostgreSQL 18
         +-- Redis 7
```

Daphne, PostgreSQL y Redis no publican puertos en la VM. `cloudflared` abre una
conexion saliente y alcanza a Daphne por la red privada de Docker.

## 1. Requisitos

- Cuenta de Oracle Cloud con recursos Always Free disponibles.
- Zona DNS `bold.gt` administrada por Cloudflare.
- Repositorio Git accesible desde la VM.
- Una llave SSH guardada en un lugar seguro.
- Si se migraran datos: URL externa de PostgreSQL de Render y una version de
  `pg_dump` igual o posterior a la version del origen.

No uses las contrasenas conocidas de la seed en un servidor accesible desde
Internet. La configuracion de Oracle deshabilita toda seed por defecto.

## 2. Crear la VM en Oracle

1. En Oracle Cloud abre **Compute > Instances > Create instance**.
2. Nombre sugerido: `bold-test`.
3. Elige tu home region. Una region cercana reduce latencia, pero los recursos
   Always Free solo pueden crearse en la region principal de la cuenta.
4. Selecciona Ubuntu 24.04 LTS para ARM64.
5. En Shape selecciona `VM.Standard.A1.Flex`, marcada como Always Free:
   - 2 OCPU.
   - 12 GB de RAM.
6. Usa un boot volume entre 50 y 100 GB, marcado Always Free.
7. Crea una VCN/subred publica y asigna IPv4 publica solo para el acceso SSH
   inicial.
8. Carga tu llave publica SSH o descarga cuidadosamente la llave generada.
9. Crea la instancia y anota su IP publica.

Si Oracle muestra `Out of host capacity`, prueba otro availability domain o
espera disponibilidad. No selecciones una shape de pago por accidente.

### Reglas de red

En la Network Security Group o Security List permite solamente:

```text
Ingress TCP 22 desde TU_IP_PUBLICA/32
Egress  all protocols hacia 0.0.0.0/0
```

No abras `80`, `443`, `8000`, `5432` ni `6379`. Cloudflare Tunnel no los
necesita. Si cambia tu IP administrativa, actualiza primero la regla SSH.

## 3. Entrar y actualizar Ubuntu

Desde PowerShell:

```powershell
ssh -i C:\ruta\llave-oci.key ubuntu@IP_PUBLICA
```

En la VM:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git unattended-upgrades
sudo timedatectl set-timezone UTC
```

## 4. Instalar Docker desde el repositorio oficial

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

cat <<EOF | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Cierra la sesion SSH, vuelve a entrar y verifica:

```bash
docker version
docker compose version
```

Pertenecer al grupo `docker` equivale practicamente a acceso root. No agregues
usuarios que no deban administrar el servidor.

## 5. Descargar el proyecto

```bash
sudo mkdir -p /opt/bold-app
sudo chown "$USER":"$USER" /opt/bold-app
git clone URL_DEL_REPOSITORIO /opt/bold-app
cd /opt/bold-app
git switch Develop
```

Para un repositorio privado, usa una deploy key de solo lectura. No guardes un
token personal dentro de la URL del remote.

## 6. Crear Cloudflare Tunnel

1. En Cloudflare abre **Networking > Tunnels**.
2. Crea un tunnel administrado llamado `bold-oracle`.
3. Selecciona Docker como entorno y copia solamente el token mostrado.
4. En **Workers VPC > Services > Create VPC Service** configura:

   ```text
   Service name: boldapp-backend
   Tunnel: bold-oracle
   Service type: HTTP
   Host: backend
   HTTP port: 8000
   DNS resolver: Use tunnel as resolver
   ```

5. No agregues una politica de Cloudflare Access delante de toda la API: el
   navegador y el WebSocket necesitan alcanzarla. La autenticacion sigue a
   cargo de Bold.
6. Copia el Service ID generado a `frontend/modulos/core/wrangler.jsonc` como
   `vpc_services[0].service_id`. El Worker solo obtiene acceso a ese host y
   puerto; no se publica la red completa ni se abre un puerto en Oracle.

No pegues el token en comandos, tickets o capturas. Se almacenara unicamente en
el archivo de entorno protegido de la VM.

## 7. Configurar secretos

```bash
cd /opt/bold-app/deploy/oracle
cp .env.oracle.example .env.oracle
chmod 600 .env.oracle
```

Genera cuatro valores diferentes. El formato URL-safe evita romper las URLs
internas de PostgreSQL y Redis:

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
python3 -c 'import secrets; print(secrets.token_urlsafe(64))'
python3 -c 'import secrets; print(secrets.token_urlsafe(64))'
```

Edita el archivo con `nano .env.oracle` y asigna valores distintos a:

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `SECRET_KEY`
- `AUTH_ENCRYPTION_KEY`
- `CLOUDFLARE_TUNNEL_TOKEN`

Confirma también:

```text
ALLOWED_HOSTS=backend,boldapp.<cuenta>.workers.dev
CORS_ALLOWED_ORIGINS=https://boldapp.<cuenta>.workers.dev
FRONTEND_URL=https://boldapp.<cuenta>.workers.dev
TRUST_CLOUDFLARE_CONNECTING_IP=true
SEED_DEMO_ACCOUNTS=false
SEED_PRIVILEGED_DEMO_ACCOUNTS=false
```

`AUTH_ENCRYPTION_KEY` cifra secretos MFA existentes. Si ya tienes datos en
Render debes copiar exactamente el valor utilizado allí; cambiarlo impediría
descifrar los enrolamientos TOTP existentes. Conserva también `SECRET_KEY`.
Las sesiones activas pueden revocarse antes del corte por precaucion.

### Correo

La recuperacion de contrasena necesita SMTP real. El entorno de prueba usa
Postmark con una firma de remitente individual verificada, por lo que no
requiere modificar el DNS de `bold.gt`. En `.env.oracle` configura
`smtp.postmarkapp.com`, puerto `587`, TLS y el Server API Token de Postmark como
`EMAIL_HOST_USER` y `EMAIL_HOST_PASSWORD`. El token pertenece al servidor
transaccional, debe guardarse solo en el archivo privado con permisos `600` y
no debe copiarse al repositorio.

Postmark mantiene las cuentas nuevas en `Test mode` hasta completar su revision
manual. La conexion SMTP puede validarse mientras la solicitud esta pendiente,
pero los envios reales deben probarse despues de la aprobacion. Hasta tener un
proveedor configurado puede cambiarse temporalmente a:

```text
EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend
```

En ese modo los enlaces solo aparecen en logs y no llegan al usuario.

## 8. Validar y construir

```bash
cd /opt/bold-app/deploy/oracle
docker compose --env-file .env.oracle -f compose.oracle.yaml config --quiet
docker compose --env-file .env.oracle -f compose.oracle.yaml pull postgres redis cloudflared
docker compose --env-file .env.oracle -f compose.oracle.yaml build --pull
```

No continues si `config --quiet` informa una variable ausente.

## 9. Base de datos

### Opcion A: instalacion vacia

El primer `up` ejecutara automaticamente todas las migraciones. Después de que
el backend quede healthy, crea la unica cuenta propietaria mediante el comando
interactivo, sin habilitar la seed:

```bash
docker compose --env-file .env.oracle -f compose.oracle.yaml exec backend \
  python manage.py bootstrap_owner --email luis@bold.gt --name "Luis"
```

La contrasena se solicita dos veces sin mostrarse en pantalla ni quedar en el
historial del shell. El comando se niega a crear un segundo propietario. Desde
esa cuenta ya puedes crear el resto de empleados con el modulo administrativo.

### Opcion B: migrar PostgreSQL desde Render

Antes del corte, evita cambios de usuarios o pon la aplicacion anterior en
mantenimiento. Confirma primero la version principal de PostgreSQL de origen;
el Compose usa PostgreSQL 18 para coincidir con la base actual de Render.
Desde una maquina con una version de `pg_dump` igual o posterior al origen crea
el dump:

```bash
pg_dump --format=custom --no-owner --no-acl \
  --dbname='URL_EXTERNA_DE_RENDER' > bold-render.dump
```

Transfiere el archivo:

```powershell
scp -i C:\ruta\llave-oci.key .\bold-render.dump `
  ubuntu@IP_PUBLICA:/opt/bold-app/deploy/oracle/
```

En Oracle inicia solo las dependencias y restaura:

```bash
cd /opt/bold-app/deploy/oracle
docker compose --env-file .env.oracle -f compose.oracle.yaml up -d postgres redis
docker compose --env-file .env.oracle -f compose.oracle.yaml exec -T postgres \
  pg_restore --clean --if-exists --no-owner --no-acl \
  --username=boldapp --dbname=boldapp < bold-render.dump
rm -f bold-render.dump
```

Elimina el dump transferido después de verificar la restauracion porque puede
contener datos personales y hashes de contrasena.

## 10. Arrancar el backend

```bash
cd /opt/bold-app/deploy/oracle
docker compose --env-file .env.oracle -f compose.oracle.yaml up -d
docker compose --env-file .env.oracle -f compose.oracle.yaml ps
```

Los cinco servicios deben estar activos y `backend` debe quedar healthy. Antes
de iniciar Daphne, el contenedor web aplica las migraciones. Si una falla,
Daphne no inicia y la politica de reinicio vuelve a intentarlo; revisa los logs
antes de hacer otro despliegue.

Logs sin mostrar el archivo de secretos:

```bash
docker compose --env-file .env.oracle -f compose.oracle.yaml logs \
  --tail=100 backend worker cloudflared
```

Prueba externa:

```bash
curl -i https://boldapp.<cuenta>.workers.dev/health/
```

Respuesta esperada:

```json
{"status":"ok","checks":{"database":true,"redis":true}}
```

## 11. Cloudflare Workers

El Worker sirve `dist` y envia `/api/*`, `/ws/*` y `/health*` al VPC Service.
Esto mantiene las cookies, CSRF y WebSockets en un unico origen y no altera el
DNS ni la pagina estatica de `bold.gt`.

Desde `frontend/modulos/core`:

```bash
npm ci
npm test
npm run test:worker
npm run build
npx wrangler deploy
```

No definas `VITE_API_BASE_URL`: el cliente usa `location.origin`. El backend
real requiere `VITE_USE_REAL_BACKEND=true`. Para conservar las optimizaciones
publicadas el 2 de octubre de 2026, define también los siguientes flags **antes
del build**, no como variables de ejecución del Worker. Primero publica el
backend compatible; de lo contrario, mantén el historial paginado desactivado.

```text
VITE_USE_REAL_BACKEND=true
VITE_PERMISSION_CONTROL_ENABLED=true
VITE_TASK_INCREMENTAL_SYNC=true
VITE_TASK_PAGED_COMMENTS=true
VITE_TASK_RECONCILE_MS=300000
VITE_SYNC_DIAGNOSTICS=true
VITE_APP_VERSION=<commit-del-codigo-compilado>
```

En PowerShell, por ejemplo (desde `frontend/modulos/core`):

```powershell
$env:VITE_USE_REAL_BACKEND='true'
$env:VITE_API_BASE_URL=''
$env:VITE_PERMISSION_CONTROL_ENABLED='true'
$env:VITE_TASK_INCREMENTAL_SYNC='true'
$env:VITE_TASK_PAGED_COMMENTS='true'
$env:VITE_TASK_RECONCILE_MS='300000'
$env:VITE_SYNC_DIAGNOSTICS='true'
$env:VITE_APP_VERSION=(git rev-parse --short=8 HEAD).Trim()
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build fallido: no publicar' }
npx wrangler deploy
```

La lectura anterior de comentarios sigue disponible para revertir el flag.
Consulta `VERIFICACION_HISTORIAL_PAGINADO.md` y
`VERIFICACION_CONEXIONES_FASE_5.md` para pruebas, límites y reversión. Sin estos
flags, un build posterior puede volver al comportamiento anterior aunque el
backend esté actualizado. Diagnósticos son agregados locales, no un servicio
externo de telemetría; pueden desactivarse una vez terminada la medición.

La primera publicacion asigna una direccion estable bajo `workers.dev`. Anotala
y actualiza `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` y `FRONTEND_URL` en Oracle;
despues recrea `backend` y `worker`. Si mas adelante se agrega un dominio
propio, haz el cambio en una ventana de mantenimiento y conserva mismo origen.

El entorno de prueba configurado en esta guia usa actualmente
`https://boldapp.boldapp-93b.workers.dev`.

## 12. Lista de comprobacion funcional

Desde una ventana privada:

1. Abre `https://boldapp.<cuenta>.workers.dev`.
2. Inicia sesion y comprueba la cookie `bold_session`: `Secure`, `HttpOnly`,
   `SameSite=Lax`.
3. Ejecuta una operacion POST o PATCH para comprobar CSRF/CORS.
4. Confirma una conexion `wss://boldapp.<cuenta>.workers.dev/ws/...` con estado 101.
5. Prueba MFA, recuperacion de contrasena y cierre remoto de sesiones.
6. Crea una tarea y confirma la actualizacion en otro navegador.
7. Si usas webhooks, comprueba que Celery procese y reintente entregas.
8. Revisa que auditoria muestre la IP del cliente, no una IP `172.x` de Docker.

Observa recursos durante la prueba:

```bash
docker stats
free -h
df -h
```

## 13. Backups

Prueba manualmente el script incluido:

```bash
cd /opt/bold-app/deploy/oracle
chmod 700 backup_postgres.sh
./backup_postgres.sh
ls -lh backups/
```

Conserva por defecto 14 dias. Para programarlo diariamente a las 02:30 UTC:

```bash
sudo crontab -e
```

Agrega:

```cron
30 2 * * * BACKUP_RETENTION_DAYS=14 /opt/bold-app/deploy/oracle/backup_postgres.sh >> /var/log/bold-backup.log 2>&1
```

Los dumps en el mismo boot volume no protegen contra perdida total de la VM.
Configura además una politica de backup del boot volume en Oracle y descarga
periodicamente un dump cifrado fuera de la instancia.

Para probar restauracion usa una base o VM separada. No ejecutes `pg_restore
--clean` sobre el entorno activo sin mantenimiento y un backup verificado.

## 14. Actualizaciones

**Despliegue de prueba actualizado el 2 de octubre de 2026:** durante la optimización del
tráfico, Oracle está temporalmente en `perf/sincronizacion-trafico`, fuentes
`11961822` (fase 4 y limpieza de contexto; imagen backend basada en `8259da57`,
sin diferencias de backend entre ambos commits), no en
Develop. Develop no se fusionó ni modificó. No aplicar la receta
de retorno a Develop hasta integrar y validar esta entrega; cambiar la rama y
reconstruir ahora volvería a una versión anterior. Estado, pruebas y reversión en
`PLAN_OPTIMIZACION_SINCRONIZACION.md`, secciones 13–15. La sincronización
incremental requiere el backend compatible antes del frontend; para volver a
fase 2, revertir primero el cliente como indica la sección 14 del plan.

El clon remoto está limitado por defecto al fetch de Develop. Para actualizar
la rama de prueba (sin upstream) mientras dure esta etapa:

```bash
cd /opt/bold-app
git status --short  # detenerse si hay cambios ajenos
git fetch origin refs/heads/perf/sincronizacion-trafico:refs/remotes/origin/perf/sincronizacion-trafico
git switch perf/sincronizacion-trafico
git merge --ff-only origin/perf/sincronizacion-trafico
```

Después siguen el respaldo, build y `up -d` indicados abajo. La receta habitual
para cuando la entrega esté integrada en Develop es:

```bash
cd /opt/bold-app
git fetch origin
git switch Develop
git pull --ff-only
cd deploy/oracle
./backup_postgres.sh
docker compose --env-file .env.oracle -f compose.oracle.yaml build --pull
docker compose --env-file .env.oracle -f compose.oracle.yaml up -d
docker compose --env-file .env.oracle -f compose.oracle.yaml ps
```

El backend aplica migraciones antes de arrancar Daphne y el worker espera a que
el healthcheck sea satisfactorio. Revisa logs después de cada actualizacion.

## 15. Operacion y recuperacion

```bash
# Estado
docker compose --env-file .env.oracle -f compose.oracle.yaml ps

# Logs recientes
docker compose --env-file .env.oracle -f compose.oracle.yaml logs --tail=200

# Reiniciar solo Daphne
docker compose --env-file .env.oracle -f compose.oracle.yaml restart backend

# Detener sin borrar datos
docker compose --env-file .env.oracle -f compose.oracle.yaml down

# Volver a iniciar
docker compose --env-file .env.oracle -f compose.oracle.yaml up -d
```

No ejecutes `down -v`: la opcion `-v` elimina los volumenes de PostgreSQL y
Redis. Tampoco borres `/var/lib/docker`.

Si Cloudflare falla, revisa `cloudflared`, luego `backend`, y finalmente
`postgres`/`redis`. No cambies la cookie a `SameSite=None` para ocultar errores
de DNS, certificado, CORS o tunnel.

## 16. Endurecimiento antes de produccion

Este montaje es adecuado para pruebas controladas, pero sigue siendo una sola
VM. Antes de produccion:

- mueve PostgreSQL a un servicio administrado con backups y PITR;
- usa un gestor de secretos en lugar de un archivo local;
- agrega monitoreo y alertas externas para `/health/`;
- prueba restauraciones de base de datos;
- rota token del tunnel y secretos después de cualquier exposicion;
- activa MFA obligatorio solo tras enrolar a todas las cuentas;
- revisa actualizaciones de imagenes y dependencias periodicamente;
- manten una estrategia para el posible reclaim de una instancia Always Free.
