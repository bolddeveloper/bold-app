import test from "node:test";
import assert from "node:assert/strict";
import { simulateSyncCapacity } from "../../../testing/sync_capacity.mjs";

for (const clients of [5, 10, 25]) test(`${clients} simulated tabs: bounded tickets, no idle invalidation or leaked connection`, async () => {
    const report = await simulateSyncCapacity({ clients, units: 13 });
    assert.equal(report.initialRevisionReads, clients);
    assert.equal(report.periodicRevisionReads, clients * 60);
    assert.equal(report.initialTickets, clients * 14);
    assert.equal(report.openSockets, clients * 14);
    assert.equal(report.peakConcurrentTicketsPerTab, 2);
    assert.equal(report.idleInvalidations, 0);
    assert.equal(report.revokedTabs, clients);
    assert.equal(report.remainingTimers, 0);
    assert.equal(report.remainingSockets, 0);
    assert.equal(report.remainingOnlineListeners, 0);
});
test("two tabs: hidden backup generates no polling, but receives the same revocation", async () => {
    const report = await simulateSyncCapacity({ clients: 2, hiddenTabs: 1 });
    assert.equal(report.periodicRevisionReads, 60);
    assert.equal(report.revokedTabs, 2);
    assert.equal(report.initialTickets, 4);
    assert.equal(report.remainingTimers, 0);
});
test("capacity harness rejects unbounded scenarios", async () => {
    await assert.rejects(simulateSyncCapacity({ clients: 26 }));
    await assert.rejects(simulateSyncCapacity({ minutes: 1440 }));
});
