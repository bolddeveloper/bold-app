import test from "node:test";
import assert from "node:assert/strict";
import { workspaceTabs, emptyWorkspaceTabs } from "../core/workspace_tabs.js";

test("tabs deduplicate, select and close to previous while home remains fixed", () => {
    let state = emptyWorkspaceTabs();
    for (const id of ["a", "b", "a"]) state = workspaceTabs(state, {type: "open", file: {id}});
    assert.deepEqual(state.tabs.map(file => file.id), ["a", "b"]);
    assert.equal(state.active, "a");
    state = workspaceTabs(state, {type: "select", id: "b"});
    state = workspaceTabs(state, {type: "close", id: "b"});
    assert.equal(state.active, "a");
    state = workspaceTabs(state, {type: "close", id: "a"});
    assert.equal(state.active, null);
    assert.equal(workspaceTabs(state, {type: "select", id: "missing"}).active, null);
});

test("same account preserves tabs; switching or disconnecting clears them", () => {
    let state = workspaceTabs(emptyWorkspaceTabs(), {type: "account", key: "userA-googleA"});
    state = workspaceTabs(state, {type: "open", file: {id: "a"}});
    assert.equal(workspaceTabs(state, {type: "account", key: "userA-googleA"}).tabs.length, 1);
    assert.equal(workspaceTabs(state, {type: "account", key: "userA-googleB"}).tabs.length, 0);
    assert.equal(workspaceTabs(state, {type: "account", key: ""}).active, null);
});
