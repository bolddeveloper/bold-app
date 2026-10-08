import assert from "node:assert/strict";
import { insertUnsectioned, reorderSections, materializePersonalSection } from "./section_order.js";

const sections = [{ id: "a" }, { id: "b" }, { id: "c" }];
assert.deepEqual(reorderSections(sections, "a", "c", true).map(item => item.id), ["b", "c", "a"]);
assert.deepEqual(reorderSections(sections, "c", "a").map(item => item.id), ["c", "a", "b"]);
assert.equal(reorderSections(sections, "a", "b"), sections);
assert.deepEqual(sections.map(item => item.id), ["a", "b", "c"]);
const virtual = { id: "unsectioned" };
assert.deepEqual(insertUnsectioned(sections, virtual, 1).map(item => item.id), ["a", "unsectioned", "b", "c"]);
assert.deepEqual(reorderSections(insertUnsectioned(sections, virtual, 1), "unsectioned", "c", true).map(item => item.id), ["a", "b", "c", "unsectioned"]);

const board = {sections, task_sections: {assigned: "b", hidden: "c"}, unsectioned_index: 1};
const renamed = materializePersonalSection(board, {id: "new", label: "Hoy"}, ["assigned", "unassigned"]);
assert.deepEqual(renamed.sections.map(item => item.id), ["a", "new", "b", "c"]);
assert.deepEqual(renamed.task_sections, {assigned: "b", hidden: "c", unassigned: "new"});
assert.equal(renamed.unsectioned_index, null);
assert.deepEqual(board.task_sections, {assigned: "b", hidden: "c"});
