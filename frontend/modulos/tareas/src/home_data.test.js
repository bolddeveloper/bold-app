import assert from "node:assert/strict";
import { buildHomeData } from "./home_data.js";
const now = new Date(2026, 8, 7);
const tasks = [{ id: 1, assignee_id: "a", section: "todo", due: now }, { id: 2, assignee_id: "a", section: "in_progress", due: new Date(2026, 8, 8) }, { id: 3, assignee_id: "b", section: "completed", completed: true, due: null }];
const data = buildHomeData(tasks, [{ id: "p" }], task => task.due, "a", now);
assert.deepEqual([data.assigned.length, data.dueToday.length, data.upcoming.length, data.inProgress.length], [2, 1, 1, 1]);
const shared = { assignee_id: "b", collaborator_ids: ["a"], taskProjects: [{ projectId: "p" }, { projectId: "q" }], statusCategory: "in_progress" };
const v2 = buildHomeData([shared], [{ id: "p" }, { id: "q" }], () => null, "a", now);
assert.equal(v2.assigned.length, 0); // Following a task does not make it assigned to you.
assert.deepEqual(v2.projects.map(project => project.total), [1, 1]);
console.log("Home checks passed");
