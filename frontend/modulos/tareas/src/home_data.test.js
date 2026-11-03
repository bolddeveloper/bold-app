import assert from "node:assert/strict";
import { buildHomeData } from "./home_data.js";
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
const createdWithoutProject = buildHomeData([
    { id: "created", created_by_assignment: "a", assignee_id: "", collaborator_ids: [], completed: false },
], [], () => null, "a", now);
assert.deepEqual(createdWithoutProject.assigned.map(item => item.task.id), ["created"]);
const normalized = buildHomeData([
 {id:"done-status",assignee_id:"a",statusCategory:"completed",project_id:"p",due:new Date(2026,8,7,14)},
 {id:"invalid",assignee_id:"a",due:new Date("invalid")},
 {id:"later",assignee_id:"a",due:new Date(2026,8,10)},
 {id:"sooner",assignee_id:"a",due:new Date(2026,8,8)},
], [{id:"p"}], task=>task.due,"a",now);
assert.equal(normalized.assigned.length,3);
assert.equal(normalized.statusCounts.completed,1);
assert.deepEqual(normalized.upcoming.map(row=>row.task.id),["sooner","later"]);
assert.equal(normalized.undated[0].task.id,"invalid");
assert.equal(normalized.weekly[0].total,1);
assert.equal(normalized.weekly[0].completed,1);
assert.equal(normalized.projects[0].completed,1);
console.log("Home data checks passed");
