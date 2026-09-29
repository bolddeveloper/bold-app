import assert from "node:assert/strict";
import { test } from "node:test";
import { eventDay, guestSuggestions, matchesDay, selectedTimeRange, timedEventLayout } from "./calendar_data.js";

test("event dates follow the connected calendar time zone and all-day end is exclusive", () => {
    const zone = "America/Tegucigalpa";
    const timed = { start: { dateTime: "2026-09-30T02:00:00Z" }, end: { dateTime: "2026-09-30T03:00:00Z" } };
    assert.equal(eventDay(timed, zone), "2026-09-29");
    assert.equal(matchesDay(timed, "2026-09-29", zone), true);
    assert.equal(matchesDay(timed, "2026-09-30", zone), false);
    const allDay = { start: { date: "2026-09-29" }, end: { date: "2026-10-01" } };
    assert.equal(matchesDay(allDay, "2026-09-30", zone), true);
    assert.equal(matchesDay(allDay, "2026-10-01", zone), false);
});

test("timed grid keeps overlapping events in separate lanes", () => {
    const events = [
        { id: "a", start: { dateTime: "2026-09-29T09:00:00-06:00" }, end: { dateTime: "2026-09-29T10:00:00-06:00" } },
        { id: "b", start: { dateTime: "2026-09-29T09:30:00-06:00" }, end: { dateTime: "2026-09-29T11:00:00-06:00" } },
    ];
    const rows = timedEventLayout(events, "2026-09-29", "America/Tegucigalpa");
    assert.deepEqual(rows.map(row => [row.start, row.lane, row.columns]), [[540, 0, 2], [570, 1, 2]]);
});

test("dragging upward or downward includes the last half-hour", () => {
    assert.deepEqual(selectedTimeRange(540, 660), { start: 540, end: 690 });
    assert.deepEqual(selectedTimeRange(660, 540), { start: 540, end: 690 });
});

test("guest suggestions include known people and any complete external email", () => {
    const contacts = [{ name: "Pablo", email: "pablo@bold.gt" }];
    assert.equal(guestSuggestions("pa", [], contacts)[0].email, "pablo@bold.gt");
    assert.deepEqual(guestSuggestions("cliente@example.com", [], contacts).map(person => person.email), ["cliente@example.com"]);
    assert.deepEqual(guestSuggestions("cliente@", [], contacts), []);
    assert.deepEqual(guestSuggestions("pablo@bold.gt", ["pablo@bold.gt"], contacts), []);
});
