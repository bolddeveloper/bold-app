import test from "node:test";
import assert from "node:assert/strict";
import { cleanWorkspaces, readWorkspaces, saveWorkspaces, folderBranch, folderPath, folderSummary, transferFolderItems, tasksInWorkspace, toggleWorkspaceItem, workspaceStorageKey } from "./workspace_store.js";

test("invalid storage is reported without overwriting data; inaccessible references survive", () => {
    assert.throws(() => readWorkspaces({ getItem: () => "{" }, "u1"));
    const cleaned = cleanWorkspaces([{ id: "w", name: " Estudio ", projectIds: ["p", "missing", "p"], taskIds: ["t", "missing"] }], ["p"], ["t"]);
    assert.deepEqual(cleaned[0].projectIds, ["p", "missing"]);
    assert.deepEqual(cleaned[0].taskIds, ["t", "missing"]);
    assert.equal(cleaned[0].parentId, null);
    assert.equal(workspaceStorageKey("u1"), "bold_workspaces:v2:u1");
});

test("migration keeps v1 backup and failed saves leave prior data intact", () => {
    const original = JSON.stringify([{ id: "a", name: "Estudio", projectIds: ["p"], taskIds: [] }]);
    const data = new Map([["bold_workspaces:v1:u", original]]);
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    const migrated = readWorkspaces(storage, "u");
    assert.equal(migrated[0].parentId, null);
    assert.equal(data.get("bold_workspaces:v1:u"), original);
    assert.deepEqual(readWorkspaces(storage, "u"), migrated);
    const before = data.get(workspaceStorageKey("u"));
    assert.throws(() => saveWorkspaces({ ...storage, setItem: () => { throw new Error("quota"); } }, "u", []));
    assert.equal(data.get(workspaceStorageKey("u")), before);
    assert.deepEqual(readWorkspaces(storage, "other"), []);
});

test("tree repairs cycles and orphan parents and permits names in separate branches", () => {
    const items = cleanWorkspaces([{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }, { id: "c", name: "C", parentId: "missing" }, { id: "d", name: "C", parentId: "a" }, { id: "a", name: "duplicate" }]);
    assert.equal(items.length, 4);
    assert.equal(items.find(item => item.id === "c").parentId, null);
    assert.equal(items.find(item => item.id === "d").name, "C");
    assert.deepEqual(folderPath(items, "b").map(item => item.id), ["a", "b"]);
});

test("recursive summary deduplicates tasks and branch deletion preserves other associations", () => {
    const items = cleanWorkspaces([{ id: "a", name: "A", projectIds: ["p"] }, { id: "b", name: "B", parentId: "a", projectIds: ["p", "q"], taskIds: ["t"] }, { id: "c", name: "C", taskIds: ["t"] }]);
    const tasks = [{ id: "t", completed: true, taskProjects: [{ projectId: "p" }, { projectId: "q" }] }, { id: "u", project_id: "q", completed: false }];
    assert.deepEqual(folderSummary(items, "a", [{ id: "p" }, { id: "q" }], tasks), { folders: 1, projects: 2, tasks: 2, done: 1, progress: 50 });
    const removed = new Set(folderBranch(items, "a").map(item => item.id));
    assert.deepEqual(items.filter(item => !removed.has(item.id)).map(item => item.taskIds), [["t"]]);
    assert.equal(tasks.length, 2);
});

test("bulk move preserves other memberships and protects inherited tasks", () => {
    const items = cleanWorkspaces([{ id: "a", name: "A", projectIds: ["p"], taskIds: ["t"] }, { id: "b", name: "B" }, { id: "c", name: "C", taskIds: ["t"] }]);
    const selection = [{ field: "projectIds", id: "p" }, { field: "taskIds", id: "t" }];
    const moved = transferFolderItems(items, "a", "b", selection, "move");
    assert.deepEqual(moved.map(item => item.taskIds), [[], ["t"], ["t"]]);
    assert.deepEqual(moved[1].projectIds, ["p"]);
    assert.throws(() => transferFolderItems(items, "a", "b", [{ field: "taskIds", id: "inherited" }], "move"));
    assert.deepEqual(transferFolderItems(items, "a", "b", [{ field: "taskIds", id: "inherited" }], "add")[1].taskIds, ["inherited"]);
    assert.deepEqual(transferFolderItems(items, "a", null, selection, "remove")[0].projectIds, []);
    assert.throws(() => transferFolderItems(items, "a", "a", selection, "move"));
});

test("workspace membership is multiple and project tasks are included once", () => {
    let workspaces = [{ id: "a", name: "A", projectIds: [], taskIds: [] }, { id: "b", name: "B", projectIds: [], taskIds: [] }];
    workspaces = toggleWorkspaceItem(toggleWorkspaceItem(workspaces, "a", "projectIds", "p"), "b", "projectIds", "p");
    assert.deepEqual(workspaces.map(item => item.projectIds), [["p"], ["p"]]);
    const tasks = [{ id: "t", project_id: "p" }, { id: "loose", project_id: null }, { id: "other", project_id: "q" }];
    assert.deepEqual(tasksInWorkspace({ ...workspaces[0], taskIds: ["t", "loose"] }, tasks).map(task => task.id), ["t", "loose"]);
});
