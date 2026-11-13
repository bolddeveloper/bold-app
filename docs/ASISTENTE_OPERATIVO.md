# Asistente operativo privado de BOLD

El asistente prepara propuestas privadas y ejecuta exclusivamente la revisión aprobada por el empleado. Codex interpreta texto y devuelve JSON. BOLD conserva la autorización y llama a sus servicios existentes con la sesión y asignación del solicitante. El piloto se activa para departamentos explícitos, inicialmente IT. En Slack, el bot de lectura está disponible para quienes pueden escribir en el canal.

## Activación

1. Respaldar la base de datos del entorno de destino y aplicar las nuevas migraciones `bold_assistant` mediante el procedimiento habitual. No ejecutar contra producción como parte de las pruebas locales.
2. Mantener la configuración de [Soporte BOLD](SOPORTE_BOLD.md), su sesión de ChatGPT en Codex y su worker. Se requiere `BOLD_SUPPORT_ENABLED=true`; no se utiliza una clave de API.
3. Configurar `BOLD_ASSISTANT_ENABLED=true` y `BOLD_ASSISTANT_PILOT_UNIT_IDS=UUID_IT`. Para mantener también Informes restringido a IT, configurar `REPORTS_PILOT_ENABLED=true` y `REPORTS_PILOT_UNIT_IDS=UUID_IT`. Se aceptan varios IDs separados por comas, pero no se añaden departamentos por su nombre. Sin IDs no se concede acceso, tampoco al propietario.
4. Ejecutar `python manage.py run_support_bot --check` y reiniciar los procesos del entorno. El chequeo comprueba configuración y sesión sin inferir ni ejecutar propuestas. En desarrollo el ASGI existente atiende la cola; en producción se mantiene un único servicio de soporte y Redis compartido. No iniciar un segundo servicio local sin necesidad.
5. Acceder con una asignación de IT. Abrir el asistente desde Informes, una tarea o un proyecto, o seleccionar **soportebold · privado** en Chat o Slack. En Slack, la opción **soportebold** inserta la mención para que el bot de lectura responda en el canal o hilo al enviarla. Los clientes antiguos conservan la protección para las menciones al asistente.

Compose transmite las variables de ambos pilotos a los servicios existentes. No crea recursos adicionales de Cloudflare ni habilita facturación API. Desactivar la bandera detiene el acceso y el procesamiento operativo; no elimina solicitudes ni revierte cambios ya aplicados.

## Recorrido y capacidades

La primera inferencia recibe la petición y referencias de contexto, sin contenido adicional de negocio. Presenta las consultas propuestas; el empleado puede refinarlas antes de aprobar su alcance. Después se consultan las fuentes autorizadas y se prepara la segunda revisión, con acciones editables individualmente. Una modificación invalida la aprobación anterior. Las consultas puras terminan sin segunda aprobación.

El catálogo inicial permite buscar, crear y actualizar tareas y proyectos; organizar relaciones tarea-proyecto; definir y avanzar etapas ordinarias; crear y modificar reuniones en calendarios BOLD accesibles y en el calendario principal Google conectado; calcular informes y guardar o compartir sus definiciones. Los IDs de destinos existentes deben proceder de consultas aprobadas. Las referencias entre pasos se resuelven en el servidor. Nombres ambiguos requieren aclaración.

Se mantienen las validaciones y efectos normales del módulo: asignaciones y etapas pueden notificar a sus participantes; compartir un informe comparte su definición, sin conceder acceso a sus datos. Google Calendar envía los avisos correspondientes a invitados. No se permiten eliminaciones, cancelaciones de reuniones, cambios globales de permisos, cuentas, conectores ni excepciones para saltar etapas. Una etapa obligatoria continúa bloqueando la finalización de su tarea.

Los recibos distinguen pasos completados, pendientes, detenidos y de resultado incierto. «Abrir registro» vuelve a consultar el recurso con los permisos actuales dentro del asistente. Cancelar detiene lo pendiente y no revierte operaciones ni invitaciones ya realizadas. Tras iniciar una ejecución, sus recibos se conservan: los pasos pendientes se solicitan expresamente en una nueva petición.

## Autorización y persistencia

Los permisos configurables son `assistant.request.use`, `assistant.request.execute` y `assistant.usage.read`. Los dos primeros tienen un valor personal inicial; las denegaciones explícitas prevalecen. Ninguno sustituye el permiso del módulo afectado. La supervisión de uso requiere permiso y alcance organizativo, y solo entrega agregados: no concede lectura de peticiones privadas.

Las APIs `/api/v2/assistant/requests/` aceptan únicamente la sesión interactiva de BOLD y su protección CSRF. Las aprobaciones quedan fuera de MCP. Se verifican cuenta, asignación, sesión, MFA cuando se exige y permisos al consultar y ejecutar. La aprobación de ejecución pertenece a la sesión original y vence a los quince minutos. Las fuentes se reautorizan al abrir propuestas e historial; si dejaron de estar disponibles se ocultan los datos derivados. Un informe calculado cuyo conjunto cambió requiere volver a preparar la consulta antes de mostrar su respuesta anterior.

Las migraciones conservan solicitudes versionadas, propuestas, aprobaciones, recibos y consumo. Las respuestas de dominio no se duplican en los recibos, que guardan referencias. La interfaz recupera solicitudes por API al abrir o recargar, y recibe indicaciones privadas por los sockets existentes. No ejecuta propuestas al recargar ni utiliza sondeo HTTP periódico.

Los lotes internos compatibles se aplican en una transacción. Se comprueban revisiones y se bloquean destinos locales para impedir sobrescrituras. Los pasos Google tienen recibos independientes, ID de creación estable y condiciones `If-Match` para actualizaciones. Ante una respuesta interrumpida no se reenvía: la conciliación de creaciones comprueba el ID y la marca de operación mediante GET. Una modificación Google de resultado incierto requiere revisión manual; PostgreSQL y Google no comparten transacción.

## Laboratorio y actividad

El laboratorio proyecta las tareas consultadas, estados, carga asignada, proyectos, etapas y cambios de agenda. Una muestra parcial queda identificada. No proyecta productividad, horas ahorradas ni duración futura. La simulación no crea registros de negocio, borradores Google ni invitaciones. Las lecturas Google del asistente tampoco actualizan presencia ni importan reuniones a Informes. Se conservan los registros de autorización de las consultas.

Actividad muestra solicitudes, aprobaciones, estados de acciones, espera, duración de inferencia y tokens comunicados por Codex. Los tokens no comunicados aparecen como desconocidos. No se calcula saldo ni coste monetario. Los límites compartidos con el soporte anterior son una inferencia simultánea, cien intentos diarios globales y veinte por empleado; los refinamientos también consumen. Cada cuenta puede mantener una solicitud activa y cada propuesta admite veinticinco acciones. Los fallos no se reintentan automáticamente.

El dictado solo aparece si el navegador ofrece reconocimiento de voz. Produce texto editable y requiere envío manual. Puede utilizar servicios externos del navegador. No transcribe notas grabadas ni añade una API de pago. Referencias: [SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [Codex no interactivo](https://learn.chatgpt.com/docs/non-interactive-mode), [seguridad de agentes](https://developers.openai.com/api/docs/guides/agent-builder-safety).

## Comprobación local

Desde `backend`, ejecutar `python manage.py test boldApp.asistente.tests --settings=config.settings_test`. La suite usa una base efímera y proveedores simulados; no certifica el consentimiento ni las invitaciones de una cuenta Google real. La prueba PostgreSQL `boldApp.asistente.concurrency_tests.AssistantConcurrencyTests` exige la configuración privada de aceptación local y rechaza bases de aplicación. La prueba `boldApp.asistente.live_tests.LivePlannerTests` solo se activa con `BOLD_ASSISTANT_LIVE_ACCEPTANCE=synthetic-only`; realiza dos llamadas reales a Codex y trabaja exclusivamente con registros sintéticos de la base de tests.

Desde `frontend/modulos/core`, `npm run test:assistant` comprueba menciones privadas, dictado sin envío automático y el recorrido de dos aprobaciones, refinamiento, simulación, recarga y retirada de fuentes en móvil/escritorio y ambos temas. Las notas del piloto están en `release_notes_assistant.js` y se muestran únicamente cuando la asignación tiene acceso al asistente. La nota histórica de Informes también se filtra por su acceso; las de Chat, Slack y Etapas conservan su audiencia.

La ampliación a Docs, Drive, marcas, Sheets, operaciones de Chat/Slack y transcripción de notas grabadas queda para entregas posteriores.
