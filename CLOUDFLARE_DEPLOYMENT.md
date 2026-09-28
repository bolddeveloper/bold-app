# Despliegue de prueba con Cloudflare

## Arquitectura recomendada

- `app.bold.gt`: PWA estatica en Cloudflare Pages.
- `api.bold.gt`: proxy DNS de Cloudflare hacia el servicio ASGI de Render.
- Render: Django/Daphne, Celery, PostgreSQL y Redis/Key Value.

Pages no ejecuta directamente Django, Celery ni las conexiones persistentes a
PostgreSQL/Redis. Esta separacion mantiene el backend actual y coloca el
frontend y el dominio publico delante de la red de Cloudflare.

Para evitar una interrupcion durante el cambio, crea primero el proyecto de
Pages y asignale `app.bold.gt`; despues configura `api.bold.gt`, actualiza las
variables de Render y prueba el flujo completo. `render.yaml` ya no declara el
Static Site anterior: si Render propone eliminarlo al sincronizar el Blueprint,
pospon esa eliminacion hasta que la PWA de Pages haya quedado verificada.

## 1. Preparar el backend en Render

1. Cuando el proyecto inicial de Pages ya exista, sincroniza el Blueprint de
   `render.yaml` y confirma los cuatro recursos dinamicos. No elimines todavia
   el Static Site anterior si lo necesitas como referencia durante el cambio.
2. Comprueba que las migraciones terminen antes de que arranque Daphne.
3. En el servicio `bold-app-backend`, agrega `api.bold.gt` en
   **Settings > Custom Domains**.
4. Conserva temporalmente el hostname `*.onrender.com`; sirve para diagnostico
   y ya esta incluido en `ALLOWED_HOSTS`.
5. Verifica estas variables en el servicio web:

   ```text
   DJANGO_DEBUG=false
   ALLOWED_HOSTS=api.bold.gt,bold-app-backend.onrender.com
   CORS_ALLOWED_ORIGINS=https://app.bold.gt
   FRONTEND_URL=https://app.bold.gt
   AUTH_SESSION_COOKIE_SAMESITE=Lax
   AUTH_NUM_PROXIES=1
   AUTH_MFA_REQUIRED=false
   ```

   `SECRET_KEY` y `AUTH_ENCRYPTION_KEY` deben ser valores distintos, aleatorios
   y administrados como secretos de Render. No deben entrar al repositorio.
   Activa `AUTH_MFA_REQUIRED=true` solamente despues de enrolar las cuentas que
   participaran en la prueba.

6. El worker debe compartir `SECRET_KEY`, `AUTH_ENCRYPTION_KEY`, `DATABASE_URL`
   y `REDIS_URL` con el servicio web. El Blueprint ya expresa esta relacion.

## 2. Conectar `api.bold.gt` en Cloudflare

1. En **DNS > Records**, crea un CNAME `api` que apunte al hostname real
   `bold-app-backend.onrender.com` (o al nombre que Render haya asignado).
2. Empieza con **Proxy status: DNS only** hasta que Render verifique el dominio
   y emita su certificado.
3. Cuando Render muestre el dominio verificado, cambia el registro a
   **Proxied**.
4. En **SSL/TLS**, utiliza **Full (strict)** una vez que el certificado de
   Render este activo. Nunca uses Flexible.
5. En **Network**, deja WebSockets habilitado.
6. Crea una regla de cache para el hostname `api.bold.gt` con accion
   **Bypass cache**. Las respuestas autenticadas y los tickets WebSocket no se
   deben almacenar en el edge.

No agregues una regla que reescriba `/api` desde Pages: el frontend ya consume
la URL exacta indicada por `VITE_API_BASE_URL` y los tickets abren `wss` contra
el mismo dominio de API.

## 3. Crear el proyecto de Cloudflare Pages

En **Workers & Pages > Create > Pages > Connect to Git**, conecta este
repositorio y configura:

```text
Production branch: Develop
Root directory: frontend/modulos/core
Build command: npm ci && npm run build
Build output directory: dist
```

Agrega como variables de produccion:

```text
VITE_USE_REAL_BACKEND=true
VITE_API_BASE_URL=https://api.bold.gt
```

No agregues secretos como `SECRET_KEY`, contraseñas, tokens o URLs privadas de
base de datos: las variables `VITE_*` quedan incorporadas en el JavaScript que
descarga el navegador.

Pages reconoce esta aplicacion como SPA porque el build contiene `index.html`
y no contiene un `404.html`; no hace falta un `_redirects` global. El archivo
`public/_headers` agrega cabeceras defensivas y evita servir un service worker
obsoleto.

Tras el primer build, agrega `app.bold.gt` en **Custom domains** del proyecto de
Pages. Usa el dominio personalizado para las pruebas autenticadas. Los previews
`*.pages.dev` son otro sitio y, con la cookie `SameSite=Lax`, deliberadamente no
deben iniciar sesion contra la API de produccion.

## 4. Comprobacion previa a usuarios

Ejecuta localmente, sin levantar servidores:

```powershell
Set-Location frontend/modulos/core
npm ci
npm test
npm run build

Set-Location ../../../backend
..\.venv\Scripts\python.exe manage.py check --deploy
..\.venv\Scripts\python.exe manage.py test
```

Luego verifica desde una ventana privada del navegador:

1. `https://app.bold.gt` carga y el manifiesto permite instalar la PWA.
2. El login devuelve cookie `bold_session` con `Secure`, `HttpOnly` y
   `SameSite=Lax`.
3. Las operaciones POST/PATCH/DELETE no presentan errores CSRF o CORS.
4. La pestaña Network muestra una conexion `wss://api.bold.gt/ws/...` con
   estado `101 Switching Protocols`.
5. Cerrar una sesion desde Administracion desconecta esa cuenta sin esperar el
   corte diario.
6. Recuperacion, enrolamiento MFA y confirmacion MFA funcionan por HTTPS.

## 5. Prueba concurrente

Cloudflare Pages no sera normalmente el cuello de botella. Mide por separado:

- login y recuperacion (respetando los limites antiabuso existentes);
- listados y cambios de tareas;
- conexiones WebSocket simultaneas;
- operaciones administrativas y de permisos;
- entrega y reintentos de webhooks por Celery.

No uses cuentas reales ni correos sensibles en la primera corrida. Comienza con
5 usuarios, continua con 15 y despues con el objetivo real, observando latencia,
errores HTTP, memoria/CPU, conexiones de PostgreSQL, cola de Celery y Redis.

El nivel gratuito de Render sirve para una demostracion, pero no para evaluar
fiabilidad: el web service puede suspenderse, PostgreSQL gratuito expira y no
tiene backups, Redis gratuito puede perder su contenido tras un reinicio y el
web service gratuito no escala. Para una prueba concurrente representativa,
usa al menos recursos persistentes y un servicio web de pago durante la ventana
de prueba.

## 6. Reversion

Si el cambio de dominio falla, deja `api.bold.gt` como **DNS only** o vuelve a
usar temporalmente el hostname `*.onrender.com`. No cambies cookies a
`SameSite=None` para ocultar un problema de DNS/CORS: revisa primero
`ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, el certificado y la URL compilada en
Pages.
