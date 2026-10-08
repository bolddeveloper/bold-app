import test from "node:test";
import assert from "node:assert/strict";
import {uniquePeople, removePersonAssignments} from "./people.js";

test("multiple department assignments produce one person and preserve the selected assignment", () => {
    const rows = [{id: "sales", personId: "sam", unitId: "sales"}, {id: "it", employee: "sam", unitId: "it"}, {id: "other", personId: "other"}];
    assert.deepEqual(uniquePeople(rows, ["it"]).map(row => row.id), ["it", "other"]);
    assert.deepEqual(uniquePeople(rows.filter(row => row.unitId === "it")).map(row => row.id), ["it"]);
});
test("owner takes precedence; equal names do not merge different people", () => {
    const rows = [{id: "member", personId: "sam", name: "Samuel"}, {id: "owner", personId: "sam", name: "Samuel"}, {id: "other", personId: "another", name: "Samuel"}];
    assert.deepEqual(uniquePeople(rows, ["owner", "member", "owner"]).map(row => row.id), ["owner", "other"]);
});
test("legacy directory entries can deduplicate by normalized email", () => {
    assert.equal(uniquePeople([{id: "a", email: "SAM@bold.gt"}, {id: "b", email: "sam@bold.gt"}]).length, 1);
    assert.equal(uniquePeople([{id: "a", name: "Sam"}, {id: "b", name: "Sam"}]).length, 2);
});

test("removing a person clears duplicate assignments and preserves other members", () => {
    const rows = [{id: "sales", personId: "sam"}, {id: "it", personId: "sam"}, {id: "other", personId: "another"}];
    assert.deepEqual(removePersonAssignments(["sales", "it", "other", "unknown"], "it", rows), ["other", "unknown"]);
    assert.deepEqual(removePersonAssignments(["it", "unknown"], "unknown", rows), ["it"]);
});
