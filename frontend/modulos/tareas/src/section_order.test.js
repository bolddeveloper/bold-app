import assert from "node:assert/strict";
import { insertUnsectioned, reorderSections } from "./section_order.js";

const sections = [{ id: "a" }, { id: "b" }, { id: "c" }];
assert.deepEqual(reorderSections(sections, "a", "c", true).map(item => item.id), ["b", "c", "a"]);
assert.deepEqual(reorderSections(sections, "c", "a").map(item => item.id), ["c", "a", "b"]);
assert.equal(reorderSections(sections, "a", "b"), sections);
assert.deepEqual(sections.map(item => item.id), ["a", "b", "c"]);
const virtual = { id: "unsectioned" };
assert.deepEqual(insertUnsectioned(sections, virtual, 1).map(item => item.id), ["a", "unsectioned", "b", "c"]);
assert.deepEqual(reorderSections(insertUnsectioned(sections, virtual, 1), "unsectioned", "c", true).map(item => item.id), ["a", "b", "c", "unsectioned"]);
