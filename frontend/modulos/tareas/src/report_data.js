export function buildReport(tasks, projects, days, parseDueDate, now = new Date()) {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days + 1);
    const rows = tasks.map(task => ({ task, due: parseDueDate(task) }))
        .filter(({ due }) => !days || (due && due >= start && due <= end));
    const completed = rows.filter(({ task }) => task.completed || task.section === "completed").length;
    const active = rows.filter(({ task }) => !task.completed && (task.statusCategory || task.section) === "in_progress").length;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const overdue = rows.filter(({ task, due }) => !task.completed && task.section !== "completed" && due && due < today).length;
    const weeks = Array.from({ length: 6 }, (_, index) => {
        const from = new Date(today);
        from.setDate(from.getDate() - ((from.getDay() + 6) % 7) - (5 - index) * 7);
        const to = new Date(from);
        to.setDate(to.getDate() + 7);
        return { label: from.toLocaleDateString("es", { day: "numeric", month: "short" }), count: rows.filter(({ task, due }) => (task.completed || task.section === "completed") && due >= from && due < to).length };
    });
    return { total: rows.length, completed, active, overdue, pending: rows.length - completed - active, weeks,
        projects: projects.map(project => {
            const items = rows.filter(({ task }) => task.taskProjects ? task.taskProjects.some(link => link.projectId === project.id) : task.project_id === project.id);
            return { ...project, total: items.length, completed: items.filter(({ task }) => task.completed || task.section === "completed").length };
        }) };
}
