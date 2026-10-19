export function taskSyncOptions(environment = {}) {
    const incremental = environment?.VITE_TASK_INCREMENTAL_SYNC !== "false";
    const real = environment?.VITE_USE_REAL_BACKEND === "true";
    return {
        incremental,
        pagedComments: real && incremental && environment.VITE_TASK_PAGED_COMMENTS !== "false",
        pagedAttachments: real && incremental && environment.VITE_TASK_PAGED_ATTACHMENTS !== "false",
    };
}
