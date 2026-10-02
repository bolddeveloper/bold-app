import test from "node:test";
import assert from "node:assert/strict";
import { projectHasTasks } from "./project_deletion.js";

test("blocks project tasks, linked tasks and nested tasks; checks unloaded links and propagates failures", async () => {
    for (const tasks of [[{ project_id: "p" }], [{ taskProjects: [{ projectId: "p" }] }], [{ subtasks: [{ project_id: "p" }] }]]) {
        assert.equal(await projectHasTasks("p", tasks), true);
    }
    assert.equal(await projectHasTasks("p", [], async () => [{ task: "unloaded" }]), true);
    assert.equal(await projectHasTasks("p", [{ project_id: "other" }], async () => []), false);
    await assert.rejects(projectHasTasks("p", [], async () => { throw Error("offline"); }), /offline/);
});
