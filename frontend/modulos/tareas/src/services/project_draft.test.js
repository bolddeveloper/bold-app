import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createProjectDraftInitializer, initialProjectMemberIds } from "./project_draft.js";

test("new projects and department changes do not automatically select the department", () => {
    const people = [{ id: "ana" }, { id: "carla" }];
    assert.deepEqual(initialProjectMemberIds(null, people), []);
    assert.deepEqual(initialProjectMemberIds({ member_ids: ["ana", "other", "ana"] }, people), ["ana"]);
});

test("live refresh preserves the selection until closing or changing the project/identity", () => {
    const initializer = createProjectDraftInitializer();
    let draft = [];
    initializer.initialize("assignment:new", () => { draft = []; });
    draft = ["ana"];
    assert.equal(initializer.initialize("assignment:new", () => { draft = ["ana", "carla"]; }), false);
    assert.deepEqual(draft, ["ana"]);
    initializer.reset();
    assert.equal(initializer.initialize("assignment:new", () => { draft = []; }), true);
    assert.deepEqual(draft, []);
    assert.equal(initializer.initialize("assignment:other-project", () => { draft = ["carla"]; }), true);
    assert.deepEqual(draft, ["carla"]);
    assert.equal(initializer.initialize("other-assignment:other-project", () => {}), true);
});

test("a failed initialization can be retried", () => {
    const initializer = createProjectDraftInitializer();
    assert.throws(() => initializer.initialize("new", () => { throw Error("unavailable"); }));
    assert.equal(initializer.initialize("new", () => {}), true);
});

test("project forms use atomic member_ids rather than per-person API requests", () => {
    const source = readFileSync(new URL("../task_app.jsx", import.meta.url), "utf8");
    assert.match(source, /member_ids: project_people_ids/);
    assert.match(source, /api\.update\("projects", project_id, \{ member_ids \}\)/);
    assert.doesNotMatch(source, /api\.(?:create|update|remove)\("project-members"/);
    assert.match(source, /project_form_initialized\.current\.initialize\(draftKey/);
    assert.match(source, /set_project_people_ids\(initialProjectMemberIds\(project, unitPeople\)\)/);
});
