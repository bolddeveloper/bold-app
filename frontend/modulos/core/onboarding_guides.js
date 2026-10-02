// Descriptions only: tours never navigate, submit forms, or request domain data.
const step = (element, title, description) => ({ element, popover: { title, description, side: "bottom", align: "start" } });
const dialog = label => `[role="dialog"][aria-label="${label}"]`;
const taskForm = label => {
    const root = dialog(label);
    return { title: label, root, steps: [
        step(`${root} input[placeholder]`, "Una tarea concreta", "Escribe un título que explique la acción. Añade en la descripción el contexto, el resultado esperado y los detalles que necesitará el equipo."),
        step(`${root} [aria-label="Proyecto"]`, "Proyecto y organización", "Elige el proyecto correspondiente. Los campos y las opciones disponibles dependen de tu cargo y del alcance autorizado; crear tareas no concede acceso a otros departamentos."),
        step(`${root} [aria-label="Equipo responsable"]`, "Equipo responsable", "Selecciona el equipo que realizará el trabajo. Después revisa el responsable: es la persona encargada de dar seguimiento y completar la tarea."),
        step(`${root} [aria-label="Responsable"]`, "Quién se hace cargo", "Asigna una persona disponible para este equipo. Los colaboradores acompañan el trabajo, pero no sustituyen al responsable ni adquieren permisos adicionales por aparecer aquí."),
        step(`${root} .bold_date_trigger_btn, ${root} [aria-label="Fecha límite"]`, "Cuándo debe estar lista", "Abre el selector de fecha para definir el vencimiento. Revisa el día, mes y año antes de aplicarlo; una fecha pasada puede hacer que la tarea aparezca como retrasada."),
        step(`${root} [aria-label="Prioridad"]`, "Prioridad no es estado", "La prioridad indica qué atender primero. El estado describe cómo avanza el trabajo y completar indica que terminó. Una tarea urgente no es necesariamente una tarea en curso."),
        step(`${root} textarea`, "Contexto para el equipo", "Describe el resultado esperado, los detalles y las referencias necesarias para trabajar. No incluyas contraseñas ni otros secretos."),
        step(`${root} .add_subtask_link_btn`, "Desglosa el trabajo", "Agrega subtareas cuando quieras dividir la acción en pasos. Pon un nombre claro a cada una y revisa que no queden campos vacíos antes de guardar."),
        step(`${root} button[type="submit"]`, "Guardar una sola vez", "Cuando termines este recorrido, revisa tus datos y pulsa guardar. La animación indica que la solicitud sigue en curso: no necesitas repetirla. El tutorial no envía el formulario."),
    ] };
};

export const ONBOARDING_GUIDES = {
    home: { title: "Inicio", root: '[data-tour="home"]', steps: [
        step('[data-tour="home-header"]', "Tu resumen diario", "Inicio reúne los indicadores, tareas y proyectos disponibles para tu cuenta. Es un resumen de tu alcance, no una vista de toda la empresa para todos los cargos."),
        step('[data-tour="home-toolbar"]', "Personaliza tu inicio", "Usa las opciones para agregar widgets o restaurar la distribución. Puedes mover y cambiar el tamaño de las tarjetas para priorizar lo que consultas a diario."),
        step('[data-tour="home-dashboard"]', "Del resumen al trabajo", "Revisa pendientes, vencimientos y progreso en cada widget. Los enlaces de tareas y proyectos te llevan al detalle correspondiente; el tutorial no los abre ni modifica su estado."),
        step('[data-tour="sidebar"], [data-tour="mobile-menu"]', "Encuentra tus módulos", "La navegación muestra las áreas disponibles para tu cargo. En móvil usa el menú. Dentro de Tareas encontrarás tus tareas, los proyectos del departamento y los workspaces."),
        step('[data-tour="search"]', "Busca una vista", "Escribe el nombre de un módulo o apartado y elige una referencia del resultado. Solo aparecen destinos autorizados para tu cuenta. No es una búsqueda universal de todos los datos de la empresa."),
        step('[data-tour="notifications"], [data-tour="mobile-notifications"]', "Novedades del equipo", "Abre la campana para consultar las novedades disponibles y marcarlas como leídas. La Bandeja permite revisar esa actividad con más contexto."),
        step('[data-tour="help"], [data-tour="mobile-help"]', "Ayuda donde la necesitas", "Este botón repite la guía de la vista actual, sin llevarte a Inicio. Cada módulo presenta su propio recorrido la primera vez que lo visitas en este navegador y con este cargo."),
    ] },
    tasks: { title: "Tareas", root: ".tasks_module", steps: [
        step(".task_project_header", "Comprueba dónde estás", "El encabezado identifica tus tareas o el proyecto abierto. Cambia de proyecto desde el menú de Tareas para trabajar en el contexto correcto."),
        step(".main_section_nav_tabs", "Tareas o cronograma", "Tareas muestra el trabajo para gestionarlo; Cronograma ayuda a revisar su distribución por fechas. Cambiar de vista no modifica las tareas."),
        step(".view_switch_toggle", "Lista y tablero", "Elige lista para comparar campos o tablero para revisar las tareas por secciones. Ambas vistas representan los mismos registros."),
        step(".task_tools", "Ordenar, filtrar y personalizar", "Ordenar cambia la presentación. Filtrar reduce los resultados visibles sin borrarlos. Personalizar permite elegir columnas, incluida la persona que creó cada tarea; vuelve a revisar los filtros si parece faltar un registro."),
        step(".tasks_main_area", "Completar y consultar", "Abre una tarea para ver su detalle. Marcar o desmarcar se refleja de inmediato y luego se confirma con el servidor; si falla, la aplicación informa el problema y revierte el cambio. Editar, eliminar o reasignar sigue sujeto a tus permisos, aunque puedas ver la tarea."),
        step(".timeline_view_wrapper", "Fechas y planificación", "El cronograma sitúa el trabajo por fechas. Revisa qué tareas tienen fechas definidas; una tarea sin planificación no necesariamente aparecerá en el período que estás viendo."),
        step('.project_actions .primary_button, .mobile_floating_add', "Crear una tarea", "Usa Agregar tarea para abrir el formulario. La primera vez encontrarás una guía de sus campos. Si cierras una tarea nueva sin enviarla, su borrador permite retomarla; no es todavía una tarea guardada en el servidor."),
    ] },
    projects: { title: "Proyectos", root: ".projects_module:not(.folder_module)", steps: [
        step(".projects_module_header", "Proyectos de tu alcance", "Aquí se reúnen los proyectos disponibles para tu cuenta. El propietario puede supervisarlos agrupados por departamento; otros cargos solo ven lo que su alcance permite."),
        step(".project_summary_card", "Lee el progreso", "Cada tarjeta muestra nombre, estado, prioridad, fechas y proporción de tareas completadas. Abre el nombre para entrar a sus tareas; el icono del proyecto muestra información adicional."),
        step(".project_actions_toggle", "Acciones de un proyecto", "Despliega las acciones para abrir tareas, editar, compartir, organizar en workspace o eliminar cuando tu cargo lo permita. Compartir una referencia no concede acceso a quien no lo tenga."),
        step(".projects_module_header .primary_button", "Crear un proyecto", "Define el objetivo, las fechas, la prioridad y las personas del departamento responsable. Al abrir el formulario tendrás un recorrido específico, sin crear registros automáticamente."),
    ] },
    workspaces: { title: "Workspaces", root: ".folder_module", steps: [
        step(".folder_breadcrumb", "Organiza sin duplicar", "Los workspaces agrupan referencias a proyectos y tareas en carpetas y subcarpetas. Usa esta ruta para subir de nivel. La organización de carpetas se conserva en este navegador; no sustituye la estructura de departamentos ni los permisos del servidor."),
        step(".folder_actions", "Carpetas y contenido", "Crea una carpeta con nombre, descripción y color. Dentro de ella puedes agregar referencias a proyectos o tareas existentes y editar sus datos de organización."),
        step(".folder_card", "Entra en una carpeta", "Abre la tarjeta para ver sus subcarpetas y contenido. Las acciones permiten organizar o retirar referencias: eliminar una carpeta no elimina las tareas ni los proyectos originales."),
        step(".folder_module", "Organización y acceso son distintos", "Agregar una tarea a una carpeta no concede permisos sobre ella. La vista total reúne operaciones disponibles sobre los registros autorizados; revisa siempre la selección antes de aplicar una acción masiva."),
    ] },
    inbox: { title: "Bandeja de entrada", root: ".inbox_module", steps: [
        step(".inbox_header", "Actividad en contexto", "La bandeja reúne novedades relacionadas con tu trabajo. Consulta quién realizó el cambio y a qué tarea o proyecto se refiere antes de actuar."),
        step(".inbox_tabs", "Actividad, guardadas y menciones", "Cambia entre la actividad general, lo guardado, lo archivado y las menciones dirigidas a ti. Archivar una notificación no elimina la tarea a la que hace referencia."),
        step(".inbox_toolbar", "Encuentra una novedad", "Usa la búsqueda y los controles de la bandeja para acotar o ordenar la actividad. Estos controles organizan las notificaciones, no cambian los datos del proyecto."),
        step(".inbox_activity_list", "Revisa y organiza", "Abre una actividad para consultar su detalle. Usa sus acciones para marcarla como leída, guardarla o archivarla; la selección permite gestionar varias cuando esas opciones están disponibles."),
        step(".inbox_detail_panel", "De la novedad a su referencia", "Consulta el detalle y abre la referencia si necesitas trabajar en ella. Se siguen aplicando tus permisos actuales, incluso si la notificación es anterior a un cambio de acceso."),
    ] },
    calendar: { title: "Calendario", root: ".bold_calendar", steps: [
        step(".bold_calendar_header", "Planificación del equipo", "El calendario depende de la conexión con Google Calendar. Si todavía no está configurada, se mostrará un aviso en lugar de los eventos; el tutorial no conecta cuentas ni cambia la configuración."),
        step(".bold_calendar_state", "Una conexión pendiente no es un calendario vacío", "Cuando no hay conexión, primero debe completarse la configuración autorizada. No podrás crear ni consultar eventos desde esta vista hasta entonces."),
        step(".bold_calendar_toolbar", "Elige el período", "Usa Hoy y las flechas para moverte por fechas. Busca eventos por texto o actualiza la vista cuando necesites consultar novedades."),
        step(".bold_calendar_views", "Día, semana, mes o agenda", "Elige el nivel de detalle que necesites. Agenda es útil para recorrer eventos sin navegar por toda la cuadrícula."),
        step(".bold_calendar_sources", "Fuentes visibles", "Comprueba qué calendario está conectado y activa su visualización. Ocultar una fuente en la vista no borra sus eventos."),
        step(".bold_calendar_create", "Crear y revisar", "Abre Crear para elegir evento o tarea cuando la conexión y tus permisos lo permitan. Revisa fechas, horario y zona horaria antes de guardar; pulsa un evento existente para consultar su detalle."),
    ] },
    suggestions: { title: "Sugerencias", root: ".suggestions_module", steps: [
        step(".suggestions_header", "Mejora Bold desde Bold", "Envía problemas, ideas y ajustes dentro de la aplicación. No se necesita correo: los recibe el equipo autorizado para revisar sugerencias."),
        step('.suggestions_form select[name="category"]', "Clasifica tu mensaje", "Elige si se trata de una idea, un problema u otra categoría disponible. Así el equipo puede distinguir una mejora de un fallo que necesita revisión."),
        step('.suggestions_form select[name="source_module"]', "Indica dónde ocurre", "Selecciona el módulo relacionado o General si afecta a varias partes. Esto ayuda a dirigir la revisión al área correcta."),
        step('.suggestions_form textarea', "Describe algo reproducible", "Cuenta qué intentabas hacer, qué ocurrió y qué esperabas. Para una idea, explica la necesidad que resolvería. No incluyas contraseñas, códigos MFA ni datos confidenciales."),
        step(".suggestions_primary", "Revisa y confirma", "Al enviar se pide confirmación. Tras guardarse se muestra el aviso de éxito y se limpia el formulario. Mientras se envía, espera a que termine antes de repetir la solicitud."),
        step(".suggestions_history", "Seguimiento y correcciones", "Consulta el historial y filtra por estado. Solo el creador puede editar o eliminar su propia sugerencia dentro del alcance autorizado; el equipo revisor puede gestionar su estado. Actualizar vuelve a consultar la información."),
    ] },
    reports: { title: "Informes", root: ".reports_module", steps: [
        step(".reports_work_in_progress", "Informes está en desarrollo", "Estamos trabajando en este módulo. Próximamente. Lo visible por ahora es un resumen preliminar de tareas, no un informe completo de toda la empresa ni de módulos futuros."),
        step(".reports_actions", "Período y descarga", "Elige el período disponible. Crear informe descarga un CSV de este resumen; revisa su alcance antes de compartirlo."),
        step(".reports_metrics", "Interpreta los indicadores", "Compara tareas totales, completadas, en curso y retrasadas. Los indicadores dependen de los registros disponibles y del período; no sustituyen una revisión del contexto de cada proyecto."),
        step(".reports_projects", "Progreso por proyecto", "Consulta la proporción de tareas completadas. Este porcentaje no mide por sí solo esfuerzo, calidad o cumplimiento del objetivo del proyecto."),
    ] },
    "task-create": taskForm("Nueva tarea"),
    "task-edit": taskForm("Editar tarea"),
    "task-detail": { title: "Detalle de tarea", root: dialog("Detalle de tarea"), steps: [
        step(`${dialog("Detalle de tarea")} .detail_title_row`, "Consulta antes de modificar", "Comprueba el título y el estado de finalización. Ver una tarea no implica poder editarla: algunas reglas permiten modificar solamente tareas que tú creaste."),
        step(`${dialog("Detalle de tarea")} .detail_meta_grid`, "Responsable y planificación", "Revisa la persona responsable, la prioridad y el vencimiento. Antes de reasignar o cambiar fechas, confirma que tu cargo permita la acción para esta tarea."),
        step(`${dialog("Detalle de tarea")} .detail_collaborators_card`, "Personas relacionadas", "Consulta quién acompaña el trabajo. Los colaboradores ayudan a dar seguimiento; figurar aquí no amplía los permisos sobre otras tareas o departamentos."),
        step(`${dialog("Detalle de tarea")} .detail_subtasks_block`, "Avance por pasos", "Las subtareas desglosan el trabajo. Revisa los pasos pendientes y los completados antes de marcar la tarea principal como terminada; cambiar uno sigue sujeto a los permisos de edición."),
        step(`${dialog("Detalle de tarea")} .detail_comment_input_box`, "Conserva el contexto", "Escribe un comentario claro y revísalo antes de enviarlo. Espera la confirmación sin volver a pulsar. El historial puede cargarse por páginas para evitar descargar todas las conversaciones al entrar."),
        step(`${dialog("Detalle de tarea")} .detail_top_eyebrow_row`, "Acciones y límites", "Las acciones superiores permiten trabajar sobre la tarea según tu cargo; el servidor confirma los permisos. Los archivos reales siguen pendientes de integración: un aviso de Próximamente no significa que un archivo se haya subido."),
    ] },
    "project-form": { title: "Configurar un proyecto", root: ".project_create_modal", steps: [
        step('.project_create_modal input[name="project_name"]', "Nombre y objetivo", "Usa un nombre identificable y explica el objetivo y el alcance en la descripción. Este mismo formulario sirve para crear o editar un proyecto."),
        step('.project_create_modal [aria-label="Departamento responsable"]', "Departamento y responsable", "El propietario puede elegir el departamento y una plaza responsable activa. Las personas disponibles corresponden al departamento elegido; no se incorporan todos los empleados de la empresa."),
        step(".project_color_options", "Identidad visual", "Elige un color para distinguir el proyecto. La imagen es opcional; no necesitas modificarla para poder continuar."),
        step(".project_create_grid_3", "Planificación inicial", "Revisa fechas de inicio y fin, estado y prioridad. Al editar, comprueba los valores existentes antes de reemplazarlos."),
        step(".project_create_footer", "Personas y guardado", "Revisa las personas relacionadas y los demás campos antes de guardar. Esta selección no sustituye las políticas de acceso. La animación indica una operación en curso; espera la confirmación sin volver a pulsar."),
    ] },
};

export function onboardingGuideId(module, { modal, detail } = {}) {
    if (["administration", "permissions"].includes(module)) return null;
    if (module !== "department_projects" && !Object.hasOwn(ONBOARDING_GUIDES, module)) return null;
    if (modal === "task") return "task-create";
    if (modal === "edit_task") return "task-edit";
    if (modal === "project") return "project-form";
    // Other dialogs are not onboarding targets: never place a tour over a confirmation or MFA.
    if (modal) return null;
    if (module === "tasks" && detail) return "task-detail";
    if (["projects", "department_projects"].includes(module)) return "projects";
    return Object.hasOwn(ONBOARDING_GUIDES, module) ? module : null;
}
