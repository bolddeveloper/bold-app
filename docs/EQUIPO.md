# Equipo

`Tareas > Equipo` permite consultar el trabajo publicado por integrantes activos de la empresa. Su acceso está en la barra lateral, debajo de Mis tareas y antes de Workspace. Tiene un espacio propio y no aparece como pestaña dentro de Mis tareas ni de proyectos.

## Publicación

- Los ojos individuales de Mis tareas funcionan en lista y tablero. El control para compartir varias tareas está en las etapas del pipeline Personal, dentro de Estados; actúa sobre las tareas mostradas en cada etapa. Las secciones de Tareas y las etapas de proyectos no incluyen ese control. Las tareas nuevas empiezan ocultas.
- Creador, responsable o colaborador con acceso vigente pueden publicar una tarea en su propio perfil. La publicación de otra persona permanece independiente.
- Las subtareas accesibles heredan la publicación de su tarea principal. Su ojo indica esa herencia y no permite ocultarlas individualmente.
- El perfil es único por empleado; combina publicaciones de sus asignaciones activas. El tablero muestra el nombre del pipeline personal y agrupa las tareas publicadas por sus etapas actuales, con sus nombres y orden. Solo aparecen etapas con tareas compartidas.
- Cada etapa conserva las tarjetas apiladas verticalmente, incluso cuando solo existe una sección. El tablero contiene su propio desplazamiento y respeta movimiento reducido.
- Equipo muestra tarjetas, detalles, imágenes, adjuntos y subtareas en modo lectura. No solicita ni devuelve comentarios o imágenes de comentarios.

## Agenda

Compartir la agenda requiere activar el interruptor personal «Compartir agenda» en Calendario. No aparece dentro de Equipo. Las fichas incluyen solamente nombre, inicio y fin. Las reuniones privadas se muestran como «Ocupado». Se reutiliza `meeting_window` para excluir eventos cancelados, rechazados, transparentes, borradores y tareas reflejadas. La consulta expande recurrencias y usa la zona horaria de la conexión de Calendario.

Una agenda oculta o desconectada no indica disponibilidad. Las respuestas de agenda se guardan durante 60 segundos en el servidor; cada consulta comprueba antes el consentimiento y la conexión actuales. Las respuestas HTTP de Equipo no se almacenan en caché.

## Servidor

Aplicar la migración `boldApp_tareas.0015_teamprofile_teamtaskshare` antes de servir la nueva versión. Las preferencias iniciales no publican contenido.

Rutas bajo `/api/v2/my-team/`:

- `self/`: GET de preferencias/publicaciones propias; PUT `{task_ids, visible}` atómico; PATCH `{share_calendar}`.
- `directory/`: GET de unidades existentes e integrantes activos, sin funciones administrativas.
- `<employee_id>/board/`: GET de tablero, secciones y tareas publicadas.
- `<employee_id>/tasks/<task_id>/`: GET de detalle y descendientes accesibles.
- `<employee_id>/tasks/<task_id>/voice-note/?note=<note_id>`: GET de audio autorizado.
- `<employee_id>/meetings/?date=YYYY-MM-DD`: GET de fichas mínimas de reuniones.

Todas requieren una asignación activa propia. La lectura vuelve a comprobar participación y acceso del publicador. Publicar no amplía permisos de escritura, proyectos, comentarios ni otros recursos. El acceso adicional a imágenes se limita a descripciones y adjuntos de tareas compartidas. La interfaz cancela consultas anteriores al cambiar de persona o fecha y actualiza los perfiles cada 30 segundos mientras la ventana está visible.

## Comprobación

- Servidor: `manage.py test boldApp.tareas.tests.test_team boldApp.tareas.tests.test_personal_board boldApp.tareas.tests.test_task_features boldApp.workspace.test_image_storage boldApp.calendario.tests.test_calendar`.
- Frontend, desde `frontend/modulos/core`: `node --test ../tareas/src/team_sharing.test.js ../tareas/src/services/task_models.test.js` y `node tests/team_ui.mjs`. La prueba DOM usa la instalación local de jsdom compartida por las demás comprobaciones UI.
- Comprobación visual con los componentes reales y respuestas simuladas: 375, 768, 1024 y 1440 px; nombres largos, tablero con secciones, detalle, reuniones y ausencia de desbordamiento horizontal de página.
