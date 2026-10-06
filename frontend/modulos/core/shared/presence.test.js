import {test} from "node:test";
import assert from "node:assert/strict";
import {filterPresence, presenceLabel, presencePatch, presenceDurations, quickPresenceStatuses, editablePresenceStatuses} from "./presence.js";
test("presence writes only editable fields and durations only for away/busy", () => {
    const value = {status: "busy", duration_minutes: "30", calendar_automatic: true, expires_at: "2099-01-01", user: "other"};
    assert.deepEqual(presencePatch(value), {status: "busy", duration_minutes: 30, calendar_automatic: true, title: "", description: ""});
    assert.equal(presencePatch({...value, status: "online"}).duration_minutes, 0);
    assert.deepEqual(presenceDurations.map(([minutes]) => minutes), [15, 30, 60, 120, 0]);
    assert.deepEqual(quickPresenceStatuses, ["online", "away", "busy"]);
    assert.deepEqual(editablePresenceStatuses, ["online", "away", "busy", "vacation", "custom"]);
});
test("presence filters only connected/non-invisible people and never grants module access", () => {
    const rows = [{name: "Ana", status: "online", units: [{id: "marketing"}]}, {name: "Luis", status: "custom", title: "En una entrega", description: "Escríbeme luego", units: [{id: "direction"}]}, {name: "David", status: "offline", units: [{id: "marketing"}]}];
    assert.equal(filterPresence(rows).length, 2);
    assert.deepEqual(filterPresence(rows, "marketing").map(row => row.name), ["Ana"]);
    assert.deepEqual(filterPresence(rows, "", "ENTREGA").map(row => row.name), ["Luis"]);
    assert.deepEqual(filterPresence(rows, "", "luego").map(row => row.name), ["Luis"]);
    assert.equal(presenceLabel({status: "meeting"}), "En reunión");
});
