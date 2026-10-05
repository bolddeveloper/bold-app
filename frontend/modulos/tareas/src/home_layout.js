export const HOME_WIDGET_TYPES = ["metrics", "tasks", "projects", "activity", "shortcuts", "status", "deadlines", "notes"];
export const HOME_WIDGET_SIZES = { small: true, medium: true, large: true };
export const HOME_WIDGET_COLUMNS = {
    notes: { small: 3, medium: 6, large: 8 },
    metrics: { small: 4, medium: 6, large: 8 },
    projects: { small: 3, medium: 4, large: 6 },
    tasks: { small: 3, medium: 5, large: 8 },
    activity: { small: 3, medium: 4, large: 6 },
    deadlines: { small: 3, medium: 4, large: 6 },
    shortcuts: { small: 3, medium: 6, large: 8 },
    status: { small: 3, medium: 6, large: 8 },
};
const legacySize = width => Number(width) >= 4 ? "large" : Number(width) >= 2 ? "medium" : "small";

export const defaultHomeLayout = () => [
    { id: "home_status", type: "status", size: "small", variant: "compact" },
    { id: "home_projects", type: "projects", size: "medium", variant: "compact" },
    { id: "home_tasks", type: "tasks", size: "medium", variant: "compact", tab: "today" },
    { id: "home_activity", type: "activity", size: "small", variant: "compact" },
    { id: "home_deadlines", type: "deadlines", size: "medium", variant: "compact" },
    { id: "home_shortcuts", type: "shortcuts", size: "medium", variant: "compact", shortcuts: ["create_task", "create_project", "module:reports"] },
];

export function widgetColumnSpan(widget, columns) {
    return Math.min(columns, HOME_WIDGET_COLUMNS[widget.type]?.[widget.size] || 3);
}

export function placeHomeWidgets(widgets, heights, columns, gap = 14) {
    const positions = {};
    if (columns === 1) {
        let top = 0;
        for (const widget of widgets) {
            positions[widget.id] = { column: 0, span: 1, top };
            top += Math.max(1, heights[widget.id] || 180) + gap;
        }
        return { positions, height: Math.max(0, top - (widgets.length ? gap : 0)) };
    }
    const rows = [];
    let row = [], used = 0;
    for (const widget of widgets) {
        const preferred = widgetColumnSpan(widget, columns);
        const minimum = Math.min(columns, HOME_WIDGET_COLUMNS[widget.type]?.small || preferred);
        if (row.length && columns - used < minimum) { rows.push(row); row = []; used = 0; }
        row.push({ widget, span: Math.min(preferred, columns - used) });
        used += row.at(-1).span;
        if (used === columns) { rows.push(row); row = []; used = 0; }
    }
    if (row.length) rows.push(row);
    let top = 0;
    rows.forEach(items => {
        // ponytail: one height per row avoids gaps; content above that height scrolls inside its widget.
        const rowHeight = Math.max(180, ...items.map(({ widget }) => heights[widget.id] || 280));
        items.at(-1).span += columns - items.reduce((total, item) => total + item.span, 0);
        let column = 0;
        for (const { widget, span } of items) {
            positions[widget.id] = { column, span, top, height: rowHeight };
            column += span;
        }
        top += rowHeight + gap;
    });
    return { positions, height: rows.length ? top - gap : 0 };
}

export function normalizeHomeLayout(value) {
    if (!Array.isArray(value)) return defaultHomeLayout();
    if (!value.length) return [];
    const ids = new Set();
    const widgets = value.filter(widget => {
        if (!widget || typeof widget.id !== "string" || ids.has(widget.id) || !HOME_WIDGET_TYPES.includes(widget.type)) return false;
        ids.add(widget.id); return true;
    }).map(({ width, height, lockedWidth, ...widget }) => ({
        ...widget,
        size: HOME_WIDGET_SIZES[widget.size] ? widget.size : legacySize(width),
        variant: "compact",
        metrics: widget.type === "metrics" ? [...new Set(widget.metrics || [])].filter(id => ["assigned", "today", "progress"].includes(id)) : widget.metrics,
        shortcuts: widget.type === "shortcuts" ? [...new Set(widget.shortcuts || [])] : widget.shortcuts,
    })).filter(widget => widget.type !== "metrics" || widget.metrics.length);
    const seenTypes = new Set();
    const unique = widgets.filter(widget => widget.type === "shortcuts" || (!seenTypes.has(widget.type) && seenTypes.add(widget.type)));
    return unique.length ? unique : defaultHomeLayout();
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
