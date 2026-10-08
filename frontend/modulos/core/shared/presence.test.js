import {test} from "node:test";
import assert from "node:assert/strict";
import {filterPresence, groupPresence, presenceLabel, presencePatch, presenceDurations, quickPresenceStatuses, editablePresenceStatuses} from "./presence.js";

test("groups all people by their departments without duplicate memberships", () => {
    const it = {id: "it", name: "IT"}, sales = {id: "sales", name: "Ventas"};
    const rows = [{name: "Ana", status: "online", units: [it, it, sales]}, {name: "Luis", status: "busy", units: [it]}, {name: "David", status: "offline", units: [sales]}];
    assert.deepEqual(groupPresence(rows).map(group => [group.name, group.people.length]), [["IT", 2], ["Ventas", 2]]);
    assert.deepEqual(groupPresence(rows, "luis").map(group => [group.name, group.people[0].name]), [["IT", "Luis"]]);
    assert.deepEqual(groupPresence([], ""), []);
});
test("presence writes only editable fields and durations only for away/busy", () => {
    const value = {status: "busy", duration_minutes: "30", calendar_automatic: true, expires_at: "2099-01-01", user: "other"};
    assert.deepEqual(presencePatch(value), {status: "busy", duration_minutes: 30, calendar_automatic: true, title: "", description: ""});
    assert.equal(presencePatch({...value, status: "online"}).duration_minutes, 0);
    assert.deepEqual(presenceDurations.map(([minutes]) => minutes), [15, 30, 60, 120, 0]);
    assert.deepEqual(quickPresenceStatuses, ["online", "away", "busy"]);
    assert.deepEqual(editablePresenceStatuses, ["online", "away", "busy", "vacation", "custom"]);
});
test("presence includes offline people and filters names, states and departments", () => {
    const rows = [{name: "Ana", status: "online", units: [{id: "marketing"}]}, {name: "Luis", status: "custom", title: "En una entrega", description: "Escríbeme luego", units: [{id: "direction"}]}, {name: "David", status: "offline", units: [{id: "marketing"}]}];
    assert.equal(filterPresence(rows).length, 3);
    assert.deepEqual(filterPresence(rows, "marketing").map(row => row.name), ["Ana", "David"]);
    assert.deepEqual(filterPresence(rows, "", "ENTREGA").map(row => row.name), ["Luis"]);
    assert.deepEqual(filterPresence(rows, "", "luego").map(row => row.name), ["Luis"]);
    assert.equal(presenceLabel({status: "meeting"}), "En reunión");
    assert.deepEqual(filterPresence(rows, "", "desconectado").map(row => row.name), ["David"]);
});

test("active department comes first; filtering does not leak other memberships", () => {
    const it = {id: "it", name: "IT"}, sales = {id: "sales", name: "Ventas"}, empty = {id: "empty", name: "Administración"};
    const rows = [{name: "Ana", status: "away", units: [it, sales]}, {name: "Luis", status: "offline", units: [it]}];
    assert.deepEqual(groupPresence(rows, "", "", "sales", [it, sales, empty]).map(group => group.id), ["sales", "empty", "it"]);
    assert.deepEqual(groupPresence(rows, "", "sales", "it", [it, sales, empty]).map(group => [group.id, group.people.length]), [["sales", 1]]);
    assert.deepEqual(groupPresence(rows, "luis", "", "sales", [it, sales, empty]).map(group => group.id), ["it"]);
});
