import assert from "node:assert/strict";
import test from "node:test";

import { fetchConsistentPermissionSnapshot } from "../../permisos/permissions_state.js";


function responseSet(revision) {
    return {
        policies: { revision, roles: [], rules: [] },
        grants: { revision, results: [] },
        authorities: { revision, results: [] },
        effective: { revision, results: [] },
    };
}

test("permission snapshots retry mixed revisions instead of pairing stale data with a new revision", async () => {
    let round = 0;
    const calls = { audit: 0 };
    const api = {
        access: async () => ({ policy_revision: ++round, can_read_audit: true, mfa_recent: true }),
        catalog: async () => [],
        rolePolicies: async () => responseSet(round === 1 ? 2 : round).policies,
        grants: async () => responseSet(round === 1 ? 2 : round).grants,
        authorities: async () => responseSet(round === 1 ? 2 : round).authorities,
        effective: async () => responseSet(round === 1 ? 2 : round).effective,
        audit: async () => { calls.audit += 1; return []; },
    };

    const snapshot = await fetchConsistentPermissionSnapshot({ api, unitId: "unit-1" });

    assert.equal(round, 2);
    assert.equal(snapshot.revision, 2);
    assert.equal(calls.audit, 2);
});

test("permission snapshots fail closed after repeated revision races and hide audit without recent MFA", async () => {
    let round = 0;
    const api = {
        access: async () => ({ policy_revision: ++round, can_read_audit: true, mfa_recent: false }),
        catalog: async () => [],
        rolePolicies: async () => responseSet(round + 1).policies,
        grants: async () => responseSet(round + 1).grants,
        authorities: async () => responseSet(round + 1).authorities,
        effective: async () => responseSet(round + 1).effective,
        audit: async () => { throw new Error("audit must not be requested"); },
    };

    await assert.rejects(
        fetchConsistentPermissionSnapshot({ api, unitId: "unit-1" }),
        /políticas cambiaron/,
    );
    assert.equal(round, 2);
});
