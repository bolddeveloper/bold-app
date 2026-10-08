import assert from "node:assert/strict";
import test from "node:test";
import {mergeLocalComments} from "./local_comments.js";

test("local comments stay in their task or scope and disappear when confirmed rows arrive", () => {
    const local = [{id: "local1", task: "t1", local_projects: ["p1"], local_mine: true}, {id: "local2", task: "t2"}];
    assert.deepEqual(mergeLocalComments([], local, [{tasks: "t1"}]), [local[0]]);
    assert.deepEqual(mergeLocalComments([], local, [{project: "p1"}]), [local[0]]);
    assert.deepEqual(mergeLocalComments([], local, [{mine: "1"}]), [local[0]]);
    assert.deepEqual(mergeLocalComments([], local, []), []);
    assert.deepEqual(mergeLocalComments([{id: "local1", body: "confirmed"}], local, [{tasks: "t1"}]), [{id: "local1", body: "confirmed"}]);
});

test("new comments stay at the bottom before and after confirmation regardless of incoming order", () => {
    const older = {id: "old", task: "t1", created_at: "2026-10-08T10:00:00Z"};
    const newer = {id: "newer", task: "t1", created_at: "2026-10-08T10:01:00Z"};
    const first = {id: "local1", task: "t1", created_at: "2026-10-08T10:02:00Z", local_status: "sending"};
    const second = {id: "local2", task: "t1", created_at: "2026-10-08T10:03:00Z", local_status: "sending"};
    const rows = [newer, older], local = [second, first], queries = [{tasks: "t1"}];
    assert.deepEqual(mergeLocalComments(rows, local, queries).map(row => row.id), ["old", "newer", "local1", "local2"]);
    const saved = {...first, id: "server1", local_status: "saved"};
    assert.deepEqual(mergeLocalComments([saved, ...rows], [second, saved], queries).map(row => row.id), ["old", "newer", "server1", "local2"]);
    assert.deepEqual(rows, [newer, older]);
    assert.deepEqual(local, [second, first]);
});

test("timeline views only include sends from that timeline and project", () => {
    const local = [
        {id: "task", task: "t1", local_projects: ["p1"]},
        {id: "timeline", task: "t1", image_section: "timeline", image_project_id: "p1", local_projects: ["p1"]},
        {id: "other-project", task: "t1", image_section: "timeline", image_project_id: "p2", local_projects: ["p1", "p2"]},
    ];
    assert.deepEqual(mergeLocalComments([], local, [{tasks: "t1", image_section: "timeline"}]).map(row => row.id), ["timeline", "other-project"]);
    assert.deepEqual(mergeLocalComments([], local, [{project: "p1", image_section: "timeline"}]).map(row => row.id), ["timeline"]);
});
