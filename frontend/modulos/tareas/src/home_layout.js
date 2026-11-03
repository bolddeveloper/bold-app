export const HOME_WIDGET_TYPES = ["status", "agenda", "tasks", "weekly", "projects", "shortcuts", "activity", "notes"];
export const HOME_WIDGET_HEIGHT = 320;
export const defaultHomeLayout = () => [
    {id:"home_status",type:"status"}, {id:"home_agenda",type:"agenda"},
    {id:"home_tasks",type:"tasks",tab:"today"}, {id:"home_weekly",type:"weekly"},
    {id:"home_projects",type:"projects"},
    {id:"home_shortcuts",type:"shortcuts",shortcuts:["create_task","module:calendar","module:inbox","create_project"]},
];
export const widgetColumnSpan = (_widget, columns) => columns === 1 ? 1 : columns === 6 ? 3 : 4;
export function placeHomeWidgets(widgets, _heights, columns, gap = 14) {
    const span = widgetColumnSpan(null, columns), count = columns / span;
    const positions = Object.fromEntries(widgets.map((widget,index) => [widget.id, {
        column:index % count * span,span,top:Math.floor(index/count)*(HOME_WIDGET_HEIGHT+gap),height:HOME_WIDGET_HEIGHT,
    }]));
    return {positions,height:widgets.length ? Math.ceil(widgets.length/count)*(HOME_WIDGET_HEIGHT+gap)-gap : 0};
}
export function normalizeHomeLayout(value) {
    if (!Array.isArray(value)) return defaultHomeLayout();
    if (!value.length) return [];
    const widgets = [], ids = new Set();
    for (const item of value) {
        if (!item || typeof item.id !== "string" || ids.has(item.id)) continue;
        const type = item.type === "metrics" ? "status" : item.type === "deadlines" ? "tasks" : item.type;
        if (!HOME_WIDGET_TYPES.includes(type)) continue;
        ids.add(item.id);
        const duplicate = widgets.find(widget => widget.type === type);
        if (duplicate) {
            if (type === "shortcuts") duplicate.shortcuts = [...new Set([...duplicate.shortcuts,...(Array.isArray(item.shortcuts) ? item.shortcuts.filter(id => typeof id === "string") : [])])];
            continue;
        }
        const widget = {id:item.id,type};
        if (typeof item.title === "string") widget.title = item.title.slice(0,60);
        if (type === "tasks") widget.tab = ["today","overdue","upcoming","undated"].includes(item.tab) ? item.tab : "today";
        if (type === "shortcuts") widget.shortcuts = [...new Set(Array.isArray(item.shortcuts) ? item.shortcuts.filter(id => typeof id === "string") : [])];
        widgets.push(widget);
    }
    return widgets.length ? widgets : defaultHomeLayout();
}
export function migrateHomeLayout(value) {
    const widgets = normalizeHomeLayout(value);
    if (!Array.isArray(value) || !value.length) return widgets;
    for (const type of ["agenda","weekly"]) if (!widgets.some(widget => widget.type === type)) widgets.push({id:`home_${type}`,type});
    return widgets;
}

export function reorderHomeWidgets(widgets, draggedId, targetId, after = false) {
    const from = widgets.findIndex(widget => widget.id === draggedId);
    const target = widgets.findIndex(widget => widget.id === targetId);
    if (from < 0 || target < 0 || from === target) return widgets;
    const next = [...widgets], [dragged] = next.splice(from, 1);
    const destination = next.findIndex(widget => widget.id === targetId) + Number(after);
    next.splice(destination, 0, dragged);
    return next.every((widget, index) => widget === widgets[index]) ? widgets : next;
}
