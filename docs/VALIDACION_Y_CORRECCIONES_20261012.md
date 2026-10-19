# Correcciones y validación — 12 octubre 2026

## Qué se comprobó

Los diez resultados fallidos iniciales no demostraban diez vulnerabilidades: varias pruebas asumían un único tipo de mensaje por WebSocket, omitían campos públicos nuevos o intentaban subir imágenes sin configurar el almacenamiento que ahora exige Drive. Se mantuvieron las restricciones reales y se corrigieron las pruebas para verificar el contrato actual, no para ignorar errores.

- Los mensajes de presencia/control pueden preceder a una notificación o al cierre de la conexión. Las pruebas esperan el evento correspondiente con **un plazo total fijo** y fallan ante mensajes ajenos al protocolo, ausencia de entrega o códigos de cierre incorrectos.
- La caducidad diaria, la inactividad, la revocación y dos pestañas de una misma sesión siguen comprobándose. También se verifica que revocar una sesión no desconecte a los otros clientes.
- `units` y `avatar_url` pertenecen al directorio público autorizado; las pruebas conservan una lista explícita de campos y no aceptan datos privados adicionales.
- Las pruebas de imágenes usan un transporte Drive simulado, pero ejecutan la persistencia y las comprobaciones de acceso reales. Comprueban bytes, rutas protegidas, ausencia de caché pública, aislamiento de capturas y retirada de referencias. Si falta almacenamiento, no queda guardado un perfil o reporte parcial.

## Problemas de ejecución corregidos

### Ráfagas de presencia

Las conexiones simultáneas encolaban comprobaciones completas repetidas en cada cliente. Se agrupan exclusivamente los avisos de presencia durante 150 ms. La revocación, los eventos de permisos y el temporizador de seguridad **no se retrasan ni se agrupan**. La actualización sigue pasando por la comprobación completa antes de enviarse. Se evita enviar notificaciones después de empezar el cierre y se cancela el trabajo pendiente al desconectar.

Una prueba envía 40 avisos y exige una sola actualización, sin invalidación falsa. Las pruebas de 5, 10 y 25 clientes son sintéticas, en ASGI aislado: no equivalen a un benchmark de capacidad pública o de Cloudflare.

### Compatibilidad PostgreSQL

La validación con el motor real encontró errores que SQLite no detectaba:

- Retirar una plaza intentaba bloquear también la relación opcional con la cuenta. Ahora bloquea expresamente la asignación y la plaza, conservando la protección del propietario y los bloqueos por responsabilidades pendientes.
- Las tareas recurrentes intentaban bloquear una unión opcional. Ahora se bloquea la tarea plantilla que protege la generación y deduplicación.
- La edición de marcas compartidas intentaba combinar `DISTINCT` con `FOR UPDATE`. Se bloquea la fila de la marca por separado y se **vuelve a comprobar su visibilidad después de adquirir el bloqueo**; esperar a otro editor no conserva indebidamente una membresía retirada.

La prueba de biblioteca con dos conexiones PostgreSQL verifica tanto el primer guardado simultáneo como actualizaciones posteriores: un guardado devuelve 200, el otro 409 y la versión aumenta una sola vez. Esta prueba se omite en SQLite, porque no implementa el bloqueo de filas requerido.

## Repetir las comprobaciones

Resultado verificado: 322 pruebas Django aprobadas en PostgreSQL aislado; SQLite conserva una omisión explícita de la prueba de bloqueo real. Frontend: 259 aprobadas, una omitida; PWA: 7 aprobadas; Worker: 5 aprobadas. Comprobación de componentes de Marcas y compilación Vite aprobadas. La compilación mantiene la advertencia de tamaño del paquete principal, que no es un fallo de estas comprobaciones.

Desde `backend` en Windows (la carpeta de trabajo es importante para descubrir toda la suite):

```powershell
../.venv/Scripts/python.exe manage.py test --settings=config.settings_test --noinput
../.venv/Scripts/python.exe manage.py makemigrations --check --dry-run --settings=config.settings_test
```

Desde `frontend/modulos/core`:

```text
npm ci
npm test
npm run test:pwa
npm run test:worker
npm run test:brands-ui
npm run build
```

`test:brands-ui` usa jsdom registrado en las dependencias de desarrollo; ya no depende de una carpeta temporal de este computador. Comprueba guardado, bloqueo de envíos duplicados y preservación del formulario ante un conflicto. No sustituye la revisión visual manual.

Para PostgreSQL, crear **una base y un servicio de pruebas independientes**. Usar `BOLD_TEST_DATABASE_URL` y ejecutar `--settings=config.settings_test_postgres`. Esta configuración acepta únicamente la base `bold_validation` en localhost o en un contenedor `bold-validation-*`, y crea `test_bold_validation`; mantiene caché, canales y correo aislados. No usar la base de producción ni sus credenciales. Las pruebas en Oracle se ejecutan en contenedores temporales sin puertos publicados, sin volúmenes de datos reales y en una red independiente; esos contenedores y su base de prueba se eliminan al terminar.

## Despliegue y límites

Respaldar PostgreSQL y verificar el archivo antes de migrar. Conservar una imagen del backend anterior. Actualizar el backend antes de publicar el frontend, porque marcas y bibliotecas requieren las nuevas rutas y tablas. No reiniciar PostgreSQL, Redis ni el túnel como parte de este cambio.

Postmark permanece rechazado por el proveedor. No se cambiaron secretos ni se habilitó envío de correo. Oracle ya tiene un destino de imágenes activo; los tests no necesitan acceder a esa cuenta ni a sus ocho imágenes reales.
