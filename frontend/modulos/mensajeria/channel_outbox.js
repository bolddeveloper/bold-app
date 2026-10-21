// Keep the original file, payload and UUID together until the server confirms.
// In particular, a lost response must not apply another image's caption/task.
export function lockChannelMedia(item, {parentId = null, taskId = null} = {}) {
    if (item.attempt) return item;
    return {...item, attempted:true, attempt:{body:item.caption.trim(), client_id:item.id, parent_id:parentId, ...(taskId ? {task_id:taskId} : {})}};
}

export function unlockRejectedChannelMedia(item) {
    const {attempt, ...draft} = item;
    return {...draft, attempted:false};
}
