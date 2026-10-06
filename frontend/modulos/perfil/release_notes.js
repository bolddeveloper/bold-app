// Notas de la demo local. Añadir las nuevas entradas al principio de la lista.
export const releaseNotes = [
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
