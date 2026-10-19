import test from "node:test";
import assert from "node:assert/strict";
import {brandDraft, brandFields, emptyBrand, toggleBrandLink} from "./brand_fields.js";

test("brand drafts preserve version, hidden references and do not mutate server data", () => {
    const row = {...emptyBrand(), revision: 3}; row.project_ids = ["hidden"];
    row.details.extra = {Objetivo: "Ventas"};
    const draft = brandDraft(row); draft.details.extra.Objetivo = "Otro";
    assert.equal(row.details.extra.Objetivo, "Ventas");
    assert.equal(draft.revision, 3); assert.deepEqual(draft.project_ids, ["hidden"]);
    assert.deepEqual(toggleBrandLink(["a"], "b"), ["a", "b"]);
    assert.deepEqual(toggleBrandLink(["a", "b"], "a"), ["b"]);
    assert.ok(brandFields.some(([key]) => key === "designer"));
});
