// Defines the navigation shown by the empty Bold application shell.
export const navigation_items = [
    {
        id: "home",
        label: "Inicio",
        icon: "home"
    },
    {
        id: "tasks",
        label: "Tareas",
        icon: "check"
    },
    {
        id: "inbox",
        label: "Bandeja de entrada",
        icon: "inbox"
    },
    {
        id: "reports",
        label: "Informes",
        icon: "reports"
    }
];


// Defines the projects displayed in the task workspace sidebar.
export const project_items = [
    {
        id: "launch_q4",
        label: "Lanzamiento Q4",
        color: "#ef3c3c"
    },
    {
        id: "monthly_content",
        label: "Contenido mensual",
        color: "#f3a43b"
    },
    {
        id: "web_redesign",
        label: "Rediseno web",
        color: "#66b885"
    },
    {
        id: "active_campaigns",
        label: "Campanas activas",
        color: "#7d6bd6"
    }
];


// Defines the workspace users shown in task cards and project sharing.
export const team_members = [
    {
        id: "joaquin_sierra",
        name: "Joaquin Sierra",
        email: "joaquin@bold.gt",
        initials: "JS",
        color: "#e73535"
    },
    {
        id: "ana_martinez",
        name: "Ana Martinez",
        email: "ana@bold.gt",
        initials: "AM",
        color: "#f08163"
    },
    {
        id: "david_urbina",
        name: "David Urbina",
        email: "david@bold.gt",
        initials: "DU",
        color: "#4d9ae6"
    },
    {
        id: "carla_ruiz",
        name: "Carla Ruiz",
        email: "carla@bold.gt",
        initials: "CR",
        color: "#43aa75"
    }
];


// Defines the starter task list inspired by Asana project views.
export const starter_tasks = [
    {
        id: "task_001",
        title: "Definir concepto creativo",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae augue sit amet ipsum volutpat porta.",
        project_id: "launch_q4",
        section: "todo",
        assignee_id: "ana_martinez",
        due_day: 10,
        due_label: "10 sep",
        priority: "Alta",
        status: "Pend.",
        completed: false,
        tags: [
            "Marketing"
        ],
        subtasks: [
            {
                id: "subtask_001",
                title: "Lorem ipsum dolor sit amet",
                completed: true
            },
            {
                id: "subtask_002",
                title: "Consectetur adipiscing elit",
                completed: false
            }
        ],
        attachment_name: "brief-creativo.pdf"
    },
    {
        id: "task_002",
        title: "Preparar calendario de contenidos",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aliquam posuere lectus eu tellus tempus cursus.",
        project_id: "launch_q4",
        section: "todo",
        assignee_id: "carla_ruiz",
        due_day: 12,
        due_label: "12 sep",
        priority: "Media",
        status: "Pend.",
        completed: false,
        tags: [
            "Contenido"
        ],
        subtasks: [
            {
                id: "subtask_003",
                title: "Lorem ipsum dolor sit amet",
                completed: false
            }
        ],
        attachment_name: "calendario.pdf"
    },
    {
        id: "task_003",
        title: "Validar presupuesto de pauta",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla facilisi cras ac tellus quis justo porta.",
        project_id: "launch_q4",
        section: "todo",
        assignee_id: "",
        due_day: 13,
        due_label: "13 sep",
        priority: "Alta",
        status: "Pend.",
        completed: false,
        tags: [
            "Pauta"
        ],
        subtasks: [],
        attachment_name: "presupuesto.pdf"
    },
    {
        id: "task_004",
        title: "Disenar piezas de lanzamiento",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed tempor arcu vitae ex dignissim, non gravida orci porttitor.",
        project_id: "launch_q4",
        section: "in_progress",
        assignee_id: "joaquin_sierra",
        due_day: 8,
        due_label: "8 sep",
        priority: "Alta",
        status: "Activa",
        completed: false,
        tags: [
            "Diseno"
        ],
        subtasks: [
            {
                id: "subtask_004",
                title: "Adaptar formatos para Instagram",
                completed: true
            },
            {
                id: "subtask_005",
                title: "Preparar versiones para pauta",
                completed: true
            },
            {
                id: "subtask_006",
                title: "Validar piezas con el cliente",
                completed: false
            }
        ],
        attachment_name: "brief-campana.pdf"
    },
    {
        id: "task_005",
        title: "Configurar campana en Meta",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque tempor odio a eros dictum, at mattis urna fermentum.",
        project_id: "launch_q4",
        section: "in_progress",
        assignee_id: "ana_martinez",
        due_day: 9,
        due_label: "9 sep",
        priority: "Media",
        status: "Activa",
        completed: false,
        tags: [
            "Ads"
        ],
        subtasks: [],
        attachment_name: "meta-setup.pdf"
    },
    {
        id: "task_006",
        title: "Aprobar mensajes principales",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus tincidunt leo at nibh viverra viverra.",
        project_id: "launch_q4",
        section: "completed",
        assignee_id: "carla_ruiz",
        due_day: 4,
        due_label: "4 sep",
        priority: "Media",
        status: "Lista",
        completed: true,
        tags: [
            "Copy"
        ],
        subtasks: [],
        attachment_name: "mensajes.pdf"
    },
    {
        id: "task_007",
        title: "Reunion de arranque",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec semper justo a lacus ullamcorper commodo.",
        project_id: "launch_q4",
        section: "completed",
        assignee_id: "ana_martinez",
        due_day: 2,
        due_label: "2 sep",
        priority: "Baja",
        status: "Lista",
        completed: true,
        tags: [
            "Planning"
        ],
        subtasks: [],
        attachment_name: "minuta.pdf"
    }
];


// Defines the starter notification list shown in the top bar bell dropdown.
export const notification_items = [
    {
        id: "notif_001",
        type: "assignment",
        actor_id: "david_urbina",
        title: "David Urbina te asigno una tarea",
        body: "Definir concepto creativo",
        time_label: "Hace 10 min",
        is_read: false
    },
    {
        id: "notif_002",
        type: "comment",
        actor_id: "carla_ruiz",
        title: "Carla Ruiz comento en Reunion de arranque",
        body: "\"Quedamos en revisar el brief manana.\"",
        time_label: "Hace 1 h",
        is_read: false
    },
    {
        id: "notif_003",
        type: "status_changed",
        actor_id: "ana_martinez",
        title: "Ana Martinez marco una tarea como completada",
        body: "Reunion de arranque",
        time_label: "Ayer",
        is_read: true
    }
];
