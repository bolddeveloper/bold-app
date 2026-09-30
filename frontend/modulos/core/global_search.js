const childEntries = {
    home: [
        { id: "home-summary", label: "Resumen de inicio", keywords: "dashboard actividad reciente accesos rápidos" },
    ],
    tasks: [
        { id: "tasks-mine", label: "Mis tareas", target: "my_tasks", keywords: "asignadas pendientes trabajo personal" },
        { id: "tasks-projects", label: "Proyectos", target: "department_projects", keywords: "progreso departamentos proyecto" },
        { id: "tasks-workspaces", label: "Workspaces", target: "workspaces", keywords: "espacios carpetas organización" },
        { id: "tasks-schedule", label: "Cronograma", target: "schedules", keywords: "timeline fechas planificación" },
    ],
    calendar: [
        { id: "calendar-day", label: "Vista diaria", view: "day", keywords: "día agenda eventos" },
        { id: "calendar-week", label: "Vista semanal", view: "week", keywords: "semana eventos" },
        { id: "calendar-month", label: "Vista mensual", view: "month", keywords: "mes eventos" },
        { id: "calendar-agenda", label: "Agenda", view: "agenda", keywords: "lista próximos eventos" },
    ],
    administration: [
        { id: "admin-dashboard", label: "Resumen administrativo", view: "dashboard", keywords: "dashboard métricas empresa" },
        { id: "admin-employees", label: "Empleados", view: "employees", keywords: "cuentas personal colaboradores trabajadores" },
        { id: "admin-audit", label: "Auditoría", view: "audit", keywords: "registros eventos trazabilidad historial" },
        { id: "admin-organization", label: "Organización", view: "organization", keywords: "unidades cargos plazas estructura departamentos" },
        { id: "admin-connectors", label: "Conectores", view: "connectors", keywords: "integraciones google calendario" },
    ],
};

export function normalizeSearchText(value = "") {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}

export function buildNavigationSearchIndex(navigation = []) {
    return navigation.flatMap(module => {
        const root = {
            id: `module-${module.id}`,
            module: module.id,
            target: module.id,
            label: module.label,
            section: "Módulo",
            reference: module.label,
            keywords: `${module.label} ${module.id}`,
            icon: module.icon,
        };
        const children = (childEntries[module.id] || []).map(child => ({
            ...child,
            module: module.id,
            target: child.target || module.id,
            section: module.label,
            reference: `${module.label} › ${child.label}`,
            keywords: `${module.label} ${child.label} ${child.keywords || ""}`,
            icon: module.icon,
        }));
        return [root, ...children];
    });
}

function score(entry, query) {
    const label = normalizeSearchText(entry.label), reference = normalizeSearchText(entry.reference), haystack = normalizeSearchText(entry.keywords);
    if (label === query) return 0;
    if (label.startsWith(query)) return 1;
    if (reference.startsWith(query)) return 2;
    if (label.includes(query)) return 3;
    const tokens = query.split(/\s+/).filter(Boolean);
    if (tokens.every(token => haystack.includes(token))) return 4;
    return -1;
}

export function searchNavigation(navigation, value, limit = 8) {
    const query = normalizeSearchText(value);
    if (!query) return [];
    return buildNavigationSearchIndex(navigation)
        .map(entry => ({ entry, rank: score(entry, query) }))
        .filter(result => result.rank >= 0)
        .sort((left, right) => left.rank - right.rank || left.entry.label.localeCompare(right.entry.label, "es"))
        .slice(0, limit)
        .map(result => result.entry);
}
