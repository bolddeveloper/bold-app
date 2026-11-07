# MCP y Soporte BOLD en producción

Esta entrega prepara ambos servicios. Un commit o una compilación local no los activa ni verifica el entorno publicado. MCP utiliza la cuenta y los permisos de quien autoriza la conexión. El bot solo recibe lecturas acotadas de BOLD y no utiliza las herramientas de escritura de MCP ni conexiones externas.

## Antes de activar

1. Guardar y comprobar el respaldo de PostgreSQL con el procedimiento existente. Conservar las variables privadas y los volúmenes de la instalación. Las migraciones de MCP y soporte crean tablas; no migran archivos ni eliminan datos.
2. Publicar el backend y el Worker de Cloudflare de la misma revisión. El proxy debe entregar `/api/v2/mcp`, `/api/v2/mcp/oauth/*` y `/.well-known/oauth-*` al backend. Publicar solo el frontend no instala el bot.
3. Mantener `DJANGO_DEBUG=false`, PostgreSQL y Redis compartidos. El MCP limita solicitudes con su caché Redis propia; el bot usa Redis para sus eventos y su comprobación de salud. Las cachés existentes de autenticación no cambian.
4. La configuración privada debe incluir `MCP_PUBLIC_ORIGIN` con el origen HTTPS real del frontend, sin rutas, y `BOLD_SUPPORT_UNIT_ID` con el UUID de un departamento existente. No utilizar los identificadores de las pruebas locales.

Desde la raíz del repositorio, preparar las imágenes:

```bash
docker compose --env-file deploy/oracle/.env.oracle -f deploy/oracle/compose.oracle.yaml --profile support build backend support
```

La imagen normal del backend no contiene Codex. La imagen `support` añade la versión verificada del cliente nativo para la arquitectura de la máquina, sin Node en ejecución. El servicio no publica puertos, ejecuta como usuario sin privilegios y conserva un único volumen privado para su sesión. El código y la imagen no contienen credenciales.

## Conectar la cuenta del bot

Conservar `BOLD_SUPPORT_ENABLED=false` hasta preparar la cuenta. Iniciar sesión directamente en el volumen privado del servicio:

```bash
docker compose --env-file deploy/oracle/.env.oracle -f deploy/oracle/compose.oracle.yaml --profile support run --rm --no-deps support codex -c 'cli_auth_credentials_store="file"' login --device-auth
```

Completar personalmente el código en la página oficial. No pegar contraseñas, códigos o tokens en Slack ni en el repositorio. El volumen debe ser escribible para que el cliente oficial renueve la sesión. No montarlo en backend, Celery, Cloudflare ni otros contenedores. No copiar la carpeta personal completa de Codex.

Esta modalidad usa el plan y los créditos de la cuenta conectada, sin cambiar a facturación API. Para una cuenta gestionada de automatización, revisar su disponibilidad en el workspace antes de provisionarla. El sistema no compra cuentas, créditos ni ampliaciones.

Referencias oficiales: [autenticación en equipos sin navegador](https://learn.chatgpt.com/docs/auth), [autenticación de automatizaciones](https://learn.chatgpt.com/docs/non-interactive-mode), [cuentas de servicio](https://learn.chatgpt.com/docs/enterprise/service-accounts).

## Activar y comprobar

Configurar en el archivo privado, conservando los demás valores de la instalación:

```dotenv
MCP_ENABLED=true
MCP_PUBLIC_ORIGIN=https://ORIGEN_PUBLICO_DE_BOLD
BOLD_SUPPORT_ENABLED=true
BOLD_SUPPORT_UNIT_ID=UUID_DEL_DEPARTAMENTO
BOLD_SUPPORT_MODEL=gpt-6-luna
BOLD_SUPPORT_DAILY_LIMIT=100
BOLD_SUPPORT_USER_DAILY_LIMIT=20
```

Recrear backend y Celery con la nueva revisión; el backend aplica las migraciones en su arranque. Comprobar su salud antes de iniciar soporte:

```bash
docker compose --env-file deploy/oracle/.env.oracle -f deploy/oracle/compose.oracle.yaml up -d backend worker
docker compose --env-file deploy/oracle/.env.oracle -f deploy/oracle/compose.oracle.yaml --profile support run --rm --no-deps support python manage.py run_support_bot --check
docker compose --env-file deploy/oracle/.env.oracle -f deploy/oracle/compose.oracle.yaml --profile support up -d support
docker compose --env-file deploy/oracle/.env.oracle -f deploy/oracle/compose.oracle.yaml --profile support ps
```

`--check` comprueba configuración, departamento, conexión Redis y sesión de ChatGPT sin crear identidad, procesar preguntas ni consumir una inferencia. No demuestra acceso al modelo ni saldo: eso requiere una consulta real. Al iniciar normalmente se configura `soportebold` como cuenta inactiva, sin contraseña utilizable ni permisos propios. La comprobación de salud del contenedor verifica su actividad compartida; no ejecuta modelos.

Verificar después en el entorno público:

- El descubrimiento `/.well-known/oauth-protected-resource/api/v2/mcp` devuelve el recurso HTTPS correcto. Una solicitud MCP sin autorización devuelve 401.
- Un cliente completa OAuth con PKCE mediante una sesión real de BOLD. La autorización de solo lectura impide escrituras. Una conexión con cambios sigue aplicando los permisos actuales de esa persona.
- En un canal de prueba accesible, mencionar a `@soportebold` y pedir un resumen del texto compartido. Comprobar una única respuesta en su hilo y su llegada en vivo a otro dispositivo, sin recargar.
- Comprobar que otra conversación y una tarea sin compartir quedan fuera del contexto. Retirar una publicación o el acceso durante una consulta debe impedir publicar los datos generados con ese contexto.
- Revisar el recibo de la consulta y el uso de la cuenta de Codex. Un fallo no se reintenta automáticamente. Una conexión MCP vence como máximo en una hora y termina antes si vence o se revoca su sesión de BOLD; esta versión requiere volver a autorizar.

El bot termina la consulta actual antes de apagarse por SIGTERM. Compose concede 110 segundos; cada inferencia tiene un máximo de 90 segundos. Tras una interrupción imprevista, los recibos iniciados se cierran sin volver a consumir el modelo.

Para desactivar, volver a `MCP_ENABLED=false` y/o `BOLD_SUPPORT_ENABLED=false`, recrear backend y worker y detener `support`. Conservar volúmenes y tablas; no ejecutar `down -v` ni eliminar datos para revertir.

## Verificaciones reproducibles

```bash
python deploy/check_messaging_environment.py --render
cd backend
python manage.py test boldApp.mcp boldApp.mensajeria.test_support_bot boldApp.tareas.tests.test_team --settings=config.settings_test --noinput
```

Las pruebas de bloqueo necesitan PostgreSQL aislado y `config.settings_test_postgres`; añadir `boldApp.mensajeria.test_support_concurrency` para comprobar que dos procesos no consumen dos inferencias para la misma pregunta. Nunca apuntar esas pruebas a la base desplegada. La validación de Compose lee exclusivamente la plantilla y no inicia contenedores ni certifica una publicación.

### Resultado local del 7 de noviembre de 2026

- 61 pruebas de backend correctas en PostgreSQL 18, incluida la disputa entre dos trabajadores por una consulta.
- 23 pruebas de frontend correctas para menciones, novedades y proxy, más compilación de producción completada.
- Imágenes de soporte compiladas para Linux AMD64 y ARM64; cliente nativo `0.166.0-alpha.6` ejecutado en ambas. Comprobación Django de despliegue ejecutada en ARM64 con configuración ficticia, sin errores.
- Aceptación con `DEBUG=false`, PostgreSQL y Redis aislados: respuesta única, contexto del equipo compartido, evento WebSocket entre servidor y trabajador separados, descubrimiento HTTPS de MCP, lectura autenticada, escritura rechazada para alcance de lectura y comprobación de salud compartida. El modelo de esta aceptación fue simulado; no consumió una inferencia externa.
- Consulta real de Codex en el Slack local de Windows, con respuesta y evento en vivo en 11,55 segundos tras aislar las variables del proceso. Se registraron 9.524 tokens de entrada y 34 de salida.

Estos resultados no certifican el despliegue publicado, la sesión de Codex de Oracle, su acceso al modelo ni su saldo. La aceptación pública sigue siendo un paso de la activación.
