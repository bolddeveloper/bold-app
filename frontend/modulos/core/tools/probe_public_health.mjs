import { PROBE_ORIGIN, PROBE_STAGES, probePublicHealth } from "../../../testing/public_health_probe.mjs";
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
if (process.argv.length === 2) {
    console.log(JSON.stringify({ mode: "dry-run", origin: PROBE_ORIGIN, path: "/health/", stages: PROBE_STAGES,
        requestBudget: 40, writes: 0, retries: 0, tcpFamilyAttemptTimeoutMs: 2000,
        execute: "npm run probe:public-health -- --execute" }, null, 2));
} else if (process.argv.length === 3 && process.argv[2] === "--execute") {
    // Process-local instrument setting, not an app/OS/network-security change.
    // A 250ms TCP-family race under a burst caused false early ETIMEDOUT on this
    // Windows route. Keep TLS validation and the total 10s request deadline.
    const originalAttemptTimeoutMs = getDefaultAutoSelectFamilyAttemptTimeout();
    setDefaultAutoSelectFamilyAttemptTimeout(2000);
    const report = await probePublicHealth();
    report.instrument = { node: process.version, originalAttemptTimeoutMs, tcpFamilyAttemptTimeoutMs: 2000 };
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
} else { throw new Error("Solo se admite --execute; no se puede ampliar host/presupuesto/concurrencia."); }
