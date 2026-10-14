// Server capability is viewer-specific. Never infer authorship from a name or task role.
export function canManageComment(comment, assignmentId = "", localMode = false) {
    if (!comment || comment.local_status) return false;
    if (!localMode) return comment.can_manage === true;
    const author = comment.author_assignment || comment.author_id;
    return Boolean(assignmentId && author && String(author) === String(assignmentId));
}
