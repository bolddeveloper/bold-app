import { isMyTask } from "./services/task_models.js";
export const homeTaskCompleted = task => Boolean(task.completed || task.section === "completed" || task.statusCategory === "completed");

export function buildHomeData(tasks, projects, parseDueDate, userId, now = new Date(), notifications = []) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const afterWindow = new Date(today);
    afterWindow.setDate(afterWindow.getDate() + 3);
    const dated = tasks.map(task => { const parsed = parseDueDate(task), due = parsed && Number.isFinite(parsed.getTime()) ? new Date(parsed) : null; due?.setHours(0,0,0,0); return {task,due}; });
    const open = dated.filter(({ task }) => !homeTaskCompleted(task));
    const belongsToUser = task => isMyTask(task, userId);
    const assigned = open.filter(({ task }) => belongsToUser(task));
    const dueToday = assigned.filter(({ due }) => due?.getTime() === today.getTime());
    const attention = assigned.filter(({ due }) => due && due <= today).sort((a, b) => b.due - a.due);
    const upcoming = assigned.filter(({ due }) => due && due > today).sort((a,b) => a.due-b.due);
    const undated = assigned.filter(({ due }) => !due);
    const completed = tasks.filter(task => belongsToUser(task) && homeTaskCompleted(task));
    const inProgress = assigned.filter(({ task }) => (task.statusCategory || task.section) === "in_progress");
    return {
        overdue: assigned.filter(({due}) => due && due < today).sort((a,b) => a.due-b.due),
        weekly: Array.from({length:7},(_,index) => {
            const date = new Date(today); date.setDate(date.getDate() - (date.getDay()+6)%7 + index);
            const rows = dated.filter(({task,due}) => belongsToUser(task) && due?.getTime() === date.getTime());
            return {date,total:rows.length,completed:rows.filter(({task}) => homeTaskCompleted(task)).length};
        }),
        assigned,
        dueToday,
        attention,
        upcoming,
        undated,
        inProgress,
        statusCounts: { completed: completed.length, inProgress: inProgress.length, pending: assigned.length - inProgress.length },
        deadlines: assigned.filter(({ due }) => due && due < afterWindow).sort((a, b) => (a.due < today) - (b.due < today) || (a.due < today ? b.due - a.due : a.due - b.due)),
        activity: [
            ...tasks.filter(item => item.created_at && (!item.created_by_assignment || String(item.created_by_assignment) === String(userId))).map(item => ({ id: `task:${item.id}`, type: "task_created", title: `Creaste la tarea “${item.title}”`, created_at: item.created_at, task_id: item.id })),
            ...projects.filter(item => item.created_at && (!item.created_by_assignment || String(item.created_by_assignment) === String(userId))).map(item => ({ id: `project:${item.id}`, type: "project_created", title: `Creaste el proyecto “${item.label || item.name}”`, created_at: item.created_at, project_id: item.id })),
            ...notifications.map(item => ({ ...item, id: `notification:${item.id}` })),
        ].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)),
        projects: projects.map(project => {
            const projectTasks = tasks.filter(task => task.taskProjects ? task.taskProjects.some(link => link.projectId === project.id) : task.project_id === project.id);
            const completed = projectTasks.filter(homeTaskCompleted).length;
            return { ...project, total: projectTasks.length, completed };
        })
    };
}
