import assert from "node:assert/strict";
import test from "node:test";
import {sharingSelection} from "./team_sharing.js";

test("mixed sections enable remaining displayed tasks without including filtered tasks", () => {
    const result = sharingSelection(["shown", "pending", "shown"], {task_ids: ["shown", "filtered"], inherited_ids: []});
    assert.deepEqual(result, {targets: ["shown", "pending"], selected: false, partial: true});
});
test("all published tasks can be hidden; inherited subtasks cannot be toggled independently", () => {
    assert.deepEqual(sharingSelection(["parent", "child"], {task_ids: ["parent"], inherited_ids: ["child"]}), {
        targets: ["parent"], selected: true, partial: false,
    });
    assert.deepEqual(sharingSelection(["child"], {task_ids: [], inherited_ids: ["child"]}), {
        targets: [], selected: true, partial: false,
    });
});
test("new tasks are hidden and an empty section is never selected", () => {
    assert.equal(sharingSelection(["new"], {task_ids: ["old"]}).selected, false);
    assert.deepEqual(sharingSelection([], null), {targets: [], selected: false, partial: false});
});
