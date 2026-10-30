import test from "node:test";
import assert from "node:assert/strict";
import {restoreTaskNavigation, readTaskNavigation, readCollapsedSections, writeCollapsedSections, readTaskFilters, writeTaskFilters, taskViewKey, readTaskView} from "./task_navigation.js";

test("project/workspace views belong to the active assignment; Estados and personal board are restored", () => {
    const values = new Map();
    globalThis.localStorage = {getItem: key => values.get(key)};
    try {
        const mine = taskViewKey("assignment-a", "mine"), project = taskViewKey("assignment-a", "project", "project-a");
        values.set(mine, "board"); values.set(project, "states");
        assert.deepEqual(readTaskView(mine), {section: "tasks", view: "board"});
        assert.deepEqual(readTaskView(project, "project"), {section: "states", view: "list"});
        assert.deepEqual(readTaskView(taskViewKey("assignment-b", "project", "project-a"), "project"), {section: "tasks", view: "list"});
        assert.notEqual(taskViewKey("assignment-a", "workspace", "folder-a"), taskViewKey("assignment-a", "workspace", "folder-b"));
        values.set(project, "team"); assert.equal(readTaskView(project, "project").section, "tasks");
    } finally {delete globalThis.localStorage;}
});

test("los filtros sobreviven recargas y no se mezclan entre cargos o proyectos", () => {
    const saved = new Map();
    globalThis.localStorage = {getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)};
    try {
        writeTaskFilters("cargo-a:mine", {assignee_ids:["ana","ana"],collaborator_ids:["luis"],priorities:["Alta"],sections:["Pendiente"]});
        assert.deepEqual(readTaskFilters("cargo-a:mine"), {assignee_ids:["ana"],collaborator_ids:["luis"],priorities:["Alta"],sections:["Pendiente"]});
        assert.deepEqual(readTaskFilters("cargo-b:mine").assignee_ids, []);
        writeTaskFilters("cargo-a:project", {priorities:["Baja"]});
        assert.deepEqual(readTaskFilters("cargo-a:mine").priorities,["Alta"]);
        writeTaskFilters("cargo-a:mine", {});
        assert.deepEqual(readTaskFilters("cargo-a:mine").priorities,[]);
        saved.set("bad", '{"assignee_ids":[{},null,4],"priorities":"invalid"}');
        assert.deepEqual(readTaskFilters("bad").assignee_ids,[]);
        saved.set("bad", "no-json");
        assert.deepEqual(readTaskFilters("bad").sections,[]);
        globalThis.localStorage = {getItem(){throw Error("storage");},setItem(){throw Error("storage");}};
        assert.doesNotThrow(()=>writeTaskFilters("bad",{}));
        assert.deepEqual(readTaskFilters("bad").priorities,[]);
    } finally {delete globalThis.localStorage;}
});

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

test("las secciones contraídas sobreviven recargas y se aíslan por cargo y tablero", () => {
    const saved = new Map();
    globalThis.localStorage = {getItem:key=>saved.get(key), setItem:(key,value)=>saved.set(key,value)};
    try {
        const personal="cargo-a:mine:personal:collapsed-sections", project="cargo-a:project:proyecto:collapsed-sections", other="cargo-b:mine:personal:collapsed-sections";
        writeCollapsedSections(personal,["pendiente","completadas"]);
        writeCollapsedSections(project,["pendiente"]);
        assert.deepEqual(readCollapsedSections(personal),["pendiente","completadas"]);
        assert.deepEqual(readCollapsedSections(project),["pendiente"]);
        assert.deepEqual(readCollapsedSections(other),[]);
        writeCollapsedSections(personal,[]);
        assert.deepEqual(readCollapsedSections(personal),[]);
        assert.deepEqual(readCollapsedSections(project),["pendiente"]);
        saved.set(personal,'{"incorrecto":true}');
        assert.deepEqual(readCollapsedSections(personal),[]);
        saved.set(personal,'["pendiente","pendiente",null,{},1]');
        assert.deepEqual(readCollapsedSections(personal),["pendiente",1]);
        saved.set(personal,'no-json');
        assert.deepEqual(readCollapsedSections(personal),[]);
        globalThis.localStorage = {getItem(){throw Error("storage");}, setItem(){throw Error("storage");}};
        assert.deepEqual(readCollapsedSections(personal),[]);
        assert.doesNotThrow(()=>writeCollapsedSections(personal,["pendiente"]));
    } finally {delete globalThis.localStorage;}
});
