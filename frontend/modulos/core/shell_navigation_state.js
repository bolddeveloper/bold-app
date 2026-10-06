const taskViews = new Set(["projects", "department_projects", "workspaces", "schedules"]);

export function isShellModuleAllowed(module, navigation) {
    return module === "profile" || navigation.some(item => item.id === module)
        || taskViews.has(module) && navigation.some(item => item.id === "tasks");
}

export function entranceModule(navigation, saved) {
    return isShellModuleAllowed(saved, navigation) ? saved : navigation.find(item => item.default)?.id || navigation[0]?.id;
}

export function historyModule(target, context, navigation) {
    if (!target || target.context !== context || !Number.isInteger(target.index)) return null;
    return isShellModuleAllowed(target.module, navigation) ? target.module : null;
}
