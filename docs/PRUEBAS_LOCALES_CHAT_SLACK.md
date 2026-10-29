# Pruebas locales de Chat y Slack

La rama `feature/chat-directo` reúne las mejoras funcionales de Chat, canales y
páginas para revisión del equipo. El arranque rápido usa una base SQLite nueva,
cuentas ficticias y Drive simulado. No necesita Docker, acceso a Oracle ni
credenciales de Google. No utilizar esta configuración para publicar un servidor.

## Descargar la rama

Guarde sus cambios pendientes antes de cambiar de rama. Desde su copia del
repositorio, para crear la rama local por primera vez:

```powershell
git fetch origin
git switch --track origin/feature/chat-directo
```

Si ya tiene esa rama local, utilice:

```powershell
git switch feature/chat-directo
git pull --ff-only origin feature/chat-directo
```

Si Git informa de cambios locales o divergencia, deténgase y resuélvalos sin
`reset --hard`. No es necesario fusionar estos cambios con `Develop` para probarlos.

## Preparar dependencias

Se validó con Python 3.12 y Node.js 24. Para audio, FFmpeg y FFprobe deben estar
disponibles en `PATH`. Desde la raíz de un clon sin entorno Python preparado:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Set-Location frontend\modulos\core
npm ci
```

No copie `.env` de producción, bases de datos, sesiones, JSON OAuth, tokens ni
la carpeta privada de pruebas de otra persona. Las dependencias se instalan una
vez por copia; no hace falta repetirlas en cada arranque.

## Iniciar el backend de pruebas

En una terminal nueva, desde la raíz del repositorio:

```powershell
Set-Location backend
$env:MESSAGING_AUTOMATIONS_ENABLED='true'
..\.venv\Scripts\python.exe -m boldApp.mensajeria.channel_validation --history-fixtures --attention-fixtures --task-conversion-fixtures --forward-fixtures
```

El lanzador aplica todas las migraciones a una base temporal, crea proyectos,
secciones y conversaciones de ejemplo y arranca el backend en
`http://127.0.0.1:8159/`. Espere el mensaje `Channel validation ready` y conserve
la ruta `bold-channel-validation-...` que imprime la consola.

Las cuentas son `canal.validacion.alfa@bold.gt`,
`canal.validacion.beta@bold.gt` y, con `--forward-fixtures`,
`canal.validacion.gamma@bold.gt`. La contraseña pública de estas fixtures está
en la constante `PASSWORD` de `backend/boldApp/mensajeria/channel_validation.py`;
no corresponde a las cuentas reales de esos empleados ni debe reutilizarse.
Las dos unidades ficticias permiten comprobar colaboración entre departamentos;
no modifican la lista de IT del servidor de producción.

El trabajador de archivos funciona dentro del lanzador con Drive simulado. Texto
y páginas se guardan en la base temporal, pero los archivos simulados viven en
memoria. Cada arranque crea otra base: no promete conservar una demo entre
reinicios ni validar la integridad de archivos en Google real.

## Iniciar la interfaz

En otra terminal, desde la raíz del repositorio:

```powershell
Set-Location frontend\modulos\core
node node_modules/vite/bin/vite.js --config vite.channel-validation.config.js --configLoader runner
```

Abra `http://127.0.0.1:5192/` e inicie sesión como Alfa. Abra
`http://localhost:5192/` como Beta: los hosts distintos permiten dos sesiones
separadas. Si alguno de esos puertos está ocupado, el lanzador rechaza el
arranque; no cierre procesos ajenos ni cambie el proxy hacia producción.

## Qué probar

1. En Chat o un canal, deje texto y un adjunto pendientes, recargue y recupere el
   borrador expresamente. No debe enviarse solo. En páginas, pruebe deshacer y
   rehacer mientras la otra cuenta escribe.
2. Abra Buscar en el historial, filtre mensajes, páginas y archivos y compruebe
   que un resultado antiguo abre su contexto exacto. Beta no debe encontrar el
   contenido del canal privado de Alfa sin invitación.
3. Pruebe menciones, seguimiento de hilos, guardados, marcas de no leído y
   reacciones. En Perfil y Notificaciones puede cambiar Menciones de Slack;
   seguir un canal y recibir una mención no deben duplicar el aviso.
4. Desde un mensaje, cree una tarea en un proyecto de pruebas. Seleccione varios
   mensajes para preparar una página de acuerdos, revise el contenido y confirme
   el destino. Ninguna acción debe conceder acceso al chat privado de origen.
5. En Páginas, pruebe subpáginas, movimientos, enlaces internos, comentarios por
   bloque, resolución, formato, código y plantillas. Solo el autor puede editar
   o eliminar su comentario.
6. En Archivos y enlaces, filtre el historial y descargue documentos, imágenes o
   audios. Pruebe recuperar un envío y reenviar varios mensajes sin duplicarlos.
   Los documentos permitidos incluyen PDF, TXT, CSV, DOCX, XLSX y PPTX con límites
   de tipo y tamaño. Aquí el almacenamiento sigue siendo simulado.
7. En Automatizaciones, configure un recordatorio, una regla de estado de tarea o
   una página periódica desde una plantilla del mismo canal. Cree en pausa y
   active después de revisar la acción. La otra cuenta no debe ver sus reglas.

## Ejecutar un lote de automatizaciones

El lanzador rápido no arranca Celery ni un planificador de automatizaciones.
Después de activar una regla y alcanzar su fecha, o de cambiar el estado real de
una tarea del proyecto seleccionado, ejecute un lote desde otra terminal situada
en `backend`. Sustituya la ruta por la que imprimió su propio lanzador:

```powershell
$env:BOLD_CHANNEL_VALIDATION_DIR='C:\ruta-temporal\bold-channel-validation-su-identificador'
$env:MESSAGING_AUTOMATIONS_ENABLED='true'
..\.venv\Scripts\python.exe manage.py run_channel_automations --settings=config.settings_channel_validation
```

El comando procesa hasta 25 intentos autorizados; repetirlo no debe duplicar sus
resultados. Actualice el registro y vuelva a Mensajes para ver el resultado. El
canal de eventos en memoria no comparte pistas entre este proceso y el backend.
No use `--watch`: ese modo está reservado al staging persistente autorizado del
mantenedor y rechazará este perfil temporal.

En una página periódica debe crear primero una plantilla del canal y revisar su
versión. Las repeticiones utilizan días de 24 horas UTC, no meses naturales.
Mover una tarjeta de un tablero personal no sustituye el cambio de estado real
de la tarea que observa la regla.

## Pruebas automatizadas y límites

Desde `frontend/modulos/core` puede ejecutar `npm run test:messaging`,
`npm run test:channels-ui`, `npm run test:pages-ui`, `npm run test:history-ui`,
`npm run test:pwa` y `npm run test:notification-sync`. Las revisiones de conversión
tienen además `node tests/task_conversion_ui.mjs` y `node tests/agreements_ui.mjs`.
Desde `backend`, `..\.venv\Scripts\python.exe manage.py test boldApp.mensajeria
--settings=config.settings_test --noinput` usa una base aislada. Sus pruebas de
concurrencia que exigen PostgreSQL no se acreditan con SQLite; véase
`deploy/test_channels_postgres.ps1` para el recorrido separado.

La aceptación funcional web y los resultados están en
`docs/acceptance-functional-web-20261029.json`. El rework visual, los dispositivos
físicos y la topología distribuida Redis/Celery/Beat se revisan aparte. Las notas
de esta ronda siguen en `pendingPilotReleaseNotes`, sin publicarse a todos.

Para probar Drive real, coordine una autorización independiente y una carpeta
privada exclusiva con el mantenedor. No copie sus credenciales ni cambie las
cercas de los comandos de staging para hacerlos aceptar otra configuración.

Cierre ambos procesos con Ctrl+C al terminar. Estos comandos no hacen commit,
merge, deploy ni migraciones de producción.
