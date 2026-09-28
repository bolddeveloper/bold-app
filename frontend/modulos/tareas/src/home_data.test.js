import assert from "node:assert/strict";
import { buildHomeData } from "./home_data.js";
import { defaultHomeLayout, normalizeHomeLayout, placeHomeWidgets, reorderHomeWidgets, widgetColumnSpan } from "./home_layout.js";
const now = new Date(2026, 8, 7);
const tasks = [{ id: 1, assignee_id: "a", section: "todo", due: now }, { id: 2, assignee_id: "a", section: "in_progress", due: new Date(2026, 8, 8) }, { id: 3, assignee_id: "b", section: "completed", completed: true, due: null }];
const data = buildHomeData(tasks, [{ id: "p" }], task => task.due, "a", now);
assert.deepEqual([data.assigned.length, data.dueToday.length, data.upcoming.length, data.inProgress.length], [2, 1, 1, 1]);
assert.deepEqual(data.statusCounts, { completed: 0, inProgress: 1, pending: 1 });
assert.deepEqual(data.deadlines.map(item => item.task.id), [1, 2]);
const overdue = buildHomeData([
    { id: "yesterday", assignee_id: "a", due: new Date(2026, 8, 6) },
    { id: "today", assignee_id: "a", due: new Date(2026, 8, 7) },
    { id: "two-days", assignee_id: "a", due: new Date(2026, 8, 9) },
    { id: "three-days", assignee_id: "a", due: new Date(2026, 8, 10) },
], [], task => task.due, "a", now);
assert.deepEqual(overdue.attention.map(item => item.task.id), ["today", "yesterday"]);
assert.deepEqual(overdue.deadlines.map(item => item.task.id), ["today", "two-days", "yesterday"]);
const recent = buildHomeData([
    { id: "today", title: "Hoy", assignee_id: "a", due: new Date(2026, 8, 29), created_at: "2026-09-29T12:00:00Z", created_by_assignment: "a" },
    { id: "tomorrow", assignee_id: "a", due: new Date(2026, 8, 30) },
    { id: "day-two", assignee_id: "a", due: new Date(2026, 9, 1) },
    { id: "day-three", assignee_id: "a", due: new Date(2026, 9, 2), created_at: "2026-09-29T14:00:00Z", created_by_assignment: "other" },
], [{ id: "p", label: "Nuevo", created_at: "2026-09-29T13:00:00Z", created_by_assignment: "a" }], task => task.due, "a", new Date(2026, 8, 29, 18), [{ id: "n", type: "comment", title: "Comentario", created_at: "2026-09-29T11:00:00Z" }]);
assert.deepEqual(recent.deadlines.map(item => item.task.id), ["today", "tomorrow", "day-two"]);
assert.deepEqual(recent.activity.map(item => item.id), ["project:p", "task:today", "notification:n"]);
const shared = { id: "shared", assignee_id: "b", collaborator_ids: ["a"], taskProjects: [{ projectId: "p" }, { projectId: "q" }], statusCategory: "in_progress", due: new Date(2026, 8, 8) };
const v2 = buildHomeData([shared, { id: "both", assignee_id: "a", collaborator_ids: ["a"], due: now }, { id: "done", assignee_id: "b", collaborator_ids: ["a"], completed: true }], [{ id: "p" }, { id: "q" }], task => task.due || null, "a", now);
assert.deepEqual(v2.assigned.map(item => item.task.id), ["shared", "both"]);
assert.deepEqual(v2.deadlines.map(item => item.task.id), ["both", "shared"]);
assert.deepEqual(v2.statusCounts, { completed: 1, inProgress: 1, pending: 1 });
assert.deepEqual(v2.projects.map(project => project.total), [1, 1]);
assert.deepEqual(defaultHomeLayout().map(widget => widget.type), ["status", "projects", "tasks", "activity", "deadlines", "shortcuts"]);
assert.deepEqual(normalizeHomeLayout([{ id: "a", type: "metrics", width: 9, metrics: ["today", "today", "bad"] }]), [{ id: "a", type: "metrics", size: "large", variant: "compact", metrics: ["today"], shortcuts: undefined }]);
assert.equal(normalizeHomeLayout([{ id: "a", type: "status", width: 2, variant: "compact" }])[0].variant, "compact");
assert.equal(normalizeHomeLayout([{ id: "a", type: "status", size: "small", title: "Mi resumen" }])[0].title, "Mi resumen");
assert.equal(normalizeHomeLayout([{ id: "a", type: "deadlines", width: 2, variant: "visual" }])[0].variant, "compact");
assert.equal(normalizeHomeLayout([{ id: "a", type: "activity", width: 2, height: 219 }])[0].size, "medium");
assert.equal(normalizeHomeLayout([{ id: "a", type: "activity", width: 2, height: 219 }])[0].height, undefined);
const order = [{ id: "a" }, { id: "b" }, { id: "c" }];
assert.deepEqual(reorderHomeWidgets(order, "a", "c", true).map(item => item.id), ["b", "c", "a"]);
assert.deepEqual(reorderHomeWidgets(order, "c", "a").map(item => item.id), ["c", "a", "b"]);
assert.equal(reorderHomeWidgets(order, "a", "a"), order);
assert.equal(reorderHomeWidgets(order, "a", "b"), order);
assert.deepEqual(normalizeHomeLayout([]), []);
assert.equal(normalizeHomeLayout([{ id: "a", type: "unknown" }]).length, 6);
assert.deepEqual(defaultHomeLayout().map(widget => widgetColumnSpan(widget, 12)), [3, 4, 5, 3, 4, 6]);
const reference = placeHomeWidgets(defaultHomeLayout(), {}, 12);
assert.deepEqual([reference.positions.home_status.column, reference.positions.home_projects.column, reference.positions.home_tasks.column, reference.positions.home_activity.column, reference.positions.home_deadlines.column, reference.positions.home_shortcuts.column, reference.positions.home_shortcuts.span], [0, 3, 7, 0, 3, 7, 5]);
const compactRows = placeHomeWidgets(defaultHomeLayout(), { home_status: 180, home_projects: 292, home_tasks: 180, home_activity: 180, home_deadlines: 180, home_shortcuts: 190 }, 12);
assert.deepEqual([compactRows.positions.home_status.height, compactRows.positions.home_activity.top, compactRows.height], [292, 306, 496]);
const moved = ["status", "tasks", "projects", "shortcuts", "activity", "deadlines"].map(type => defaultHomeLayout().find(widget => widget.type === type));
for (const widgets of [defaultHomeLayout(), moved, [...moved].reverse()]) for (const columns of [6, 12]) {
    const placed = placeHomeWidgets(widgets, {}, columns);
    const rows = new Map();
    for (const position of Object.values(placed.positions)) {
        assert.equal(position.height, 280);
        if (!rows.has(position.top)) rows.set(position.top, []);
        rows.get(position.top).push(position);
    }
    for (const row of rows.values()) {
        row.sort((a, b) => a.column - b.column);
        assert.equal(row[0].column, 0);
        for (let i = 1; i < row.length; i++) assert.equal(row[i].column, row[i - 1].column + row[i - 1].span);
        assert.equal(row.at(-1).column + row.at(-1).span, columns);
    }
    assert.equal(placed.height, rows.size * 294 - 14);
}
const mobileLayout = placeHomeWidgets(defaultHomeLayout().slice(0, 2), { home_status: 310, home_projects: 220 }, 1);
assert.equal(mobileLayout.positions.home_projects.top, 324);
console.log("Home checks passed");
