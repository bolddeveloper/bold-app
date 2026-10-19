# Preparación de Sheets para Oracle y Cloudflare

Este documento prepara el despliegue de BOLD. No autoriza ni ejecuta una publicación.

## Arquitectura

El navegador usa el Worker existente para `/api/*` y `/ws/*`. El Worker reenvía las
peticiones al backend mediante el binding privado `BACKEND`. Django y Celery usan
`http://sheets-engine:8010` dentro de Docker; el motor no necesita dominio, puerto
público, Worker adicional ni credenciales de Google.

El motor procesa fórmulas, importaciones y exportaciones XLSX. PostgreSQL conserva
los datos de BOLD y Redis coordina las tareas y la colaboración. Celery y su
planificador deben estar activos para los trabajos de Sheets y la sincronización
con Drive. El Compose actual ejecuta ambos en el servicio `worker`; mantener una
sola instancia del planificador.

La imagen del motor instala las dependencias fijadas en `package-lock.json` y
ejecuta `runtime_check.mjs`: cálculo de fórmula, exportación, reimportación y un
gráfico nativo. Este control básico no sustituye las pruebas completas del módulo.
El backend espera a que el motor responda al healthcheck autenticado al arrancar.

Cloudflare permite dirigir las peticiones a un servicio privado mediante el
[binding VPC existente](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/).
El destino real depende de la configuración del servicio VPC, no del hostname
escrito en la URL del Worker. Verificar que sigue apuntando al backend y su puerto
8000. Las pruebas locales del Worker comprueban el reenvío binario y del handshake
WebSocket; no establecen una conexión real a Cloudflare.

## Configuración que se necesitará

Actualizar el `.env.oracle` existente en el servidor, sin sustituirlo por la
plantilla ni regenerar los secretos actuales:

- Añadir un `SHEETS_ENGINE_TOKEN` aleatorio exclusivo para el motor. Backend,
  Celery y motor reciben el mismo valor desde Compose. Por ejemplo, generar uno
  con `openssl rand -hex 32` y guardarlo únicamente en el archivo privado.
  Compose rechaza un valor ausente o vacío. Nunca subirlo al frontend ni a Git.
- Conservar `SECRET_KEY`, `AUTH_ENCRYPTION_KEY`, las contraseñas de PostgreSQL y
  Redis, sus volúmenes y el token del túnel. Cambiar la clave de cifrado impediría
  leer credenciales de Google ya guardadas.
- Conservar la configuración OAuth guardada en Administración. Como alternativa,
  Compose ahora permite pasar `GOOGLE_WORKSPACE_CLIENT_ID`,
  `GOOGLE_WORKSPACE_CLIENT_SECRET` y `GOOGLE_WORKSPACE_COMPANY_DOMAIN` por entorno.
  El motor no recibe estas variables.
- Alinear `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` y el callback OAuth con el dominio
  público que realmente se use. La plantilla incluye ejemplos de dominio propio
  y del Worker; no son una configuración lista para copiar sin revisar.
  Registrar en Google la URI exacta que termina en
  `/api/v2/workspace/oauth/callback/`, habilitar Drive y comprobar los permisos de
  la cuenta conectada sobre los archivos. Mantener las conexiones existentes.
- Usar un `BOLD_APP_IMAGE_TAG` identificable para backend y motor. Al publicar más
  adelante, construir ambas imágenes desde la misma revisión completa del código.
- Mantener `/api/*`, `/ws/*` y `/health*` fuera de la respuesta SPA de assets.
  El `wrangler.jsonc` actual ya contiene esas rutas; Sheets no requiere otro
  binding público.

Los XLSX tienen un límite de 20 MB en la aplicación. El motor recibe JSON de hasta
40 MB, que puede incluir el XLSX codificado y el documento. No considerar el
límite de archivo una garantía para cualquier combinación de tamaño, fórmulas,
imágenes o tablas dinámicas. Probar un archivo representativo con los recursos y
límites reales de Oracle antes de abrir el servicio a usuarios.

## Comprobaciones locales sin desplegar

Desde la raíz del repositorio:

```sh
docker compose --env-file deploy/oracle/.env.oracle.example -f deploy/oracle/compose.oracle.yaml config --quiet
node --test services/sheets-engine/healthcheck.test.mjs frontend/modulos/core/worker/index.test.js
node services/sheets-engine/runtime_check.mjs
npm --prefix services/sheets-engine test
```

Con el entorno Python del backend activado:

```sh
python backend/manage.py test boldApp.hojas.tests --settings=config.settings_test --noinput
```

En una máquina con Docker Linux disponible, construir las imágenes sin levantar
servicios ni publicar nada:

```sh
docker compose --env-file deploy/oracle/.env.oracle.example -f deploy/oracle/compose.oracle.yaml build sheets-engine backend
```

El entorno Oracle registrado en el runbook es ARM64. Ejecutar la construcción en
esa arquitectura y comprobar su arranque antes de publicar; una prueba local en
Windows con Node no verifica la imagen Linux ARM64. No ejecutar `up`, migraciones
en producción ni `wrangler deploy` durante esta preparación.

## Resultado de esta preparación

Comprobaciones locales del 19 de octubre de 2026:

- Compose válido con la plantilla, sin levantar servicios.
- Ocho pruebas de healthcheck y proxy del Worker aprobadas.
- Prueba básica de fórmulas, XLSX y gráfico nativo aprobada con Node 24 en Windows.
- Tras las correcciones, las 46 pruebas del motor y las 90 del backend de Sheets
  pasan. También pasan las 81 pruebas del frontend de Sheets. Se corrigieron
  lecturas de notas y enlaces desplazadas una columna, nombres de partes de
  imágenes incompatibles con ExcelJS, conservación de filas agrupadas y rangos
  de tablas dinámicas con apóstrofos. Las pruebas ahora usan las propiedades
  reales de ExcelJS, bases y revisiones correctas, y el runtime Node de Univer.
- Las pruebas del backend usan `config.settings_test` para aislar base de datos,
  correo, Redis y credenciales externas, conservando las opciones de SQLite.
- No se construyó la imagen: el daemon Docker Linux local no estaba disponible.
  No se verificaron Oracle ni el túnel real. El usuario confirma que Drive ya
  funciona; estas pruebas locales no vuelven a verificar su conexión externa.

Las comprobaciones locales pasan. Sigue pendiente validar la imagen Linux ARM64
y el entorno publicado antes de declarar Sheets listo para producción. El commit
de preparación contiene infraestructura y controles; no incluye todos los cambios
funcionales pendientes del árbol de trabajo. Integrar y validar esos cambios en
una revisión de entrega antes de usarla para desplegar.

## Verificación posterior, cuando se autorice el despliegue

Antes de migrar, obtener un backup recuperable de PostgreSQL y conservar el archivo
de entorno cifrado o protegido fuera de Git. Revisar todas las migraciones de la
revisión de entrega; no basta con el commit de infraestructura.

Después del arranque autorizado, comprobar motor saludable, backend saludable,
worker activo y conexión de Redis. Desde una sesión normal de BOLD, verificar
acceso al módulo Sheets con sus permisos, importación de un XLSX de prueba,
fórmulas, bloques, gráficos, tablas dinámicas, descarga y reapertura en Excel.
Comprobar dos sesiones editando y el guardado/sincronización con Drive. No usar
archivos de trabajo reales para estas pruebas iniciales.

Para volver atrás, conservar imágenes anteriores de backend y motor y evaluar la
compatibilidad de las migraciones. Restaurar un backup solo con un procedimiento
acordado que contemple los cambios posteriores. No borrar volúmenes ni reemplazar
PostgreSQL con la base SQLite local.
