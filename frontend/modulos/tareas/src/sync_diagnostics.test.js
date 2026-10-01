import test from "node:test";
import assert from "node:assert/strict";
import { createSyncDiagnostics, diagnosticRoute } from "../../core/sync_diagnostics.js";

test("diagnostics redact identity, ticket and query and aggregate without network", () => {
    assert.equal(diagnosticRoute("/api/v2/tasks/private-task-id/?ticket=secret&email=ana@bold.gt"), "/api/v2/tasks/:id");
    let now = 0;
    const diagnostics = createSyncDiagnostics({ enabled: true, now: () => now });
    const finish = diagnostics.beginHttp("/api/v2/tasks/private-task-id/?ticket=secret", "get");
    now = 400; finish(200); finish(500);
    const snapshot = diagnostics.snapshot();
    assert.equal(snapshot.activeHttp, 0); assert.equal(snapshot.peakHttp, 1);
    assert.equal(snapshot.counters["http:GET /api/v2/tasks/:id"], 1);
    assert.equal(JSON.stringify(snapshot).includes("secret"), false);
    assert.equal(JSON.stringify(snapshot).includes("private-task-id"), false);
    assert.equal(snapshot.counters["http-result:GET /api/v2/tasks/:id 500"], undefined);
});

test("disabled diagnostics collect nothing", () => {
    const diagnostics = createSyncDiagnostics();
    diagnostics.beginHttp("/api/v2/tasks/", "GET")(200);
    diagnostics.record("refresh", "event");
    assert.deepEqual(diagnostics.snapshot().counters, {});
});
