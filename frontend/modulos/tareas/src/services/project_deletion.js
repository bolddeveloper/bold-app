export async function projectHasTasks(projectId, tasks, loadLinks) {
    const contains = rows => rows.some(task => String(task.project_id) === String(projectId)
        || task.taskProjects?.some(link => String(link.projectId) === String(projectId))
        || contains(task.subtasks || []));
    if (contains(tasks)) return true;
    return loadLinks ? (await loadLinks(projectId)).length > 0 : false;
}
