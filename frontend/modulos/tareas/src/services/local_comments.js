// Keep local sends visible until the server page includes their confirmed IDs.
export function mergeLocalComments(rows, local, queries) {
    const ids = new Set(rows.map(row => String(row.id)));
    const extra = local.filter(comment => !ids.has(String(comment.id)) && queries.some(query => {
        if (query.image_section && (comment.image_section || "comments") !== query.image_section) return false;
        if (query.image_section === "timeline" && query.project && String(comment.image_project_id) !== String(query.project)) return false;
        if (query.tasks) return query.tasks.split(",").includes(String(comment.task || comment.task_id));
        if (query.project) return comment.local_projects?.includes(String(query.project));
        return query.mine === "1" && comment.local_mine;
    }));
    return [...rows, ...extra].sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
}
