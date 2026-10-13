import assert from "node:assert/strict";
import { test } from "node:test";
import { currentTimeMarker, fromDay, eventDay, formatCalendarTime, mergeEventScopeDraft, guestSuggestions, matchesDay, minutesInZone, selectedTimeRange, timedEventLayout } from "./calendar_data.js";

test("calendar times use AM/PM in the viewer zone, including noon and midnight", () => {
    assert.equal(formatCalendarTime("2026-10-07T06:00:00Z", "America/Tegucigalpa"), "12:00 AM");
    assert.equal(formatCalendarTime("2026-10-07T18:00:00Z", "America/Tegucigalpa"), "12:00 PM");
    assert.equal(formatCalendarTime("2026-10-07T23:16:00Z", "America/Tegucigalpa"), "05:16 PM");
});

test("current time follows the viewer zone, including midnight", () => {
    const now = new Date("2026-10-07T06:00:00Z");
    assert.equal(minutesInZone(now, "America/Tegucigalpa"), 0);
    assert.equal(minutesInZone(now, "Asia/Tokyo"), 900);
});

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

test("suggestions match names with accents and joined words while excluding prior invitees",()=>{
    const contacts=[{name:"Jos\u00e9 Otero",email:"jos\u00e9@example.com"}];
    assert.equal(guestSuggestions("joseotero",[],contacts).length,1);
    assert.equal(guestSuggestions("jose",[],contacts).length,1);
    assert.deepEqual(guestSuggestions("jose",["jos\u00e9@example.com"],contacts),[]);
});

test("switching to a recurring series preserves unsaved fields without moving its start",()=>{
    const original={summary:"Evento",start:"2026-10-07T08:00",repeat:"DAILY",originalRepeat:"DAILY"};
    const current={...original,summary:"Nuevo nombre",repeat:"none"};
    const master={summary:"Evento",start:"2026-10-01T08:00",repeat:"DAILY",originalRepeat:"DAILY"};
    const result=mergeEventScopeDraft(current,original,master);
    assert.equal(result.start,master.start);assert.equal(result.summary,"Nuevo nombre");assert.equal(result.repeat,"none");assert.equal(result.originalRepeat,"DAILY");
});
import {dayKey, upcomingWeekDays} from "./calendar_data.js";

test("current week starts today while historical/future weeks remain complete", () => {
    const today = new Date(2026, 9, 7, 14);
    const current = upcomingWeekDays(today, today);
    assert.deepEqual(current.map(date => date.getDate()), [7, 8, 9, 10]);
    assert.equal(upcomingWeekDays(new Date(2026, 8, 28), today).length, 7);
    assert.equal(upcomingWeekDays(new Date(2026, 9, 15), today).length, 7);
    assert.equal(upcomingWeekDays(new Date(2026, 9, 10), new Date(2026, 9, 10)).length, 1);
    assert.deepEqual(upcomingWeekDays(new Date(2026, 9, 11), new Date(2026, 9, 11)).map(dayKey), ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    assert.deepEqual(upcomingWeekDays(new Date(2026, 9, 4), new Date(2026, 9, 6)).map(dayKey), ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
});

test("current marker uses the displayed date and zone, not the host date", () => {
    const now = new Date("2026-10-14T02:30:00Z");
    assert.deepEqual(currentTimeMarker([fromDay("2026-10-13")], now, "America/Guatemala"), {key: "2026-10-13", column: 0, top: 1066});
    assert.equal(currentTimeMarker([fromDay("2026-10-14")], now, "America/Guatemala"), null);
    assert.deepEqual(currentTimeMarker([fromDay("2026-10-14")], now, "Asia/Tokyo"), {key: "2026-10-14", column: 0, top: 598});
    assert.equal(currentTimeMarker([], now, "America/Guatemala"), null);
});

test("current marker moves with local minutes and does not appear in other weeks", () => {
    const days = [fromDay("2026-10-12"), fromDay("2026-10-13")];
    const marker = currentTimeMarker(days, new Date("2026-10-13T18:15:00Z"), "America/Guatemala");
    assert.equal(marker.column, 1);
    assert.equal(marker.top, 637);
    assert.equal(currentTimeMarker(days, new Date("2026-10-20T18:15:00Z"), "America/Guatemala"), null);
});
