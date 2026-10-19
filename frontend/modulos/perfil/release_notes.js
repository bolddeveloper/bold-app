// Notas de versión. Añadir las nuevas entradas al principio de la lista.
export const releaseNotes = [
    {
        id: "2026-10-19-sheets-drive-postgres-fix", date: "2026-10-19", category: "Correcciones", icon: "update",
        title: "Corrección al abrir Sheets y sincronizar con Drive",
        summary: "Se corrige el error del servidor al consultar o actualizar la conexión de un archivo con Drive.",
        sections: [{title: "Archivos de Sheets", items: [
            "La comprobación de Drive y el guardado en segundo plano utilizan consultas compatibles con PostgreSQL.",
            "La corrección conserva el contenido de los archivos y sus destinos de Drive.",
        ]}],
    },
    {
        id: "2026-10-19-people-search-drive-mentions", date: "2026-10-19", category: "Mejoras", icon: "update",
        title: "Encuentra personas y carpetas con más facilidad",
        summary: "Equipo incorpora búsqueda de personas y los comentarios permiten elegir a quién mencionar.",
        sections: [{title: "Búsqueda y navegación", items: [
            "Busca personas por nombre en Equipo; los departamentos con coincidencias se despliegan al buscar.",
            "Escribe @ o usa Mencionar persona en comentarios para buscar por nombre o correo. Las menciones solo notifican a quienes tienen acceso a la tarea.",
            "El menú de Tareas recuerda si lo dejaste abierto o cerrado en este navegador, por cargo activo.",
            "Al elegir dónde guardar un archivo, el buscador consulta carpetas de Drive y descarta resultados de búsquedas anteriores.",
        ]}],
    },
    {
        id: "2026-10-19-pipeline-postgres-fix", date: "2026-10-19", category: "Correcciones", icon: "update",
        title: "Corrección al mover tareas entre etapas",
        summary: "Se corrige el error del servidor al cambiar etapas o configurar el pipeline personal.",
        sections: [{title: "Estados", items: [
            "Mover tareas y guardar cambios del pipeline personal ya no falla por una consulta incompatible con la base de datos del servidor.",
            "La corrección conserva las tareas, sus proyectos y sus permisos.",
        ]}],
    },
    {
        id: "2026-10-19-sheets-it-pilot", date: "2026-10-19", category: "Mejoras", icon: "update",
        title: "Prueba de Sheets con Equipo de IT",
        summary: "Sheets incorpora un acceso limitado por equipo para su prueba inicial.",
        sections: [{title: "Acceso durante el piloto", items: [
            "Cuando el piloto está activo, Sheets solo está disponible desde un cargo del equipo autorizado y con los permisos correspondientes.",
            "Compartir un archivo no permite acceder a Sheets desde otro equipo durante el piloto.",
            "Equipo, Estados y los demás módulos conservan sus permisos habituales.",
        ]}],
    },
    {
        id: "2026-10-19-sheets-template-management", date: "2026-10-19", category: "Mejoras", icon: "update",
        title: "Administra tus plantillas de Sheets",
        summary: "Crea, edita y elimina plantillas directamente desde Plantillas.",
        sections: [{title: "Plantillas reutilizables", items: [
            "Nueva plantilla permite empezar en blanco o partir de una plantilla existente y guardar el diseño en BOLD.",
            "Usar plantilla crea un archivo independiente. Editar una plantilla no modifica los archivos creados anteriormente.",
            "Puedes personalizar o eliminar tu Agenda de triunfos de Plantillas sin cambiar la de otras personas. Las plantillas eliminadas se pueden recuperar en Papelera.",
            "Crear, editar y eliminar respetan los permisos de Sheets y el acceso a cada archivo.",
        ]}],
    },
    {
        id: "2026-10-19-sheets-team-pipelines", date: "2026-10-19", category: "Mejoras y correcciones", icon: "update",
        title: "Sheets, etapas de trabajo y tareas compartidas con Equipo",
        summary: "Organiza tus tareas por etapas, elige qué compartir con la empresa y conserva más información al trabajar con Excel.",
        sections: [
            {title: "Sheets y archivos de Excel", items: [
                "El módulo aparece como Sheets y su acceso depende de los permisos asignados en Administración.",
                "Se corrigió la lectura de notas y enlaces al importar Excel, la conservación de imágenes y filas agrupadas, y las tablas dinámicas en hojas con apóstrofos en el nombre.",
            ]},
            {title: "Estados y pipelines", items: [
                "La pestaña Estados permite consultar el pipeline personal o los pipelines de un proyecto, y mover tareas entre sus etapas.",
                "La organización personal es independiente de los proyectos. Una tarea vinculada a varios proyectos se completa cuando todos sus flujos de proyecto llegan a Completada.",
                "Los porcentajes de las etapas son informativos. Crear o configurar pipelines de proyecto requiere los permisos correspondientes.",
            ]},
            {title: "Compartir trabajo con Equipo", items: [
                "Equipo se encuentra debajo de Mis tareas en la barra lateral y muestra el trabajo compartido de cada persona, agrupado por etapas.",
                "Los ojos del pipeline personal permiten compartir tareas individuales o las tareas mostradas de una etapa. Compartir una tarea no concede permisos para editarla ni acceso general a su proyecto.",
                "Las tareas están ocultas inicialmente. Las reuniones se consultan solo si la persona comparte su agenda; una agenda oculta no indica que esté libre.",
            ]},
        ],
    },
    {
        id: "2026-10-14-sections-comments-patch", date: "2026-10-14", category: "Parche y mejoras", icon: "update",
        title: "Tus secciones, comentarios más ágiles y tableros sin desbordamientos",
        summary: "Organiza las tareas sin una sección obligatoria, comparte enlaces e imágenes con menos pasos y consulta tarjetas que respetan el tamaño del tablero.",
        sections: [
            {title: "Secciones bajo tu control", items: [
                "Sin sección sigue siendo el grupo inicial. Al renombrarlo conserva sus tareas y ya no aparece otro grupo Sin sección automáticamente.",
                "Puedes quitar Sin sección si existe otra sección; sus tareas se trasladan sin eliminarse. La última sección disponible permanece protegida.",
                "Nueva tarea recuerda la última sección utilizada al crear correctamente una tarea, por cargo activo y proyecto o tablero personal, en ese navegador. Si ya no existe, elige la primera sección visible; un borrador conserva su selección válida.",
            ]},
            {title: "Enlaces e imágenes en comentarios", items: [
                "Solo el autor puede editar o eliminar sus comentarios, aunque otra persona sea responsable, colaboradora o propietaria. Tener acceso para leer y comentar no permite cambiar mensajes ajenos; la regla también se aplica en el cronograma.",
                "El editor compartido reconoce direcciones HTTP, HTTPS y www. al escribirlas o pegarlas, sin necesitar el botón Enlace.",
                "El botón Enlace permite añadir un alias opcional para mostrar un nombre corto en lugar de una dirección larga.",
                "Pega una captura desde el portapapeles o arrastra un archivo PNG, JPEG, GIF o WebP al editor. Utiliza la misma previsualización y carga del botón de imágenes; no descarga imágenes remotas del HTML pegado.",
                "Los enlaces conservan los controles de seguridad del editor y los permisos existentes de la aplicación.",
            ]},
            {title: "Tarjetas que encajan en su sección", items: [
                "Se corrigió el desbordamiento de las tarjetas en el modo Tablero de Mis tareas.",
                "Los textos y enlaces largos se ajustan al ancho disponible, sin empujar las fechas ni ampliar la columna, en modos claro y oscuro.",
            ]},
        ],
    },
    {
        id: "2026-10-13-calendar-header-patch", date: "2026-10-13", category: "Parche y mejoras", icon: "update",
        title: "Un calendario situado en hoy y una barra superior más consistente",
        summary: "El calendario abre en la fecha actual, la línea de hora acompaña al día de hoy y la campana recupera su contorno circular.",
        sections: [
            {title: "La fecha correcta al entrar", items: [
                "Al ingresar al calendario se utiliza la fecha actual, manteniendo el tipo de vista elegido. Ya no se recupera una semana antigua como fecha de entrada.",
                "En la semana actual se muestran hoy y los días restantes, sin ocupar columnas con días ya pasados. Las semanas históricas y futuras continúan disponibles para consulta.",
                "Se restauró la referencia visual de la hora actual, limitada a la columna de hoy en lugar de atravesar toda la semana. No se muestra en semanas donde hoy no está presente.",
            ]},
            {title: "Notificaciones en la barra superior", items: [
                "La campana utiliza el mismo contorno circular que los demás botones, adaptado a los modos claro y oscuro.",
                "Se mantienen el indicador de notificaciones pendientes y las preferencias de cada usuario.",
            ]},
        ],
    },
    {
        id: "2026-10-12-brands-workspaces-update", date: "2026-10-12", category: "Actualización general", icon: "update",
        title: "Marcas, workspaces entre dispositivos y colaboración en tareas",
        summary: "Un lugar para el contexto de cada marca, carpetas personales guardadas en servidor y colaboración explícita en tareas sin conceder permiso para eliminarlas.",
        sections: [
            {title: "El contexto de tus marcas", items: [
                "Marcas permite guardar logo, descripción, contacto del cliente, preferencias de comunicación, pauta y presupuesto, información audiovisual, diseñador, trafficker, notas de relevo y características adicionales.",
                "Asocia proyectos y tareas existentes y abre los que tienes autorizados. Archivar una marca conserva sus proyectos y tareas originales.",
                "El creador o propietario puede compartir una marca con empleados activos de otros departamentos. Los colaboradores pueden editar cuando su cargo lo permite.",
                "Los permisos de Marcas deben habilitarse para los cargos correspondientes. Compartir su contexto no concede automáticamente acceso a los proyectos o tareas asociados.",
            ]},
            {title: "Workspaces persistentes y compartidos", items: [
                "La biblioteca personal de carpetas se guarda en servidor por cuenta y unidad, para recuperarla entre dispositivos.",
                "Importar carpetas de este dispositivo solicita confirmación antes de incorporar carpetas que estaban guardadas solo localmente, conservando su respaldo local.",
                "Las carpetas compartidas pueden incluir empleados de otros departamentos. Los colaboradores pueden modificar nombre, descripción y asociaciones; el creador administra los participantes y la eliminación.",
                "Si otra persona modifica una carpeta mientras la editas, BOLD conserva el formulario y avisa del conflicto, en lugar de sobrescribir sus cambios silenciosamente. No es coedición de texto carácter por carácter.",
                "Los permisos originales de tareas, proyectos y Drive siguen aplicándose a los elementos asociados.",
            ]},
            {title: "Trabajar en equipo en una tarea", items: [
                "Los responsables y colaboradores agregados explícitamente a una tarea pueden editarla, marcarla como finalizada, reabrirla y mover sus vínculos existentes entre secciones, respetando denegaciones explícitas y las verificaciones de seguridad.",
                "Ser colaborador de una tarea no concede permiso para eliminarla. La eliminación queda reservada al creador o responsable con autorización, además del acceso protegido del propietario.",
                "Se corrigieron acciones de completado y subtareas. La colaboración de una tarea no depende de tener un cargo llamado Colaborador.",
            ]},
            {title: "Pequeños detalles del uso diario", items: [
                "La animación de entrada saluda con el primer nombre de la persona autenticada; sin identidad conserva el mensaje general.",
                "La campana deja unos diez segundos de reposo entre movimientos y respeta la preferencia de movimiento reducido.",
                "Se corrigieron problemas de guardado en organización, marcas y tareas recurrentes, y se agrupan ráfagas de avisos de presencia sin retrasar las revocaciones de acceso.",
            ]},
        ],
    },
    {
        id: "2026-10-09-pwa-updates-patch", date: "2026-10-09", category: "Parche y mejoras", icon: "update",
        title: "Actualiza la aplicación instalada sin reinstalarla",
        summary: "BOLD detecta nuevas versiones y te permite aplicarlas cuando hayas guardado tu trabajo, tanto en la web como en la PWA.",
        sections: [
            {title: "Una actualización visible y controlada", items: [
                "Cada compilación identifica su versión de recursos. La aplicación comprueba novedades al iniciar y al recuperar foco o conexión, con comprobaciones periódicas moderadas mientras está visible y conectada.",
                "Cuando hay una versión nueva, aparece el aviso Actualizar. Confirma después de guardar tu trabajo: una ventana abierta no se recarga automáticamente sin consentimiento.",
                "Si otra ventana aplica la actualización, las demás reciben un aviso en lugar de perder sus formularios abiertos.",
                "No necesitas desinstalar ni volver a instalar la PWA. Una instalación que todavía ejecuta una versión anterior a este mecanismo puede necesitar cerrarse y abrirse o recargarse una vez para recibirlo.",
                "Sin conexión se utiliza la versión disponible del contenido estático. Este almacenamiento no incluye respuestas de las API ni conexiones WebSocket.",
            ]},
        ],
    },
    {
        id: "2026-10-08-community-patch", date: "2026-10-08", category: "Parche y mejoras", icon: "update",
        title: "Mejoras solicitadas por usuarios: tareas, imágenes y equipo conectado",
        summary: "Cambios del 8 de octubre: sugerencias, miembros conectados, imágenes en Drive, carpetas compartidas de Workspace y correcciones para trabajar con menos interrupciones.",
        sections: [
            {title: "Sugerencias y reportes de usuarios", items: [
                "Envía problemas, ideas y mejoras visuales con título, descripción, módulo, prioridad y datos del navegador o dispositivo.",
                "Consulta tus reportes y su estado. El equipo autorizado puede revisar, priorizar y registrar el seguimiento interno.",
                "Las imágenes se agregan directamente en la descripción. Se retiró el apartado separado de Capturas; las capturas anteriores siguen disponibles dentro de la descripción.",
                "Se corrigió el visor de imágenes para que aparezca delante del detalle del reporte.",
            ]},
            {title: "Miembros conectados y personas del proyecto", items: [
                "El botón de miembros de la barra superior abre un panel lateral animado con las personas conectadas, agrupadas por departamento y con su cantidad.",
                "Consulta la foto de perfil, el nombre y el estado de cada persona. Busca por persona o estado desde el panel.",
                "El panel de miembros reemplaza el widget de equipo conectado. Se ajustaron su ancho, distribución y animaciones de apertura y cierre.",
                "Al pulsar los avatares de un proyecto se abre una ventana pequeña animada con sus miembros. Busca por nombre o correo y agrega personas desde los resultados.",
                "La lista de personas del proyecto permite quitar miembros y desplazarse cuando hay varias personas. Se ajustó el tamaño del botón de eliminar.",
            ]},
            {title: "Carpetas y accesos de Workspace", items: [
                "Agrega carpetas de Drive desde la misma ventana donde seleccionas proyectos y tareas. El selector permite buscar, navegar y crear carpetas.",
                "Los accesos a carpetas de Drive se abren dentro del módulo Drive de BOLD. Quitar un acceso del Workspace conserva la carpeta original.",
                "Comparte las carpetas que creaste con personas de tu departamento. Busca por nombre o correo para agregarlas y usa el botón de eliminar para quitar su acceso.",
                "Las personas seleccionadas ven la carpeta compartida y sus subcarpetas en modo consulta. El creador controla su organización y los cambios se actualizan en segundo plano.",
                "Compartir una carpeta de Workspace mantiene los permisos existentes de proyectos, tareas y Google Drive.",
                "Se ajustaron los botones de eliminar para que sean compactos. Las descripciones de carpetas y la creación de proyectos ya no ofrecen adjuntar imágenes.",
            ]},
            {title: "Tareas, subtareas y comentarios", items: [
                "Las tareas y los comentarios con imágenes aparecen inmediatamente para quien los envía mientras el guardado y la sincronización continúan en segundo plano.",
                "Los comentarios nuevos permanecen abajo durante la sincronización y después de guardarse. El aviso de sincronización se muestra arriba a la derecha, sin repetirlo dentro de cada comentario.",
                "En comentarios, Enter envía y Shift + Enter agrega un nuevo renglón.",
                "Cada subtarea tiene un botón de eliminar. Al pulsar el resto de su fila se abren sus detalles, conservando las acciones del nombre y la casilla de completado.",
                "El cronograma muestra únicamente los comentarios enviados desde cronograma; ya no mezcla los comentarios de las tareas.",
                "Los paneles de crear, consultar y editar tareas y proyectos usan un ancho inicial de 600 px, con tamaño ajustable dentro de sus límites.",
            ]},
            {title: "Imágenes, carrusel y zoom", items: [
                "Las imágenes de las descripciones se muestran como miniaturas pequeñas, alineadas a la izquierda y con bordes redondeados.",
                "Pulsa una miniatura para ampliar la imagen y recorrer el carrusel. El visor conserva las proporciones de imágenes horizontales y verticales.",
                "Amplía hasta el 400 % con los botones o la rueda del mouse. Arrastra la imagen ampliada y restablece el zoom al 100 % cuando lo necesites.",
                "Los comentarios disponen de carrusel para consultar sus imágenes. El carrusel del cronograma respeta la separación de sus comentarios.",
                "Se corrigieron fotos de perfil que aparecían demasiado grandes en tareas y proyectos, y problemas de superposición del visor con otras ventanas.",
            ]},
            {title: "Almacenamiento de imágenes en Drive", items: [
                "Administración → Conectores permite seleccionar la carpeta de Drive donde BOLD guarda las imágenes mediante la cuenta administradora conectada.",
                "Las imágenes se organizan en subcarpetas por módulo, proyecto, tarea y usuario, separando descripción, comentarios y cronograma.",
                "El selector de destino permite crear carpetas desde Administración y Docs.",
                "La conexión personal de cada usuario al módulo Drive se mantiene independiente del almacenamiento de imágenes de BOLD.",
                "Se ajustó el guardado de tareas con imágenes para evitar esperas que bloqueaban otras acciones. Los errores de guardado conservan un borrador recuperable.",
            ]},
            {title: "Archivos y vistas previas de Drive", items: [
                "Descarga carpetas como archivos ZIP desde Drive en BOLD.",
                "Las tarjetas de archivos muestran vistas previas cuando Drive las proporciona, con un icono de respaldo cuando no están disponibles.",
                "Las miniaturas se conservan en el navegador por cuenta y versión del archivo para reutilizarlas y cargar las nuevas o modificadas.",
                "Se retiraron límites adicionales de BOLD para las cargas y descargas; siguen aplicándose los límites de Google y del entorno donde se utiliza la aplicación.",
            ]},
            {title: "Avisos y acceso a Novedades", items: [
                "Novedades tiene un botón junto a Ayuda y una animación cuando hay una publicación nueva por consultar.",
                "Si entras con notificaciones pendientes, BOLD reproduce el sonido una vez en Inicio, después de la animación de entrada y según tus preferencias de sonido.",
                "Los avisos de guardado, sincronización y confirmación utilizan los tres puntos animados de BOLD en rojo, adaptados a su tamaño y con un ciclo más rápido.",
                "Los avisos flotantes se muestran sobre los paneles y carruseles para mantenerlos visibles durante el trabajo.",
                "Los avisos de tareas cuyo guardado no pudo confirmarse incluyen Cerrar y No volver a mostrar. Esta última opción silencia el aviso de esa tarea en el navegador sin borrar su borrador.",
                "Se restauró el acceso a Ayuda y se ajustaron los botones superiores. La campana conserva su animación y añade el contorno del modo oscuro.",
                "La campana repite su animación mientras hay notificaciones sin leer y muestra el mismo punto rojo que Novedades, también en móvil.",
            ]},
            {title: "Correcciones del editor y presentación", items: [
                "Se ajustó el cambio de estilo de texto para conservar el renglón y la selección al editar descripciones.",
                "Se mejoraron la alineación de avatares, las miniaturas y los paneles para mantener una presentación consistente entre módulos.",
                "Las nuevas animaciones respetan la preferencia de movimiento reducido del dispositivo.",
            ]},
        ],
    },
    {
        id: "2026-10-05-major-update", date: "2026-10-05", category: "Actualización general", icon: "update",
        title: "Gran actualización de BOLD: Drive, Docs, Calendario y Perfil",
        summary: "Una demo más completa: archivos, editores, conexión Google, personalización y mejoras en el trabajo diario.",
        sections: [
            {title: "Drive dentro de BOLD", items: [
                "Navega por Página principal, Mi unidad, Unidades compartidas, Compartido conmigo, Reciente, Destacados, Papelera y Almacenamiento.",
                "Usa las vistas de lista y cuadrícula, búsqueda, filtros, ordenamiento, selección múltiple, menús de archivo y panel de detalles.",
                "Crea carpetas, sube archivos o carpetas y arrastra archivos para iniciar una carga. Elige su destino para mantener organizada tu unidad.",
                "Renombra, destaca, copia, mueve y comparte archivos según los permisos de tu cuenta. Consulta imágenes y PDF desde la vista previa.",
                "Las vistas visitadas conservan sus datos mientras se actualizan en segundo plano. Se corrigieron descargas, menús fuera de pantalla y la transición al regresar a una carpeta.",
            ]},
            {title: "Docs, hojas de cálculo y presentaciones", items: [
                "Crea documentos, hojas de cálculo y presentaciones desde Docs. Antes de crearlos, selecciona el nombre y la carpeta de Drive donde se guardarán.",
                "Abre archivos compatibles desde Drive en los editores de BOLD, con herramientas de lectura y edición para cada formato.",
                "La edición de archivos Office conserva el archivo original cuando el formato es compatible. Los formatos antiguos pueden requerir una conversión inicial, que se reutiliza en aperturas posteriores.",
                "Mantén la opción Abrir en Google para usar el editor completo de Google y sus herramientas adicionales.",
                "La portada de Docs se simplificó para mostrar los tres tipos de archivo; la biblioteca completa se consulta en Drive.",
            ]},
            {title: "Calendario y búsqueda de invitados", items: [
                "Calendario utiliza la cuenta Google individual del usuario y conserva las vistas visitadas mientras actualiza sus datos en segundo plano.",
                "Las sugerencias de invitados combinan contactos de Google People y direcciones disponibles en Gmail. También puedes escribir un correo completo para invitar a alguien nuevo.",
                "Se mejoró el manejo de búsquedas lentas y respuestas antiguas para evitar sugerencias incorrectas al cambiar lo que escribes.",
                "Se corrigió la edición de recurrencia para permitir volver a No se repite después de configurar un evento recurrente.",
            ]},
            {title: "Conexión Google unificada", items: [
                "Conecta Drive, Docs, Sheets, Slides, Calendario, Tasks, Contactos y Gmail desde una sola conexión, autorizando sus permisos en Google.",
                "Administración → Conectores concentra la configuración de Google Cloud. Cada empleado conecta su propia cuenta desde sus preferencias.",
                "Drive y Docs muestran el correo conectado. Los accesos laterales de Drive llevan a Tareas y Calendario de BOLD.",
            ]},
            {title: "Perfil, personalización y atajos", items: [
                "El perfil reúne Cuenta, Conectores, Notificaciones, Atajos y Novedades.",
                "Edita tu nombre sobre la tarjeta, sube y recorta tu foto y selecciona el color del banner. El selector de colores también se utiliza en Proyectos y Workspaces.",
                "Cambia de departamento desde la ficha rápida sin cerrar sesión. El selector aparece en un panel lateral y Novedades tiene acceso directo desde esa ficha.",
                "Personaliza los atajos de navegación, búsqueda, notificaciones y tema. Puedes desactivarlos, restaurarlos y guardarlos para tu cuenta.",
            ]},
            {title: "Notificaciones y tareas", items: [
                "Elige entre cinco sonidos de notificación, ajusta el volumen o sube un sonido personalizado. Puedes solicitar avisos de Windows mientras BOLD esté abierto.",
                "La campana se anima al recibir un aviso y al abrir las notificaciones. El panel permite limpiar los avisos del departamento activo.",
                "Las tareas completadas se muestran al final de su sección. El movimiento entre secciones responde inmediatamente y confirma el cambio con el servidor.",
                "El bloc de notas privado permite guardar tus notas y consultarlas desde otro dispositivo con tu cuenta.",
            ]},
            {title: "Diseño y navegación", items: [
                "Se añadieron respuestas visuales a botones, widgets, perfil y ajustes, respetando los modos claro y oscuro y el movimiento reducido.",
                "Las confirmaciones de la aplicación utilizan ventanas con el diseño de BOLD. Las notas de parche mantienen visible la página que hay detrás.",
                "Los botones Atrás y Adelante del navegador, incluidos los laterales del mouse, permiten regresar entre módulos y vistas.",
                "Se corrigieron accesos a Proyectos y Workspaces y problemas con sus selectores de color.",
            ]},
        ],
    },
    {
        id: "2026-10-05-shortcuts", date: "2026-10-05", category: "Nueva función", icon: "keyboard",
        title: "Tus atajos, a tu manera",
        summary: "Navega entre módulos y personaliza tus combinaciones desde Perfil → Atajos.",
        sections: [
            {title: "Atajos de teclado", items: ["Accede a Inicio, Tareas, Proyectos, Workspaces, Calendario, Drive y Docs mediante el teclado.", "Abre la búsqueda y las notificaciones, o cambia el tema con una combinación.", "Consulta la lista completa en Perfil → Atajos. También encontrarás las teclas de edición y navegación que ya funcionan en BOLD."]},
            {title: "Preferencias personales", items: ["Cambia una combinación presionando las teclas que quieres usar. Puedes desactivar atajos o restaurar los valores predeterminados.", "Guarda los cambios para aplicarlos a tu cuenta. Las preferencias se conservan entre dispositivos.", "BOLD detecta combinaciones duplicadas y reservadas. Los atajos de navegación respetan tus permisos y no se ejecutan mientras escribes o hay un diálogo abierto."]},
        ],
    },
    {
        id: "2026-10-05-notifications", date: "2026-10-05", category: "Mejoras", icon: "bell",
        title: "Notificaciones con más personalidad",
        summary: "Sonidos personalizados, avisos de Windows y una campana que responde a cada novedad.",
        sections: [
            {title: "Sonidos y avisos", items: ["Elige entre cinco sonidos o sube tu propio audio desde Perfil → Notificaciones. Puedes ajustar el volumen y escuchar una muestra.", "Solicita el permiso del navegador para recibir avisos de Windows mientras BOLD está abierto.", "Limpia las notificaciones de tu departamento activo desde el panel o las preferencias, sin borrar tareas ni eventos."]},
            {title: "Respuesta visual", items: ["La campana se mueve al llegar una notificación nueva y al abrir el panel, con la animación rápida de 520 ms.", "BOLD comprueba los avisos cada dos segundos mientras la aplicación está visible.", "Las animaciones respetan la preferencia de movimiento reducido del dispositivo."]},
        ],
    },
    {
        id: "2026-10-05-profile", date: "2026-10-05", category: "Experiencia BOLD", icon: "profile",
        title: "Un perfil más fácil de personalizar",
        summary: "Edita tu tarjeta, ajusta tu foto y encuentra tus preferencias en un solo lugar.",
        sections: [
            {title: "Tu tarjeta de perfil", items: ["Edita el nombre directamente en tu tarjeta y selecciona una foto de perfil.", "Ajusta el tamaño y el recorte de tu imagen antes de aplicarla. Cambia el color del banner con el selector compartido de BOLD.", "Los accesos al perfil y el botón de ajustes responden al pasar el mouse, con estilos para los temas claro y oscuro."]},
            {title: "Preferencias y novedades", items: ["Cuenta, Conectores, Notificaciones y Atajos están disponibles desde Perfil.", "Las confirmaciones dentro de la aplicación usan ventanas con el diseño de BOLD.", "El nuevo apartado Novedades reúne las notas de la demo. Abre una tarjeta para consultar sus cambios completos."]},
        ],
    },
];
