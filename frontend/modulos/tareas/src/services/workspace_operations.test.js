import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspaceFilters, filterWorkspaceTasks, groupWorkspaceTasks, sortWorkspaceTasks } from "./workspace_operations.js";

const tasks = [
    { id: "1", title: "Diseñar", project_id: "a", assignee_id: "ana", statusId: "active", priority: "Alta", due_date: "2026-09-14", created_at: "2026-09-01", completed: false, subtasks: [{ id: "child", completed: true }], attachments: [] },
    { id: "2", title: "Revisar", project_id: "b", assignee_id: "david", statusId: "active", priority: "Alta", due_date: "2026-09-15", created_at: "2026-09-02", completed: false, subtasks: [], attachments: [{ id: 1 }] },
    { id: "3", title: "Publicar", project_id: "a", assignee_id: "maria", statusId: "done", priority: "Baja", due_date: "2026-09-01", created_at: "2026-08-20", completed: true, subtasks: [], attachments: [] },
];

test("combina categorías con AND y valores de una categoría con OR", () => {
    const filters = { ...emptyWorkspaceFilters(), projects: ["a", "b"], assignees: ["ana", "david"], priorities: ["Alta"], statuses: ["active"] };
    assert.deepEqual(filterWorkspaceTasks(tasks, filters).map(task => task.id), ["1", "2"]);
    assert.deepEqual(filterWorkspaceTasks(tasks, { ...filters, projects: ["a"] }).map(task => task.id), ["1"]);
});

test("filtra fechas, subtareas, adjuntos y búsqueda simultáneamente", () => {
    const today = new Date(2026, 8, 14);
    const filters = { ...emptyWorkspaceFilters(), due: "next7", subtasks: "true", attachments: "false", createdFrom: "2026-09-01" };
    assert.deepEqual(filterWorkspaceTasks(tasks, filters, "dise", today).map(task => task.id), ["1"]);
    assert.deepEqual(filterWorkspaceTasks(tasks, { ...filters, due: "overdue" }, "", today), []);
});

test("ordena sin mutar la lista original y agrupa", () => {
    assert.deepEqual(sortWorkspaceTasks(tasks, "title").map(task => task.id), ["1", "3", "2"]);
    assert.deepEqual(tasks.map(task => task.id), ["1", "2", "3"]);
    assert.deepEqual(groupWorkspaceTasks(tasks, "project", { a: "Proyecto A", b: "Proyecto B" }).map(([label, rows]) => [label, rows.length]), [["Proyecto A", 2], ["Proyecto B", 1]]);
});
