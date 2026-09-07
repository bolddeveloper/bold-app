import assert from "node:assert/strict";
import { buildHomeData } from "./home_data.js";
const now = new Date(2026, 8, 7);
const tasks = [{ id: 1, assignee_id: "a", section: "todo", due: now }, { id: 2, assignee_id: "a", section: "in_progress", due: new Date(2026, 8, 8) }, { id: 3, assignee_id: "b", section: "completed", completed: true, due: null }];
const data = buildHomeData(tasks, [{ id: "p" }], task => task.due, "a", now);
assert.deepEqual([data.assigned.length, data.dueToday.length, data.upcoming.length, data.inProgress.length], [2, 1, 1, 1]);
console.log("Home checks passed");
