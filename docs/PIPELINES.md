# Pipelines y Estados

La pestaña **Estados** está disponible en Mis tareas y en proyectos. Equipo conserva su consulta de solo lectura.

## Organización

Cada persona tiene un pipeline personal. En Mis tareas, Personal incluye sus tareas creadas, asignadas o seguidas. Elegir un proyecto limita el tablero a sus tareas de ese proyecto; si tiene varios pipelines, aparece otro selector. La selección se conserva al recargar y las respuestas de consultas anteriores se descartan al cambiar de contexto.

Los proyectos tienen al menos un pipeline y uno predeterminado. El responsable del proyecto y las personas encargadas del departamento según el organigrama pueden crear y configurar sus pipelines accesibles. También se conserva el permiso explícito de administración de proyectos. Las denegaciones explícitas y las comprobaciones de seguridad siguen teniendo prioridad. Cada persona administra su pipeline personal. Los cambios de etapa requieren permiso para actualizar la tarea, salvo la clasificación personal de las tareas propias.

## Etapas y finalización

Las tarjetas muestran una barra de progreso informativa con el porcentaje de su etapa. Se mueven mediante arrastre o Alt + flecha izquierda/derecha, con un espacio animado que anticipa la posición de la tarjeta antes de soltarla y confirmación al guardar. La eliminación de pipelines está dentro de Configurar.

Las etapas normales admiten nombre, descripción, color y porcentaje informativo. Los porcentajes automáticos se reparten entre los valores manuales; reordenar conserva los porcentajes de cada posición. Completada (100%) y Fallida (0%) son opcionales y permanecen al final.

Personal sigue mostrando todas las tareas propias, incluidas las vinculadas a proyectos. El tablero Personal permite organizar también las tareas de proyecto mediante una clasificación independiente: moverlas allí no cambia su proyecto, su etapa de proyecto ni su finalización general. En el detalle y formulario, una tarea de proyecto no ofrece Personal como pipeline de destino; su estado real se gestiona en el proyecto. Cada relación tarea/proyecto conserva pipeline y etapa propios. Una tarea con varios proyectos solo se completa cuando todos sus flujos llegan a Completada. Fallida cierra su flujo sin completarlo; mientras exista un flujo activo la tarea permanece pendiente. Un pipeline sin Completada explica por qué no puede finalizar tareas desde ese flujo.

Eliminar una etapa o pipeline con tareas exige elegir un destino. No se eliminan tareas. El pipeline personal y el último de un proyecto se conservan. Las configuraciones usan una versión para rechazar ediciones basadas en datos antiguos.

## Compatibilidad y datos

La migración 0016 crea pipelines predeterminados para proyectos existentes y conserva sus estados y tareas. Los formularios y clientes anteriores resuelven sus estados dentro del pipeline correspondiente. Personal se crea cuando cada persona accede por primera vez.

Las publicaciones de Equipo no conceden permisos para editar pipelines. Los avisos de pipeline sin Completada y tarea en varios proyectos admiten Aceptar, Cancelar y No volver a mostrar, con preferencias separadas por persona y tipo de aviso.

## Verificación

- Servidor: `backend/venv/Scripts/python.exe backend/manage.py test boldApp.tareas.tests.test_pipelines`.
- Porcentajes: `node --test frontend/modulos/tareas/src/pipeline_stages.test.js`.
- Interfaz: con el servidor de desarrollo activo en 5174, abrir una sesión de Playwright CLI y ejecutar `run-code --filename frontend/modulos/core/tests/pipelines_browser.js`. Esta prueba usa respuestas simuladas: comprueba creación, selección inmediata de pipeline, reordenación, persistencia, ambos temas y anchos de 320 a 1440 px, sin modificar tareas reales.
