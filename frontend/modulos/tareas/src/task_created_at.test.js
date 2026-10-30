import assert from "node:assert/strict";
import test from "node:test";
import {taskCreationTime} from "./task_created_at.js";

test("original server timestamp includes localized date, time and an explicit timezone",()=>{
    const value=taskCreationTime("2026-10-30T15:45:23Z",{locale:"en-GB",timeZone:"America/Guatemala"});
    assert.equal(value.iso,"2026-10-30T15:45:23.000Z");
    assert.match(value.label,/30 Oct 2026/);assert.match(value.label,/09:45:23/);assert.match(value.label,/GMT-6/);
    assert.equal(taskCreationTime("2026-10-30T09:45:23-06:00").iso,value.iso);
});
test("missing or ambiguous dates are not invented from now or update time",()=>{
    for(const value of [undefined,null,"","2026-10-30","2026-10-30T15:45:23","2026-02-30T12:00:00Z","invalid",{},123])assert.equal(taskCreationTime(value),null);
});
