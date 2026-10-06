import {test} from "node:test";
import assert from "node:assert/strict";
import {filterPresence, presenceLabel} from "./presence.js";
test("presence filters only connected/non-invisible people and never grants module access", () => {
    const rows = [{name: "Ana", status: "online", units: [{id: "marketing"}]}, {name: "Luis", status: "custom", title: "En una entrega", description: "Escríbeme luego", units: [{id: "direction"}]}, {name: "David", status: "offline", units: [{id: "marketing"}]}];
    assert.equal(filterPresence(rows).length, 2);
    assert.deepEqual(filterPresence(rows, "marketing").map(row => row.name), ["Ana"]);
    assert.deepEqual(filterPresence(rows, "", "ENTREGA").map(row => row.name), ["Luis"]);
    assert.deepEqual(filterPresence(rows, "", "luego").map(row => row.name), ["Luis"]);
    assert.equal(presenceLabel({status: "meeting"}), "En reunión");
});
