// These sibling modules have their own queries and do not require the task graph.
export const requiresTaskData = module => !["calendar", "suggestions", "permissions", "administration"].includes(module);
