export function buildHomeData(tasks, projects, parseDueDate, userId, now = new Date()) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const dated = tasks.map(task => ({ task, due: parseDueDate(task) }));
    const open = dated.filter(({ task }) => !task.completed && task.section !== "completed");
    const assigned = open.filter(({ task }) => task.assignee_id === userId || (!task.taskProjects && task.collaborator_ids?.includes(userId)));
    const dueToday = assigned.filter(({ due }) => due?.getTime() === today.getTime());
    const upcoming = assigned.filter(({ due }) => due && due > today);
    const undated = assigned.filter(({ due }) => !due);
    return {
        assigned,
        dueToday,
        upcoming,
        undated,
        inProgress: assigned.filter(({ task }) => (task.statusCategory || task.section) === "in_progress"),
        projects: projects.map(project => {
            const projectTasks = tasks.filter(task => task.taskProjects ? task.taskProjects.some(link => link.projectId === project.id) : task.project_id === project.id);
            const completed = projectTasks.filter(task => task.completed || task.section === "completed").length;
            return { ...project, total: projectTasks.length, completed };
        })
    };
}
