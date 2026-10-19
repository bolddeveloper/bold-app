import test from "node:test";
import assert from "node:assert/strict";
import {restoreTaskNavigation, readTaskNavigation} from "./task_navigation.js";

test("personal tasks preserve scope, board and Equipo across reloads", () => {
    for (const section of ["tasks", "timeline", "team", "states"]) {
        const saved = {scope: "mine", projectId: "last-project", section, view: "board"};
        assert.deepEqual(restoreTaskNavigation(JSON.parse(JSON.stringify(saved))), saved);
    }
});

test("project links override personal scope and cannot open Equipo", () => {
    assert.deepEqual(restoreTaskNavigation({scope: "mine", section: "team", view: "board"}, "?project=linked"), {
        scope: "project", projectId: "linked", section: "tasks", view: "board",
    });
});

test("project and workspace navigation retain their selected view", () => {
    for (const scope of ["project", "workspace"]) {
        const saved = {scope, projectId: "selected", section: "timeline", view: "list"};
        assert.deepEqual(restoreTaskNavigation(saved), saved);
        assert.equal(restoreTaskNavigation({...saved, section: "team"}).section, "tasks");
    }
});

test("invalid or unavailable storage falls back to personal tasks", () => {
    assert.deepEqual(restoreTaskNavigation({scope: "invalid", projectId: 12, section: "invalid", view: "invalid"}), {
        scope: "mine", projectId: "", section: "tasks", view: "list",
    });
    assert.equal(readTaskNavigation("missing", "").scope, "mine");
    assert.equal(readTaskNavigation("missing", "?project=linked").projectId, "linked");
});

test("reload keeps this tab's location while a new session uses the durable preference", () => {
    globalThis.sessionStorage = {getItem: key => key === "employee-a" ? JSON.stringify({scope: "mine", section: "team"}) : null};
    globalThis.localStorage = {getItem: key => key === "employee-a" ? JSON.stringify({scope: "project", projectId: "other-tab"}) : null};
    try {
        assert.equal(readTaskNavigation("employee-a", "").section, "team");
        assert.equal(readTaskNavigation("employee-b", "").scope, "mine");
        delete globalThis.sessionStorage;
        assert.equal(readTaskNavigation("employee-a", "").projectId, "other-tab");
    } finally {
        delete globalThis.sessionStorage;
        delete globalThis.localStorage;
    }
});

test("Estados survives reload in personal tasks and projects", () => {
    for (const scope of ["mine", "project"]) {
        const saved = {scope, projectId: "project-a", section: "states", view: "board"};
        assert.deepEqual(restoreTaskNavigation(saved), saved);
    }
});
